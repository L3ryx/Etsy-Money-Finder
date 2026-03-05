require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ================= MIDDLEWARE ================= */

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ================= SOCKET ================= */

io.on("connection", (socket) => {
  console.log("🟢 Client connected");

  socket.emit("connected", {
    socketId: socket.id
  });
});

/* ================================================= */
/* 🔎 ETSY SEARCH */
/* ================================================= */

app.post("/search-etsy", async (req, res) => {

  const { keyword, limit, socketId } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const socket = io.sockets.sockets.get(socketId);

  try {

    /* 🔥 STEP 1 */
    if (socket) {
      socket.emit("progress", { percent: 10 });
    }

    const etsyUrl =
      `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    /* 🔥 STEP 2 — SCRAPE */

    const scraperResponse = await axios.get(
      "https://api.scraperapi.com/",
      {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url: etsyUrl,
          render: true
        }
      }
    );

    if (socket) {
      socket.emit("progress", { percent: 50 });
    }

    const html = scraperResponse.data;

    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;
    const linksFound = [...html.matchAll(linkRegex)];

    const maxItems = Math.min(parseInt(limit) || 10, 50);

    const results = [];

    for (let i = 0; i < Math.min(maxItems, linksFound.length); i++) {

      results.push({
        link: linksFound[i][0]
      });
    }

    /* 🔥 STEP 3 — EXTRACTION DONE */

    if (socket) {
      socket.emit("progress", { percent: 100 });
    }

    res.json({ results });

  } catch (err) {

    console.error("Scraping error:", err.message);

    if (socket) {
      socket.emit("progress", { percent: 0 });
    }

    res.status(500).json({ error: "Scraping failed" });
  }

});

/* ================= SERVER START ================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
