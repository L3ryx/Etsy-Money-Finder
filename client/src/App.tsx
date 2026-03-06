import { useState } from "react";

function App() {

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<any[]>([]);

  async function search() {

    const res = await fetch("http://localhost:10000/search-etsy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, limit: 10 })
    });

    const data = await res.json();
    setResults(data.results);
  }

  return (
    <div style={{ textAlign: "center", color: "white" }}>
      
      <h1>Niche Finder 🚀</h1>

      <input
        placeholder="Keyword"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />

      <button onClick={search}>
        START
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 40 }}>
        {results.map((item, index) => (
          <div key={index}>
            <img src={item.image} width="200" />
            <br />
            <a href={item.link} target="_blank">
              Open
            </a>
          </div>
        ))}
      </div>

    </div>
  );
}

export default App;
