/* ===========================================================
   PANGO GO — a Pokémon-Go-style camera AR catching game
   Smart creatures: they wander, flee, hide, camouflage and teleport.
   Pure vanilla JS. No build step, no dependencies.
   =========================================================== */

(() => {
  "use strict";

  // ---------- config ----------
  const ROUND_SECONDS = 60;
  const BASE_SPAWN_MS = 1100;
  const MIN_SPAWN_MS = 380;
  const LEVEL_UP_EVERY = 120;
  const COMBO_WINDOW_MS = 1800;
  const FLEE_RADIUS = 110;        // tap-this-close and nearby creatures bolt
  const LB_KEY = "pangogo.leaderboard.v1";
  const NAME_KEY = "pangogo.name";

  const SIZE = 84;                // target box size in px

  // sprites (svg files); creatures/rare share the Pango mascot
  const SPR = {
    pango: "assets/pango.svg",
    coin: "assets/coin.svg",
    fine: "assets/fine.svg",
  };

  // target kinds: weight, points, lifetime, and which behaviors they may use
  const KINDS = [
    { type: "creature", spr: SPR.pango, points: 10,  weight: 50, life: 5000, cls: "",
      behaviors: ["wander", "wander", "flee", "flee", "camo", "teleport", "peek"] },
    { type: "coin",     spr: SPR.coin,  points: 5,   weight: 28, life: 4600, cls: "coin",
      behaviors: ["wander"] },
    { type: "rare",     spr: SPR.pango, points: 50,  weight: 8,  life: 3200, cls: "rare",
      behaviors: ["teleport", "flee"] },
    { type: "bomb",     spr: SPR.fine,  points: -25, weight: 14, life: 4200, cls: "bomb",
      behaviors: ["wander"] },
  ];

  // ---------- state ----------
  const S = {
    running: false,
    paused: false,
    score: 0,
    caught: 0,
    combo: 1,
    bestCombo: 1,
    level: 1,
    levelProgress: 0,
    timeLeft: ROUND_SECONDS,
    lastCatchAt: 0,
    spawnTimer: null,
    tickTimer: null,
    rafId: null,
    lastFrame: 0,
    targets: new Set(),
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    camera: $("camera"),
    taplayer: $("taplayer"),
    playfield: $("playfield"),
    fx: $("fx"),
    hud: $("hud"),
    score: $("score"),
    combo: $("combo"),
    comboPill: $("combo-pill"),
    timer: $("timer"),
    levelBar: $("level-bar"),
    levelFill: $("level-fill"),
    levelLabel: $("level-label"),
    startScreen: $("start-screen"),
    endScreen: $("end-screen"),
    boardScreen: $("board-screen"),
    pauseBtn: $("pause-btn"),
    finalScore: $("final-score"),
    statCaught: $("stat-caught"),
    statBestCombo: $("stat-best-combo"),
    statLevel: $("stat-level"),
    newRecord: $("new-record"),
    nameInput: $("player-name"),
    nameRow: $("name-row"),
    boardList: $("board-list"),
    boardEmpty: $("board-empty"),
  };

  // =========================================================
  //  Audio — tiny synth, zero asset files
  // =========================================================
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep(freq, dur = 0.12, type = "sine", gain = 0.18) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
  const sfx = {
    catch:  () => { beep(660, 0.08, "triangle"); beep(990, 0.10, "triangle"); },
    coin:   () => { beep(880, 0.06, "square", 0.12); beep(1320, 0.08, "square", 0.1); },
    rare:   () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, "triangle", 0.16), i * 70)); },
    bomb:   () => { beep(140, 0.3, "sawtooth", 0.25); },
    flee:   () => { beep(520, 0.05, "sine", 0.08); },
    levelup:() => { [659, 784, 988, 1318].forEach((f, i) => setTimeout(() => beep(f, 0.14, "sawtooth", 0.14), i * 90)); },
    end:    () => { [784, 587, 392].forEach((f, i) => setTimeout(() => beep(f, 0.22, "sine", 0.18), i * 160)); },
  };
  function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

  // =========================================================
  //  Camera
  // =========================================================
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.body.classList.add("no-cam");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      el.camera.srcObject = stream;
      document.body.classList.remove("no-cam");
    } catch (err) {
      document.body.classList.add("no-cam");
    }
  }

  // =========================================================
  //  Geometry helpers
  // =========================================================
  function rand(min, max) { return min + Math.random() * (max - min); }
  function bounds() {
    return {
      minX: 8,
      maxX: window.innerWidth - SIZE - 8,
      minY: 78 + (window.visualViewport ? 0 : 0),  // below HUD
      maxY: window.innerHeight - SIZE - 70,         // above level bar
    };
  }

  // =========================================================
  //  Spawning
  // =========================================================
  function pickKind() {
    const total = KINDS.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * total;
    for (const k of KINDS) if ((r -= k.weight) <= 0) return k;
    return KINDS[0];
  }

  function spawnTarget() {
    if (!S.running || S.paused) return;
    if (S.targets.size > 9) return; // keep the screen readable

    const kind = pickKind();
    const behavior = kind.behaviors[(Math.random() * kind.behaviors.length) | 0];
    const b = bounds();

    const node = document.createElement("div");
    node.className = `target ${kind.cls}`.trim();
    const sprite = document.createElement("span");
    sprite.className = "sprite";
    const img = document.createElement("img");
    img.src = kind.spr;
    img.alt = "";
    img.draggable = false;
    sprite.appendChild(img);
    node.appendChild(sprite);
    sprite.style.animationDuration = rand(0.45, 0.8).toFixed(2) + "s";

    const speed = (45 + Math.random() * 45) * (1 + (S.level - 1) * 0.12);
    const ang = Math.random() * Math.PI * 2;

    const t = {
      node, sprite, kind, behavior, alive: true,
      x: rand(b.minX, b.maxX),
      y: rand(b.minY, b.maxY),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      baseSpeed: speed,
      fleeUntil: 0,
      camoPhase: Math.random() * Math.PI * 2,
      nextTeleport: performance.now() + rand(1200, 2400),
      bornAt: performance.now(),
    };

    // peek creatures start mostly off a random edge
    if (behavior === "peek") {
      t.peekAxis = Math.random() < 0.5 ? "x" : "y";
      t.peekEdge = Math.random() < 0.5 ? 0 : 1;
      t.peekPhase = Math.random() * Math.PI * 2;
    }

    node.style.transform = `translate(${t.x}px, ${t.y}px)`;

    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      catchTarget(t, e);
    }, { passive: false });

    el.playfield.appendChild(node);
    S.targets.add(t);
    t.timeout = setTimeout(() => removeTarget(t, true), kind.life);
  }

  function removeTarget(target, fade) {
    if (!target.alive) return;
    target.alive = false;
    clearTimeout(target.timeout);
    S.targets.delete(target);
    if (fade) {
      target.node.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      target.node.style.opacity = "0";
      setTimeout(() => target.node.remove(), 260);
    } else {
      target.node.remove();
    }
  }

  function clearAllTargets() {
    S.targets.forEach((t) => { clearTimeout(t.timeout); t.node.remove(); });
    S.targets.clear();
  }

  // =========================================================
  //  Movement / behavior loop
  // =========================================================
  function frame(now) {
    const dt = Math.min(0.05, (now - (S.lastFrame || now)) / 1000);
    S.lastFrame = now;
    if (S.running && !S.paused) updateTargets(now, dt);
    S.rafId = requestAnimationFrame(frame);
  }

  function updateTargets(now, dt) {
    const b = bounds();
    S.targets.forEach((t) => {
      if (!t.alive) return;
      let opacity = 1;

      switch (t.behavior) {
        case "flee":
          // after a scare, slow back down to a calm wander
          if (now > t.fleeUntil) {
            const sp = Math.hypot(t.vx, t.vy) || 1;
            if (sp > t.baseSpeed) {
              const f = Math.max(t.baseSpeed, sp - 600 * dt) / sp;
              t.vx *= f; t.vy *= f;
            }
          }
          moveAndBounce(t, b, dt);
          break;

        case "camo": {
          moveAndBounce(t, b, dt);
          t.camoPhase += dt * 2.4;
          opacity = 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(t.camoPhase)); // blends in/out
          break;
        }

        case "teleport":
          moveAndBounce(t, b, dt);
          if (now > t.nextTeleport) {
            // quick blink to a new spot
            t.node.style.transition = "opacity 0.12s ease";
            t.node.style.opacity = "0";
            setTimeout(() => {
              if (!t.alive) return;
              t.x = rand(b.minX, b.maxX);
              t.y = rand(b.minY, b.maxY);
              t.node.style.transform = `translate(${t.x}px, ${t.y}px)`;
              t.node.style.opacity = "1";
              setTimeout(() => { if (t.alive) t.node.style.transition = ""; }, 130);
            }, 120);
            t.nextTeleport = now + rand(1100, 2200);
          }
          break;

        case "peek": {
          // slide in and out from an edge — only fully catchable while peeking out
          t.peekPhase += dt * 1.6;
          const s = 0.5 + 0.5 * Math.sin(t.peekPhase); // 0=hidden .. 1=out
          if (t.peekAxis === "x") {
            const hidden = t.peekEdge ? window.innerWidth + 10 : -SIZE - 10;
            const out = t.peekEdge ? b.maxX : b.minX;
            t.x = hidden + (out - hidden) * s;
            t.y = clamp(t.y + t.vy * dt, b.minY, b.maxY);
            if (t.y <= b.minY || t.y >= b.maxY) t.vy *= -1;
          } else {
            const hidden = t.peekEdge ? window.innerHeight + 10 : -SIZE - 10;
            const out = t.peekEdge ? b.maxY : b.minY;
            t.y = hidden + (out - hidden) * s;
            t.x = clamp(t.x + t.vx * dt, b.minX, b.maxX);
            if (t.x <= b.minX || t.x >= b.maxX) t.vx *= -1;
          }
          opacity = 0.35 + 0.65 * s;
          break;
        }

        default: // wander
          moveAndBounce(t, b, dt);
      }

      t.node.style.transform = `translate(${t.x}px, ${t.y}px)`;
      if (t.behavior === "camo" || t.behavior === "peek") t.node.style.opacity = opacity.toFixed(2);
    });
  }

  function moveAndBounce(t, b, dt) {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    if (t.x <= b.minX) { t.x = b.minX; t.vx = Math.abs(t.vx); }
    else if (t.x >= b.maxX) { t.x = b.maxX; t.vx = -Math.abs(t.vx); }
    if (t.y <= b.minY) { t.y = b.minY; t.vy = Math.abs(t.vy); }
    else if (t.y >= b.maxY) { t.y = b.maxY; t.vy = -Math.abs(t.vy); }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // A miss-tap near a creature scares it away.
  function onMissTap(e) {
    if (!S.running || S.paused) return;
    const px = e.clientX, py = e.clientY;
    let scared = false;
    S.targets.forEach((t) => {
      if (!t.alive || t.kind.type === "bomb") return;
      const cx = t.x + SIZE / 2, cy = t.y + SIZE / 2;
      const d = Math.hypot(cx - px, cy - py);
      if (d < FLEE_RADIUS) {
        // bolt directly away from the tap
        const ang = Math.atan2(cy - py, cx - px);
        const sp = (t.kind.type === "rare" ? 420 : 320) * (1 + (S.level - 1) * 0.1);
        t.vx = Math.cos(ang) * sp;
        t.vy = Math.sin(ang) * sp;
        t.fleeUntil = performance.now() + 700;
        if (t.behavior === "wander" || t.behavior === "camo") t.behavior = "flee";
        scared = true;
      }
    });
    if (scared) sfx.flee();
  }

  // =========================================================
  //  Catching
  // =========================================================
  function catchTarget(target, ev) {
    if (!target.alive || !S.running || S.paused) return;
    const kind = target.kind;
    const cx = target.x + SIZE / 2;
    const cy = target.y + SIZE / 2;

    removeTarget(target, false);

    if (kind.type === "bomb") {
      S.score = Math.max(0, S.score + kind.points);
      S.combo = 1;
      updateCombo();
      sfx.bomb(); vibrate([60, 40, 60]); flashScreen();
      burst(cx, cy, `${kind.points}`, "bad");
      particles(cx, cy, "#ff4d5e");
      refreshHud();
      return;
    }

    const now = performance.now();
    if (now - S.lastCatchAt < COMBO_WINDOW_MS) S.combo = Math.min(S.combo + 1, 9);
    else S.combo = 1;
    S.lastCatchAt = now;
    S.bestCombo = Math.max(S.bestCombo, S.combo);

    const gained = kind.points * S.combo;
    S.score += gained;
    S.caught += 1;

    if (kind.type === "rare") { sfx.rare(); vibrate(40); particles(cx, cy, "#ffc82d", 16); burst(cx, cy, `+${gained} ⭐`, "gold"); }
    else if (kind.type === "coin") { sfx.coin(); vibrate(15); particles(cx, cy, "#ffc82d"); burst(cx, cy, `+${gained}`, "gold"); }
    else { sfx.catch(); vibrate(20); particles(cx, cy, "#5fa8ff"); burst(cx, cy, `+${gained}`, "good"); }

    updateCombo();
    addLevelProgress(gained);
    refreshHud();
  }

  function addLevelProgress(amount) {
    S.levelProgress += amount;
    while (S.levelProgress >= LEVEL_UP_EVERY) {
      S.levelProgress -= LEVEL_UP_EVERY;
      S.level += 1;
      sfx.levelup(); vibrate([30, 30, 30]);
      el.levelLabel.textContent = `שלב ${S.level}`;
      restartSpawnLoop();
      burstCenter(`שלב ${S.level}! 🚀`);
    }
    el.levelFill.style.width = (S.levelProgress / LEVEL_UP_EVERY) * 100 + "%";
  }

  function currentSpawnInterval() {
    return Math.max(MIN_SPAWN_MS, BASE_SPAWN_MS - (S.level - 1) * 90);
  }
  function restartSpawnLoop() {
    clearInterval(S.spawnTimer);
    S.spawnTimer = setInterval(spawnTarget, currentSpawnInterval());
  }

  // =========================================================
  //  Visual FX
  // =========================================================
  function burst(x, y, text, cls) {
    const b = document.createElement("div");
    b.className = `burst ${cls}`;
    b.style.left = x + "px";
    b.style.top = y + "px";
    b.textContent = text;
    el.fx.appendChild(b);
    setTimeout(() => b.remove(), 800);
  }
  function burstCenter(text) { burst(window.innerWidth / 2, window.innerHeight / 2, text, "gold"); }
  function particles(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "particle";
      p.style.left = x + "px";
      p.style.top = y + "px";
      p.style.background = color;
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 60;
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      el.fx.appendChild(p);
      setTimeout(() => p.remove(), 620);
    }
  }
  function flashScreen() {
    const f = document.createElement("div");
    f.className = "flash";
    el.fx.appendChild(f);
    setTimeout(() => f.remove(), 420);
  }

  // =========================================================
  //  HUD
  // =========================================================
  function refreshHud() {
    el.score.textContent = S.score;
    el.timer.textContent = S.timeLeft;
  }
  function updateCombo() {
    el.combo.textContent = "x" + S.combo;
    el.comboPill.classList.add("bump");
    setTimeout(() => el.comboPill.classList.remove("bump"), 160);
  }

  // =========================================================
  //  Game loop
  // =========================================================
  function startGame() {
    ensureAudio();
    S.running = true; S.paused = false;
    S.score = 0; S.caught = 0; S.combo = 1; S.bestCombo = 1;
    S.level = 1; S.levelProgress = 0; S.timeLeft = ROUND_SECONDS;
    S.lastCatchAt = 0;
    clearAllTargets();

    document.body.classList.add("playing");
    hide(el.startScreen); hide(el.endScreen); hide(el.boardScreen);
    show(el.hud); show(el.levelBar); show(el.pauseBtn);
    el.levelLabel.textContent = "שלב 1";
    el.levelFill.style.width = "0%";
    el.combo.textContent = "x1";
    refreshHud();

    if (!S.rafId) { S.lastFrame = performance.now(); S.rafId = requestAnimationFrame(frame); }

    countdown(() => {
      restartSpawnLoop();
      S.tickTimer = setInterval(tick, 1000);
    });
  }

  function tick() {
    if (S.paused) return;
    S.timeLeft -= 1;
    refreshHud();
    if (S.timeLeft <= 5 && S.timeLeft > 0) beep(880, 0.08, "sine", 0.12);
    if (S.timeLeft <= 0) endGame();
  }

  function endGame() {
    S.running = false;
    clearInterval(S.spawnTimer);
    clearInterval(S.tickTimer);
    clearAllTargets();
    document.body.classList.remove("playing");
    hide(el.hud); hide(el.levelBar); hide(el.pauseBtn);
    sfx.end();

    el.finalScore.textContent = S.score;
    el.statCaught.textContent = S.caught;
    el.statBestCombo.textContent = "x" + S.bestCombo;
    el.statLevel.textContent = S.level;

    const best = getBest();
    if (S.score > best && S.score > 0) { show(el.newRecord); vibrate([40, 40, 40, 40, 120]); }
    else hide(el.newRecord);

    const saved = localStorage.getItem(NAME_KEY);
    if (saved) el.nameInput.value = saved;
    show(el.endScreen);
  }

  function countdown(done) {
    const cd = document.createElement("div");
    cd.className = "countdown";
    document.body.appendChild(cd);
    const steps = ["3", "2", "1", "צא! 🧭"];
    let i = 0;
    function step() {
      if (i >= steps.length) { cd.remove(); done(); return; }
      cd.innerHTML = `<span>${steps[i]}</span>`;
      beep(i < 3 ? 440 : 880, 0.15, "triangle", 0.2);
      i++;
      setTimeout(step, 750);
    }
    step();
  }

  function togglePause() {
    if (!S.running) return;
    S.paused = !S.paused;
    el.pauseBtn.textContent = S.paused ? "▶" : "⏸";
    if (S.paused) { clearInterval(S.spawnTimer); burstCenter("הופסק ⏸"); }
    else { restartSpawnLoop(); }
  }

  // =========================================================
  //  Leaderboard (localStorage)
  // =========================================================
  function loadBoard() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch { return []; }
  }
  function saveBoard(list) { localStorage.setItem(LB_KEY, JSON.stringify(list.slice(0, 10))); }
  function getBest() { const l = loadBoard(); return l.length ? l[0].score : 0; }

  function renderBoard(highlightDate) {
    const list = loadBoard();
    el.boardList.innerHTML = "";
    if (!list.length) { show(el.boardEmpty); return; }
    hide(el.boardEmpty);
    const medals = ["🥇", "🥈", "🥉"];
    list.forEach((e, i) => {
      const li = document.createElement("li");
      if (e.date === highlightDate) li.classList.add("me");
      li.innerHTML =
        `<span class="board-rank">${medals[i] || (i + 1)}</span>` +
        `<span class="board-name">${escapeHtml(e.name)}</span>` +
        `<span class="board-pts">${e.score}</span>`;
      el.boardList.appendChild(li);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- helpers ----------
  function show(node) { node.classList.remove("hidden"); }
  function hide(node) { node.classList.add("hidden"); }

  // =========================================================
  //  Wire up UI
  // =========================================================
  function bind() {
    $("start-btn").addEventListener("click", () => { ensureAudio(); startCamera(); startGame(); });
    $("again-btn").addEventListener("click", () => { ensureAudio(); startGame(); });
    el.pauseBtn.addEventListener("click", togglePause);
    el.taplayer.addEventListener("pointerdown", onMissTap);

    const openBoard = () => { renderBoard(); hide(el.startScreen); hide(el.endScreen); show(el.boardScreen); };
    $("board-btn").addEventListener("click", openBoard);
    $("board-btn-2").addEventListener("click", openBoard);
    $("board-close-btn").addEventListener("click", () => {
      hide(el.boardScreen);
      if (S.caught || S.score) show(el.endScreen); else show(el.startScreen);
    });
    $("board-clear-btn").addEventListener("click", () => {
      if (confirm("לאפס את כל לוח התוצאות?")) { localStorage.removeItem(LB_KEY); renderBoard(); }
    });

    $("save-score-btn").addEventListener("click", () => {
      const name = el.nameInput.value.trim() || "אנונימי";
      localStorage.setItem(NAME_KEY, name);
      const stamp = Date.now();
      const list = loadBoard();
      list.push({ name, score: S.score, date: stamp });
      list.sort((a, b) => b.score - a.score);
      saveBoard(list);
      hide(el.nameRow);
      renderBoard(stamp);
      hide(el.endScreen);
      show(el.boardScreen);
    });

    const obs = new MutationObserver(() => {
      if (!el.endScreen.classList.contains("hidden")) show(el.nameRow);
    });
    obs.observe(el.endScreen, { attributes: true, attributeFilter: ["class"] });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && S.running && !S.paused) togglePause();
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  bind();
})();
