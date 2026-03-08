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

/*
====================================================
LOG SYSTEM
====================================================
*/

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

/*
====================================================
SCRAPE ETSY
====================================================
*/

async function scrapeEtsy(keyword) {

  const response = await axios.get(
    "https://api.zenrows.com/v1/",
    {
      params: {
        url: `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`,
        apikey: process.env.ZENROWS_KEY,
        js_render: "true"
      }
    }
  );

  const html = response.data;

  const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
  const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

  const images = [...html.matchAll(imageRegex)].map(m => m[0]);
  const links = [...html.matchAll(linkRegex)].map(m => m[0]);

  const products = [];

  for (let i = 0; i < Math.min(12, images.length); i++) {

    products.push({
      image: images[i],
      link: links[i] || null
    });

  }

  return products;
}

/*
====================================================
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", async (req, res) => {

  const { keyword, socketId } = req.body;

  const socket = io.sockets.sockets.get(socketId);

  try {

    sendLog(socket, `🔎 Searching Etsy for "${keyword}"`);

    const products = await scrapeEtsy(keyword);

    sendLog(socket, `📦 ${products.length} Etsy listings found`);

    const results = products.map(product => ({

      etsy: {
        image: product.image,
        link: product.link
      }

    }));

    sendLog(socket, "✅ Etsy search complete");

    res.json({ results });

  } catch (err) {

    console.error(err);

    sendLog(socket, "❌ Etsy scraping failed", "error");

    res.status(500).json({
      error: "Server error"
    });

  }

});

/*
====================================================
SOCKET
====================================================
*/

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");

});

/*
====================================================
START
====================================================
*/

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
