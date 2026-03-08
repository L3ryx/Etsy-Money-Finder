require("dotenv").config();
const express = require("express");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ========================================
// LOG SYSTEM
// ========================================
function sendLog(socket, message, type = "info") {
  console.log(`[${type}] ${message}`);
  if (socket) {
    socket.emit("log", {
      message,
      type,
      time: new Date().toISOString()
    });
  }
}

// ========================================
// UPLOAD IMAGE TO IMGBB
// ========================================
async function uploadToImgBB(imageUrl) {
  try {
    const response = await axios.post(
      "https://api.imgbb.com/1/upload",
      new URLSearchParams({
        key: process.env.IMGBB_KEY,
        image: imageUrl
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );
    return response.data.data.url;
  } catch (err) {
    console.error("ImgBB upload failed:", err.message);
    return imageUrl; // fallback si échec
  }
}

// ========================================
// SCRAPE ETSY VIA ZENROWS
// ========================================
async function scrapeEtsy(keyword, socket) {
  sendLog(socket, `🔎 Scraping Etsy for "${keyword}"`);

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      url: `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`,
      apikey: process.env.ZENROWS_KEY,
      js_render: "true"
    }
  });

  const html = response.data;

  const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
  const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

  const images = [...html.matchAll(imageRegex)].map(m => m[0]);
  const links = [...html.matchAll(linkRegex)].map(m => m[0]);

  const products = [];

  for (let i = 0; i < Math.min(10, images.length); i++) {
    const img = images[i];
    const link = links[i] || "#";

    sendLog(socket, `📤 Uploading image ${i + 1} to ImgBB`);
    const publicImage = await uploadToImgBB(img);

    products.push({
      image: publicImage,
      link
    });
  }

  sendLog(socket, `✅ Found ${products.length} products`);
  return products;
}

// ========================================
// ANALYZE ROUTE
// ========================================
app.post("/analyze", async (req, res) => {
  const { keyword, socketId } = req.body;
  const socket = io.sockets.sockets.get(socketId);

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  try {
    const results = await scrapeEtsy(keyword, socket);
    res.json({ results });
  } catch (err) {
    console.error(err);
    sendLog(socket, "❌ Scraping failed", "error");
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================
// SOCKET.IO
// ========================================
io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected:", socket.id);
});

// ========================================
// START SERVER
// ========================================
server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
