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
UPLOAD TO IMGBB
====================================================
*/

async function uploadToImgBB(buffer) {

  const base64 = buffer.toString("base64");

  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return response.data.data.url;
}

/*
====================================================
OPENAI SIMILARITY
====================================================
*/

async function calculateSimilarity(base64Image, imageUrl) {

  try {

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
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
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

  } catch (err) {
    return 0;
  }
}

/*
====================================================
MAIN ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socket = io.sockets.sockets.get(req.body.socketId);
  const keyword = req.body.keyword;
  const limit = parseInt(req.body.limit) || 10;

  const finalResults = [];

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing ${file.originalname}`);

    /*
    ====================================================
    STEP 1 — SEARCH ETSY VIA ZENROWS (KEYWORD SEARCH)
    ====================================================
    */

    let etsyItems = [];

    try {

      const etsyUrl =
        `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

      const response = await axios.get("https://api.zenrows.com/v1/", {
        params: {
          url: etsyUrl,
          apikey: process.env.ZENROWS_API_KEY,
          js_render: "true",
          premium_proxy: "true"
        }
      });

      const html = response.data;

      const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
      const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

      const images = [...html.matchAll(imageRegex)].map(m => m[0]);
      const links = [...html.matchAll(linkRegex)].map(m => m[0]);

      for (let i = 0; i < Math.min(limit, images.length); i++) {

        etsyItems.push({
          image: images[i],
          link: links[i] || etsyUrl
        });
      }

      sendLog(socket, `📦 ${etsyItems.length} Etsy items extracted`);

    } catch (err) {

      sendLog(socket, "❌ Etsy scrape failed", "error");
      continue;
    }

    /*
    ====================================================
    STEP 2 — UPLOAD ETSY IMAGES TO IMGBB
    ====================================================
    */

    for (let item of etsyItems) {

      try {

        const imgRes = await axios.get(item.image, {
          responseType: "arraybuffer"
        });

        const imgUrl = await uploadToImgBB(imgRes.data);

        item.imgbbUrl = imgUrl;

      } catch (err) {
        item.imgbbUrl = item.image;
      }
    }

    sendLog(socket, "✅ Etsy images uploaded to ImgBB");

    /*
    ====================================================
    STEP 3 — GOOGLE REVERSE IMAGE VIA ZENROWS
    ====================================================
    */

    let aliCandidates = [];

    try {

      const publicImageUrl = await uploadToImgBB(file.buffer);

      const reverseUrl =
        `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(publicImageUrl)}&tbm=shop`;

      const response = await axios.get("https://api.zenrows.com/v1/", {
        params: {
          url: reverseUrl,
          apikey: process.env.ZENROWS_API_KEY,
          js_render: "true",
          premium_proxy: "true"
        }
      });

      const html = response.data;

      const imageRegex = /https?:\/\/[^"]+\.(jpg|png|webp)/g;
      const linkRegex = /https?:\/\/www\.aliexpress\.com\/item\/\d+\.html/g;

      const images = [...html.matchAll(imageRegex)].map(m => m[0]);
      const links = [...html.matchAll(linkRegex)].map(m => m[0]);

      for (let i = 0; i < Math.min(5, images.length); i++) {

        if (links[i] && links[i].includes("aliexpress")) {

          aliCandidates.push({
            image: images[i],
            link: links[i]
          });
        }
      }

      sendLog(socket, `🔍 ${aliCandidates.length} AliExpress candidates`);

    } catch (err) {
      sendLog(socket, "❌ Reverse search failed", "error");
    }

    /*
    ====================================================
    STEP 4 — AI COMPARISON
    ====================================================
    */

    const matches = [];

    for (const ali of aliCandidates) {

      const similarity = await calculateSimilarity(
        file.buffer.toString("base64"),
        ali.image
      );

      if (similarity >= 70) {

        matches.push({
          etsy: etsyItems,
          aliexpress: {
            image: ali.image,
            link: ali.link,
            similarity
          }
        });

        sendLog(socket, `🔥 Match ${similarity}%`);
      }
    }

    finalResults.push({
      originalImage: file.originalname,
      etsyItems,
      matches
    });
  }

  res.json({ results: finalResults });
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
