/* ===================================================== */
/* NICHE FINDER BACKEND - PRO VERSION */
/* ===================================================== */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

/* ===================================================== */
/* APP INIT */
/* ===================================================== */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

/* ===================================================== */
/* PATH FIX FOR ES MODULE */
/* ===================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===================================================== */
/* MIDDLEWARE */
/* ===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===================================================== */
/* SERVE REACT BUILD IN PRODUCTION */
/* ===================================================== */

app.use(express.static(path.join(__dirname, "../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

/* ===================================================== */
/* SOCKET SYSTEM */
/* ===================================================== */

io.on("connection", (socket) => {
  console.log("🟢 Client connected");

  socket.emit("connected", {
    socketId: socket.id
  });
});

/* ===================================================== */
/* SEARCH ROUTE (TON SYSTEME EXACT) */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {

  const { keyword, limit } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const maxItems = Math.min(parseInt(limit) || 10, 50);

  try {

    const etsyUrl =
      `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

    const scraperResponse = await axios.get(
      "https://api.scraperapi.com/",
      {
        params: {
          api_key: process.env.SCRAPAPI_KEY,
          url: etsyUrl,
          render: true
        }
      }
    );

    const html = scraperResponse.data;

    const imageRegex = /https:\/\/i\.etsystatic\.com[^"]+/g;
    const linkRegex = /https:\/\/www\.etsy\.com\/listing\/\d+/g;

    const images = [...html.matchAll(imageRegex)];
    const links = [...html.matchAll(linkRegex)];

    const results = [];

    for (let i = 0; i < Math.min(maxItems, images.length); i++) {

      results.push({
        image: images[i][0],
        link: links[i] ? links[i][0] : etsyUrl
      });
    }

    res.json({ results });

  } catch (err) {

    console.error("Scraper error:", err.message);

    res.status(500).json({
      error: "Scraping failed"
    });
  }
});

/* ===================================================== */
/* SERVER START */
/* ===================================================== */

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
