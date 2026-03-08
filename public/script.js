// script.js

const searchBtn = document.getElementById("searchBtn");
const keywordInput = document.getElementById("keyword");
const resultsDiv = document.getElementById("results");

/**
 * Fonction principale pour lancer la recherche
 */
async function searchEtsyAli(keyword) {
  if (!keyword) return alert("Veuillez entrer un mot-clé");

  resultsDiv.innerHTML = "<p>Recherche en cours...</p>";

  try {
    // Envoi du mot-clé au serveur pour obtenir les 10 premiers résultats Etsy
    const etsyRes = await fetch("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword })
    });

    if (!etsyRes.ok) throw new Error("Erreur serveur lors de la recherche Etsy");

    const etsyData = await etsyRes.json(); // [{ etsyImage, etsyLink }, ...]
    if (!etsyData.length) {
      resultsDiv.innerHTML = "<p>Aucun résultat Etsy trouvé</p>";
      return;
    }

    resultsDiv.innerHTML = "";

    // Pour chaque produit Etsy, faire le reverse image + AliExpress
    for (const item of etsyData) {
      // Appel serveur pour reverse image + filtrage AliExpress
      const aliRes = await fetch("/reverse-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: item.etsyImage })
      });

      if (!aliRes.ok) throw new Error("Erreur serveur lors du reverse image");

      const aliData = await aliRes.json(); // { aliImage, aliLink }

      // Création de la card produit
      const card = document.createElement("div");
      card.classList.add("card");

      card.innerHTML = `
        <h3>Etsy</h3>
        <img src="${item.etsyImage}" alt="Etsy" />
        <a href="${item.etsyLink}" target="_blank">${item.etsyLink}</a>

        <h3>AliExpress</h3>
        <img src="${aliData.aliImage}" alt="AliExpress" />
        <a href="${aliData.aliLink}" target="_blank">${aliData.aliLink}</a>
      `;

      resultsDiv.appendChild(card);
    }
  } catch (err) {
    console.error(err);
    resultsDiv.innerHTML = "<p>Erreur lors de la recherche</p>";
  }
}

// Event listener du bouton
searchBtn.addEventListener("click", () => {
  const keyword = keywordInput.value.trim();
  searchEtsyAli(keyword);
});
