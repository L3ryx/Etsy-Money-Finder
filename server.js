require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/*
====================================================
UTILS
====================================================
*/

function toBase64(buffer) {
  return buffer.toString("base64");
}

function emitProgress(socket, message) {
  if (socket) {
    socket.emit("progress", {
      message,
      time: new Date().toISOString()
    });
  }
}

/*
====================================================
REAL IMAGE SIMILARITY (OPENAI)
====================================================
*/

async function calculateSimilarity(base64A, base64B) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Compare these two product images and return ONLY a similarity score between 0 and 1."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64A}`
                }
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64B}`
                }
              }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const text = response.data.choices[0].message.content;
    const match = text.match(/0\.\d+|1(\.0+)?/);

    return match ? parseFloat(match[0]) : 0;

  } catch (err) {
    console.log("Similarity error:", err.message);
    return 0;
  }
}

/*
====================================================
ANALYSIS ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  console.log("🟢 Analysis request received");

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded" });
  }

  for (const file of req.files) {

    emitProgress(socket, "📥 Image received");

    const base64Input = toBase64(file.buffer);

    /*
    ====================================================
    SEARCH IMAGE ON ALIEXPRESS
    ====================================================
    */

    emitProgress(socket, "🔎 Searching AliExpress image search");

    const searchResponse = await axios.get(
      "http://api.scraperapi.com",
      {
        params: {
          api_key: process.env.SCRAPERAPI_KEY,
          url: "https://www.aliexpress.com/p/uploadImage/search",
          render: true
        }
      }
    );

    const html = searchResponse.data;

    /*
    ====================================================
    EXTRACT TOP 10 PRODUCTS
    ====================================================
    */

    const matches = [...html.matchAll(/"productId":"(.*?)"/g)]
      .slice(0, 10);

    emitProgress(socket, `📦 ${matches.length} products found`);

    const products = [];

    /*
    ====================================================
    PROCESS PRODUCTS IN PARALLEL
    ====================================================
    */

    await Promise.all(
      matches.map(async (match) => {

        const productId = match[1];

        const productUrl =
          "https://www.aliexpress.com/item/" +
          productId +
          ".html";

        try {

          emitProgress(socket, "🔍 Loading product page");

          const productPage = await axios.get(
            "http://api.scraperapi.com",
            {
              params: {
                api_key: process.env.SCRAPERAPI_KEY,
                url: productUrl,
                render: true
              }
            }
          );

          const productHtml = productPage.data;

          const imageMatch = productHtml.match(/"imageUrl":"(.*?)"/);

          if (!imageMatch) return;

          const productImageUrl =
            imageMatch[1].replace(/\\\//g, "/");

          emitProgress(socket, "🖼 Downloading product image");

          const imgResponse = await axios.get(productImageUrl, {
            responseType: "arraybuffer"
          });

          const base64Product =
            Buffer.from(imgResponse.data).toString("base64");

          emitProgress(socket, "🤖 AI Comparing images");

          const similarityRaw = await calculateSimilarity(
            base64Input,
            base64Product
          );

          const similarity = Math.round(similarityRaw * 100);

          if (similarity >= 60) {

            products.push({
              url: productUrl,
              similarity
            });

          }

        } catch (err) {
          console.log("Product processing failed");
        }

      })
    );

    /*
    ====================================================
    SORT BY BEST MATCH
    ====================================================
    */

    const sorted = products.sort(
      (a, b) => b.similarity - a.similarity
    );

    emitProgress(socket, "✅ Analysis finished");

    results.push({
      image: file.originalname,
      matches: sorted
    });

  }

  res.json({ results });

});

/*
====================================================
SOCKET.IO CONNECTION
====================================================
*/

io.on("connection", (socket) => {

  console.log("🟢 Client connected:", socket.id);

  socket.emit("connected", {
    socketId: socket.id
  });

});

/*
====================================================
START SERVER
====================================================
*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
