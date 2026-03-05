const form = document.getElementById("uploadForm");
const resultsDiv = document.getElementById("results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  resultsDiv.innerHTML = "Analyzing...";

  const formData = new FormData(form);

  const response = await fetch("/analyze", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  resultsDiv.innerHTML = "";

  data.results.forEach(result => {

    const card = document.createElement("div");
    card.className = "card";

    let html = `<h3>${result.image}</h3>`;

    if (result.products.length > 0) {
      result.products.forEach(product => {
        html += `
          <p><b>${product.title}</b></p>
          <p>Price: ${product.price}</p>
          <a href="${product.url}" target="_blank">Open</a>
          <hr/>
        `;
      });
    } else {
      html += "<p>No products found</p>";
    }

    card.innerHTML = html;
    resultsDiv.appendChild(card);
  });
});
