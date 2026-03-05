// ========================================
// SOCKET CONNECTION
// ========================================

const socket = io();
let socketId = null;

const progressBar = document.getElementById("progressBar");
let progress = 0;

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("🟢 Connected:", socketId);
});

// ========================================
// UPDATE BAR FROM LOGS
// ========================================

socket.on("log", (data) => {

  console.log(data.message);

  // 🔥 Progression automatique
  progress += 20;
  if (progress > 100) progress = 100;

  progressBar.style.width = progress + "%";
});

// ========================================
// FORM SUBMIT
// ========================================

const form = document.getElementById("uploadForm");
const resultsContainer = document.getElementById("results");

form.addEventListener("submit", async (e) => {

  e.preventDefault();

  progress = 0;
  progressBar.style.width = "0%";

  resultsContainer.innerHTML = "";

  const filesInput = document.querySelector("input[type='file']");
  const files = filesInput.files;

  if (!files || files.length === 0) {
    alert("Upload at least one image");
    return;
  }

  const formData = new FormData();

  for (const file of files) {
    formData.append("images", file);
  }

  formData.append("socketId", socketId);

  try {

    const response = await fetch("/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    displayResults(data.results);

  } catch (err) {
    console.error("Request failed", err);
  }
});

// ========================================
// DISPLAY RESULTS
// ========================================

function displayResults(results) {

  if (!results || results.length === 0) {
    resultsContainer.innerHTML =
      "<p style='color:red'>No results</p>";
    return;
  }

  results.forEach(result => {

    const card = document.createElement("div");

    card.innerHTML = `
      <h3>📷 ${result.image}</h3>
    `;

    if (!result.matches || result.matches.length === 0) {

      card.innerHTML += `
        <p style="color:red">
          ❌ No matches found
        </p>
      `;

    } else {

      result.matches.forEach(match => {

        card.innerHTML += `
          <div>
            🔥 ${match.similarity}%
            <a href="${match.url}" target="_blank">
              Open
            </a>
          </div>
        `;
      });
    }

    resultsContainer.appendChild(card);
  });
}

/* ======================================== */
/* MATRIX BACKGROUND */
/* ======================================== */

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const letters = "01";
const fontSize = 16;
const columns = canvas.width / fontSize;
const drops = [];

for (let i = 0; i < columns; i++) {
  drops[i] = 1;
}

function drawMatrix() {

  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#00ff88";
  ctx.font = fontSize + "px monospace";

  for (let i = 0; i < drops.length; i++) {

    const text = letters[Math.floor(Math.random() * letters.length)];

    ctx.fillText(text, i * fontSize, drops[i] * fontSize);

    if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }

    drops[i]++;
  }
}

setInterval(drawMatrix, 50);

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
