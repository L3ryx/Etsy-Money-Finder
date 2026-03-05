const socket = io();
let socketId = null;

const progressBar = document.getElementById("progressBar");
let progress = 0;

/* =============================== */
/* SOCKET CONNECT */
/* =============================== */

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("Connected:", socketId);
});

/* =============================== */
/* LOG -> PROGRESS BAR */
/* =============================== */

socket.on("log", (data) => {

  console.log(data.message);

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

  const keyword = document.getElementById("keyword").value;
  const limit = document.getElementById("limit").value;

  if (!keyword) {
    alert("Enter keyword");
    return;
  }

  progress = 0;
  progressBar.style.width = "0%";

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

  console.log("Scraped results:", data.results);

  const resultsContainer = document.getElementById("results");
  resultsContainer.innerHTML = "";

  for (const item of data.results) {

    const imgResponse = await fetch(item.image);
    const blob = await imgResponse.blob();

    const formData = new FormData();
    formData.append("images", blob);
    formData.append("socketId", socketId);

    await fetch("/analyze-images", {
      method: "POST",
      body: formData
    });

  }
}
