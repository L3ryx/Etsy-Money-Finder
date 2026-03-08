// script.js
const form = document.getElementById("searchForm");
const queryInput = document.getElementById("query");
const resultsDiv = document.getElementById("results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return alert("Veuillez entrer un terme de recherche.");

  resultsDiv.innerHTML = "<p>Recherche en cours…</p>";

  try {
    // Appel à notre serveur Node.js
    const res = await fetch(`http://localhost:3000/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.etsyResults || data.etsyResults.length === 0) {
      resultsDiv.innerHTML = "<p>Aucun résultat trouvé.</p>";
      return;
    }

    // Générer HTML pour les résultats
    resultsDiv.innerHTML = "";
    data.etsyResults.forEach((etsyItem, idx) => {
      const etsySection = document.createElement("div");
      etsySection.classList.add("etsy-item");

      // Etsy image + lien
      const etsyLink = document.createElement("a");
      etsyLink.href = etsyItem.link;
      etsyLink.target = "_blank";
      const etsyImg = document.createElement("img");
      etsyImg.src = etsyItem.image;
      etsyImg.alt = `Etsy image ${idx + 1}`;
      etsyLink.appendChild(etsyImg);

      etsySection.appendChild(etsyLink);

      // AliExpress results
      const aliDiv = document.createElement("div");
      aliDiv.classList.add("aliexpress-results");

      etsyItem.aliexpressResults.forEach((aliItem) => {
        const aliLink = document.createElement("a");
        aliLink.href = aliItem.link;
        aliLink.target = "_blank";

        const aliImg = document.createElement("img");
        aliImg.src = aliItem.image;
        aliImg.alt = "AliExpress image";
        aliImg.style.width = "100px";
        aliImg.style.height = "100px";

        aliLink.appendChild(aliImg);

        // Similarity score
        const score = document.createElement("p");
        score.textContent = `Similarity: ${aliItem.similarity}%`;

        const aliContainer = document.createElement("div");
        aliContainer.classList.add("ali-item");
        aliContainer.appendChild(aliLink);
        aliContainer.appendChild(score);

        aliDiv.appendChild(aliContainer);
      });

      etsySection.appendChild(aliDiv);
      resultsDiv.appendChild(etsySection);
    });
  } catch (err) {
    console.error(err);
    resultsDiv.innerHTML = "<p>Erreur lors de la récupération des résultats.</p>";
  }
});
