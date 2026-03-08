// ========================================
// SOCKET CONNECTION
// ========================================
const socket = io();
let socketId = null;

socket.on("connected", data => {
  socketId = data.socketId;
  console.log("🟢 Socket connected:", socketId);
});

// ========================================
// LIVE LOGS
// ========================================
socket.on("log", data => {
  const logsDiv = document.getElementById("logs");
  const line = document.createElement("div");
  line.className = `log-${data.type}`;
  line.innerHTML = `
    <span style="color:#888">
      [${new Date(data.time).toLocaleTimeString()}]
    </span> ${data.message}
  `;
  logsDiv.appendChild(line);
  logsDiv.scrollTop = logsDiv.scrollHeight;
});

// ========================================
// FORM SUBMISSION
// ========================================
const form = document.getElementById("searchForm");
const resultsDiv = document.getElementById("results");

form.addEventListener("submit", async e => {
  e.preventDefault();

  resultsDiv.innerHTML = "";
  document.getElementById("logs").innerHTML = "<p>🚀 Début de la recherche...</p>";

  const keyword = document.getElementById("keyword").value.trim();
  if (!keyword) return alert("Entrez un mot clé");

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, socketId })
    });

    const data = await response.json();
    displayResults(data.results);

  } catch (err) {
    console.error("❌ Request failed:", err);
    alert("Erreur serveur, voir console pour détails");
  }
});

// ========================================
// DISPLAY RESULTS
// ========================================
function displayResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  if (!results || results.length === 0) {
    container.innerHTML = "<p style='color:red'>❌ Aucun résultat trouvé</p>";
    return;
  }

  results.forEach(r => {
    const card = document.createElement("div");
    card.className = "result-card";

    let html = `<h3>📷 Etsy: <a href="${r.etsy.link}" target="_blank">Voir annonce</a></h3>`;
    html += `<img src="${r.etsy.image}" style="width:200px; border-radius:10px">`;

    html += `<h4>💎 Correspondances AliExpress:</h4>`;
    if (!r.aliexpress || !r.aliexpress.link) {
      html += `<p>Aucune correspondance ≥70%</p>`;
    } else {
      html += `<div class="ali-products">
        <p>🔥 Similarité: ${r.similarity}%</p>
        <a href="${r.aliexpress.link}" target="_blank">
          <img src="${r.aliexpress.image}" style="width:150px; border-radius:10px">
          <br>Voir produit
        </a>
      </div>`;
    }

    card.innerHTML = html;
    container.appendChild(card);
  });
}
