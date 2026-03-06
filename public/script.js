/* ===================================================== */
/* SOCKET */
/* ===================================================== */

const socket = io();

/* ===================================================== */
/* ELEMENTS */
/* ===================================================== */

const loader = document.getElementById("loader");
const progressBar = document.getElementById("progressBar");
const resultsContainer = document.getElementById("results");

/* ===================================================== */
/* MATRIX SYSTEM */
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

let speed = 40;
let matrixInterval;
let columns;
let drops;

/* INIT MATRIX */
function initMatrix(){
  columns = Math.floor(canvas.width / fontSize);
  drops = new Array(columns).fill(0).map(() => Math.random() * canvas.height);
}

/* DRAW MATRIX */
function drawMatrix(){

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = "#00ff66";
  ctx.font = fontSize + "px monospace";

  for(let i=0;i<drops.length;i++){

    const text = letters[Math.floor(Math.random()*letters.length)];
    ctx.fillText(text, i*fontSize, drops[i]*fontSize);

    if(drops[i]*fontSize > canvas.height && Math.random() > 0.97){
      drops[i] = 0;
    }

    drops[i]++;
  }
}

/* START MATRIX */
function startMatrix(){
  clearInterval(matrixInterval);
  initMatrix();
  matrixInterval = setInterval(drawMatrix, speed);
}

/* ACCELERATE */
function accelerateMatrix(){
  clearInterval(matrixInterval);
  speed = 15;
  matrixInterval = setInterval(drawMatrix, speed);
}

/* SLOW DOWN */
function slowMatrix(){
  clearInterval(matrixInterval);
  speed = 60;
  matrixInterval = setInterval(drawMatrix, speed);
}

/* START AUTO */
startMatrix();

/* ===================================================== */
/* SEARCH FUNCTION */
/* ===================================================== */

async function searchEtsy(){

  const keyword = document.getElementById("keyword").value;
  const limit = document.getElementById("limit").value;

  if(!keyword) return;

  /* 🔥 Accelerate animation */
  accelerateMatrix();

  showLoader();

  const response = await fetch("/search-etsy", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      keyword,
      limit,
      socketId: socket.id
    })
  });

  const data = await response.json();

  hideLoader();

  /* 🔥 Ralentir matrix quand fini */
  slowMatrix();

  displayResults(data.results);
}

/* ===================================================== */
/* LOADER CONTROL */
/* ===================================================== */

function showLoader(){
  loader.style.display = "flex";
}

function hideLoader(){
  loader.style.display = "none";
}

/* ===================================================== */
/* RESULTS DISPLAY */
/* ===================================================== */

function displayResults(results){

  resultsContainer.innerHTML = "";

  if(!results || results.length === 0){
    resultsContainer.innerHTML = "<h2>No results found</h2>";
    return;
  }

  results.forEach(item => {

    const card = document.createElement("div");
    card.className = "result-card";

    card.innerHTML = `
      <img src="${item.image}" />
      <br/>
      <a href="${item.link}" target="_blank">
        🔗 Open Listing
      </a>
    `;

    resultsContainer.appendChild(card);

  });

  /* 🔥 Explosion effet quand résultats arrivent */
  explosionEffect();
}

/* ===================================================== */
/* EXPLOSION EFFECT */
/* ===================================================== */

function explosionEffect(){

  for(let i=0;i<30;i++){

    const spark = document.createElement("div");
    spark.style.position = "fixed";
    spark.style.left = Math.random()*window.innerWidth + "px";
    spark.style.top = Math.random()*window.innerHeight + "px";
    spark.style.width = "6px";
    spark.style.height = "6px";
    spark.style.background = "#00ff66";
    spark.style.borderRadius = "50%";
    spark.style.boxShadow = "0 0 20px #00ff66";
    spark.style.pointerEvents = "none";
    document.body.appendChild(spark);

    setTimeout(()=> spark.remove(), 800);
  }
}

/* ===================================================== */
/* SOCKET LIVE PROGRESS */
/* ===================================================== */

socket.on("progress", (data)=>{
  progressBar.style.width = data.percent + "%";
});

socket.on("log", ()=>{
  progressBar.style.width = "80%";
});
