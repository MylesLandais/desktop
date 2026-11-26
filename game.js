/* Zen Dino — a quiet endless runner. */
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayQuote = document.getElementById("overlay-quote");
  const startBtn = document.getElementById("start");

  const QUOTES = [
    "Fall down seven times, get up eight.",
    "The obstacle is the path.",
    "Sit quietly, and the mud settles by itself.",
    "No snowflake ever falls in the wrong place.",
    "When you get to the top of the mountain, keep climbing.",
    "The journey is the reward."
  ];

  const COLORS = {
    ink: "#2b2b33",
    inkSoft: "rgba(43,43,51,0.55)",
    paper: "#f7f3ea",
    sun: "#e8b04b",
    accent: "#d97757",
    moss: "#8a9a7b"
  };

  let W = 0, H = 0, dpr = 1;
  const GROUND_FRAC = 0.78;

  const state = {
    mode: "idle",           // idle | running | over
    t: 0,
    speed: 320,             // px/s
    baseSpeed: 320,
    distance: 0,
    score: 0,
    best: 0,
    jumps: 0,
    obstacles: [],
    spawnTimer: 1.2,
    hills: [],
    clouds: []
  };

  const player = {
    x: 0, y: 0, r: 21,
    vy: 0,
    onGround: true,
    jumpsLeft: 2,
    squash: 0,
    spin: 0
  };

  const GRAVITY = 2100;
  const JUMP_V = 760;
  const JUMP_V_2 = 640;

  /* ---------- persistence ---------- */

  function loadBest() {
    try { state.best = parseInt(localStorage.getItem("zendino.best") || "0", 10) || 0; } catch (e) {}
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      browser.storage.local.get("best").then(v => {
        if (v && v.best > state.best) { state.best = v.best; bestEl.textContent = "best " + state.best; }
      }).catch(() => {});
    }
    bestEl.textContent = "best " + state.best;
  }

  function saveBest() {
    try { localStorage.setItem("zendino.best", String(state.best)); } catch (e) {}
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      browser.storage.local.set({ best: state.best }).catch(() => {});
    }
  }

  /* ---------- layout ---------- */

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.x = Math.max(120, W * 0.16);
    seedHills();
  }

  function seedHills() {
    state.hills = [];
    const groundY = H * GROUND_FRAC;
    for (let layer = 0; layer < 2; layer++) {
      const pts = [];
      const amp = layer === 0 ? 46 : 26;
      const wl = layer === 0 ? 420 : 260;
      for (let i = -1; i < W / wl + 2; i++) {
        pts.push({ x: i * wl, h: groundY - 20 - Math.random() * amp });
      }
      state.hills.push({ pts, wl, layer });
    }
    state.clouds = [];
    for (let i = 0; i < 5; i++) {
      state.clouds.push({
        x: Math.random() * W,
        y: H * (0.08 + Math.random() * 0.25),
        s: 0.6 + Math.random() * 0.9,
        v: 4 + Math.random() * 8
      });
    }
  }

  /* ---------- world ---------- */

  const groundY = () => H * GROUND_FRAC;

  function spawnObstacle() {
    const roll = Math.random();
    let type;
    if (roll < 0.22 && state.distance > 900) type = "gate"; // decorative torii, no hitbox
    else if (roll < 0.6) type = "rock";
    else type = "bamboo";
    state.obstacles.push({ type, x: W + 80, w: 0, h: 0, hit: false });
  }

  function obstacleBox(o) {
    const g = groundY();
    if (o.type === "rock") {
      o.w = 34; o.h = 30;
      return { x: o.x, y: g - o.h, w: o.w, h: o.h };
    }
    if (o.type === "bamboo") {
      o.w = 16; o.h = 74;
      return { x: o.x, y: g - o.h, w: o.w, h: o.h };
    }
    // torii gate: pass through freely
    o.w = 70; o.h = 0;
    return null;
  }

  function circleHitsRect(cx, cy, r, b) {
    const mx = Math.max(b.x, Math.min(cx, b.x + b.w));
    const my = Math.max(b.y, Math.min(cy, b.y + b.h));
    const dx = cx - mx, dy = cy - my;
    const rEff = r * 0.8; // genuinely forgiving hitbox
    return dx * dx + dy * dy < rEff * rEff;
  }

  /* ---------- input ---------- */

  function jump() {
    if (state.mode !== "running") { startRun(); return; }
    if (player.jumpsLeft <= 0) return;
    player.vy = player.jumpsLeft === 2 ? -JUMP_V : -JUMP_V_2;
    player.jumpsLeft -= 1;
    player.onGround = false;
  }

  // ?bot=1 — simple autoplayer for headless tests: hops rocks and bamboo.
  const BOT = new URLSearchParams(location.search).has("bot");
  function botThink() {
    if (!BOT || state.mode !== "running") return;
    const ahead = state.obstacles.filter(o => o.x + o.w > player.x - 20 && o.type !== "gate");
    if (!ahead.length) return;
    const nearest = ahead[0];
    const gap = nearest.x - (player.x + player.r);
    // jump ~0.3s before impact; the safe window scales with speed
    if (gap > 0 && gap < state.speed * 0.3 && player.onGround) jump();
  }

  window.addEventListener("keydown", e => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      jump();
    }
  });
  canvas.addEventListener("pointerdown", jump);
  startBtn.addEventListener("click", startRun);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "running") state.mode = "paused";
    if (!document.hidden && state.mode === "paused") state.mode = "running";
  });

  /* ---------- flow ---------- */

  function showOverlay(title, sub, quote) {
    overlay.querySelector("h1").textContent = title;
    overlaySub.textContent = sub;
    overlayQuote.textContent = quote || "";
    overlay.classList.remove("hidden");
  }

  function startRun() {
    state.mode = "running";
    state.distance = 0;
    state.score = 0;
    state.speed = state.baseSpeed;
    state.obstacles = [];
    state.spawnTimer = 1.0;
    player.y = groundY() - player.r;
    player.vy = 0;
    player.onGround = true;
    player.jumpsLeft = 2;
    player.squash = 0;
    player.spin = 0;
    overlay.classList.add("hidden");
  }

  function gameOver() {
    state.mode = "over";
    if (state.score > state.best) { state.best = state.score; saveBest(); bestEl.textContent = "best " + state.best; }
    const cause = { rock: "hit a rock", bamboo: "hit the bamboo", gate: "hit the torii gate" }[state.deathBy] || "";
    showOverlay(
      "Out of balance",
      "score " + state.score + "  ·  best " + state.best + (cause ? "  ·  " + cause : ""),
      QUOTES[Math.floor(Math.random() * QUOTES.length)]
    );
  }

  /* ---------- update ---------- */

  function update(dt) {
    state.t += dt;
    if (state.mode !== "running") return;

    state.distance += state.speed * dt;
    state.score = Math.floor(state.distance / 12);
    state.speed = state.baseSpeed + Math.min(340, state.distance * 0.028);

    // player physics
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    const floor = groundY() - player.r;
    if (player.y >= floor) {
      if (!player.onGround) {
        player.squash = 1;
        player.spin = Math.round(player.spin / Math.PI) * Math.PI;
      }
      player.y = floor;
      player.vy = 0;
      player.onGround = true;
      player.jumpsLeft = 2;
    } else {
      player.onGround = false;
    }
    if (!player.onGround) player.spin += dt * 6;
    player.squash = Math.max(0, player.squash - dt * 5);

    // obstacles
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnObstacle();
      // spacing must exceed a jump arc (~0.72s of air time) plus reaction
      const gap = Math.max(0.85, 1.25 - state.distance * 0.00004);
      state.spawnTimer = gap + Math.random() * 0.55;
    }
    for (const o of state.obstacles) o.x -= state.speed * dt;
    state.obstacles = state.obstacles.filter(o => o.x + o.w > -60);

    // collisions
    for (const o of state.obstacles) {
      const b = obstacleBox(o);
      if (!b) continue;
      if (circleHitsRect(player.x, player.y, player.r, b)) {
        state.deathBy = o.type;
        gameOver();
        return;
      }
    }

    // clouds drift
    for (const c of state.clouds) {
      c.x -= (c.v + state.speed * 0.02) * dt;
      if (c.x < -160) { c.x = W + 120; c.y = H * (0.08 + Math.random() * 0.25); }
    }
  }

  /* ---------- draw ---------- */

  function draw() {
    const g = groundY();

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, g);
    sky.addColorStop(0, "#fdf9ef");
    sky.addColorStop(1, "#f2e8d8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, g);

    // sun
    ctx.fillStyle = COLORS.sun;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.22, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // clouds (soft ellipses)
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (const c of state.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 30 * c.s, c.y - 8 * c.s, 30 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // mountains
    ctx.fillStyle = "rgba(138,154,123,0.28)";
    drawHills(state.hills[0], state.distance * 0.18);
    ctx.fillStyle = "rgba(138,154,123,0.5)";
    drawHills(state.hills[1], state.distance * 0.42);

    // ground
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, g, W, H - g);
    ctx.strokeStyle = COLORS.inkSoft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(W, g);
    ctx.stroke();

    // obstacles
    for (const o of state.obstacles) drawObstacle(o);

    // player: enso orb
    drawPlayer();

    // hud text is DOM, nothing here
  }

  function drawHills(layer, offset) {
    const g = groundY();
    ctx.beginPath();
    const pts = layer.pts;
    const shift = offset % layer.wl;
    ctx.moveTo(-layer.wl, g);
    for (const p of pts) {
      ctx.lineTo(p.x - shift, p.h);
      ctx.lineTo(p.x - shift + layer.wl / 2, g - 6);
    }
    ctx.lineTo(W + layer.wl, g);
    ctx.lineTo(W + layer.wl, g);
    ctx.closePath();
    ctx.fill();
  }

  function drawObstacle(o) {
    const g = groundY();
    if (o.type === "rock") {
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(o.x, g);
      ctx.lineTo(o.x + o.w * 0.22, g - o.h * 0.9);
      ctx.lineTo(o.x + o.w * 0.6, g - o.h);
      ctx.lineTo(o.x + o.w, g - o.h * 0.55);
      ctx.lineTo(o.x + o.w, g);
      ctx.closePath();
      ctx.fill();
    } else if (o.type === "bamboo") {
      ctx.fillStyle = COLORS.moss;
      ctx.fillRect(o.x, g - o.h, o.w, o.h);
      ctx.strokeStyle = "rgba(43,43,51,0.35)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const y = g - o.h + (o.h * i) / 4;
        ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x + o.w, y); ctx.stroke();
      }
      ctx.fillStyle = COLORS.moss;
      ctx.beginPath();
      ctx.ellipse(o.x + o.w + 9, g - o.h + 6, 10, 3.5, -0.5, 0, Math.PI * 2);
      ctx.fill();
    } else { // torii gate to pass UNDER
      const top = g - 168;
      ctx.fillStyle = COLORS.accent;
      ctx.fillRect(o.x, top, o.w, 7);           // kasagi
      ctx.fillRect(o.x + 6, top + 7, o.w - 12, 6); // nuki
      ctx.fillRect(o.x + o.w / 2 - 3, top + 13, 6, o.h + 10); // center post
      ctx.fillRect(o.x - 2, g - 26, 5, 26);     // left leg
      ctx.fillRect(o.x + o.w - 3, g - 26, 5, 26); // right leg
    }
  }

  function drawPlayer() {
    const sq = player.squash;
    const rx = player.r * (1 + sq * 0.28);
    const ry = player.r * (1 - sq * 0.24);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.onGround ? 0 : player.spin);

    // brush gap enso
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, -0.4, Math.PI * 2 - 0.15);
    ctx.stroke();

    // accent dot
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- loop ---------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    botThink();
    draw();
    scoreEl.textContent = state.score;
    window.__game = { mode: state.mode, score: state.score, speed: Math.round(state.speed), obstacles: state.obstacles.length };
    if (BOT) document.title = "DBG " + JSON.stringify({
      m: state.mode, g: player.onGround, jl: player.jumpsLeft,
      y: Math.round(player.y - (groundY() - player.r)),
      o: state.obstacles.slice(0, 3).map(o => [o.type, Math.round(o.x)])
    });
    // self-chaining ticker: keeps simulating under headless virtual time,
    // where rAF is throttled to a handful of frames
    setTimeout(() => frame(performance.now()), 16);
  }

  window.addEventListener("resize", resize);
  resize();
  loadBest();
  showOverlay("Zen Dino", "breathe in · breathe out · jump", "");
  // ?autostart — begin a run immediately (used by tests)
  if (new URLSearchParams(location.search).has("autostart")) startRun();
  frame(performance.now());
})();
