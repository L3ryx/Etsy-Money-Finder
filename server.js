require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ===================================================== */
/* MIDDLEWARE */
/* ===================================================== */

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* SOCKET SYSTEM */
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

io.on("connection", (socket) => {

  console.log("🟢 Client connected");

  socket.emit("connected", {
    socketId: socket.id
  });

});

/* ===================================================== */
/* 🔎 ETSY SEARCH → IMAGE + LINK PROPER MATCH */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {

  console.log("🔥 Search route called");

  const { keyword, limit, socketId } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const socket = io.sockets.sockets.get(socketId);

  const maxItems = Math.min(parseInt(limit) || 10, 50);

  try {

    if (socket) {
      socket.emit("progress", { percent: 10 });
    }

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

    if (socket) {
      socket.emit("progress", { percent: 40 });
    }

    /* ===================================================== */
    /* ✅ EXTRACTION IMAGE + LISTING DANS LE MEME BLOC */
/* ===================================================== */

    const productRegex =
      /<a[^>]+href="(https:\/\/www\.etsy\.com\/listing\/\d+[^"]*)"[^>]*>[\s\S]*?<img[^>]+src="(https:\/\/i\.etsystatic\.com[^"]*)"/g;

    const results = [];

    let match;

    while ((match = productRegex.exec(html)) !== null) {

      const listingLink = match[1];
      const imageLink = match[2];

      results.push({
        image: imageLink,
        link: listingLink
      });

      if (results.length >= maxItems) break;
    }

    if (socket) {
      socket.emit("progress", { percent: 100 });
    }

    res.json({ results });

  } catch (err) {

    console.error("ScraperAPI Error:", err.message);

    if (socket) {
      socket.emit("progress", { percent: 0 });
    }

    res.status(500).json({
      error: "Scraping failed"
    });
  }

});

/* ===================================================== */
/* 🧠 IMAGE ANALYSIS PIPELINE */
/* ===================================================== */

app.post("/analyze-images", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `Processing ${file.originalname}`);

    const base64 = file.buffer.toString("base64");

    /* ================================================= */
    /* UPLOAD IMAGE TO IMGBB */
/* ================================================= */

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

    /* ================================================= */
    /* OPENAI VISION */
/* ================================================= */

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
                  image_url: {
                    url: imageUrl
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

      const text = vision.data.choices[0].message.content;
      const match = text.match(/\d+/);
      const similarity = match ? parseInt(match[0]) : 0;

      sendLog(socket, `AI Similarity: ${similarity}%`);

      results.push({
        image: file.originalname,
        matches: [
          {
            url: "AI_ANALYSIS",
            similarity
          }
        ]
      });

    } catch (err) {

      sendLog(socket, "OpenAI Vision failed");
    }
  }

  res.json({ results });

});

/* ===================================================== */
/* SERVER START */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
