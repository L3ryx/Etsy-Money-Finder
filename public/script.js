const socket = io();
let socketId = null;

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("🟢 Socket connected:", socketId);
});

socket.on("log", (data) => {
  const logsDiv = document.getElementById("logs");
  const line = document.createElement("div");
  line.innerHTML = `<span style="color:#888">[${new Date(data.time).toLocaleTimeString()}]</span> ${data.message}`;
  logsDiv.appendChild(line);
  logsDiv.scrollTop = logsDiv.scrollHeight;
});

const searchBtn = document.getElementById("searchBtn");
searchBtn.addEventListener("click", async () => {
  const keyword = document.getElementById("keyword").value.trim();
  if (!keyword) return alert("Veuillez entrer un mot clé");

  document.getElementById("results").innerHTML = "";
  document.getElementById("logs").innerHTML = "<p>🚀 Recherche en cours...</p>";

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, socketId })
    });

    const data = await response.json();
    displayResults(data.results);

  } catch (err) {
    console.error("Erreur serveur:", err);
    alert("Erreur serveur ❌");
  }
});

function displayResults(results) {
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  if (!results || results.length === 0) {
    resultsDiv.innerHTML = "<p style='color:red'>❌ Aucun résultat trouvé</p>";
    return;
  }

  results.forEach(product => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <img src="${product.image}" alt="Produit" style="width:100%; max-width:300px; border-radius:10px;">
      <p><a href="${product.link}" target="_blank">🔗 Voir l'annonce</a></p>
    `;
    resultsDiv.appendChild(card);
  });
}
