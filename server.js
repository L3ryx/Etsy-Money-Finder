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
ANALYSIS ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  console.log("🟢 /analyze request received");

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  console.log("🔎 Socket ID:", socketId);

  const results = [];

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded" });
  }

  for (const file of req.files) {

    emitProgress(socket, "📥 Image received");

    const base64Input = toBase64(file.buffer);

    /*
    ====================================================
    1️⃣ SEARCH ALIEXPRESS IMAGE SEARCH
    ====================================================
    */

    emitProgress(socket, "🔎 Searching on AliExpress image search");

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

    emitProgress(socket, "📦 Extracting products from page");

    /*
    ====================================================
    2️⃣ EXTRACT PRODUCTS (TOP 10)
    ====================================================
    */

    const matches = [...html.matchAll(/"productId":"(.*?)"/g)]
      .slice(0, 10);

    const products = [];

    emitProgress(socket, "🖼 Comparing product images");

    /*
    ====================================================
    3️⃣ PROCESS PRODUCTS IN PARALLEL
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

          // Download product image
          const imgResponse = await axios.get(productImageUrl, {
            responseType: "arraybuffer"
          });

          const base64Product =
            Buffer.from(imgResponse.data).toString("base64");

          /*
          ====================================================
          4️⃣ FAKE SIMULATION (REPLACE WITH REAL AI LATER)
          ====================================================
          */

          // ⚡ Temporary similarity (Replace with real OpenAI compare later)
          const similarity = Math.floor(Math.random() * 40) + 60;

          if (similarity >= 60) {

            products.push({
              url: productUrl,
              similarity
            });

          }

        } catch (err) {
          console.log("Product check failed");
        }

      })
    );

    emitProgress(socket, "✅ Product analysis finished");

    results.push({
      image: file.originalname,
      products
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
