require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ========================================= */
/* MIDDLEWARE */
/* ========================================= */

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ========================================= */
/* SOCKET SYSTEM */
/* ========================================= */

function sendLog(socket, message) {
  console.log(message);

  if (socket) {
    socket.emit("log", {
      message,
      time: new Date().toISOString()
    });
  }
}

/* ========================================= */
/* SCRAPAPI ETSY SEARCH */
/* ========================================= */

app.post("/search-etsy", async (req, res) => {

  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 300);

  try {

    const response = await axios.post(
      /* 🔥 CHANGE CETTE URL SI TON DASHBOARD DONNE AUTRE CHOSE */
      "https://api.scrapapi.com/etsy",

      {
        query: keyword,
        limit: maxItems
      },

      {
        headers: {
          Authorization: process.env.SCRAPAPI_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const listings = response.data?.results || [];

    const results = listings
      .map(item => ({
        link: item.url,
        image: item.images?.[0] || null
      }))
      .filter(item => item.image);

    res.json({ results });

  } catch (err) {

    console.error("ScrapAPI Error:", err.response?.data || err.message);

    res.status(500).json({
      error: "ScrapAPI request failed"
    });
  }

});

/* ========================================= */
/* IMAGE ANALYSIS ROUTE */
/* ========================================= */

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `Processing ${file.originalname}`);

    const base64 = file.buffer.toString("base64");

    let imageUrl;

    /* 🔥 UPLOAD IMAGE TO IMGBB */

    try {

      const uploadRes = await axios.post(
        "https://api.imgbb.com/1/upload",
        new URLSearchParams({
          key: process.env.IMGBB_KEY,
          image: base64
        })
      );

      imageUrl = uploadRes.data.data.url;

      sendLog(socket, "Image uploaded to IMGBB");

    } catch (err) {

      sendLog(socket, "IMGBB upload failed");
      continue;
    }

    /* 🔥 REVERSE IMAGE SEARCH */

    try {

      const serp = await axios.get(
        "https://serpapi.com/search",
        {
          params: {
            engine: "google_reverse_image",
            image_url: imageUrl,
            api_key: process.env.SERPAPI_KEY
          }
        }
      );

      const links = serp.data?.image_results || [];

      const matches = links
        .filter(l => l.link?.includes("aliexpress"))
        .slice(0, 10)
        .map(item => ({
          url: item.link,
          similarity: 70
        }));

      results.push({
        image: file.originalname,
        matches
      });

      sendLog(socket, "Reverse search completed");

    } catch (err) {

      sendLog(socket, "Reverse search failed");
    }

  }

  res.json({ results });

});

/* ========================================= */
/* SOCKET CONNECTION */
/* ========================================= */

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");
});

/* ========================================= */
/* START SERVER */
/* ========================================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
