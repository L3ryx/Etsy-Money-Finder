require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ============================= */
/* CONFIG */
/* ============================= */

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ============================= */
/* LOG SYSTEM */
/* ============================= */

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

/* ============================= */
/* UPLOAD IMAGE TO IMGBB */
/* ============================= */

async function uploadToImgBB(buffer) {
  const base64 = buffer.toString("base64");

  const res = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64
    })
  );

  return res.data.data.url;
}

/* ============================= */
/* ZENROWS ETSY SEARCH */
/* ============================= */

async function searchEtsy(keyword, limit = 10) {

  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      url,
      apikey: process.env.ZENROWS_API_KEY,
      premium_proxy: "true",
      js_render: "true"
    }
  });

  const html = response.data || "";

  const images = [...html.matchAll(/https:\/\/i\.etsystatic\.com[^"]+/g)].map(m => m[0]);
  const links = [...html.matchAll(/https:\/\/www\.etsy\.com\/listing\/\d+/g)].map(m => m[0]);

  const results = [];

  for (let i = 0; i < Math.min(limit, images.length); i++) {
    results.push({
      image: images[i],
      link: links[i] || url
    });
  }

  return results;
}

/* ============================= */
/* OPENAI SIMILARITY */
/* ============================= */

async function getSimilarity(base64Image, imageUrl) {

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Return similarity 0 to 100" },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );

  const text = response.data.choices[0].message.content;
  const match = text.match(/\d+/);

  return match ? parseInt(match[0]) : 0;
}

/* ============================= */
/* MAIN ROUTE */
/* ============================= */

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socket = io.sockets.sockets.get(req.body.socketId);
  const keyword = req.body.keyword || "product";

  const finalResults = [];

  for (const file of req.files) {

    sendLog(socket, `Processing ${file.originalname}`);

    /* ============================= */
    /* STEP 1 — UPLOAD IMAGE */
    /* ============================= */

    let imageUrl;

    try {
      imageUrl = await uploadToImgBB(file.buffer);
      sendLog(socket, "Image uploaded to ImgBB");
    } catch (err) {
      sendLog(socket, "ImgBB upload failed", "error");
      continue;
    }

    /* ============================= */
    /* STEP 2 — SEARCH ETSY VIA ZENROWS */
    /* ============================= */

    let etsyItems = [];

    try {
      etsyItems = await searchEtsy(keyword, 20);
      sendLog(socket, `Etsy items found: ${etsyItems.length}`);
    } catch (err) {
      sendLog(socket, "ZenRows Etsy search failed", "error");
    }

    /* ============================= */
    /* STEP 3 — GOOGLE IMAGE SEARCH VIA ZENROWS */
    /* ============================= */

    let googleResults = [];

    try {

      const googleUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}&tbm=isch`;

      const response = await axios.get("https://api.zenrows.com/v1/", {
        params: {
          url: googleUrl,
          apikey: process.env.ZENROWS_API_KEY,
          premium_proxy: "true",
          js_render: "true"
        }
      });

      const html = response.data || "";

      googleResults = [...html.matchAll(/https:\/\/[^"]*aliexpress[^"]*/g)]
        .slice(0, 5)
        .map(m => ({
          link: m[0],
          image: m[0]
        }));

      sendLog(socket, `AliExpress candidates: ${googleResults.length}`);

    } catch (err) {
      sendLog(socket, "Google reverse search failed", "error");
    }

    /* ============================= */
    /* STEP 4 — AI COMPARISON */
/* ============================= */

    const matches = [];

    for (const ali of googleResults) {

      try {

        const similarity = await getSimilarity(
          file.buffer.toString("base64"),
          ali.image
        );

        if (similarity >= 70) {

          matches.push({
            etsy: etsyItems,
            aliexpress: {
              link: ali.link,
              image: ali.image,
              similarity
            }
          });

          sendLog(socket, `🔥 Match ${similarity}%`);
        }

      } catch (err) {
        sendLog(socket, "AI comparison failed", "error");
      }
    }

    finalResults.push({
      product: file.originalname,
      etsyItems,
      matches
    });
  }

  res.json({ results: finalResults });
});

/* ============================= */
/* SOCKET */
/* ============================= */

io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

/* ============================= */
/* START SERVER */
/* ============================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
