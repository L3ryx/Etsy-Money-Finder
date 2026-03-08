require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ================= MULTER MEMOIRE =================
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ================= LOG SYSTEM =================
function sendLog(socket, message, type = "info") {
  console.log(`[${type}] ${message}`);
  if (socket) {
    socket.emit("log", { message, type, time: new Date().toISOString() });
  }
}

// ================= UPLOAD IMAGE IMGBB =================
async function uploadToImgBB(imageBuffer) {
  const base64 = imageBuffer.toString("base64");
  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({ key: process.env.IMGBB_KEY, image: base64 }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.data.url;
}

// ================= SCRAPE ETSY =================
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
    products.push({ image: images[i], link: links[i] || "#" });
  }
  sendLog(socket, `✅ Found ${products.length} Etsy products`);
  return products;
}

// ================= GOOGLE REVERSE IMAGE / SERPER =================
async function reverseImageSearch(imageUrl, socket) {
  sendLog(socket, "🔄 Reverse image search with Serper.dev");
  const response = await axios.post(
    "https://google.serper.dev/images",
    { imageUrl },
    { headers: { "X-API-KEY": process.env.SERPER_KEY, "Content-Type": "application/json" } }
  );
  const images = response.data.images || [];
  // Filtrer AliExpress
  const aliResults = images.filter(r => r.link?.includes("aliexpress.com")).slice(0, 10);
  sendLog(socket, `📦 Found ${aliResults.length} AliExpress results`);
  return aliResults;
}

// ================= OPENAI SIMILARITY =================
async function openAiSimilarity(imgA, imgB) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Return similarity percentage between these images (0-100)." },
            { type: "image_url", image_url: { url: imgA } },
            { type: "image_url", image_url: { url: imgB } }
          ]
        }
      ]
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );

  const text = response.data.choices[0].message.content;
  const match = text.match(/\d+/);
  return match ? parseInt(match[0]) : 0;
}

// ================= ANALYZE ROUTE =================
app.post("/analyze", upload.none(), async (req, res) => {
  const { keyword, socketId } = req.body;
  const socket = io.sockets.sockets.get(socketId);
  const results = [];

  try {
    const etsyProducts = await scrapeEtsy(keyword, socket);

    for (const product of etsyProducts) {
      sendLog(socket, `🖼 Processing Etsy image`);

      // Upload sur IMGBB
      const imgbbUrl = await uploadToImgBB(await axios.get(product.image, { responseType: "arraybuffer" }).then(r => Buffer.from(r.data, "binary")));
      sendLog(socket, `📤 Uploaded to ImgBB`);

      // Reverse image search
      const aliResults = await reverseImageSearch(imgbbUrl, socket);

      for (const ali of aliResults) {
        // Comparaison simple : placeholder 30%
        const quickSimilarity = 30; // tu peux remplacer par comparaison basique

        if (quickSimilarity >= 30) {
          // OpenAI similarity
          const similarity = await openAiSimilarity(product.image, ali.imageUrl || ali.thumbnail);
          sendLog(socket, `🤖 OpenAI similarity: ${similarity}%`);

          if (similarity >= 70) {
            results.push({
              etsy: { image: product.image, link: product.link },
              aliexpress: { image: ali.imageUrl || ali.thumbnail, link: ali.link },
              similarity
            });
          }
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

// ================= SOCKET =================
io.on("connection", socket => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

// ================= START SERVER =================
server.listen(process.env.PORT || 3000, () => console.log("🚀 Server running"));
