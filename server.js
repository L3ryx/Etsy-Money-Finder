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
SCRAPE ETSY VIA ZENROWS
====================================================
*/

async function scrapeEtsy(keyword, limit = 10) {

  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      apikey: process.env.ZENROWS_API_KEY,
      url,
      js_render: "true",
      premium_proxy: "true"
    }
  });

  const html = response.data;

  const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
  const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

  const images = [...html.matchAll(imageRegex)].map(m => m[0]);
  const links = [...html.matchAll(linkRegex)].map(m => m[0]);

  return images.slice(0, limit).map((image, i) => ({
    image,
    link: links[i] || url
  }));
}

/*
====================================================
UPLOAD IMAGE TO IMGBB
====================================================
*/

async function uploadToImgBB(buffer) {

  const base64 = buffer.toString("base64");

  const res = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  return res.data.data.url;
}

/*
====================================================
REVERSE IMAGE SEARCH VIA ZENROWS
====================================================
*/

async function reverseSearch(imageUrl) {

  const googleUrl =
    `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}`;

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      apikey: process.env.ZENROWS_API_KEY,
      url: googleUrl,
      js_render: "true",
      premium_proxy: "true"
    }
  });

  const html = response.data;

  const aliRegex = /https:\/\/[^"]*aliexpress\.com[^"]*/g;
  const imgRegex = /https:\/\/[^"]*\.(jpg|png|jpeg)/g;

  const aliLinks = [...html.matchAll(aliRegex)].map(m => m[0]);
  const aliImages = [...html.matchAll(imgRegex)].map(m => m[0]);

  return aliLinks.slice(0, 5).map((link, i) => ({
    link,
    image: aliImages[i]
  }));
}

/*
====================================================
BATCH OPENAI COMPARISON (COST REDUCTION)
👉 On compare 5 images en UNE seule requête
====================================================
*/

async function batchCompare(base64Etsy, aliItems) {

  if (aliItems.length === 0) return [];

  const imageMessages = aliItems.map(item => ({
    type: "image_url",
    image_url: { url: item.image }
  }));

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Return similarity 0-100 for each image" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Etsy}`
              }
            },
            ...imageMessages
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

  const numbers = text.match(/\d+/g) || [];

  return aliItems.map((item, i) => ({
    ...item,
    similarity: parseInt(numbers[i] || 0)
  }));
}

/*
====================================================
MAIN ROUTE
====================================================
*/

app.post("/analyze", async (req, res) => {

  const socket = io.sockets.sockets.get(req.body.socketId);

  const keyword = req.body.keyword;
  const limit = parseInt(req.body.limit) || 10;

  const finalResults = [];

  try {

    sendLog(socket, "🔎 Scraping Etsy...");

    const etsyItems = await scrapeEtsy(keyword, limit);

    sendLog(socket, `✅ ${etsyItems.length} Etsy items found`);

    for (const item of etsyItems) {

      sendLog(socket, "📥 Downloading Etsy image");

      const imageBuffer = await axios.get(item.image, {
        responseType: "arraybuffer"
      });

      const base64 = Buffer.from(imageBuffer.data).toString("base64");

      /*
      ============================================
      UPLOAD IMAGE
      ============================================
      */

      const publicImage = await uploadToImgBB(
        Buffer.from(imageBuffer.data)
      );

      sendLog(socket, "☁ Image uploaded");

      /*
      ============================================
      REVERSE SEARCH
      ============================================
      */

      const aliCandidates = await reverseSearch(publicImage);

      sendLog(socket, `🔍 ${aliCandidates.length} Ali candidates`);

      /*
      ============================================
      BATCH COMPARISON (1 CALL FOR 5 IMAGES)
      ============================================
      */

      const compared = await batchCompare(base64, aliCandidates);

      for (const result of compared) {

        if (result.similarity >= 70) {

          finalResults.push({
            etsy: {
              image: item.image,
              link: item.link
            },
            aliexpress: {
              image: result.image,
              link: result.link
            },
            similarity: result.similarity
          });

          sendLog(socket, `🔥 MATCH ${result.similarity}%`);
        }
      }
    }

    res.json({ results: finalResults });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Pipeline failed"
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
