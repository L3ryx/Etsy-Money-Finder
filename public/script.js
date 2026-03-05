/* ===================================================== */
/* SOCKET CONNECTION */
/* ===================================================== */

const socket = io();
let socketId = null;

const progressBar = document.getElementById("progressBar");
let progress = 0;

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("🟢 Connected to server:", socketId);
});

/* ===================================================== */
/* LOGS -> PROGRESS BAR */
/* ===================================================== */

socket.on("log", (data) => {

  console.log("LOG:", data.message);

  progress += 20;

  if (progress > 100) progress = 100;

  if (progressBar) {
    progressBar.style.width = progress + "%";
  }

});

/* ===================================================== */
/* 🔎 SEARCH ETSY */
/* ===================================================== */

async function searchEtsy() {

  const keywordInput = document.getElementById("keyword");
  const limitSelect = document.getElementById("limit");
  const resultsContainer = document.getElementById("results");

  if (!keywordInput) {
    console.error("Keyword input not found");
    return;
  }

  const keyword = keywordInput.value;
  const limit = limitSelect ? limitSelect.value : 10;

  if (!keyword) {
    alert("Please enter a keyword");
    return;
  }

  /* Reset progress */
  progress = 0;

  if (progressBar) {
    progressBar.style.width = "0%";
  }

  resultsContainer.innerHTML = "<p>🔎 Searching Etsy...</p>";

  try {

    /* ===================================== */
    /* CALL BACKEND SEARCH ROUTE */
    /* ===================================== */

    const response = await fetch("/search-etsy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        keyword,
        limit
      })
    });

    const data = await response.json();

    if (!data.results || data.results.length === 0) {

      resultsContainer.innerHTML =
        "<p style='color:red'>❌ No results found</p>";

      return;
    }

    resultsContainer.innerHTML = "";

    /* ===================================== */
    /* LOOP THROUGH SCRAPED IMAGES */
    /* ===================================== */

    for (const item of data.results) {

      const card = document.createElement("div");
      card.style.background = "#111";
      card.style.padding = "10px";
      card.style.margin = "10px";
      card.style.borderRadius = "10px";

      card.innerHTML = `
        <p>🔗 <a href="${item.link}" target="_blank" style="color:#00ff88">
        Open Listing
        </a></p>
        <img src="${item.image}" width="200" style="border-radius:10px"/>
      `;

      resultsContainer.appendChild(card);

      /* ===================================== */
      /* SEND IMAGE TO ANALYSIS PIPELINE */
      /* ===================================== */

      try {

        const imgResponse = await fetch(item.image);
        const blob = await imgResponse.blob();

        const formData = new FormData();
        formData.append("images", blob);
        formData.append("socketId", socketId);

        await fetch("/analyze-images", {
          method: "POST",
          body: formData
        });

      } catch (err) {
        console.error("Image analysis failed", err);
      }

    }

  } catch (err) {

    console.error("Search failed:", err);
    resultsContainer.innerHTML =
      "<p style='color:red'>❌ Search failed</p>";
  }
}
