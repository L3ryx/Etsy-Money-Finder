const socket = io();
let socketId = null;

const progressBar = document.getElementById("progressBar");
let progress = 0;

socket.on("connected", (data) => {
  socketId = data.socketId;
});

socket.on("log", (data) => {

  progress += 20;
  if (progress > 100) progress = 100;

  progressBar.style.width = progress + "%";

  console.log(data.message);
});

/* ======================================== */
/* SEARCH ETSY */
/* ======================================== */

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

  console.log("Scraped:", data.results);

  // 🔥 Pour chaque image → lancer analyse

  for (const item of data.results) {

    const imgRes = await fetch(item.image);
    const blob = await imgRes.blob();

    const formData = new FormData();
    formData.append("images", blob);
    formData.append("socketId", socketId);

    await fetch("/analyze", {
      method: "POST",
      body: formData
    });

  }
}
