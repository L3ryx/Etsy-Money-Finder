const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ZENROWS_KEY = process.env.ZENROWS_KEY;
const SERPER_KEY = process.env.SERPER_KEY;
const IMGBB_KEY = process.env.IMGBB_KEY;

function extractImageUrl(srcset) {
  if (!srcset) return null;
  const urls = srcset.split(",").map(u => u.trim().split(" ")[0]);
  return urls[urls.length - 1];
}

async function scrapeEtsy(keyword) {

  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      url: url,
      apikey: ZENROWS_KEY,
      js_render: "true"
    }
  });

  const html = response.data;

  const imageRegex = /<img [^>]*srcset="([^"]+)"/g;
  const linkRegex = /href="(\/listing\/\d+)"/g;

  const images = [...html.matchAll(imageRegex)]
    .map(m => extractImageUrl(m[1]))
    .filter(Boolean);

  const links = [...html.matchAll(linkRegex)]
    .map(m => "https://www.etsy.com" + m[1]);

  const results = [];

  for (let i = 0; i < Math.min(10, images.length); i++) {

    results.push({
      image: images[i],
      link: links[i]
    });

  }

  return results;
}

async function uploadToImgbb(imageUrl) {

  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

  const base64 = Buffer.from(response.data).toString("base64");

  const upload = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: IMGBB_KEY,
      image: base64
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return upload.data.data.url;
}

async function reverseImageSearch(imageUrl) {

  const response = await axios.post(
    "https://google.serper.dev/images",
    { imageUrl: imageUrl },
    {
      headers: {
        "X-API-KEY": SERPER_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.images || [];
}

async function scrapeAliExpressResults(queryUrl) {

  const response = await axios.get("https://api.zenrows.com/v1/", {
    params: {
      url: queryUrl,
      apikey: ZENROWS_KEY,
      js_render: "true"
    }
  });

  const html = response.data;

  const imageRegex = /<img[^>]+src="([^"]+)"/g;
  const linkRegex = /href="(https:\/\/www\.aliexpress\.com\/item\/[^"]+)"/g;

  const images = [...html.matchAll(imageRegex)].map(m => m[1]);
  const links = [...html.matchAll(linkRegex)].map(m => m[1]);

  const results = [];

  for (let i = 0; i < Math.min(10, images.length); i++) {

    results.push({
      image: images[i],
      link: links[i]
    });

  }

  return results;
}

app.post("/search", async (req, res) => {

  try {

    const { keyword } = req.body;

    const etsyProducts = await scrapeEtsy(keyword);

    const finalResults = [];

    for (const product of etsyProducts) {

      const imgbbUrl = await uploadToImgbb(product.image);

      const reverseResults = await reverseImageSearch(imgbbUrl);

      const aliResults = reverseResults
        .filter(r => r.link && r.link.includes("aliexpress.com"))
        .slice(0, 10);

      for (const ali of aliResults) {

        const aliProducts = await scrapeAliExpressResults(ali.link);

        for (const item of aliProducts) {

          finalResults.push({

            etsyImage: product.image,
            etsyLink: product.link,

            aliImage: item.image,
            aliLink: item.link

          });

        }

      }

    }

    res.json(finalResults);

  } catch (error) {

    console.error(error);

    res.status(500).json({ error: "Server error" });

  }

});

app.get("/", (req, res) => {

  res.send("Server running");

});

app.listen(PORT, () => {

  console.log("Server started on port " + PORT);

});
