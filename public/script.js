/* ===================================================== */
/* SOCKET */
/* ===================================================== */

const socket = io();
const loader = document.getElementById("loader");

/* ===================================================== */
/* MATRIX BACKGROUND */
/* ===================================================== */

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

function resizeCanvas(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const letters = "010101ETSYMONEYFINDER";
const fontSize = 16;

let columns = Math.floor(canvas.width / fontSize);
let drops = [];

for(let i = 0; i < columns; i++){
  drops[i] = Math.random() * canvas.height;
}

let matrixSpeed = 40;
let matrixInterval = setInterval(drawMatrix, matrixSpeed);

function setMatrixSpeed(newSpeed){
  clearInterval(matrixInterval);
  matrixSpeed = newSpeed;
  matrixInterval = setInterval(drawMatrix, matrixSpeed);
}

function drawMatrix(){

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = "#00ff66";
  ctx.font = fontSize + "px monospace";

  for(let i=0;i<drops.length;i++){

    const text = letters[Math.floor(Math.random()*letters.length)];
    ctx.fillText(text, i*fontSize, drops[i]*fontSize);

    if(drops[i]*fontSize > canvas.height && Math.random() > 0.975){
      drops[i] = 0;
    }

    drops[i]++;
  }
}

/* ===================================================== */
/* SEARCH SYSTEM */
/* ===================================================== */

async function searchEtsy(){

  const keyword = document.getElementById("keyword").value;
  const limit = document.getElementById("limit").value;

  loader.style.display = "block";

  /* 🔥 Matrix accélère pendant scraping */
  setMatrixSpeed(5);

  const response = await fetch("/search-etsy",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ keyword, limit })
  });

  const data = await response.json();

  loader.style.display = "none";

  /* 🔥 Matrix ralentit quand terminé */
  setMatrixSpeed(60);

  displayResults(data.results);

  explosionEffect();
}

/* ===================================================== */
/* RESULTS DISPLAY */
/* ===================================================== */

function displayResults(results){

  const container = document.getElementById("results");
  container.innerHTML = "";

  if(!results || results.length === 0){
    container.innerHTML = "<h2>No results found</h2>";
    return;
  }

  results.forEach(item => {

    const card = document.createElement("div");
    card.className = "result-card";

    card.innerHTML = `
      <img src="${item.image}" />
      <br>
      🔗 <a href="${item.link}" target="_blank">
        Open Listing
      </a>
    `;

    container.appendChild(card);

  });
}

/* ===================================================== */
/* EXPLOSION EFFECT WHEN RESULTS ARRIVE */
/* ===================================================== */

function explosionEffect(){

  const boom = document.createElement("div");

  boom.innerHTML = "💥";
  boom.style.position = "fixed";
  boom.style.top = "50%";
  boom.style.left = "50%";
  boom.style.fontSize = "150px";
  boom.style.transform = "translate(-50%,-50%)";
  boom.style.transition = "1s";
  boom.style.opacity = "1";
  boom.style.zIndex = "9999";

  document.body.appendChild(boom);

  setTimeout(() => {
    boom.style.transform = "translate(-50%,-50%) scale(3)";
    boom.style.opacity = "0";
  },100);

  setTimeout(() => {
    boom.remove();
  },1200);

}

/* ===================================================== */
/* LIVE PROGRESS FROM SERVER */
/* ===================================================== */

socket.on("progress", (data) => {

  // Optionnel : tu peux relier ça à une vraie progress bar plus tard
  console.log("Progress:", data.percent);

});
