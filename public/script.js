const socket = io();
const loader = document.getElementById("loader");

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let fontSize = 16;
let letters = "010101ETSYMONEYFINDER";

let columns = canvas.width / fontSize;
let drops = [];

for(let i=0;i<columns;i++){
  drops[i] = 1;
}

let speed = 50;
let matrixInterval = setInterval(drawMatrix, speed);

/* ===================================================== */
/* MATRIX SPEED CONTROL */
/* ===================================================== */

function setMatrixSpeed(newSpeed){
  clearInterval(matrixInterval);
  speed = newSpeed;
  matrixInterval = setInterval(drawMatrix, speed);
}

/* ===================================================== */
/* DRAW MATRIX */
/* ===================================================== */

function drawMatrix(){

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = "#00ff66";
  ctx.font = fontSize+"px monospace";

  for(let i=0;i<drops.length;i++){

    let text = letters[Math.floor(Math.random()*letters.length)];
    ctx.fillText(text, i*fontSize, drops[i]*fontSize);

    if(drops[i]*fontSize > canvas.height && Math.random()>0.98){
      drops[i] = 0;
    }

    drops[i]++;
  }
}

/* ===================================================== */
/* RESIZE */
/* ===================================================== */

window.addEventListener("resize", () => {

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  columns = canvas.width / fontSize;
  drops = [];

  for(let i=0;i<columns;i++){
    drops[i] = 1;
  }

});

/* ===================================================== */
/* SEARCH */
/* ===================================================== */

async function searchEtsy(){

  const keyword = document.getElementById("keyword").value;
  const limit = document.getElementById("limit").value;

  loader.style.display = "block";

  /* 🔥 Matrix accélère */
  setMatrixSpeed(5);

  const res = await fetch("/search-etsy",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ keyword, limit })
  });

  const data = await res.json();

  loader.style.display = "none";

  /* 🔥 Matrix ralentit */
  setMatrixSpeed(60);

  displayResults(data.results);

  explosion();
}

/* ===================================================== */
/* RESULTS */
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
      <img src="${item.image}">
      <br>
      🔗 <a href="${item.link}" target="_blank">
        Open Listing
      </a>
    `;

    container.appendChild(card);

  });

}

/* ===================================================== */
/* EXPLOSION EFFECT */
/* ===================================================== */

function explosion(){

  const boom = document.createElement("div");
  boom.innerHTML = "💥";
  boom.style.position = "fixed";
  boom.style.top = "50%";
  boom.style.left = "50%";
  boom.style.fontSize = "150px";
  boom.style.transform = "translate(-50%,-50%)";
  boom.style.transition = "1s";
  boom.style.opacity = "1";

  document.body.appendChild(boom);

  setTimeout(()=>{
    boom.style.transform = "translate(-50%,-50%) scale(3)";
    boom.style.opacity = "0";
  },100);

  setTimeout(()=>{
    boom.remove();
  },1200);

}
