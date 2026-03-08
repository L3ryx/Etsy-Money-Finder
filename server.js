require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    }
  })
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadDir));
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
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing ${file.filename}`);

    /*
    ============================================
    STEP 1 — CREATE PUBLIC LOCAL URL
    ============================================
    */

    const publicUrl =
      `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;

    sendLog(socket, `🌍 Public URL created: ${publicUrl}`);

    /*
    ============================================
    STEP 2 — CALL SERPAPI
    ============================================
    */

    sendLog(socket, "🔎 Calling SerpAPI");

    let serpResults = [];

    try {

      const response = await axios.get(
        "https://serpapi.com/search",
        {
          params: {
            engine: "google_reverse_image",
            image_url: publicUrl,
            api_key: process.env.SERPAPI_KEY
          }
        }
      );

      serpResults = response.data?.image_results || [];

      sendLog(socket, `📦 ${serpResults.length} results found`);

    } catch (err) {

      sendLog(
        socket,
        `❌ SerpAPI error | ${err.response?.status || "No Status"} | ${err.message}`,
        "error"
      );

      serpResults = [];
    }

    /*
    ============================================
    STEP 3 — FILTER ALIEXPRESS
    ============================================
    */

    const matches = serpResults
      .filter(r => r.link?.includes("aliexpress.com"))
      .slice(0, 10)
      .map(r => ({
        url: r.link,
        similarity: 70
      }));

    results.push({
      image: file.filename,
      publicUrl,
      matches
    });
  }

  res.json({ results });
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
