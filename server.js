require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ========================================= */
/* SOCKET LOG SYSTEM */
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
/* ETSY SEARCH VIA SCRAPAPI */
/* ========================================= */

app.post("/search-etsy", async (req, res) => {

  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 300);

  try {

    const response = await axios.post(
      "https://api.scrapapi.com/etsy", // 🔥 CHANGE SI TON DASHBOARD DONNE AUTRE URL
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
      error: "ScrapAPI search failed"
    });
  }

});

/* ========================================= */
/* IMAGE ANALYSIS PIPELINE */
/* ========================================= */

app.post("/analyze-images", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `Processing ${file.originalname}`);

    const base64 = file.buffer.toString("base64");

    /* ===================================== */
    /* UPLOAD TO IMGBB */
    /* ===================================== */

    let publicImageUrl;

    try {

      const uploadRes = await axios.post(
        "https://api.imgbb.com/1/upload",
        new URLSearchParams({
          key: process.env.IMGBB_KEY,
          image: base64
        })
      );

      publicImageUrl = uploadRes.data.data.url;

      sendLog(socket, "Uploaded to IMGBB");

    } catch (err) {

      sendLog(socket, "IMGBB upload failed");
      continue;
    }

    /* ===================================== */
    /* OPENAI VISION ANALYSIS */
    /* ===================================== */

    try {

      const visionResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Return similarity score between 0 and 100." },
                {
                  type: "image_url",
                  image_url: { url: publicImageUrl }
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

      const aiText = visionResponse.data.choices[0].message.content;

      const similarityMatch = aiText.match(/\d+/);
      const similarity = similarityMatch ? parseInt(similarityMatch[0]) : 0;

      sendLog(socket, `AI similarity: ${similarity}%`);

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
/* SERVER START */
/* ========================================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
