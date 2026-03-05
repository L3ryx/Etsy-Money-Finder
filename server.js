require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const FormData = require("form-data");

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
  console.log("LOG:", message);

  if (socket) {
    socket.emit("log", {
      message,
      time: new Date().toISOString()
    });
  }
}

/*
====================================================
IMAGE SIMILARITY (OPENAI)
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
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
ANALYZE ROUTE
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

    sendLog(socket, `🖼 Processing image ${file.originalname}`);

    const base64Input = file.buffer.toString("base64");

    /*
    ====================================================
    1️⃣ CALL OFFICIAL ALIEXPRESS IMAGE SEARCH API
    ====================================================
    */

    sendLog(socket, "🔎 Calling AliExpress image search API");

    let productsData = [];

    try {

      const form = new FormData();
      form.append("image", file.buffer, {
        filename: "image.jpg"
      });

      const searchResponse = await axios.post(
        "https://www.aliexpress.com/aer-api/search/image",
        form,
        {
          headers: {
            ...form.getHeaders()
          }
        }
      );

      productsData = searchResponse.data?.data?.products || [];

      sendLog(socket, `📦 ${productsData.length} products returned`);

    } catch (err) {

      sendLog(socket, "❌ Image search API failed");
      productsData = [];

    }

    const matchedProducts = [];

    /*
    ====================================================
    2️⃣ PROCESS TOP 10 PRODUCTS
    ====================================================
    */

    const topProducts = productsData.slice(0, 10);

    await Promise.all(
      topProducts.map(async (product) => {

        const productId = product.productId;

        const productUrl =
          "https://www.aliexpress.com/item/" +
          productId +
          ".html";

        try {

          sendLog(socket, `🔍 Checking product ${productId}`);

          const productImageUrl = product.imageUrl;

          if (!productImageUrl) return;

          const imgResponse = await axios.get(productImageUrl, {
            responseType: "arraybuffer"
          });

          const base64Product =
            Buffer.from(imgResponse.data).toString("base64");

          sendLog(socket, "🤖 AI comparing images");

          const similarityRaw = await calculateSimilarity(
            base64Input,
            base64Product
          );

          const similarity = Math.round(similarityRaw * 100);

          if (similarity >= 60) {

            sendLog(socket, `✅ Match found ${similarity}%`);

            matchedProducts.push({
              url: productUrl,
              similarity
            });
          } else {

            sendLog(socket, `❌ Rejected ${similarity}%`);
          }

        } catch {
          sendLog(socket, "⚠ Product processing failed");
        }

      })
    );

    const sorted = matchedProducts.sort(
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
