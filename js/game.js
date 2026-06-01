/* ===========================================================
   PANGO GO — main engine
   • Gyroscope AR world: creatures live at angles around you; pan the
     phone (or drag) to find them. Off-screen radar arrows guide you.
   • Throw a Pango-ball (flick / tap) with arc physics to catch them.
   • Game feel: screen shake, hit-stop, squash, catch animation, trails.
   • Meta: Pangodex collection, player XP/level, coins, daily mission.
   =========================================================== */
(() => {
  "use strict";
  const A = PANGO.Audio, D = PANGO.Data;

  // ---------- config ----------
  const ROUND_SECONDS = 70;
  const HFOV = 80;                 // horizontal field of view (deg)
  const BASE_SPAWN_MS = 1100, MIN_SPAWN_MS = 460;
  const LEVEL_UP_EVERY = 130, COMBO_WINDOW_MS = 2000;
  const CATCH_RADIUS = 74;
  const HAZARD_CHANCE = 0.13;
  const AIM_LOCK_FLEE_MS = 1500;   // staring at a creature this long → it bolts

  // ---------- state ----------
  const S = {
    running: false, paused: false,
    score: 0, caught: 0, combo: 1, bestCombo: 1,
    level: 1, levelProgress: 0, timeLeft: ROUND_SECONDS,
    lastCatchAt: 0,
    coinsRun: 0, xpRun: 0, newSpecies: 0,
    spawnTimer: null, tickTimer: null, rafId: null, lastFrame: 0,
    timeScale: 1, shakeMag: 0, shakeUntil: 0,
    ballActive: false,
    creatures: new Set(),
    view: { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, hasGyro: false },
    pointer: null,
    timeouts: new Set(),
  };
  let W = window.innerWidth, H = window.innerHeight;

  const $ = (id) => document.getElementById(id);
  const el = {};
  ["camera","stage","playfield","balllayer","radar","fx","hud","score","combo","comboPill",
   "timer","coinsRun","lookHint","levelBar","levelFill","levelLabel","pauseBtn",
   "startScreen","howtoScreen","endScreen","boardScreen","dexScreen","toast",
   "finalScore","statCaught","statBestCombo","statCoins","statNew","newRecord","missionDone",
   "nameInput","nameRow","boardList","boardEmpty","dexGrid",
   "playerLevel","playerCoins","dexCount","xpFill","xpLabel",
   "missionText","missionFill","missionReward"].forEach((k) => {
    el[k] = $(k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()));
  });

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const angDiff = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
  const show = (n) => n.classList.remove("hidden");
  const hide = (n) => n.classList.add("hidden");
  function later(fn, ms) { const t = setTimeout(() => { S.timeouts.delete(t); fn(); }, ms); S.timeouts.add(t); return t; }
  function clearLaters() { S.timeouts.forEach(clearTimeout); S.timeouts.clear(); }

  function vibrate(p) { if (navigator.vibrate) navigator.vibrate(p); }

  // =========================================================
  //  Sensors: camera + gyroscope
  // =========================================================
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { document.body.classList.add("no-cam"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      el.camera.srcObject = stream;
      document.body.classList.remove("no-cam");
    } catch { document.body.classList.add("no-cam"); }
  }

  function onOrient(e) {
    if (e.alpha == null) return;
    S.view.hasGyro = true;
    S.view.tYaw = e.alpha;
    S.view.tPitch = clamp(e.beta - 90, -45, 45);
  }
  async function startGyro() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") return;
      }
      window.addEventListener("deviceorientation", onOrient, true);
    } catch { /* fall back to drag-look */ }
  }

  // =========================================================
  //  Spawning
  // =========================================================
  function pickSpecies() {
    const total = D.SPECIES.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * total;
    for (const sp of D.SPECIES) if ((r -= sp.weight) <= 0) return sp;
    return D.SPECIES[0];
  }

  function spawn() {
    if (!S.running || S.paused) return;
    if (S.creatures.size > 7 + S.level) return;

    const hazard = Math.random() < HAZARD_CHANCE;
    const sp = hazard ? null : pickSpecies();
    const behaviors = hazard ? ["wander"]
      : (sp.rarity === "rare" || sp.rarity === "legendary")
        ? ["teleport", "flee", "camo"]
        : ["wander", "wander", "flee", "camo", "teleport"];
    const behavior = behaviors[(Math.random() * behaviors.length) | 0];

    const node = document.createElement("div");
    node.className = "target " + (hazard ? "bomb" : (sp.rarity === "legendary" ? "legendary" : sp.rarity === "rare" ? "rare" : ""));
    const sprite = document.createElement("span");
    sprite.className = "sprite";
    const img = document.createElement("img");
    img.src = hazard ? D.FINE_URI : sp.uri;
    img.alt = "";
    sprite.appendChild(img);
    node.appendChild(sprite);
    sprite.style.animationDuration = rand(0.45, 0.8).toFixed(2) + "s";

    const c = {
      sp, hazard, node, sprite, img, alive: true, frozen: false,
      behavior,
      yaw: ((S.view.yaw + rand(-120, 120)) % 360 + 360) % 360,
      pitch: rand(-26, 26),
      vyaw: rand(-14, 14), vpitch: rand(-7, 7),
      camoPhase: Math.random() * 6.28,
      nextTeleport: performance.now() + rand(1600, 3000),
      fleeUntil: 0, aimSince: 0,
      blinkAt: performance.now() + rand(2000, 5000),
      points: hazard ? -25 : sp.points,
      sx: -999, sy: -999, dy: 999, dp: 999, visible: false,
    };
    el.playfield.appendChild(node);
    S.creatures.add(c);
    c.life = later(() => removeCreature(c, true), hazard ? 5200 : rand(7000, 11000));
  }

  function removeCreature(c, fade) {
    if (!c.alive) return;
    c.alive = false;
    clearTimeout(c.life);
    S.creatures.delete(c);
    if (fade) { c.node.style.transition = "opacity .25s, transform .25s"; c.node.style.opacity = "0"; later(() => c.node.remove(), 260); }
    else c.node.remove();
  }
  function clearCreatures() { S.creatures.forEach((c) => { clearTimeout(c.life); c.node.remove(); }); S.creatures.clear(); }

  // =========================================================
  //  Main loop
  // =========================================================
  function frame(now) {
    let dt = Math.min(0.05, (now - (S.lastFrame || now)) / 1000);
    S.lastFrame = now;
    if (S.running && !S.paused) {
      updateView(dt);
      updateCreatures(now, dt * S.timeScale);
      updateBalls(now, dt);
      render(now);
    }
    S.rafId = requestAnimationFrame(frame);
  }

  function updateView(dt) {
    const v = S.view;
    const k = Math.min(1, dt * 8);
    v.yaw += angDiff(v.tYaw - v.yaw) * k;
    v.yaw = (v.yaw % 360 + 360) % 360;
    v.pitch += (v.tPitch - v.pitch) * k;
  }

  function updateCreatures(now, dt) {
    const v = S.view;
    S.creatures.forEach((c) => {
      if (!c.alive || c.frozen) return;
      let op = 1;
      switch (c.behavior) {
        case "flee":
          if (now > c.fleeUntil) { c.vyaw *= (1 - Math.min(1, dt * 1.5)); }
          break;
        case "camo":
          c.camoPhase += dt * 2.4;
          op = 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(c.camoPhase));
          break;
        case "teleport":
          if (now > c.nextTeleport && !c.hazard) {
            c.node.style.transition = "opacity .12s";
            c.node.style.opacity = "0";
            const cc = c;
            later(() => {
              if (!cc.alive) return;
              cc.yaw = (v.yaw + rand(-90, 90) + 360) % 360;
              cc.pitch = rand(-26, 26);
              cc.node.style.opacity = "1";
              later(() => { if (cc.alive) cc.node.style.transition = ""; }, 130);
            }, 120);
            c.nextTeleport = now + rand(1700, 3200);
          }
          break;
      }
      // base drift
      c.yaw = (c.yaw + c.vyaw * dt + 360) % 360;
      c.pitch += c.vpitch * dt;
      if (c.pitch < -30) { c.pitch = -30; c.vpitch = Math.abs(c.vpitch); }
      if (c.pitch > 30) { c.pitch = 30; c.vpitch = -Math.abs(c.vpitch); }

      // "aim lock": staring straight at it makes it nervous → flee
      if (!c.hazard && Math.abs(c.dy) < 7 && Math.abs(c.dp) < 7) {
        if (!c.aimSince) c.aimSince = now;
        else if (now - c.aimSince > AIM_LOCK_FLEE_MS) { scare(c); c.aimSince = 0; }
      } else c.aimSince = 0;

      // occasional blink
      if (now > c.blinkAt) {
        if (!c.hazard) { c.img.src = c.sp.uriBlink; later(() => { if (c.alive) c.img.src = c.sp.uri; }, 130); }
        c.blinkAt = now + rand(2500, 6000);
      }

      c._op = op;
    });
  }

  function scare(c) {
    if (c.hazard || !c.alive) return;
    const away = c.dy >= 0 ? 1 : -1;
    c.vyaw = away * rand(70, 110);
    c.vpitch = rand(-20, 20);
    c.fleeUntil = performance.now() + 800;
    if (c.behavior !== "teleport") c.behavior = "flee";
    A.sfx.flee();
  }

  function project(c) {
    const dy = angDiff(c.yaw - S.view.yaw);
    const dp = c.pitch - S.view.pitch;
    const halfH = HFOV / 2;
    const vfov = HFOV * (H / W);
    const halfV = vfov / 2;
    c.dy = dy; c.dp = dp;
    c.sx = W / 2 + (dy / halfH) * (W / 2);
    c.sy = H / 2 - (dp / halfV) * (H / 2);
    c.visible = Math.abs(dy) <= halfH * 1.12 && Math.abs(dp) <= halfV * 1.3;
  }

  function render(now) {
    // creatures
    S.creatures.forEach((c) => {
      if (!c.alive) return;
      if (!c.frozen) project(c);
      if (c.visible || c.frozen) {
        c.node.style.display = "";
        c.node.style.transform = `translate(${c.sx}px, ${c.sy}px)`;
        if (c.behavior === "camo") c.node.style.opacity = (c._op ?? 1).toFixed(2);
      } else {
        c.node.style.display = "none";
      }
    });
    renderRadar();
    // screen shake on the stage
    let tx = 0, ty = 0;
    if (now < S.shakeUntil) {
      const m = S.shakeMag * ((S.shakeUntil - now) / 260);
      tx = (Math.random() * 2 - 1) * m; ty = (Math.random() * 2 - 1) * m;
    }
    el.stage.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  function renderRadar() {
    el.radar.innerHTML = "";
    const off = [];
    S.creatures.forEach((c) => { if (c.alive && !c.frozen && !c.hazard && !c.visible) off.push(c); });
    off.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
    off.slice(0, 4).forEach((c) => {
      const a = document.createElement("div");
      a.className = "radar-arrow" + (c.sp.rarity === "rare" || c.sp.rarity === "legendary" ? " rare" : "");
      const right = c.dy >= 0;
      const x = right ? W - 22 : 22;
      const vfov = HFOV * (H / W);
      const y = clamp(H / 2 - (c.dp / (vfov / 2)) * (H / 2), 90, H - 110);
      a.style.left = x + "px"; a.style.top = y + "px";
      a.textContent = right ? "▶" : "◀";
      el.radar.appendChild(a);
    });
  }

  // =========================================================
  //  Throwing
  // =========================================================
  function throwBall(aimX, aimY) {
    if (S.ballActive) return;
    S.ballActive = true;
    A.sfx.throw();
    const node = document.createElement("div");
    node.className = "ball spin";
    const img = document.createElement("img");
    img.src = D.BALL_URI; img.alt = "";
    node.appendChild(img);
    el.balllayer.appendChild(node);
    const ball = {
      node, x0: W / 2, y0: H - 46, x1: aimX, y1: aimY,
      t: 0, dur: 0.46, lastTrail: 0,
    };
    S.ball = ball;
  }

  function updateBalls(now, dt) {
    const b = S.ball;
    if (!b) return;
    b.t += dt / b.dur;
    const t = Math.min(1, b.t);
    const e = 1 - Math.pow(1 - t, 2);
    const cx = b.x0 + (b.x1 - b.x0) * e;
    const cy = b.y0 + (b.y1 - b.y0) * e - Math.sin(Math.PI * t) * 120;
    const sc = 1 - 0.55 * t;
    b.node.style.transform = `translate(${cx}px, ${cy}px) scale(${sc})`;
    if (now - b.lastTrail > 24) { trail(cx, cy); b.lastTrail = now; }
    if (t >= 1) resolveThrow(b);
  }

  function trail(x, y) {
    const d = document.createElement("div");
    d.className = "ball-trail";
    d.style.left = x + "px"; d.style.top = y + "px";
    el.balllayer.appendChild(d);
    later(() => d.remove(), 400);
  }

  function resolveThrow(b) {
    b.node.remove();
    S.ball = null;
    // nearest catchable creature to the landing point
    let best = null, bestD = CATCH_RADIUS;
    S.creatures.forEach((c) => {
      if (!c.alive || c.frozen || !c.visible) return;
      const d = Math.hypot(c.sx - b.x1, c.sy - b.y1);
      if (d < bestD) { bestD = d; best = c; }
    });
    if (best) {
      if (best.hazard) { hitHazard(best); S.ballActive = false; }
      else catchSequence(best);
    } else {
      A.sfx.miss();
      S.ballActive = false;
      // a near miss scares creatures around the landing point
      S.creatures.forEach((c) => {
        if (c.alive && !c.hazard && c.visible && Math.hypot(c.sx - b.x1, c.sy - b.y1) < 130) scare(c);
      });
    }
  }

  function hitHazard(c) {
    const x = c.sx, y = c.sy;
    removeCreature(c, false);
    S.score = Math.max(0, S.score - 25);
    S.combo = 1; updateCombo();
    A.sfx.fine(); vibrate([60, 40, 60]); flash(); shake(16, 320);
    burst(x, y, "-25", "bad"); particles(x, y, "#ff4d5e", 14);
    refreshHud();
  }

  function catchSequence(c) {
    c.frozen = true;
    clearTimeout(c.life);
    const x = c.sx, y = c.sy;
    shake(6, 160); hitStop(70);
    // wobble ball at the creature, suspense, then capture
    const wb = document.createElement("div");
    wb.className = "ball wobble";
    const im = document.createElement("img"); im.src = D.BALL_URI; wb.appendChild(im);
    wb.style.transform = `translate(${x}px, ${y}px) scale(0.85)`;
    el.balllayer.appendChild(wb);
    c.node.style.opacity = "0";
    A.sfx.wobble();
    later(() => A.sfx.wobble(), 250);
    later(() => {
      wb.remove();
      finishCatch(c, x, y);
      S.ballActive = false;
    }, 620);
  }

  function finishCatch(c, x, y) {
    const sp = c.sp;
    removeCreature(c, false);

    const now = performance.now();
    if (now - S.lastCatchAt < COMBO_WINDOW_MS) S.combo = Math.min(S.combo + 1, 9);
    else S.combo = 1;
    S.lastCatchAt = now;
    S.bestCombo = Math.max(S.bestCombo, S.combo);

    const gained = sp.points * S.combo;
    S.score += gained; S.caught += 1;
    S.coinsRun += Math.max(1, Math.round(sp.points / 5));
    S.xpRun += sp.points;

    // collection
    const isNew = D.discover(sp.id);
    if (isNew) { S.newSpecies++; S.score += 25; S.coinsRun += 10; toast(`✨ מין חדש: ${sp.name}!  +25`); }

    // mission progress
    bumpMission(sp);

    // feedback
    const color = sp.rarity === "legendary" ? "#ffc82d" : sp.rarity === "rare" ? "#ff9ec9" : "#5fa8ff";
    if (sp.rarity === "legendary") { A.sfx.legend(); vibrate([30,40,30,40,80]); shake(14, 300); particles(x, y, "#ffc82d", 22); }
    else if (sp.rarity === "rare") { A.sfx.rare(); vibrate(40); shake(8, 220); particles(x, y, "#ff9ec9", 16); }
    else { A.sfx.catch(); vibrate(22); particles(x, y, color, 12); }
    burst(x, y - 10, `+${gained}`, sp.rarity === "common" || sp.rarity === "uncommon" ? "good" : "gold");
    if (S.combo >= 3) burst(x, y - 44, `קומבו x${S.combo}!`, "gold");

    updateCombo(); addLevelProgress(gained); refreshHud();
  }

  function bumpMission(sp) {
    const m = D.mission();
    if (m.done) return;
    if (m.kind === "any") m.progress++;
    else if (m.kind === "rare" && (sp.rarity === "rare" || sp.rarity === "legendary")) m.progress++;
    else if (m.kind === "combo") m.progress = Math.max(m.progress, S.combo);
    else if (m.kind === "score") m.progress = S.score;
    D.saveMission(m);
  }

  function addLevelProgress(amount) {
    S.levelProgress += amount;
    while (S.levelProgress >= LEVEL_UP_EVERY) {
      S.levelProgress -= LEVEL_UP_EVERY;
      S.level++;
      A.sfx.levelup(); vibrate([30, 30, 30]);
      el.levelLabel.textContent = `שלב ${S.level}`;
      restartSpawn();
      toast(`🚀 שלב ${S.level}! דמויות מהירות יותר`);
    }
    el.levelFill.style.width = (S.levelProgress / LEVEL_UP_EVERY) * 100 + "%";
  }
  function spawnInterval() { return Math.max(MIN_SPAWN_MS, BASE_SPAWN_MS - (S.level - 1) * 80); }
  function restartSpawn() { clearInterval(S.spawnTimer); S.spawnTimer = setInterval(spawn, spawnInterval()); }

  // =========================================================
  //  Game feel utilities
  // =========================================================
  function shake(mag, dur) { S.shakeMag = mag; S.shakeUntil = performance.now() + dur; }
  function hitStop(ms) { S.timeScale = 0.0; later(() => { S.timeScale = 1; }, ms); }
  function flash() { const f = document.createElement("div"); f.className = "flash"; el.fx.appendChild(f); later(() => f.remove(), 420); }
  function burst(x, y, text, cls) {
    const b = document.createElement("div"); b.className = "burst " + cls;
    b.style.left = x + "px"; b.style.top = y + "px"; b.textContent = text;
    el.fx.appendChild(b); later(() => b.remove(), 900);
  }
  function particles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div"); p.className = "particle";
      p.style.left = x + "px"; p.style.top = y + "px"; p.style.background = color;
      const a = Math.random() * 6.28, d = 40 + Math.random() * 70;
      p.style.setProperty("--dx", Math.cos(a) * d + "px");
      p.style.setProperty("--dy", Math.sin(a) * d + "px");
      el.fx.appendChild(p); later(() => p.remove(), 650);
    }
  }
  let toastTimer = null;
  function toast(text) {
    el.toast.textContent = text; show(el.toast);
    requestAnimationFrame(() => el.toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.classList.remove("show"); setTimeout(() => hide(el.toast), 300); }, 2200);
  }

  // =========================================================
  //  HUD
  // =========================================================
  function refreshHud() {
    el.score.textContent = S.score;
    el.timer.textContent = S.timeLeft;
    el.coinsRun.textContent = S.coinsRun;
  }
  function updateCombo() {
    el.combo.textContent = "x" + S.combo;
    el.comboPill.classList.add("bump");
    later(() => el.comboPill.classList.remove("bump"), 160);
  }

  // =========================================================
  //  Input (look + throw)
  // =========================================================
  function bindInput() {
    window.addEventListener("pointerdown", (e) => {
      if (!S.running || S.paused) return;
      S.pointer = { sx: e.clientX, sy: e.clientY, moved: 0, look: false, t: performance.now() };
    });
    window.addEventListener("pointermove", (e) => {
      const p = S.pointer; if (!p || !S.running || S.paused) return;
      const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
      p.moved = Math.hypot(dx, dy);
      if (!S.view.hasGyro && p.moved > 12) {
        // drag to look around (no-gyro fallback)
        p.look = true;
        S.view.tYaw = (S.view.tYaw - dx * 0.18) % 360;
        S.view.tPitch = clamp(S.view.tPitch + dy * 0.16, -45, 45);
        p.sx = e.clientX; p.sy = e.clientY;
      }
    });
    window.addEventListener("pointerup", (e) => {
      const p = S.pointer; S.pointer = null;
      if (!p || !S.running || S.paused) return;
      if (p.look) return;                          // it was a look-drag
      if (!S.view.hasGyro && p.moved > 12) return; // ambiguous drag → ignore
      throwBall(e.clientX, e.clientY);             // tap/flick → throw
    });
  }

  // =========================================================
  //  Flow: start / tick / end / pause
  // =========================================================
  function startGame() {
    A.init();
    if (D.settings().sound) A.startMusic();
    S.running = true; S.paused = false;
    S.score = 0; S.caught = 0; S.combo = 1; S.bestCombo = 1;
    S.level = 1; S.levelProgress = 0; S.timeLeft = ROUND_SECONDS;
    S.lastCatchAt = 0; S.coinsRun = 0; S.xpRun = 0; S.newSpecies = 0;
    S.timeScale = 1; S.ballActive = false; S.ball = null;
    clearCreatures(); clearLaters();
    el.balllayer.innerHTML = ""; el.fx.innerHTML = ""; el.radar.innerHTML = "";

    document.body.classList.add("playing");
    [el.startScreen, el.endScreen, el.boardScreen, el.dexScreen, el.howtoScreen].forEach(hide);
    [el.hud, el.levelBar, el.pauseBtn].forEach(show);
    show(el.lookHint); later(() => hide(el.lookHint), 4500);
    el.levelLabel.textContent = "שלב 1"; el.levelFill.style.width = "0%";
    el.combo.textContent = "x1"; refreshHud();

    if (!S.rafId) { S.lastFrame = performance.now(); S.rafId = requestAnimationFrame(frame); }
    countdown(() => { restartSpawn(); S.tickTimer = setInterval(tick, 1000); });
  }

  function tick() {
    if (S.paused) return;
    S.timeLeft--;
    refreshHud();
    if (S.timeLeft <= 5 && S.timeLeft > 0) A.sfx.count(true);
    if (S.timeLeft <= 0) endGame();
  }

  function endGame() {
    S.running = false;
    clearInterval(S.spawnTimer); clearInterval(S.tickTimer);
    clearCreatures(); clearLaters();
    el.balllayer.innerHTML = "";
    document.body.classList.remove("playing");
    [el.hud, el.levelBar, el.pauseBtn, el.lookHint].forEach(hide);
    el.stage.style.transform = "";
    A.stopMusic(); A.sfx.end();

    // commit meta
    const prof = D.profile();
    const lvlBefore = D.levelFromXp(prof.xp);
    prof.xp += S.xpRun; prof.coins += S.coinsRun; prof.totalCaught += S.caught;
    const lvlAfter = D.levelFromXp(prof.xp);

    // daily mission completion
    const m = D.mission();
    let missionJustDone = false;
    if (!m.done && m.progress >= m.target) { m.done = true; prof.coins += m.reward; D.saveMission(m); missionJustDone = true; }
    D.saveProfile(prof);

    el.finalScore.textContent = S.score;
    el.statCaught.textContent = S.caught;
    el.statBestCombo.textContent = "x" + S.bestCombo;
    el.statCoins.textContent = S.coinsRun;
    el.statNew.textContent = S.newSpecies;
    el.missionDone.classList.toggle("hidden", !missionJustDone);

    const best = D.bestScore();
    el.newRecord.classList.toggle("hidden", !(S.score > best && S.score > 0));
    if (S.score > best && S.score > 0) vibrate([40, 40, 40, 40, 120]);

    const saved = localStorage.getItem("pangogo.name");
    if (saved) el.nameInput.value = saved;
    show(el.nameRow);
    show(el.endScreen);
    if (lvlAfter > lvlBefore) later(() => toast(`⭐ עלית לשלב שחקן ${lvlAfter}!`), 600);
  }

  function countdown(done) {
    const cd = document.createElement("div"); cd.className = "countdown"; document.body.appendChild(cd);
    const steps = ["3", "2", "1", "צא! 🧭"]; let i = 0;
    (function step() {
      if (i >= steps.length) { cd.remove(); done(); return; }
      cd.innerHTML = `<span>${steps[i]}</span>`;
      A.sfx.count(i >= 3); i++; setTimeout(step, 750);
    })();
  }

  function togglePause() {
    if (!S.running) return;
    S.paused = !S.paused;
    el.pauseBtn.textContent = S.paused ? "▶" : "⏸";
    if (S.paused) { clearInterval(S.spawnTimer); A.stopMusic(); toast("הופסק ⏸"); }
    else { restartSpawn(); if (D.settings().sound) A.startMusic(); }
  }

  // =========================================================
  //  Screens: profile / mission / dex / board
  // =========================================================
  function refreshStart() {
    const p = D.profile();
    const lvl = D.levelFromXp(p.xp);
    el.playerLevel.textContent = lvl;
    el.playerCoins.textContent = p.coins;
    const dex = D.dex();
    el.dexCount.textContent = `${Object.keys(dex).length}/${D.SPECIES.length}`;
    const cur = D.xpForLevel(lvl), next = D.xpForLevel(lvl + 1);
    el.xpFill.style.width = clamp((p.xp - cur) / (next - cur) * 100, 0, 100) + "%";
    el.xpLabel.textContent = `${p.xp - cur} / ${next - cur} XP`;
    const m = D.mission();
    el.missionText.textContent = m.text + (m.done ? " ✅" : "");
    el.missionFill.style.width = clamp(m.progress / m.target * 100, 0, 100) + "%";
    el.missionReward.textContent = `+${m.reward}🪙`;
  }

  function renderBoard(highlight) {
    const list = D.board();
    el.boardList.innerHTML = "";
    if (!list.length) { show(el.boardEmpty); return; }
    hide(el.boardEmpty);
    const medals = ["🥇", "🥈", "🥉"];
    list.forEach((e, i) => {
      const li = document.createElement("li");
      if (e.date === highlight) li.classList.add("me");
      li.innerHTML = `<span class="board-rank">${medals[i] || i + 1}</span><span class="board-name">${esc(e.name)}</span><span class="board-pts">${e.score}</span>`;
      el.boardList.appendChild(li);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function renderDex() {
    const dex = D.dex();
    el.dexGrid.innerHTML = "";
    const rar = { common: "⚪", uncommon: "🟢", rare: "🔵", legendary: "🟡" };
    D.SPECIES.forEach((sp) => {
      const got = dex[sp.id];
      const cell = document.createElement("div");
      cell.className = "dex-cell" + (got ? "" : " locked");
      cell.innerHTML = `<span class="dex-rarity">${rar[sp.rarity]}</span>` +
        `<img src="${sp.uri}" alt="">` +
        `<div class="dex-name">${got ? esc(sp.name) : "???"}</div>` +
        `<div class="dex-count">${got ? "×" + got.count : ""}</div>`;
      el.dexGrid.appendChild(cell);
    });
  }

  // =========================================================
  //  Wire up UI
  // =========================================================
  function openOverlay(node) { [el.startScreen, el.endScreen, el.boardScreen, el.dexScreen, el.howtoScreen].forEach(hide); show(node); }

  function bind() {
    bindInput();

    $("start-btn").addEventListener("click", () => {
      A.init(); startCamera(); startGyro();
      if (!localStorage.getItem("pangogo.onboarded")) {
        localStorage.setItem("pangogo.onboarded", "1");
        openOverlay(el.howtoScreen);
        el._afterHowto = startGame;
      } else startGame();
    });
    $("howto-close").addEventListener("click", () => { if (el._afterHowto) { const f = el._afterHowto; el._afterHowto = null; f(); } else openOverlay(el.startScreen); });
    $("howto-btn").addEventListener("click", () => { el._afterHowto = null; openOverlay(el.howtoScreen); });
    $("again-btn").addEventListener("click", () => { A.init(); startGame(); });
    el.pauseBtn.addEventListener("click", togglePause);

    const openBoard = () => { renderBoard(); openOverlay(el.boardScreen); };
    $("board-btn").addEventListener("click", openBoard);
    $("board-btn-2").addEventListener("click", openBoard);
    $("board-close-btn").addEventListener("click", () => { refreshStart(); openOverlay(S.caught || S.score ? el.endScreen : el.startScreen); });
    $("board-clear-btn").addEventListener("click", () => { if (confirm("לאפס את כל לוח התוצאות?")) { D.clearBoard(); renderBoard(); } });

    const openDex = () => { renderDex(); openOverlay(el.dexScreen); };
    $("dex-btn").addEventListener("click", openDex);
    $("dex-btn-2").addEventListener("click", openDex);
    $("dex-close-btn").addEventListener("click", () => { refreshStart(); openOverlay(S.caught || S.score ? el.endScreen : el.startScreen); });

    $("save-score-btn").addEventListener("click", () => {
      const name = el.nameInput.value.trim() || "אנונימי";
      localStorage.setItem("pangogo.name", name);
      const stamp = D.addScore(name, S.score);
      hide(el.nameRow); renderBoard(stamp); openOverlay(el.boardScreen);
    });

    $("sound-btn").addEventListener("click", () => {
      const s = D.settings(); s.sound = !s.sound; D.saveSettings(s);
      A.toggle(s.sound);
      $("sound-btn").textContent = s.sound ? "🔊 סאונד" : "🔇 מושתק";
    });

    document.addEventListener("visibilitychange", () => { if (document.hidden && S.running && !S.paused) togglePause(); });
    window.addEventListener("resize", () => { W = window.innerWidth; H = window.innerHeight; });

    // init labels
    const s = D.settings(); $("sound-btn").textContent = s.sound ? "🔊 סאונד" : "🔇 מושתק";
    refreshStart();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  bind();
})();
