// ========================================
// SOCKET CONNECTION
// ========================================

const socket = io();
let socketId = null;

socket.on("connected", (data) => {

  socketId = data.socketId;
  console.log("🟢 Socket connected:", socketId);

});

// ========================================
// LIVE LOGS
// ========================================

socket.on("log", (data) => {

  const logsDiv = document.getElementById("logs");

  const line = document.createElement("div");

  line.className = `log-${data.type}`;

  line.innerHTML = `
    <span style="color:#888">
      [${new Date(data.time).toLocaleTimeString()}]
    </span>
    ${data.message}
  `;

  logsDiv.appendChild(line);
  logsDiv.scrollTop = logsDiv.scrollHeight;

});

// ========================================
// FORM SUBMISSION (KEYWORD SEARCH)
// ========================================

const form = document.getElementById("searchForm");
const resultsContainer = document.getElementById("results");

form.addEventListener("submit", async (e) => {

  e.preventDefault();

  const keyword = document.getElementById("keyword").value;

  resultsContainer.innerHTML = "";

  document.getElementById("logs").innerHTML =
    "<p>🚀 Starting analysis...</p>";

  if (!keyword) {

    alert("Please enter a keyword");
    return;

  }

  try {

    const response = await fetch("/analyze", {

      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        keyword,
        socketId
      })

    });

    const data = await response.json();

    displayResults(data.results);

  } catch (err) {

    console.error("❌ Request failed:", err);

  }

});

// ========================================
// DISPLAY RESULTS
// ========================================

function displayResults(results) {

  const resultsContainer = document.getElementById("results");

  if (!results || results.length === 0) {

    resultsContainer.innerHTML =
      "<p style='color:red'>❌ No suppliers found</p>";

    return;

  }

  results.forEach(result => {

    const card = document.createElement("div");
    card.className = "result-card";

    card.innerHTML = `

      <div class="product-container">

        <div class="etsy-product">
          <h3>🛍 Etsy Product</h3>
          <img src="${result.etsy.image}" class="product-img">
          <a href="${result.etsy.link}" target="_blank">
            Open Etsy Listing
          </a>
        </div>

        <div class="ali-product">
          <h3>🏭 AliExpress Supplier</h3>
          <img src="${result.aliexpress.image}" class="product-img">
          <a href="${result.aliexpress.link}" target="_blank">
            Open AliExpress Product
          </a>
        </div>

      </div>

      <p class="similarity">
        🔥 Similarity: ${result.similarity}%
      </p>

    `;

    resultsContainer.appendChild(card);

  });

}
