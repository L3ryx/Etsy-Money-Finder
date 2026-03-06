/* ===================================================== */
/* ===================== IMPORTS ======================= */
/* ===================================================== */

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ===================================================== */
/* ================= MODELS ============================ */
/* ===================================================== */

const User = require("./models/User");
const SavedProduct = require("./models/SavedProduct");

/* ===================================================== */
/* ================= APP SETUP ========================= */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* =============== DATABASE CONNECTION ================= */
/* ===================================================== */

const mongoURI = `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(
  process.env.DB_PASS
)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`;

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

/* ===================================================== */
/* ================= SOCKET LOGGER ===================== */
/* ===================================================== */

function sendLog(socket, message) {
  console.log(message);
  if (socket) {
    socket.emit("log", {
      message,
      time: new Date().toISOString(),
    });
  }
}

/* ===================================================== */
/* ================= AUTH MIDDLEWARE =================== */
/* ===================================================== */

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* ===================================================== */
/* ================= REGISTER ========================== */
/* ===================================================== */

app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const existing = await User.findOne({ email });

  if (existing) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await User.create({
    email,
    password: hashedPassword,
  });

  res.json({ message: "User created ✅" });
});

/* ===================================================== */
/* ================= LOGIN (JWT) ======================= */
/* ===================================================== */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

/* ===================================================== */
/* =============== SAVE PRODUCT ======================== */
/* ===================================================== */

app.post("/save-product", authMiddleware, async (req, res) => {
  const { image, link } = req.body;

  const product = await SavedProduct.create({
    userId: req.user.userId,
    image,
    link,
  });

  res.json({ message: "Saved ✅", product });
});

/* ===================================================== */
/* =============== DASHBOARD =========================== */
/* ===================================================== */

app.get("/dashboard", authMiddleware, async (req, res) => {
  const products = await SavedProduct.find({
    userId: req.user.userId,
  });

  res.json({ products });
});

/* ===================================================== */
/* ================= ETSY SCRAPER ====================== */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {
  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 100);

  try {
    const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(
      keyword
    )}`;

    const scraperResponse = await axios.get(
      "https://api.scraperapi.com/",
      {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url: etsyUrl,
          render: true,
        },
      }
    );

    const html = scraperResponse.data;
    const $ = cheerio.load(html);

    const results = [];

    $("a").each((i, el) => {
      if (results.length >= maxItems) return;

      const href = $(el).attr("href");
      if (!href || !href.includes("/listing/")) return;

      const link = href.startsWith("http")
        ? href
        : "https://www.etsy.com" + href;

      let image = $(el).find("img").first().attr("src") ||
                  $(el).find("img").first().attr("data-src");

      if (!image) return;

      if (image.startsWith("//")) {
        image = "https:" + image;
      }

      results.push({ image, link });
    });

    res.json({ results });

  } catch (err) {
    console.error("Scraper Error:", err.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

/* ===================================================== */
/* ================= IMAGE ANALYSIS ==================== */
/* ===================================================== */

app.post("/analyze-images", upload.array("images"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  const results = [];

  for (const file of req.files) {
    sendLog(socket, `Processing ${file.originalname}`);

    const base64 = file.buffer.toString("base64");

    try {
      const uploadRes = await axios.post(
        "https://api.imgbb.com/1/upload",
        new URLSearchParams({
          key: process.env.IMGBB_KEY,
          image: base64,
        })
      );

      const imageUrl = uploadRes.data.data.url;

      const vision = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Return similarity score between 0 and 100.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      const match = vision.data.choices[0].message.content.match(/\d+/);
      const similarity = match ? parseInt(match[0]) : 0;

      results.push({
        image: file.originalname,
        similarity,
      });

    } catch (err) {
      sendLog(socket, "Image analysis failed");
    }
  }

  res.json({ results });
});

/* ===================================================== */
/* ================= SOCKET ============================ */
/* ===================================================== */

io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
