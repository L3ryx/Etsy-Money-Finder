import express from "express";
import axios from "axios";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const IMGBB_API_KEY = process.env.IMGBB_API_KEY; // clé Imgbb
const SERPER_API_KEY = process.env.SERPER_API_KEY; // clé Serper
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // clé OpenAI

// ---------------- Utilitaires ----------------
function extractImageUrl(srcset) {
  if (!srcset) return null;
  const urls = srcset.split(",").map(u => u.trim().split(" ")[0]);
  return urls[urls.length - 1]; // haute résolution
}

async function scrapeEtsy(keyword) {
  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const imageRegex = /<img [^>]*srcset="([^"]+)"/g;
  const images = [...html.matchAll(imageRegex)]
    .map(m => extractImageUrl(m[1]))
    .filter(Boolean);

  return images.slice(0, 10);
}

async function uploadToImgbb(imageUrl) {
  const form = new URLSearchParams();
  form.append("key", IMGBB_API_KEY);
  form.append("image", imageUrl);
  const res = await axios.post("https://api.imgbb.com/1/upload", form);
  return res.data.data.url;
}

async function reverseImageSearch(imgUrl) {
  const res = await axios.post(
    "https://google.serper.dev/images",
    { imageUrl: imgUrl },
    { headers: { "X-API-KEY": SERPER_API_KEY } }
  );
  return res.data;
}

async function downloadImage(url, filename) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(filename, res.data);
  return filename;
}

async function compareImagesWithOpenAI(imagePath1, imagePath2) {
  // Simulé ici, remplacer par OpenAI Vision/CLIP
  return Math.random() * 100; 
}

// ---------------- Endpoint principal ----------------
app.post("/search", async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: "Keyword is required" });

    console.log("🔎 Scraping Etsy for", keyword);
    const etsyImages = await scrapeEtsy(keyword);

    const results = [];

    for (const etsy of etsyImages) {
      try {
        // 1️⃣ Upload sur IMGBB
        const imgbbUrl = await uploadToImgbb(etsy);
        console.log("Uploaded to IMGBB:", imgbbUrl);

        // 2️⃣ Reverse image search
        const reverseResults = await reverseImageSearch(imgbbUrl);
        const aliResults = (reverseResults.results || [])
          .filter(r => r.link?.includes("aliexpress.com"))
          .slice(0, 10);

        // 3️⃣ Comparaison des images
        const etsyTemp = path.join("tmp", "etsy.jpg");
        fs.mkdirSync("tmp", { recursive: true });
        await downloadImage(etsy, etsyTemp);

        for (let i = 0; i < aliResults.length; i++) {
          const aliImageUrl = aliResults[i].image;
          const aliTemp = path.join("tmp", `ali_${i}.jpg`);
          await downloadImage(aliImageUrl, aliTemp);

          const similarity = await compareImagesWithOpenAI(etsyTemp, aliTemp);

          if (similarity >= 70) {
            results.push({
              etsy,
              aliExpress: aliImageUrl,
              aliLink: aliResults[i].link,
              similarity: similarity.toFixed(2)
            });
          }
          fs.unlinkSync(aliTemp);
        }

        fs.unlinkSync(etsyTemp);
      } catch (err) {
        console.error("Erreur pour l'image Etsy:", etsy, err.message);
      }
    }

    res.json({ matches: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));
