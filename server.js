/* ===================================================== */
/* ================== IMPORTS ========================== */
/* ===================================================== */

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cheerio = require("cheerio");

/* ===================================================== */
/* ================== APP SETUP ======================== */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ===================================================== */
/* ================= DATABASE CONNECTION ================ */
/* ===================================================== */

const mongoUser = process.env.DB_USER;
const mongoPass = encodeURIComponent(process.env.DB_PASS);
const mongoName = process.env.DB_NAME;

const mongoURI = `mongodb+srv://${mongoUser}:${mongoPass}@cluster0.bwlimkp.mongodb.net/${mongoName}?retryWrites=true&w=majority`;

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

/* ===================================================== */
/* ================= MIDDLEWARE ======================== */
/* ===================================================== */

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* ================= SOCKET LOGGER ===================== */
/* ===================================================== */

function sendLog(socket, message) {
  console.log(message);

  if (socket) {
    socket.emit("log", {
      message,
      time: new Date().toISOString()
    });
  }
}

/* ===================================================== */
/* ================= ETSY SEARCH ======================= */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {

  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 100);

  try {

    const etsyUrl =
      `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

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

    const html = scraperResponse.data;

    /* ===================================================== */
    /* ================= CHEERIO PARSER ==================== */
    /* ===================================================== */

    const $ = cheerio.load(html);
    const results = [];

    $("a").each((i, el) => {

      if (results.length >= maxItems) return;

      const href = $(el).attr("href");
      if (!href || !href.includes("/listing/")) return;

      const link = href.startsWith("http")
        ? href
        : "https://www.etsy.com" + href;

      const img = $(el).find("img").first();
      let image = img.attr("src") || img.attr("data-src");

      if (!image) return;

      if (image.startsWith("//")) {
        image = "https:" + image;
      }

      results.push({
        image,
        link
      });

    });

    res.json({ results });

  } catch (err) {

    console.error("Scraper Error:", err.message);

    res.status(500).json({
      error: "Scraping failed"
    });
  }

});

/* ===================================================== */
/* ================= IMAGE ANALYSIS ==================== */
/* ===================================================== */

app.post("/analyze-images", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `Processing ${file.originalname}`);

    const base64 = file.buffer.toString("base64");

    let imageUrl;

    try {

      const uploadRes = await axios.post(
        "https://api.imgbb.com/1/upload",
        new URLSearchParams({
          key: process.env.IMGBB_KEY,
          image: base64
        })
      );

      imageUrl = uploadRes.data.data.url;

      sendLog(socket, "Uploaded to IMGBB");

    } catch (err) {

      sendLog(socket, "IMGBB upload failed");
      continue;
    }

    /* ================= OPENAI VISION ================= */

    try {

      const vision = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Return similarity score between 0 and 100."
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl }
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

      const text = vision.data.choices[0].message.content;
      const match = text.match(/\d+/);
      const similarity = match ? parseInt(match[0]) : 0;

      sendLog(socket, `AI Similarity: ${similarity}%`);

      results.push({
        image: file.originalname,
        similarity
      });

    } catch (err) {

      sendLog(socket, "OpenAI Vision failed");
    }
  }

  res.json({ results });

});

/* ===================================================== */
/* ================= SOCKET CONNECTION ================= */
/* ===================================================== */

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");
});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
