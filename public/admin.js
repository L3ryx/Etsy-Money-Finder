async function loadConfig() {

  const password = document.getElementById("adminPassword").value;

  const res = await fetch("/api/config?password=" + password);

  if (!res.ok) {
    alert("Unauthorized");
    return;
  }

  const data = await res.json();

  document.getElementById("serpapi").value = data.SERPAPI_KEY || "";
  document.getElementById("openai").value = data.OPENAI_KEY || "";
  document.getElementById("imgbb").value = data.IMGBB_KEY || "";
}

async function saveConfig() {

  const password = document.getElementById("adminPassword").value;

  const config = {
    SERPAPI_KEY: document.getElementById("serpapi").value,
    OPENAI_KEY: document.getElementById("openai").value,
    IMGBB_KEY: document.getElementById("imgbb").value
  };

  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, config })
  });

  if (!res.ok) {
    alert("Unauthorized");
    return;
  }

  document.getElementById("status").innerText =
    "✅ Saved Successfully!";
}
