require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ========================= */
/* MIDDLEWARE */
/* ========================= */

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ========================= */
/* SOCKET LOG */
/* ========================= */

function sendLog(socket, message) {

  console.log(message);

  if (socket) {
    socket.emit("log", {
      message,
      time: new Date().toISOString()
    });
  }
}

/* ========================= */
/* ETSY SEARCH */
/* ========================= */

app.post("/search-etsy", async (req, res) => {

  console.log("🔥 Search route called");

  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.json({ results: [] });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 100);

  try {

    const etsyUrl =
      `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    const response = await axios.get("https://api.scraperapi.com/", {
      params: {
        api_key: process.env.SCRAPAPI_KEY,
        url: etsyUrl
      },
      timeout: 30000
    });

    const html = response.data;

    if (!html) {
      console.log("No HTML returned");
      return res.json({ results: [] });
    }

    /* EXTRACTION */

    const imageRegex = /https:\/\/i\.etsystatic\.com\/[^\s"]+/g;
    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

    const images = html.match(imageRegex) || [];
    const links = html.match(linkRegex) || [];

    console.log("Images:", images.length);
    console.log("Links:", links.length);

    const results = [];

    for (let i = 0; i < Math.min(maxItems, images.length); i++) {

      results.push({
        image: images[i],
        link: links[i] || null
      });

    }

    res.json({ results });

  } catch (err) {

    console.error("Scraper error:", err.message);

    res.json({ results: [] });
  }

});

/* ========================= */
/* IMAGE ANALYSIS */
/* ========================= */

app.post("/analyze-images", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const listingLink = req.body.listingLink;

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

      sendLog(socket, "Image uploaded to IMGBB");

    } catch (err) {

      sendLog(socket, "IMGBB upload failed");
      continue;
    }

    try {

      const vision = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Return similarity score between 0 and 100." },
                { type: "image_url", image_url: { url: imageUrl } }
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

      sendLog(socket, `Similarity: ${similarity}%`);

      results.push({
        image: file.originalname,
        listing: listingLink,
        similarity
      });

    } catch (err) {

      sendLog(socket, "OpenAI Vision failed");
    }

  }

  res.json({ results });

});

/* ========================= */
/* SOCKET */
/* ========================= */

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");

});

/* ========================= */
/* START SERVER */
/* ========================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {

  console.log("🚀 Server running on port", PORT);

});
