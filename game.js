/* Root Runner — you are the packet. The network is hostile. */
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
    "Trace complete. 0 results. Sometimes silence is the exploit.",
    "The quiet ones own the box.",
    "You did not fail the breach. The breach failed you.",
    "Root is a state of mind.",
    "Every firewall is a promise someone made to the wrong person.",
    "Disconnect. Reconnect. Different port, same you."
  ];

  const COLORS = {
    phos: "#33ff88",
    phosSoft: "rgba(51,255,136,0.35)",
    phosDim: "rgba(51,255,136,0.12)",
    void0: "#060b07",
    alert: "#ff3b6b",
    cyan: "#41d6ff",
    amber: "#ffc857"
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
    try { state.best = parseInt(localStorage.getItem("rootrunner.best") || "0", 10) || 0; } catch (e) {}
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      browser.storage.local.get("best").then(v => {
        if (v && v.best > state.best) { state.best = v.best; bestEl.textContent = "high " + state.best; }
      }).catch(() => {});
    }
    bestEl.textContent = "high " + state.best;
  }

  function saveBest() {
    try { localStorage.setItem("rootrunner.best", String(state.best)); } catch (e) {}
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
    if (roll < 0.22 && state.distance > 900) type = "gate"; // data arch, pass-through
    else if (roll < 0.6) type = "rock";                     // firewall block
    else type = "bamboo";                                   // ICE spike
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
    // data arch: pass through freely
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

  // ?bot=1 — simple autoplayer for headless tests: hops firewalls and ICE.
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
    if (state.score > state.best) { state.best = state.score; saveBest(); bestEl.textContent = "high " + state.best; }
    const cause = {
      rock: "slammed a firewall",
      bamboo: "flatlined by ICE",
      gate: "collided with a data arch"
    }[state.deathBy] || "";
    showOverlay(
      "CONNECTION TERMINATED",
      "bytes " + state.score + "  ·  high " + state.best + (cause ? "  ·  " + cause : ""),
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

    // background drift
    for (const c of state.clouds) {
      c.x -= (c.v + state.speed * 0.02) * dt;
      if (c.x < -160) { c.x = W + 120; c.y = H * (0.08 + Math.random() * 0.25); }
    }
  }

  /* ---------- draw ---------- */

  function draw() {
    const g = groundY();

    // void sky
    const sky = ctx.createLinearGradient(0, 0, 0, g);
    sky.addColorStop(0, "#04090b");
    sky.addColorStop(1, "#0a140c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, g);

    // monitoring beacon (the distant sysadmin eye)
    ctx.fillStyle = COLORS.amber;
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(state.t * 2);
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.amber;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.2, 14 + 4 * Math.sin(state.t * 2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // drifting packets in the upper network
    ctx.fillStyle = "rgba(65,214,255,0.28)";
    for (const c of state.clouds) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(state.t * 0.4 * (c.s % 1 > 0.5 ? 1 : -1));
      ctx.fillRect(-7 * c.s, -7 * c.s, 14 * c.s, 14 * c.s);
      ctx.restore();
    }

    // server racks on the horizon
    ctx.fillStyle = "rgba(51,255,136,0.10)";
    drawHills(state.hills[0], state.distance * 0.18);
    ctx.fillStyle = "rgba(51,255,136,0.20)";
    drawHills(state.hills[1], state.distance * 0.42);

    // ground: the network bus
    ctx.fillStyle = COLORS.void0;
    ctx.fillRect(0, g, W, H - g);
    ctx.strokeStyle = COLORS.phosSoft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(W, g);
    ctx.stroke();
    // bus data ticks
    ctx.strokeStyle = COLORS.phosDim;
    ctx.lineWidth = 1;
    const tickOffset = (state.distance * 0.9) % 28;
    for (let x = -tickOffset; x < W; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, g + 8);
      ctx.lineTo(x + 10, g + 8);
      ctx.stroke();
    }

    // obstacles
    for (const o of state.obstacles) drawObstacle(o);

    // player: the packet
    drawPlayer();
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
      // firewall: layered dark blocks with green seams
      ctx.fillStyle = "#0d1f14";
      ctx.strokeStyle = COLORS.phosSoft;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.x, g);
      ctx.lineTo(o.x + o.w * 0.22, g - o.h * 0.9);
      ctx.lineTo(o.x + o.w * 0.6, g - o.h);
      ctx.lineTo(o.x + o.w, g - o.h * 0.55);
      ctx.lineTo(o.x + o.w, g);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.phosDim;
      ctx.fillRect(o.x + 4, g - o.h * 0.45, o.w - 10, 2);
    } else if (o.type === "bamboo") {
      // ICE spike: hot red column with flicker
      const flick = 0.75 + 0.25 * Math.sin(state.t * 9 + o.x);
      ctx.fillStyle = COLORS.alert;
      ctx.globalAlpha = flick;
      ctx.fillRect(o.x, g - o.h, o.w, o.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.5 * flick;
      ctx.fillRect(o.x + 2, g - o.h + 4, o.w - 4, 2);
      ctx.globalAlpha = 1;
      // base node
      ctx.fillStyle = COLORS.alert;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(o.x + o.w / 2, g, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // data arch: cyan gate you pass through
      const top = g - 168;
      ctx.fillStyle = COLORS.cyan;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(o.x, top, o.w, 5);            // top bar
      ctx.fillRect(o.x - 4, top, 5, 168);        // left pillar
      ctx.fillRect(o.x + o.w - 1, top, 5, 168);  // right pillar
      ctx.globalAlpha = 0.25;
      ctx.fillRect(o.x - 12, top - 6, o.w + 24, 3); // glow cap
      ctx.globalAlpha = 1;
      // falling glyph rain through the arch
      ctx.fillStyle = COLORS.cyan;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 3; i++) {
        const gy = top + 14 + ((state.t * 120 + i * 47 + o.x) % 150);
        ctx.fillRect(o.x + 12 + i * 22, gy, 2, 8);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    const sq = player.squash;
    const rx = player.r * (1 + sq * 0.28);
    const ry = player.r * (1 - sq * 0.24);

    // motion trail
    ctx.fillStyle = COLORS.phosDim;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(player.x - i * 14, player.y + (player.onGround ? 0 : i * 2), player.r * (0.75 - i * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.onGround ? 0 : player.spin);

    // packet shell
    ctx.strokeStyle = COLORS.phos;
    ctx.lineWidth = 4.5;
    ctx.shadowColor = COLORS.phos;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // kernel core
    ctx.fillStyle = COLORS.cyan;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
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
  showOverlay("ROOT RUNNER", "> escalate · evade · exfiltrate", "");
  // ?autostart — begin a run immediately (used by tests)
  if (new URLSearchParams(location.search).has("autostart")) startRun();
  frame(performance.now());
})();
