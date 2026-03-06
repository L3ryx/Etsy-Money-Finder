/* ===================================================== */
/* ===================== IMPORTS ======================= */
/* ===================================================== */

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cheerio = require("cheerio");
const Stripe = require("stripe");

const app = express();
const server = http.createServer(app);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ===================================================== */
/* ================= MODELS ============================ */
/* ===================================================== */

const User = require("./models/User");
const SavedProduct = require("./models/SavedProduct");

/* ===================================================== */
/* ================= DATABASE ========================== */
/* ===================================================== */

mongoose
  .connect(
    `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(
      process.env.DB_PASS
    )}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
  )
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ Mongo Error", err));

/* ===================================================== */
/* ================= MIDDLEWARE ======================== */
/* ===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ===================================================== */
/* ================= HTML ROUTES ======================= */
/* ===================================================== */

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/register", (req, res) => {
  res.sendFile(__dirname + "/public/register.html");
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.get("/dashboard", (req, res) => {
  res.sendFile(__dirname + "/public/dashboard.html");
});

app.get("/payment", (req, res) => {
  res.sendFile(__dirname + "/public/payment.html");
});

/* ===================================================== */
/* ================= AUTH ============================== */
/* ===================================================== */

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* ===================================================== */
/* ================= REGISTER ========================== */
/* ===================================================== */

app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) {
    return res.status(400).json({ message: "User already exists" });
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await User.create({
    email,
    password: hashed
  });

  /* 🔥 CREATE STRIPE CUSTOMER */

  const customer = await stripe.customers.create({
    email: email
  });

  user.stripeCustomerId = customer.id;
  await user.save();

  res.json({ message: "User created" });
});

/* ===================================================== */
/* ================= LOGIN ============================= */
/* ===================================================== */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Invalid credentials" });

  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

/* ===================================================== */
/* ================= ATTACH CARD ======================= */
/* ===================================================== */

app.post("/attach-card", auth, async (req, res) => {

  const { paymentMethodId } = req.body;

  const user = await User.findById(req.user.userId);

  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: user.stripeCustomerId
  });

  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId
    }
  });

  user.defaultPaymentMethod = paymentMethodId;
  await user.save();

  res.json({ success: true });
});

/* ===================================================== */
/* ================= AUTO CHARGE 0.50€ ================= */
/* ===================================================== */

app.post("/charge-search", auth, async (req, res) => {

  try {

    const user = await User.findById(req.user.userId);

    if (!user.stripeCustomerId || !user.defaultPaymentMethod) {
      return res.status(400).json({ message: "Carte non enregistrée" });
    }

    await stripe.paymentIntents.create({
      amount: 50,
      currency: "eur",
      customer: user.stripeCustomerId,
      payment_method: user.defaultPaymentMethod,
      off_session: true,
      confirm: true
    });

    res.json({ success: true });

  } catch (err) {

    console.log("❌ Payment failed");
    res.status(400).json({ message: "Paiement échoué" });

  }
});

/* ===================================================== */
/* ================= ETSY SEARCH ======================= */
/* ===================================================== */

app.post("/search-etsy", auth, async (req, res) => {

  const { keyword, limit } = req.body;

  try {

    /* 🔥 Paiement DIRECT ici (PLUS DE localhost) */

    const user = await User.findById(req.user.userId);

    if (!user.stripeCustomerId || !user.defaultPaymentMethod) {
      return res.status(400).json({ message: "Carte non enregistrée" });
    }

    await stripe.paymentIntents.create({
      amount: 50,
      currency: "eur",
      customer: user.stripeCustomerId,
      payment_method: user.defaultPaymentMethod,
      off_session: true,
      confirm: true
    });

    /* 🔎 SCRAP ETSY */

    const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    const response = await axios.get(
      "https://api.scraperapi.com/",
      {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url,
          render: true
        }
      }
    );

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

    console.log("❌ Search error:", err.message);

    res.status(500).json({
      message: "Search failed or payment rejected"
    });

  }

});

/* ===================================================== */
/* ================= SERVER START ====================== */
/* ===================================================== */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
