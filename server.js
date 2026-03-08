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

/* =====================
   LOG SYSTEM
===================== */
function sendLog(socket, message, type = "info") {
  console.log(`[${type}] ${message}`);
  if (socket) {
    socket.emit("log", {
      message,
      type,
      time: new Date().toISOString(),
    });
  }
}

/* =====================
   UPLOAD IMAGE → IMGBB
===================== */
async function uploadToImgBB(imageBuffer) {
  const base64 = imageBuffer.toString("base64");
  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.data.url;
}

/* =====================
   SCRAPE ETSY WITH ZENROWS
===================== */
async function scrapeEtsy(keyword) {
  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      url: `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`,
      apikey: process.env.ZENROWS_KEY,
      js_render: "true",
    },
  });

  const html = response.data;

  const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
  const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

  const images = [...html.matchAll(imageRegex)].map((m) => m[0]);
  const links = [...html.matchAll(linkRegex)].map((m) => m[0]);

  const products = [];
  for (let i = 0; i < Math.min(10, images.length); i++) {
    products.push({ image: images[i], link: links[i] || null });
  }

  return products;
}

/* =====================
   SERPER REVERSE IMAGE
===================== */
async function reverseImageSearch(imageUrl) {
  try {
    const response = await axios.post(
      "https://google.serper.dev/images",
      { image_url: imageUrl, num: 10 },
      { headers: { "X-API-KEY": process.env.SERPER_KEY, "Content-Type": "application/json" } }
    );
    return response.data.images || [];
  } catch (err) {
    console.error("❌ Serper error:", err.response?.data || err.message);
    return [];
  }
}

/* =====================
   OPENAI IMAGE SIMILARITY
===================== */
async function calculateSimilarity(imgA, imgB) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: [{ type: "text", text: "Return similarity percentage 0-100 between these images." }, { type: "image_url", image_url: { url: imgA } }, { type: "image_url", image_url: { url: imgB } }] },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const text = response.data.choices[0].message.content;
    const number = text.match(/\d+/);
    return number ? parseInt(number[0]) : 0;
  } catch (err) {
    console.error("❌ OpenAI similarity error:", err.response?.data || err.message);
    return 0;
  }
}

/* =====================
   ANALYZE ROUTE
===================== */
app.post("/analyze", upload.array("images"), async (req, res) => {
  const { keyword, socketId } = req.body;
  const socket = io.sockets.sockets.get(socketId);
  const results = [];

  try {
    sendLog(socket, `🔎 Scraping Etsy for "${keyword}"`);
    const etsyProducts = await scrapeEtsy(keyword);
    sendLog(socket, `📦 ${etsyProducts.length} Etsy products found`);

    for (const product of etsyProducts) {
      sendLog(socket, `🖼 Uploading Etsy image to ImgBB`);
      const etsyImgUrl = await uploadToImgBB(Buffer.from(product.image.split(",")[1] || ""));
      sendLog(socket, `✅ Uploaded: ${etsyImgUrl}`);

      sendLog(socket, `🔎 Searching reverse image on Serper`);
      const reverseResults = await reverseImageSearch(etsyImgUrl);

      const aliResults = reverseResults
        .filter((r) => r.link?.includes("aliexpress.com"))
        .slice(0, 10);

      for (const ali of aliResults) {
        const basicSimilarity = Math.random() * 100; // Placeholder simple filter ~30%
        if (basicSimilarity < 30) continue;

        const similarity = await calculateSimilarity(etsyImgUrl, ali.imageUrl || ali.thumbnail);
        if (similarity >= 70) {
          results.push({
            etsy: { image: product.image, link: product.link },
            aliexpress: { image: ali.imageUrl || ali.thumbnail, link: ali.link },
            similarity,
          });
          sendLog(socket, `🔥 Match found! ${similarity}%`);
        }
      }
    }

    sendLog(socket, "✅ Analysis complete");
    res.json({ results });
  } catch (err) {
    console.error(err);
    sendLog(socket, "❌ Analysis failed", "error");
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================
   SOCKET.IO
===================== */
io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

/* =====================
   START SERVER
===================== */
server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
