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

function sendLog(socket, message) {
  console.log(message);
  if (socket) socket.emit("log", { message, time: new Date().toISOString() });
}

/* ===================================================== */
/* 🔎 ETSY SEARCH VIA SCRAPERAPI */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {
  const { keyword, limit } = req.body;
  const maxItems = Math.min(parseInt(limit) || 10, 50);

  try {
    const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    const scraperResponse = await axios.get("https://api.scraperapi.com/", {
      params: {
        api_key: process.env.SCRAPAPI_KEY,
        url: etsyUrl,
        render: true
      }
    });

    const html = scraperResponse.data;

    // Extraire les images et liens
    const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;
    const images = [...html.matchAll(imageRegex)];
    const links = [...html.matchAll(linkRegex)];

    const results = [];
    for (let i = 0; i < Math.min(maxItems, images.length); i++) {
      results.push({
        image: images[i][0],
        link: links[i] ? links[i][0] : etsyUrl
      });
    }

    res.json({ results });
  } catch (err) {
    console.error("ScraperAPI Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

/* ===================================================== */
/* 🔍 GOOGLE SHOPPING + AI COMPARISON */
/* ===================================================== */

app.post("/compare-aliexpress", upload.single("image"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);
  const etsyImage = req.body.etsyImage; // URL image Etsy

  if (!etsyImage) return res.status(400).json({ message: "Etsy image required" });

  sendLog(socket, "Starting Google Shopping search with AliExpress filter...");

  try {
    // 🔹 Recherche Google Shopping par image
    const searchUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(etsyImage)}&tbm=shop&q=site:aliexpress.com`;
    
    const scraperResponse = await axios.get("https://api.scraperapi.com/", {
      params: {
        api_key: process.env.SCRAPAPI_KEY,
        url: searchUrl,
        render: true
      }
    });

    const html = scraperResponse.data;

    // 🔹 Extraire les images + liens (top 10)
    const imageRegex = /"https:\/\/[^"]+\.jpg"/g;
    const linkRegex = /"https:\/\/www\.aliexpress\.com\/item\/\d+\.html"/g;

    const images = [...html.matchAll(imageRegex)].slice(0, 10).map(m => m[0].replace(/"/g, ""));
    const links = [...html.matchAll(linkRegex)].slice(0, 10).map(m => m[0].replace(/"/g, ""));

    const results = [];

    // 🔹 Comparer chaque image avec Etsy via OpenAI
    for (let i = 0; i < images.length; i++) {
      const aiResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Compare the similarity of these two images and return a number 0-100." },
                { type: "image_url", image_url: { url: etsyImage } },
                { type: "image_url", image_url: { url: images[i] } }
              ]
            }
          ]
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }
        }
      );

      const text = aiResponse.data.choices[0].message.content;
      const match = text.match(/\d+/);
      const similarity = match ? parseInt(match[0]) : 0;

      if (similarity >= 70) {
        results.push({ image: images[i], link: links[i], similarity });
        sendLog(socket, `Match found: ${similarity}%`);
      }
    }

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Comparison failed" });
  }
});

/* ===================================================== */
/* SOCKET CONNECTION */
/* ===================================================== */

io.on("connection", socket => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

/* ===================================================== */
/* SERVER START */
/* ===================================================== */

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
