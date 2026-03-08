// ===============================
// SERVER.JS — FULL VERSION
// API KEYS STORED IN CONFIG.JSON
// ADMIN PROTECTED
// ===============================

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CONFIG_PATH = "./config.json";
const ADMIN_PASSWORD = "123456"; // 🔐 CHANGE THIS

/* ===============================
   CONFIG SYSTEM
================================*/

function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

/* ===============================
   FILE UPLOAD
================================*/

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

/* ===============================
   LOG SYSTEM
================================*/

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

/* ===============================
   ADMIN ROUTES (PROTECTED)
================================*/

app.get("/admin", (req, res) => {

  const password = req.query.password;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).send("Unauthorized");
  }

  res.sendFile(path.join(__dirname, "public/admin.html"));
});

app.get("/api/config", (req, res) => {

  const password = req.query.password;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  res.json(getConfig());
});

app.post("/api/config", (req, res) => {

  const { password, config } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  saveConfig(config);

  res.json({ success: true });
});

/* ===============================
   ANALYZE ROUTE
================================*/

app.post("/analyze", upload.array("images"), async (req, res) => {

  const socket = io.sockets.sockets.get(req.body.socketId);
  const config = getConfig();

  const results = [];

  for (const file of req.files) {

    sendLog(socket, `🖼 Processing ${file.filename}`);

    const publicUrl =
      `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;

    sendLog(socket, `🌍 Image URL: ${publicUrl}`);

    /* ============================
       SERPAPI CALL
    ============================*/

    sendLog(socket, "🔎 Calling SerpAPI");

    let serpResults = [];

    try {

      const response = await axios.get(
        "https://serpapi.com/search",
        {
          params: {
            engine: "google_reverse_image",
            image_url: publicUrl,
            api_key: config.SERPAPI_KEY
          }
        }
      );

      serpResults = response.data?.image_results || [];

      sendLog(socket, `📦 ${serpResults.length} results found`);

    } catch (err) {

      sendLog(socket,
        `❌ SerpAPI error | ${err.response?.status || ""}`,
        "error"
      );

    }

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

/* ===============================
   SOCKET
================================*/

io.on("connection", (socket) => {
  console.log("🟢 Client connected");
  socket.emit("connected", { socketId: socket.id });
});

/* ===============================
   START SERVER
================================*/

server.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
