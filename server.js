const express = require("express");
const axios = require("axios");
const cors = require("cors");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Endpoint test
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// Upload image to Imgbb
async function uploadToImgbb(imageUrl) {
  try {
    const form = new FormData();
    form.append("image", imageUrl);

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, form, {
      headers: form.getHeaders()
    });

    return response.data.data.url;
  } catch (err) {
    console.error("Imgbb upload failed:", err.response?.data || err.message);
    return null;
  }
}

// Reverse image search via Serper
async function reverseImageSearch(imgUrl) {
  try {
    const response = await axios.post(
      "https://google.serper.dev/images",
      { imageUrl: imgUrl },
      {
        headers: { "X-API-KEY": SERPER_API_KEY },
      }
    );
    return response.data;
  } catch (err) {
    console.error("Serper reverse image error:", err.response?.data || err.message);
    return null;
  }
}

// Example route: process image → reverse search → Imgbb → return URL
app.post("/process-image", async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ message: "Missing imageUrl" });

  try {
    // Upload to Imgbb
    const imgbbUrl = await uploadToImgbb(imageUrl);

    // Reverse image search
    const reverseResults = await reverseImageSearch(imageUrl);

    // Here you can integrate AliExpress scraping and OpenAI comparison

    res.json({
      imgbbUrl,
      reverseResults
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
