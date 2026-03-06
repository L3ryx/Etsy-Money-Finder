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
const Stripe = require("stripe");

/* ===================================================== */
/* ================= CONFIG ============================ */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({ storage: multer.memoryStorage() });

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ===================================================== */
/* ================= STRIPE WEBHOOK RAW ================= */
/* ===================================================== */

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("❌ Webhook signature failed");
      return res.status(400).send(`Webhook Error`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session.metadata.userId;

      await User.findByIdAndUpdate(userId, {
        $inc: { tokens: 1 }
      });

      console.log("✅ 1 token added after payment");
    }

    res.json({ received: true });
  }
);

/* ===================================================== */
/* ================= MODELS ============================ */
/* ===================================================== */

const User = require("./models/User");
const SavedProduct = require("./models/SavedProduct");

/* ===================================================== */
/* ================= DATABASE ========================== */
/* ===================================================== */

const mongoURI = `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(
  process.env.DB_PASS
)}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`;

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));

/* ===================================================== */
/* ================= MIDDLEWARE ======================== */
/* ===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* ================= AUTH MIDDLEWARE =================== */
/* ===================================================== */

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

/* ===================================================== */
/* ================= REGISTER ========================== */
/* ===================================================== */

app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "User exists" });

  const hashed = await bcrypt.hash(password, 10);

  await User.create({
    email,
    password: hashed,
    tokens: 0
  });

  res.json({ message: "User created ✅" });
});

/* ===================================================== */
/* ================= LOGIN ============================= */
/* ===================================================== */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user)
    return res.status(400).json({ message: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);

  if (!match)
    return res.status(400).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

/* ===================================================== */
/* ============== CREATE PAYMENT (0.50€) =============== */
/* ===================================================== */

app.post("/create-payment", authMiddleware, async (req, res) => {

  try {

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Image Search"
            },
            unit_amount: 50
          },
          quantity: 1
        }
      ],

      metadata: {
        userId: req.user.userId
      },

      success_url: "https://tonsite.com/success",
      cancel_url: "https://tonsite.com/cancel"
    });

    res.json({ url: session.url });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Stripe error" });
  }
});

/* ===================================================== */
/* ============== TOKEN DEDUCTION ====================== */
/* ===================================================== */

async function consumeToken(userId) {

  const user = await User.findById(userId);

  if (!user || user.tokens <= 0) {
    throw new Error("No tokens left");
  }

  await User.findByIdAndUpdate(userId, {
    $inc: { tokens: -1 }
  });
}

/* ===================================================== */
/* ============== ETSY SCRAPER ========================= */
/* ===================================================== */

app.post("/search-etsy", authMiddleware, async (req, res) => {

  const { keyword, limit } = req.body;

  try {

    await consumeToken(req.user.userId);

    const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    const response = await axios.get("https://api.scraperapi.com/", {
      params: {
        api_key: process.env.SCRAPAPI_KEY,
        url,
        render: true
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $("a").each((i, el) => {

      if (results.length >= limit) return;

      const href = $(el).attr("href");

      if (!href || !href.includes("/listing/")) return;

      let image =
        $(el).find("img").first().attr("src") ||
        $(el).find("img").first().attr("data-src");

      if (!image) return;

      if (image.startsWith("//")) image = "https:" + image;

      results.push({
        image,
        link: href.startsWith("http")
          ? href
          : "https://www.etsy.com" + href
      });

    });

    res.json({ results });

  } catch (err) {

    if (err.message === "No tokens left") {
      return res.status(403).json({
        message: "No tokens left, please buy more."
      });
    }

    res.status(500).json({ error: "Scraping failed" });
  }
});

/* ===================================================== */
/* ============== SAVE PRODUCT ========================= */
/* ===================================================== */

app.post("/save-product", authMiddleware, async (req, res) => {

  const { image, link } = req.body;

  const product = await SavedProduct.create({
    userId: req.user.userId,
    image,
    link
  });

  res.json(product);
});

/* ===================================================== */
/* ============== DASHBOARD ============================ */
/* ===================================================== */

app.get("/dashboard", authMiddleware, async (req, res) => {

  const products = await SavedProduct.find({
    userId: req.user.userId
  });

  const user = await User.findById(req.user.userId);

  res.json({
    tokens: user.tokens,
    products
  });

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
