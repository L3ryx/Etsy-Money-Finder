import { useEffect, useRef } from "react";

export default function BackgroundGame() {

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    resize();
    window.addEventListener("resize", resize);

    /* ================= WORLD ================= */

    const dogs:any[] = [];
    const money:any[] = [];

    const niche = {
      x: window.innerWidth / 2,
      y: window.innerHeight - 200
    };

    /* ================= SPAWN DOG ================= */

    function spawnDog() {

      const fromLeft = Math.random() > 0.5;

      dogs.push({
        x: fromLeft ? -50 : canvas.width + 50,
        y: canvas.height - 150,
        speed: fromLeft ? 2 : -2,
        entered: false
      });

    }

    setInterval(spawnDog, 2000);

    /* ================= SPAWN MONEY ================= */

    function spawnMoney() {

      money.push({
        x: niche.x,
        y: niche.y,
        velocityY: -3,
        alpha: 1
      });

    }

    setInterval(spawnMoney, 800);

    /* ================= ANIMATION LOOP ================= */

    function animate() {

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      /* 🌿 HERBE */
      ctx.fillStyle = "#2ecc71";
      ctx.fillRect(0, canvas.height - 150, canvas.width, 150);

      /* ☀ SUN */
      ctx.beginPath();
      ctx.fillStyle = "yellow";
      ctx.arc(150, 150, 60, 0, Math.PI * 2);
      ctx.fill();

      /* 🏠 NICHE */
      ctx.fillStyle = "#8B4513";
      ctx.fillRect(niche.x - 60, niche.y - 40, 120, 80);

      /* 🐕 DOGS */
      dogs.forEach((dog, index) => {

        dog.x += dog.speed;

        ctx.font = "50px Arial";
        ctx.fillStyle = "#8B5A2B";
        ctx.fillText("🐕", dog.x, dog.y);

        /* Collision avec niche */
        if (
          !dog.entered &&
          Math.abs(dog.x - niche.x) < 30
        ) {
          dog.entered = true;
          spawnMoney();
        }

        if (dog.entered) {
          dog.speed = 0;
        }

      });

      /* 💵 MONEY */
      money.forEach((m, index) => {

        m.y += m.velocityY;
        m.alpha -= 0.01;

        ctx.globalAlpha = m.alpha;
        ctx.fillStyle = "#00ff00";
        ctx.font = "30px Arial";
        ctx.fillText("$", m.x, m.y);
        ctx.globalAlpha = 1;

        if (m.alpha <= 0) {
          money.splice(index, 1);
        }

      });

      requestAnimationFrame(animate);
    }

    animate();

    return () => {
      window.removeEventListener("resize", resize);
    };

  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: -1
      }}
    />
  );
}
