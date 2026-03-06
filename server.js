require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { GoogleSearch } = require("serpapi");

/* ===================== MONGOOSE MODELS ===================== */

const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  credits: { type: Number, default: 0 },
  role: { type: String, default: "user" },
  paid: { type: Boolean, default: false },
  purchaseHistory: [],
  searchHistory: []
});

const EtsyCacheSchema = new mongoose.Schema({
  keyword: { type: String, unique: true },
  results: [],
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);
const EtsyCache = mongoose.model("EtsyCache", EtsyCacheSchema);

/* ===================== EXPRESS SETUP ===================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

/* ===================== AUTH MIDDLEWARE ===================== */

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* ===================== REGISTER ===================== */

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ email, password: hashed });
  res.json({ message: "User created" });
});

/* ===================== LOGIN ===================== */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "Invalid" });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Invalid" });

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

/* ===================== DASHBOARD ===================== */

app.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({
    email: user.email,
    role: user.role,
    credits: user.credits,
    purchaseHistory: user.purchaseHistory,
    searchHistory: user.searchHistory
  });
});

/* ===================== ETSY + AliExpress SEARCH ===================== */

app.post("/search-etsy", auth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(401).json({ message: "User not found" });

  if (user.role !== "unlimited" && user.credits <= 0)
    return res.status(403).json({ message: "No credits left" });

  const { keyword, limit } = req.body;
  const maxItems = Math.min(parseInt(limit) || 10, 50);

  try {
    // ==== CACHE CHECK ====
    let cache = await EtsyCache.findOne({ keyword });
    if (cache && cache.results.length > 0) {
      console.log("✅ Using cached results");
      return res.json({ results: cache.results, creditsLeft: user.credits });
    }

    // ==== ETSY SCRAPING ====
    const etsyUrl = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;
    const etsyResponse = await axios.get("https://api.scraperapi.com/", {
      params: { api_key: process.env.SCRAPAPI_KEY, url: etsyUrl, render: true }
    });

    const html = etsyResponse.data;
    const productRegex = /<a[^>]*href="(https:\/\/www\.etsy\.com\/listing\/\d+)[^"]*"[^>]*>[\s\S]*?<\/a>/g;
    const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;

    const matches = [...html.matchAll(productRegex)];
    const images = [...html.matchAll(imageRegex)];

    const results = [];

    for (let i = 0; i < Math.min(maxItems, matches.length, images.length); i++) {
      const etsyLink = matches[i][1];
      const etsyImage = images[i][0];

      // ==== SERPAPI Google Shopping ====
      const serpapiClient = new GoogleSearch(process.env.SERPAPI_KEY);
      const params = {
        engine: "google_shopping",
        q: etsyImage,
        google_domain: "google.com",
        hl: "fr",
        gl: "fr"
      };

      let aliImages = [];
      let aliLinks = [];

      await new Promise((resolve, reject) => {
        serpapiClient.json(params, (data) => {
          if (!data || data.error) return resolve();
          if (data.shopping_results) {
            data.shopping_results.forEach(p => {
              if (p.link.includes("aliexpress")) {
                aliImages.push(p.thumbnail || p.image);
                aliLinks.push(p.link);
              }
            });
          }
          resolve();
        });
      });

      // ==== SIMILARITY CHECK (70-100%) ====
      const similarPairs = [];
      for (let j = 0; j < aliImages.length; j++) {
        // Ici tu dois appeler ton smartCompare OpenAI
        // const similarity = await smartCompare(etsyImage, aliImages[j]);
        const similarity = 80; // TEMP TEST (à remplacer par OpenAI)
        if (similarity >= 70) {
          similarPairs.push({
            aliexpress: { image: aliImages[j], link: aliLinks[j] },
            similarity
          });
        }
      }

      if (similarPairs.length > 0) {
        results.push({
          etsy: { image: etsyImage, link: etsyLink },
          aliMatches: similarPairs
        });
      }
    }

    // ==== SAVE CACHE ====
    await EtsyCache.updateOne(
      { keyword },
      { results, updatedAt: new Date() },
      { upsert: true }
    );

    if (user.role !== "unlimited") user.credits -= 1;
    user.searchHistory.push({ query: keyword, date: new Date() });
    await user.save();

    res.json({ results, creditsLeft: user.credits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Scraping failed" });
  }
});

/* ===================== SOCKET CONNECTION ===================== */

io.on("connection", socket => {
  console.log("🟢 Client connected");
  socket.emit("connected", { socketId: socket.id });
});

/* ===================== SERVER START ===================== */

mongoose.connect(process.env.DB_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch(err => console.log("❌ Mongo error", err));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
