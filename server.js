require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { Server } = require("socket.io");

/* ===================================================== */
/* APP SETUP */
/* ===================================================== */
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const User = require("./models/User");

/* ===================================================== */
/* DATABASE */
/* ===================================================== */
mongoose.connect(
  `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(
    process.env.DB_PASS
  )}@cluster0.bwlimkp.mongodb.net/${process.env.DB_NAME}?retryWrites=true&w=majority`
)
.then(() => console.log("✅ Mongo Connected"))
.catch((err) => console.log("❌ Mongo Error", err));

/* ===================================================== */
/* MIDDLEWARE */
/* ===================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

/* ===================================================== */
/* AUTH MIDDLEWARE */
/* ===================================================== */
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

/* ===================================================== */
/* REGISTER */
/* ===================================================== */
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "User exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hashed,
      credits: 0,
      role: "user",
      paid: false,
      purchaseHistory: [],
      searchHistory: [],
    });

    const customer = await stripe.customers.create({ email });
    user.stripeCustomerId = customer.id;
    await user.save();

    res.json({ message: "User created" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Register failed" });
  }
});

/* ===================================================== */
/* LOGIN */
/* ===================================================== */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Login failed" });
  }
});

/* ===================================================== */
/* DASHBOARD */
/* ===================================================== */
app.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  res.json({
    email: user.email,
    role: user.role,
    credits: user.credits,
    searchesUsed: user.searchesUsed,
    purchaseHistory: user.purchaseHistory || [],
    searchHistory: user.searchHistory || [],
  });
});

/* ===================================================== */
/* STRIPE CHECKOUT */
/* ===================================================== */
app.post("/create-checkout-session", auth, async (req, res) => {
  const user = await User.findById(req.user.userId);
  const { amount, plan, searches } = req.body;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer: user.stripeCustomerId,
    metadata: { plan, searches },
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: `Plan ${plan}` },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    success_url: "http://localhost:10000/success.html",
    cancel_url: "http://localhost:10000/payment.html",
  });

  res.json({ url: session.url });
});

/* ===================================================== */
/* WEBHOOK */
/* ===================================================== */
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const endpointSecret = process.env.STRIPE
