/* ===========================================================
   AR CATCH — a Pokémon-Go-style camera AR catching game
   Pure vanilla JS. No build step, no dependencies.
   =========================================================== */

(() => {
  "use strict";

  // ---------- config ----------
  const ROUND_SECONDS = 60;
  const BASE_SPAWN_MS = 1100;      // spawn interval at level 1
  const MIN_SPAWN_MS = 380;        // fastest spawn at high levels
  const LEVEL_UP_EVERY = 120;      // points needed to advance a level
  const COMBO_WINDOW_MS = 1800;    // time to keep a combo alive
  const LB_KEY = "arcatch.leaderboard.v1";
  const NAME_KEY = "arcatch.name";

  // target kinds with weights, points, lifetime and emoji
  const KINDS = [
    { type: "creature", emoji: ["👾", "🐲", "👽", "🦖", "🐙"], points: 10, weight: 50, life: 2600, cls: "" },
    { type: "coin",     emoji: ["🪙"],                          points: 5,  weight: 30, life: 2400, cls: "coin" },
    { type: "rare",     emoji: ["⭐", "💎", "🌟"],              points: 50, weight: 7,  life: 1700, cls: "rare" },
    { type: "bomb",     emoji: ["💣"],                          points: -25, weight: 13, life: 2200, cls: "bomb" },
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
    targets: new Set(),
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    camera: $("camera"),
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
  //  Audio — tiny synth so we need zero asset files
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
      // permission denied or no camera — fall back to animated background
      document.body.classList.add("no-cam");
    }
  }

  // =========================================================
  //  Spawning targets
  // =========================================================
  function pickKind() {
    const total = KINDS.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * total;
    for (const k of KINDS) {
      if ((r -= k.weight) <= 0) return k;
    }
    return KINDS[0];
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  function spawnTarget() {
    if (!S.running || S.paused) return;
    const kind = pickKind();
    const node = document.createElement("div");
    node.className = `target ${kind.cls}`.trim();

    const sprite = document.createElement("span");
    sprite.className = "sprite";
    sprite.textContent = kind.emoji[(Math.random() * kind.emoji.length) | 0];
    node.appendChild(sprite);

    // keep targets inside a comfortable zone (away from HUD & bottom bar)
    const x = rand(12, 88);
    const y = rand(18, 80);
    node.style.left = x + "vw";
    node.style.top = y + "vh";

    // randomize hop speed a bit for liveliness
    const hopDur = rand(0.45, 0.8).toFixed(2);
    sprite.style.animationDuration = `${hopDur}s`;

    const target = { node, kind, alive: true };
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      catchTarget(target, e);
    }, { passive: false });

    el.playfield.appendChild(node);
    S.targets.add(target);

    // auto-despawn
    target.timeout = setTimeout(() => removeTarget(target, true), kind.life);
  }

  function removeTarget(target, fade) {
    if (!target.alive) return;
    target.alive = false;
    clearTimeout(target.timeout);
    S.targets.delete(target);
    if (fade) {
      target.node.style.transition = "transform 0.25s ease, opacity 0.25s ease";
      target.node.style.opacity = "0";
      target.node.style.transform = "scale(0.4)";
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
  //  Catching logic
  // =========================================================
  function catchTarget(target, ev) {
    if (!target.alive || !S.running || S.paused) return;
    const kind = target.kind;
    const rect = target.node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    removeTarget(target, false);

    if (kind.type === "bomb") {
      // penalty: reset combo, lose points, flash
      S.score = Math.max(0, S.score + kind.points);
      S.combo = 1;
      updateCombo();
      sfx.bomb();
      vibrate([60, 40, 60]);
      flashScreen();
      burst(cx, cy, `${kind.points}`, "bad");
      particles(cx, cy, "#ff5470");
      refreshHud();
      return;
    }

    // combo handling
    const now = performance.now();
    if (now - S.lastCatchAt < COMBO_WINDOW_MS) {
      S.combo = Math.min(S.combo + 1, 9);
    } else {
      S.combo = 1;
    }
    S.lastCatchAt = now;
    S.bestCombo = Math.max(S.bestCombo, S.combo);

    const gained = kind.points * S.combo;
    S.score += gained;
    S.caught += 1;

    // feedback
    if (kind.type === "rare") { sfx.rare(); vibrate(40); particles(cx, cy, "#ffd23f", 16); burst(cx, cy, `+${gained} ⭐`, "gold"); }
    else if (kind.type === "coin") { sfx.coin(); vibrate(15); particles(cx, cy, "#ffd23f"); burst(cx, cy, `+${gained}`, "gold"); }
    else { sfx.catch(); vibrate(20); particles(cx, cy, "#4ade80"); burst(cx, cy, `+${gained}`, "good"); }

    updateCombo();
    addLevelProgress(gained);
    refreshHud();
  }

  function addLevelProgress(amount) {
    S.levelProgress += amount;
    while (S.levelProgress >= LEVEL_UP_EVERY) {
      S.levelProgress -= LEVEL_UP_EVERY;
      S.level += 1;
      sfx.levelup();
      vibrate([30, 30, 30]);
      el.levelLabel.textContent = `שלב ${S.level}`;
      restartSpawnLoop();
      burstCenter(`שלב ${S.level}! 🚀`);
    }
    const pct = (S.levelProgress / LEVEL_UP_EVERY) * 100;
    el.levelFill.style.width = pct + "%";
  }

  function currentSpawnInterval() {
    const interval = BASE_SPAWN_MS - (S.level - 1) * 90;
    return Math.max(MIN_SPAWN_MS, interval);
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
  function burstCenter(text) {
    burst(window.innerWidth / 2, window.innerHeight / 2, text, "gold");
  }
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
    // reset state
    S.running = true; S.paused = false;
    S.score = 0; S.caught = 0; S.combo = 1; S.bestCombo = 1;
    S.level = 1; S.levelProgress = 0; S.timeLeft = ROUND_SECONDS;
    S.lastCatchAt = 0;
    clearAllTargets();

    hide(el.startScreen); hide(el.endScreen); hide(el.boardScreen);
    show(el.hud); show(el.levelBar); show(el.pauseBtn);
    el.levelLabel.textContent = "שלב 1";
    el.levelFill.style.width = "0%";
    el.combo.textContent = "x1";
    refreshHud();

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
    hide(el.hud); hide(el.levelBar); hide(el.pauseBtn);
    sfx.end();

    el.finalScore.textContent = S.score;
    el.statCaught.textContent = S.caught;
    el.statBestCombo.textContent = "x" + S.bestCombo;
    el.statLevel.textContent = S.level;

    const best = getBest();
    if (S.score > best && S.score > 0) {
      show(el.newRecord);
      vibrate([40, 40, 40, 40, 120]);
    } else {
      hide(el.newRecord);
    }

    // prefill saved name
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) el.nameInput.value = saved;

    show(el.endScreen);
  }

  function countdown(done) {
    const cd = document.createElement("div");
    cd.className = "countdown";
    document.body.appendChild(cd);
    const steps = ["3", "2", "1", "צא! 🎯"];
    let i = 0;
    function step() {
      if (i >= steps.length) { cd.remove(); done(); return; }
      const label = steps[i];
      cd.innerHTML = `<span>${label}</span>`;
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
    if (S.paused) {
      clearInterval(S.spawnTimer);
      burstCenter("הופסק ⏸");
    } else {
      restartSpawnLoop();
    }
  }

  // =========================================================
  //  Leaderboard (localStorage)
  // =========================================================
  function loadBoard() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
    catch { return []; }
  }
  function saveBoard(list) {
    localStorage.setItem(LB_KEY, JSON.stringify(list.slice(0, 10)));
  }
  function getBest() {
    const list = loadBoard();
    return list.length ? list[0].score : 0;
  }
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

  // =========================================================
  //  Small helpers
  // =========================================================
  function show(node) { node.classList.remove("hidden"); }
  function hide(node) { node.classList.add("hidden"); }

  // =========================================================
  //  Wire up UI
  // =========================================================
  function bind() {
    $("start-btn").addEventListener("click", () => { ensureAudio(); startCamera(); startGame(); });
    $("again-btn").addEventListener("click", () => { ensureAudio(); startGame(); });
    el.pauseBtn.addEventListener("click", togglePause);

    const openBoard = () => { renderBoard(); hide(el.startScreen); hide(el.endScreen); show(el.boardScreen); };
    $("board-btn").addEventListener("click", openBoard);
    $("board-btn-2").addEventListener("click", openBoard);
    $("board-close-btn").addEventListener("click", () => {
      hide(el.boardScreen);
      // return to whichever screen makes sense
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

    // reset name row visibility when end screen opens
    const obs = new MutationObserver(() => {
      if (!el.endScreen.classList.contains("hidden")) show(el.nameRow);
    });
    obs.observe(el.endScreen, { attributes: true, attributeFilter: ["class"] });

    // pause on tab hide
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && S.running && !S.paused) togglePause();
    });
  }

  // register service worker for PWA/offline
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  bind();
})();
