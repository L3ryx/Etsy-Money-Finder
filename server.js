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
LOG SYSTEM
====================================================
*/

function sendLog(socket, message) {
  const logMessage = {
    message,
    time: new Date().toISOString()
  };

  console.log("LOG:", message);

  if (socket) {
    socket.emit("log", logMessage);
  }
}

/*
====================================================
UTILS
====================================================
*/

function toBase64(buffer) {
  return buffer.toString("base64");
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
                text: "Return ONLY a similarity score between 0 and 1 for these two images."
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

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded" });
  }

  sendLog(socket, "📥 Images received");

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing image: ${file.originalname}`);

    const base64Input = toBase64(file.buffer);

    /*
    ====================================================
    ALIEXPRESS IMAGE SEARCH
    ====================================================
    */

    sendLog(socket, "🔎 Searching AliExpress image search");

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
    EXTRACT PRODUCTS (TOP 10)
    ====================================================
    */

    const matches = [...html.matchAll(/"productId":"(.*?)"/g)]
      .slice(0, 10);

    sendLog(socket, `📦 ${matches.length} products extracted`);

    const products = [];

    /*
    ====================================================
    PROCESS PRODUCTS PARALLEL
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

          sendLog(socket, `🔍 Loading product ${productId}`);

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

          sendLog(socket, "🖼 Downloading product image");

          const imgResponse = await axios.get(productImageUrl, {
            responseType: "arraybuffer"
          });

          const base64Product =
            Buffer.from(imgResponse.data).toString("base64");

          sendLog(socket, "🤖 AI Comparing images");

          const similarityRaw = await calculateSimilarity(
            base64Input,
            base64Product
          );

          const similarity = Math.round(similarityRaw * 100);

          if (similarity >= 60) {

            sendLog(socket, `✅ Match found (${similarity}%)`);

            products.push({
              url: productUrl,
              similarity
            });

          } else {

            sendLog(socket, `❌ Product rejected (${similarity}%)`);

          }

        } catch (err) {
          sendLog(socket, "⚠ Product processing failed");
        }

      })
    );

    const sorted = products.sort(
      (a, b) => b.similarity - a.similarity
    );

    sendLog(socket, "🏁 Image finished");

    results.push({
      image: file.originalname,
      matches: sorted
    });

  }

  res.json({ results });

});

/*
====================================================
SOCKET.IO
====================================================
*/

io.on("connection", (socket) => {

  console.log("🟢 Client connected:", socket.id);

  socket.emit("connected", {
    socketId: socket.id
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
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
