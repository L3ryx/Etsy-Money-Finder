// =============================
// SERVER.JS — SERPAPI VERSION
// =============================

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

  console.log(`[${type.toUpperCase()}] ${message}`);

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
SIMILARITY WITH OPENAI
====================================================
*/

async function calculateSimilarity(base64A, base64B, socket) {

  try {

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Return ONLY a similarity score between 0 and 1."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64A}`
                }
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64B}`
                }
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
    const match = text.match(/0\.\d+|1(\.0+)?/);

    return match ? parseFloat(match[0]) : 0;

  } catch (err) {

    sendLog(socket, `❌ Similarity failed`, "error");

    return 0;
  }
}

/*
====================================================
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded" });
  }

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing ${file.originalname}`);

    const base64Input = file.buffer.toString("base64");

    /*
    =====================================================
    STEP 1 — SERPAPI REVERSE IMAGE SEARCH
    =====================================================
    */

    sendLog(socket, "🔎 Calling SerpAPI");

    let serpResults = [];

    try {

      const response = await axios.get(
        "https://serpapi.com/search",
        {
          params: {
            engine: "google_reverse_image",
            image_url: `data:image/jpeg;base64,${base64Input}`,
            api_key: process.env.SERPAPI_KEY
          }
        }
      );

      serpResults = response.data?.image_results || [];

      sendLog(socket, `📦 ${serpResults.length} Google results found`, "success");

    } catch (err) {

      sendLog(
        socket,
        `❌ SerpAPI error | ${err.response?.status} | ${err.message}`,
        "error"
      );

      results.push({
        image: file.originalname,
        matches: []
      });

      continue;
    }

    /*
    =====================================================
    STEP 2 — FILTER ALIEXPRESS LINKS
    =====================================================
    */

    const aliexpressLinks = serpResults
      .filter(r => r.link && r.link.includes("aliexpress.com"))
      .slice(0, 10);

    sendLog(socket, `🛒 ${aliexpressLinks.length} AliExpress links filtered`);

    /*
    =====================================================
    STEP 3 — DOWNLOAD PRODUCT IMAGE + COMPARE
    =====================================================
    */

    const matches = [];

    for (const item of aliexpressLinks) {

      sendLog(socket, `🔍 Checking ${item.link}`);

      try {

        if (!item.thumbnail) continue;

        const imgResponse = await axios.get(item.thumbnail, {
          responseType: "arraybuffer"
        });

        const base64Product =
          Buffer.from(imgResponse.data).toString("base64");

        const similarity = Math.round(
          (await calculateSimilarity(
            base64Input,
            base64Product,
            socket
          )) * 100
        );

        if (similarity >= 60) {

          sendLog(socket, `✅ Match ${similarity}%`, "success");

          matches.push({
            url: item.link,
            similarity
          });

        } else {

          sendLog(socket, `❌ Rejected ${similarity}%`, "info");
        }

      } catch (err) {

        sendLog(
          socket,
          `❌ Product image failed | ${err.message}`,
          "error"
        );
      }
    }

    results.push({
      image: file.originalname,
      matches: matches.sort((a, b) => b.similarity - a.similarity)
    });
  }

  res.json({ results });
});

/*
====================================================
SOCKET.IO
====================================================
*/

io.on("connection", (socket) => {

  console.log("🟢 Client connected");

  socket.emit("connected", {
    socketId: socket.id
  });

});

/*
====================================================
START SERVER
====================================================
*/

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
