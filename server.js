const express = require("express");
const multer = require("multer");
const axios = require("axios");
const cheerio = require("cheerio");
const FormData = require("form-data");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

const SCRAPER_API = "TA_CLE_SCRAPERAPI";
const IMGBB_API = "TA_CLE_IMGBB";

app.post("/search", upload.single("image"), async (req, res) => {

    try {

        // upload image vers imgbb
        const form = new FormData();
        form.append("image", req.file.buffer.toString("base64"));

        const upload = await axios.post(
            `https://api.imgbb.com/1/upload?key=${IMGBB_API}`,
            form
        );

        const imageUrl = upload.data.data.url;

        // recherche Etsy
        const searchUrl = `https://www.etsy.com/search?q=${encodeURIComponent(imageUrl)}`;

        const response = await axios.get("https://api.scraperapi.com/", {
            params: {
                api_key: SCRAPER_API,
                url: searchUrl,
                render: true
            }
        });

        const $ = cheerio.load(response.data);

        const results = [];

        $("li.wt-list-unstyled").each((i, el) => {

            const img =
                $(el).find("img").attr("src") ||
                $(el).find("img").attr("data-src");

            const link = $(el).find("a").attr("href");

            if (img && link && link.includes("/listing/")) {

                results.push({
                    image: img,
                    link: link.startsWith("http") ? link : "https://www.etsy.com" + link
                });

            }

        });

        res.json(results);

    } catch (err) {

        console.log(err);
        res.status(500).send("Search failed");

    }

});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
