/* ===================================================== */
/* SOCKET CONNECTION (SI TU UTILISES LES LOGS) */
/* ===================================================== */

const socket = io();
let socketId = null;

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("Socket connected:", socketId);
});

socket.on("log", (data) => {

  const logsDiv = document.getElementById("logs");

  if (!logsDiv) return;

  const p = document.createElement("p");

  p.innerHTML = `
    <span style="color:#888">
      [${new Date(data.time).toLocaleTimeString()}]
    </span>
    ${data.message}
  `;

  logsDiv.appendChild(p);
  logsDiv.scrollTop = logsDiv.scrollHeight;

});


/* ===================================================== */
/* ETSY SEARCH */
/* ===================================================== */

const searchForm = document.getElementById("searchForm");
const resultsDiv = document.getElementById("results");

if (searchForm) {

  searchForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    resultsDiv.innerHTML = "Searching... 🔎";

    const keyword = document.getElementById("keyword").value;
    const limit = document.getElementById("limit").value;

    try {

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

        resultsDiv.innerHTML = "No results found ❌";
        return;

      }

      resultsDiv.innerHTML = "";

      data.results.forEach(item => {

        const card = document.createElement("div");
        card.style.marginBottom = "20px";

        card.innerHTML = `
          <img src="${item.image}" width="250" />
          <br><br>
          <a href="${item.link}" target="_blank"
             style="color:blue; font-weight:bold;">
             🔗 Open Etsy Listing
          </a>
          <hr>
        `;

        resultsDiv.appendChild(card);

      });

    } catch (err) {

      console.error(err);
      resultsDiv.innerHTML = "Search failed ❌";

    }

  });

}


/* ===================================================== */
/* IMAGE ANALYSIS FORM */
/* ===================================================== */

const analyzeForm = document.getElementById("analyzeForm");

if (analyzeForm) {

  analyzeForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const fileInput = document.getElementById("imageInput");

    const files = fileInput.files;

    if (!files || files.length === 0) {
      alert("Select an image");
      return;
    }

    const formData = new FormData();

    for (const file of files) {
      formData.append("images", file);
    }

    formData.append("socketId", socketId);

    try {

      const response = await fetch("/analyze-images", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      console.log("Analysis result:", data);

    } catch (err) {

      console.error("Analysis failed", err);

    }

  });

}
