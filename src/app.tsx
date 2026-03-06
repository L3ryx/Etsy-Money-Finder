import BackgroundGame from "./components/BackgroundGame";

function App() {

  return (
    <>
      {/* 🌿 FOND ANIME */}
      <BackgroundGame />

      {/* 🎮 UI CENTRALE */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          textAlign: "center",
          marginTop: "60px",
          color: "white"
        }}
      >

        {/* 🔥 TITRE */}
        <h1
          style={{
            fontSize: "60px",
            textShadow: "0 0 20px green",
            marginBottom: "40px"
          }}
        >
          Niche Finder
        </h1>

        {/* INPUT */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "20px"
          }}
        >

          <input
            placeholder="Keyword"
            style={{
              padding: "15px",
              borderRadius: "15px",
              border: "2px solid green",
              background: "black",
              color: "white",
              fontSize: "18px"
            }}
          />

          <select
            style={{
              padding: "15px",
              borderRadius: "15px",
              border: "2px solid green",
              background: "black",
              color: "white",
              fontSize: "18px"
            }}
          >
            <option>10</option>
            <option>50</option>
            <option>100</option>
          </select>

          {/* START */}
          <button
            style={{
              padding: "20px 60px",
              borderRadius: "30px",
              background: "green",
              color: "white",
              fontSize: "22px",
              fontWeight: "bold",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 0 40px green"
            }}
          >
            START
          </button>

        </div>

      </div>
    </>
  );
}

export default App;
