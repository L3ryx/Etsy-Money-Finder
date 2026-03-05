require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static("public"));

/*
====================================================
IMAGE ANALYSIS PIPELINE
====================================================
*/
app.post("/analyze", upload.array("images"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded" });
  }

  const results = [];

  for (const file of req.files) {
    try {
      console.log("Analyzing:", file.originalname);

      const base64Image = file.buffer.toString("base64");

      /*
      ====================================================
      1️⃣ ZENSERP REVERSE IMAGE SEARCH
      ====================================================
      */

      const zenserpResponse = await axios.get(
        "https://app.zenserp.com/api/v2/search",
        {
          params: {
            apikey: process.env.ZENSERP_API_KEY,
            tbm: "isch",
            image_url: `data:image/jpeg;base64,${base64Image}`
          }
        }
      );

      const organic = zenserpResponse.data.organic || [];

      const aliexpressLinks = organic
        .map(item => item.link)
        .filter(link => link && link.includes("aliexpress.com"));

      console.log("AliExpress Links:", aliexpressLinks);

      /*
      ====================================================
      2️⃣ SCRAPERAPI SCRAPE PRODUITS
      ====================================================
      */

      const products = [];

      for (const link of aliexpressLinks) {
        try {
          const scrapeResponse = await axios.get(
            "http://api.scraperapi.com",
            {
              params: {
                api_key: process.env.SCRAPERAPI_KEY,
                url: link,
                render: true
              }
            }
          );

          const html = scrapeResponse.data;

          const titleMatch = html.match(/<title>(.*?)<\/title>/);
          const priceMatch = html.match(/"price":"(.*?)"/);

          products.push({
            url: link,
            title: titleMatch ? titleMatch[1] : "Unknown",
            price: priceMatch ? priceMatch[1] : "Unknown"
          });

        } catch (err) {
          console.log("Scraper failed for:", link);
        }
      }

      /*
      ====================================================
      3️⃣ RESULT FINAL
      ====================================================
      */

      results.push({
        image: file.originalname,
        products
      });

    } catch (err) {
      console.log("Pipeline error:", err.message);

      results.push({
        image: file.originalname,
        products: []
      });
    }
  }

  res.json({ results });
});

/*
====================================================
START SERVER
====================================================
*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
