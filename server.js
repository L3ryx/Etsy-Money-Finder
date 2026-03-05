/* ===================================================== */
/* 🔎 ETSY SEARCH → EXTRACTION PROPRE + ORGANISATION */
/* ===================================================== */

app.post("/search-etsy", async (req, res) => {

  console.log("🔥 Search route called");

  const { keyword, limit, socketId } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: "Keyword required" });
  }

  const socket = io.sockets.sockets.get(socketId);
  const maxItems = Math.min(parseInt(limit) || 10, 50);

  try {

    if (socket) socket.emit("progress", { percent: 10 });

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

    if (socket) socket.emit("progress", { percent: 40 });

    /* ===================================================== */
    /* ✅ EXTRACTION AMÉLIORÉE */
/* ===================================================== */

    const productRegex =
      /<a[^>]+href="(https:\/\/www\.etsy\.com\/listing\/\d+[^"]*)"[^>]*>[\s\S]*?<img[^>]+src="(https:\/\/i\.etsystatic\.com[^"]*)"/g;

    let match;
    let rawResults = [];

    while ((match = productRegex.exec(html)) !== null) {

      rawResults.push({
        link: match[1],
        image: match[2]
      });

      if (rawResults.length >= maxItems) break;
    }

    /* ===================================================== */
    /* ✅ ORGANISATION PROPRE */
/* ===================================================== */

    const organizedResults = rawResults
      .map((item, index) => {

        return {
          order: index + 1,
          image: item.image,
          link: item.link
        };

      });

    /* ===================================================== */
    /* ✅ TRI & STRUCTURE FINALE */
/* ===================================================== */

    const finalResults = organizedResults.sort(
      (a, b) => a.order - b.order
    );

    if (socket) socket.emit("progress", { percent: 100 });

    res.json({
      total: finalResults.length,
      results: finalResults
    });

  } catch (err) {

    console.error("ScraperAPI Error:", err.message);

    if (socket) socket.emit("progress", { percent: 0 });

    res.status(500).json({
      error: "Scraping failed"
    });
  }

});
