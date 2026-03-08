// server.js
import express from "express";
import axios from "axios";
import cors from "cors";
import FormData from "form-data";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Endpoint principal
app.post("/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });

    // 1️⃣ Scraping Etsy - top 10 résultats
    const etsyResponse = await axios.get(
      `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&url=${encodeURIComponent(
        `https://www.etsy.com/search?q=${query}`
      )}&render_js=false`,
      { timeout: 30000 }
    );
    // Extraction des images + liens
    const etsyData = etsyResponse.data.match(
      /"listingPageUrl":"(.*?)".*?"url":"(.*?)"/g
    )?.slice(0, 10) || [];
    const etsyResults = etsyData.map((item) => {
      const urlMatch = item.match(/"listingPageUrl":"(.*?)"/);
      const imgMatch = item.match(/"url":"(.*?)"/);
      return {
        link: urlMatch ? urlMatch[1].replace(/\\/g, "") : "",
        image: imgMatch ? imgMatch[1].replace(/\\/g, "") : "",
      };
    });

    // 2️⃣ Reverse image search + filtrage AliExpress - top 5
    const finalResults = [];
    for (const etsyItem of etsyResults) {
      if (!etsyItem.image) continue;

      const aliResponse = await axios.get(
        `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&url=${encodeURIComponent(
          `https://www.aliexpress.com/wholesale?SearchText=${etsyItem.image}`
        )}&render_js=false`,
        { timeout: 30000 }
      );

      const aliData = aliResponse.data.match(
        /"productUrl":"(.*?)".*?"imageUrl":"(.*?)"/g
      )?.slice(0, 5) || [];

      const aliResults = aliData.map((item) => {
        const linkMatch = item.match(/"productUrl":"(.*?)"/);
        const imgMatch = item.match(/"imageUrl":"(.*?)"/);
        return {
          link: linkMatch ? linkMatch[1].replace(/\\/g, "") : "",
          image: imgMatch ? imgMatch[1].replace(/\\/g, "") : "",
          similarity: 0, // placeholder OpenAI similarity
        };
      });

      // 3️⃣ Comparaison d’images OpenAI
      for (const aliItem of aliResults) {
        try {
          // Upload image Etsy sur Imgbb
          const form = new FormData();
          form.append("image", etsyItem.image);
          const imgbbRes = await axios.post(
            `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
            form,
            { headers: form.getHeaders() }
          );
          const etsyImgUrl = imgbbRes.data.data.url;

          // Comparaison OpenAI
          const openaiRes = await axios.post(
            "https://api.openai.com/v1/images/compare",
            {
              image_1: etsyImgUrl,
              image_2: aliItem.image,
            },
            { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
          );
          aliItem.similarity = openaiRes.data.similarity || 0;
        } catch (err) {
          console.log("OpenAI/Imgbb error:", err.message);
          aliItem.similarity = 0;
        }
      }

      finalResults.push({
        etsy: etsyItem,
        aliexpress: aliResults,
      });
    }

    res.json(finalResults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
