const socket = io();
let socketId = null;

/*
=========================================
SOCKET CONNECTION
=========================================
*/

socket.on("connected", (data) => {
  socketId = data.socketId;
  console.log("Socket connected:", socketId);
});

/*
=========================================
LIVE LOGS
=========================================
*/

socket.on("log", (data) => {

  const logsDiv = document.getElementById("logs");

  const line = document.createElement("p");

  line.innerHTML = `
    <span style="color:#888">
      [${new Date(data.time).toLocaleTimeString()}]
    </span>
    ${data.message}
  `;

  logsDiv.appendChild(line);
  logsDiv.scrollTop = logsDiv.scrollHeight;
});

/*
=========================================
FORM SUBMIT
=========================================
*/

const form = document.getElementById("uploadForm");

form.addEventListener("submit", async (e) => {

  e.preventDefault();

  const formData = new FormData(form);
  formData.append("socketId", socketId);

  document.getElementById("logs").innerHTML = "";

  const response = await fetch("/analyze", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  console.log("Results:", data);
});
