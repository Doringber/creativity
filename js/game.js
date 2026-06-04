/* ===========================================================
   PANGO GO — main engine (v3: cleaner, brighter, gradual, Fever)
   • Gyro AR world (pan phone / drag to look). Radar arrows guide you.
   • Aim + throw a big Pango-ball (press to aim, release to throw).
   • Gradual difficulty: easy start, mechanics introduced over levels.
   • Hook: PANGO FEVER — chain catches to trigger double-point fever mode.
   • Minimal UI: one Home screen + one End screen.
   =========================================================== */
(() => {
  "use strict";
  const A = PANGO.Audio, D = PANGO.Data;

  const ROUND_SECONDS = 70;
  const HFOV = 80;
  const COMBO_WINDOW_MS = 2200;
  const FEVER_MAX = 100, FEVER_DECAY = 4, FEVER_SECONDS = 8, FEVER_GRACE_MS = 1600;
  const AIM_LOCK_FLEE_MS = 1600;

  const S = {
    running: false, paused: false,
    score: 0, caught: 0, combo: 1, bestCombo: 1,
    level: 1, levelProgress: 0, timeLeft: ROUND_SECONDS, lastCatchAt: 0,
    coinsRun: 0, xpRun: 0, newNames: [],
    fever: 0, feverMode: false, feverEndsAt: 0,
    spawnTimer: null, tickTimer: null, rafId: null, lastFrame: 0,
    timeScale: 1, shakeMag: 0, shakeUntil: 0,
    ballActive: false, ball: null,
    creatures: new Set(),
    traps: new Set(),
    view: { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, hasGyro: false },
    pointer: null, timeouts: new Set(),
  };
  let W = innerWidth, H = innerHeight;

  const $ = (id) => document.getElementById(id);
  const el = {};
  ("camera stage playfield aim balllayer radar fx feverFlash hud score comboPill combo timer pauseBtn " +
   "fever feverFill weaponBtn weaponImg homeScreen homeMascot missionChip missionText missionReward playBtn dexStrip weapBar " +
   "homeBest homeLevel homeCoins soundBtn endScreen endEmoji finalScore eCaught eCombo eCoins " +
   "newRecord newSpecies missionDone nameRow playerName saveScoreBtn againBtn homeBtn top3 toast")
    .split(" ").forEach((k) => { el[k] = $(k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())); });

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const angDiff = (a) => ((a + 180) % 360 + 360) % 360 - 180;
  const show = (n) => n.classList.remove("hidden");
  const hide = (n) => n.classList.add("hidden");
  const vibrate = (p) => navigator.vibrate && navigator.vibrate(p);
  function later(fn, ms) { const t = setTimeout(() => { S.timeouts.delete(t); fn(); }, ms); S.timeouts.add(t); return t; }
  function clearLaters() { S.timeouts.forEach(clearTimeout); S.timeouts.clear(); }

  // ---------- sensors ----------
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { document.body.classList.add("no-cam"); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      el.camera.srcObject = st; document.body.classList.remove("no-cam");
      el.camera.setAttribute("playsinline", ""); el.camera.muted = true;
      resumeCamera();
      el.camera.onloadedmetadata = resumeCamera;
      el.camera.oncanplay = resumeCamera;
    } catch { document.body.classList.add("no-cam"); }
  }
  // iOS frequently pauses the getUserMedia video (refocus/permission flow) —
  // keep nudging it so we never fall back to the blank blue screen.
  function resumeCamera() { if (el.camera.srcObject && el.camera.paused) el.camera.play?.().catch(() => {}); }
  function onOrient(e) { if (e.alpha == null) return; S.view.hasGyro = true; S.view.tYaw = e.alpha; S.view.tPitch = clamp(e.beta - 90, -45, 45); }
  async function startGyro() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") { if (await DOE.requestPermission() !== "granted") return; }
      window.addEventListener("deviceorientation", onOrient, true);
    } catch {}
  }

  // ---------- difficulty curve ----------
  function diff() {
    const L = S.level;
    return {
      spread: Math.min(150, 36 + L * 20),
      behaviors: L <= 1 ? ["wander"] : L === 2 ? ["wander", "wander", "flee"] : L === 3 ? ["wander", "flee", "camo"] : ["wander", "flee", "camo", "teleport"],
      hazardChance: L <= 2 ? 0 : Math.min(0.14, 0.05 * (L - 2)),
      speedMul: Math.min(1.5, 0.55 + 0.12 * (L - 1)),
      catchRadius: Math.max(80, 110 - L * 5),
      aimLock: L >= 3,
      maxCreatures: 4 + L,
      spawnMs: Math.max(440, 1300 - (L - 1) * 110),
    };
  }
  function allowedSpecies() {
    const L = S.level;
    return D.SPECIES.filter((s) => L >= 4 ? true : L >= 3 ? s.rarity !== "legendary" : L >= 2 ? (s.rarity === "common" || s.rarity === "uncommon") : s.rarity === "common");
  }

  // ---------- spawning ----------
  function pickSpecies() {
    const pool = allowedSpecies();
    const total = pool.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * total;
    for (const sp of pool) if ((r -= sp.weight) <= 0) return sp;
    return pool[0];
  }
  function spawn() {
    if (!S.running || S.paused) return;
    const dd = diff();
    if (S.creatures.size > dd.maxCreatures) return;
    const hazard = Math.random() < dd.hazardChance;
    const sp = hazard ? null : pickSpecies();
    const behavior = hazard ? "wander" : dd.behaviors[(Math.random() * dd.behaviors.length) | 0];

    const node = document.createElement("div");
    node.className = "target " + (hazard ? "bomb" : (sp.rarity === "legendary" ? "legendary" : sp.rarity === "rare" ? "rare" : ""));
    const sprite = document.createElement("span"); sprite.className = "sprite";
    const img = document.createElement("img"); img.src = hazard ? D.FINE_URI : sp.uri; sprite.appendChild(img);
    node.appendChild(sprite); sprite.style.animationDuration = rand(0.45, 0.8).toFixed(2) + "s";

    const sm = dd.speedMul;
    const c = {
      sp, hazard, node, sprite, img, alive: true, frozen: false, behavior,
      yaw: ((S.view.yaw + rand(-dd.spread, dd.spread)) % 360 + 360) % 360,
      pitch: clamp(rand(-dd.spread * 0.32, dd.spread * 0.32), -28, 28),
      vyaw: rand(-12, 12) * sm, vpitch: rand(-6, 6) * sm,
      camoPhase: Math.random() * 6.28, nextTeleport: performance.now() + rand(1800, 3200),
      fleeUntil: 0, aimSince: 0, blinkAt: performance.now() + rand(2000, 5000),
      points: hazard ? -25 : sp.points, sx: -999, sy: -999, dy: 999, dp: 999, visible: false,
    };
    el.playfield.appendChild(node); S.creatures.add(c);
    c.life = later(() => removeCreature(c, true), hazard ? 5200 : rand(7500, 11500));
  }
  function removeCreature(c, fade) {
    if (!c.alive) return; c.alive = false; clearTimeout(c.life); S.creatures.delete(c);
    if (fade) { c.node.style.transition = "opacity .25s,transform .25s"; c.node.style.opacity = "0"; later(() => c.node.remove(), 260); }
    else c.node.remove();
  }
  function clearCreatures() { S.creatures.forEach((c) => { clearTimeout(c.life); c.node.remove(); }); S.creatures.clear(); }

  // ---------- loop ----------
  function frame(now) {
    let dt = Math.min(0.05, (now - (S.lastFrame || now)) / 1000); S.lastFrame = now;
    if (S.running && !S.paused) {
      updateView(dt); updateFever(now, dt);
      updateCreatures(now, dt * S.timeScale); updateBall(now, dt); updateTraps(now); render(now);
    }
    S.rafId = requestAnimationFrame(frame);
  }
  function updateView(dt) {
    const v = S.view, k = Math.min(1, dt * 8);
    v.yaw = (v.yaw + angDiff(v.tYaw - v.yaw) * k + 360) % 360;
    v.pitch += (v.tPitch - v.pitch) * k;
  }
  function updateFever(now, dt) {
    if (S.feverMode) {
      const rem = (S.feverEndsAt - now) / (FEVER_SECONDS * 1000);
      S.fever = clamp(rem * FEVER_MAX, 0, FEVER_MAX);
      if (now >= S.feverEndsAt) endFever();
    } else if (S.fever > 0 && now - S.lastCatchAt > FEVER_GRACE_MS) {
      S.fever = Math.max(0, S.fever - FEVER_DECAY * dt);   // only drains once you stop catching
    }
    el.feverFill.style.width = (S.fever / FEVER_MAX * 100) + "%";
  }
  function updateCreatures(now, dt) {
    const v = S.view, dd = diff();
    S.creatures.forEach((c) => {
      if (!c.alive || c.frozen) return;
      let op = 1;
      if (c.behavior === "flee" && now > c.fleeUntil) c.vyaw *= (1 - Math.min(1, dt * 1.5));
      else if (c.behavior === "camo") { c.camoPhase += dt * 2.4; op = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(c.camoPhase)); }
      else if (c.behavior === "teleport" && now > c.nextTeleport && !c.hazard) {
        c.node.style.transition = "opacity .12s"; c.node.style.opacity = "0";
        const cc = c;
        later(() => { if (!cc.alive) return; cc.yaw = (v.yaw + rand(-90, 90) + 360) % 360; cc.pitch = rand(-26, 26); cc.node.style.opacity = "1"; later(() => { if (cc.alive) cc.node.style.transition = ""; }, 130); }, 120);
        c.nextTeleport = now + rand(1800, 3400);
      }
      c.yaw = (c.yaw + c.vyaw * dt + 360) % 360;
      c.pitch += c.vpitch * dt;
      if (c.pitch < -30) { c.pitch = -30; c.vpitch = Math.abs(c.vpitch); }
      if (c.pitch > 30) { c.pitch = 30; c.vpitch = -Math.abs(c.vpitch); }
      if (dd.aimLock && !c.hazard && Math.abs(c.dy) < 7 && Math.abs(c.dp) < 7) {
        if (!c.aimSince) c.aimSince = now; else if (now - c.aimSince > AIM_LOCK_FLEE_MS) { scare(c); c.aimSince = 0; }
      } else c.aimSince = 0;
      if (now > c.blinkAt) { if (!c.hazard) { c.img.src = c.sp.uriBlink; later(() => { if (c.alive) c.img.src = c.sp.uri; }, 130); } c.blinkAt = now + rand(2500, 6000); }
      c._op = op;
    });
  }
  function scare(c) {
    if (c.hazard || !c.alive) return;
    c.vyaw = (c.dy >= 0 ? 1 : -1) * rand(70, 110); c.vpitch = rand(-20, 20);
    c.fleeUntil = performance.now() + 800; if (c.behavior !== "teleport") c.behavior = "flee"; A.sfx.flee();
  }
  function project(c) {
    const dy = angDiff(c.yaw - S.view.yaw), dp = c.pitch - S.view.pitch;
    const halfH = HFOV / 2, halfV = (HFOV * (H / W)) / 2;
    c.dy = dy; c.dp = dp;
    c.sx = W / 2 + (dy / halfH) * (W / 2);
    c.sy = H / 2 - (dp / halfV) * (H / 2);
    c.visible = Math.abs(dy) <= halfH * 1.12 && Math.abs(dp) <= halfV * 1.3;
  }
  function render(now) {
    S.creatures.forEach((c) => {
      if (!c.alive) return;
      if (!c.frozen) project(c);
      if (c.visible || c.frozen) { c.node.style.display = ""; c.node.style.transform = `translate(${c.sx}px,${c.sy}px)`; if (c.behavior === "camo") c.node.style.opacity = (c._op ?? 1).toFixed(2); }
      else c.node.style.display = "none";
    });
    renderRadar();
    let tx = 0, ty = 0;
    if (now < S.shakeUntil) { const m = S.shakeMag * ((S.shakeUntil - now) / 260); tx = (Math.random() * 2 - 1) * m; ty = (Math.random() * 2 - 1) * m; }
    el.stage.style.transform = `translate(${tx}px,${ty}px)`;
  }
  function renderRadar() {
    el.radar.innerHTML = "";
    const off = [];
    S.creatures.forEach((c) => { if (c.alive && !c.frozen && !c.hazard && !c.visible) off.push(c); });
    off.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
    off.slice(0, 4).forEach((c) => {
      const a = document.createElement("div");
      a.className = "radar-arrow " + (c.sp.rarity === "legendary" ? "legendary" : (c.sp.rarity === "rare" ? "rare" : ""));
      const right = c.dy >= 0;
      a.style.left = (right ? W - 22 : 22) + "px";
      a.style.top = clamp(H / 2 - (c.dp / ((HFOV * (H / W)) / 2)) * (H / 2), 92, H - 110) + "px";
      a.textContent = right ? "▶" : "◀";
      el.radar.appendChild(a);
    });
  }

  // ---------- aim + throw ----------
  function arcPoint(x0, y0, x1, y1, t, arc) {
    const e = 1 - Math.pow(1 - t, 2);
    return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e - Math.sin(Math.PI * t) * (arc ?? 120)];
  }
  function drawAim(x, y) {
    el.aim.innerHTML = "";
    const x0 = W / 2, y0 = H - 46, arc = D.selectedWeapon().arc;
    for (let i = 1; i <= 7; i++) {
      const [px, py] = arcPoint(x0, y0, x, y, i / 8, arc);
      const d = document.createElement("div"); d.className = "aim-dot";
      d.style.left = px + "px"; d.style.top = py + "px"; d.style.opacity = (0.3 + i * 0.09).toFixed(2);
      el.aim.appendChild(d);
    }
    const ring = document.createElement("div"); ring.className = "aim-ring";
    ring.style.left = x + "px"; ring.style.top = y + "px"; el.aim.appendChild(ring);
  }
  function clearAim() { el.aim.innerHTML = ""; }

  function throwBall(x, y) {
    if (S.ballActive) return;
    const w = D.selectedWeapon();
    if (w.special === "hitscan") { shoot(x, y, w); return; }   // gun: instant
    S.ballActive = true; A.sfx.throw();
    const node = document.createElement("div"); node.className = "ball";
    const img = document.createElement("img"); img.src = w.uri;
    img.onerror = () => { img.src = D.BALL_URI; };
    node.appendChild(img);
    el.balllayer.appendChild(node);
    particles(W / 2, H - 46, w.trail || "#cfe0ff", 8);   // launch puff
    S.ball = { node, x0: W / 2, y0: H - 46, x1: x, y1: y, t: 0, dur: 0.55 / (w.speed || 1), lastTrail: 0, weapon: w };
  }
  // gun: no flight — muzzle flash, a tracer line, instant hit at the aim point
  function shoot(x, y, w) {
    S.ballActive = true; A.sfx.throw();
    particles(W / 2, H - 46, w.trail || "#ffe08a", 10);
    tracer(W / 2, H - 46, x, y, w.trail || "#ffe08a");
    const radius = diff().catchRadius * (w.radius || 1);
    impact(x, y, radius, w);
    resolveHit(x, y, w, radius);
    later(() => { if (!S.ball) S.ballActive = false; }, 240);
  }
  function tracer(x0, y0, x1, y1, color) {
    const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    const t = document.createElement("div"); t.className = "tracer";
    t.style.left = x0 + "px"; t.style.top = y0 + "px"; t.style.width = len + "px";
    t.style.transform = `rotate(${ang}deg)`; t.style.background = `linear-gradient(90deg, ${color}, transparent)`;
    el.fx.appendChild(t); later(() => t.remove(), 200);
  }
  function updateBall(now, dt) {
    const b = S.ball; if (!b) return;
    const w = b.weapon || {};
    b.t += dt / b.dur; const t = Math.min(1, b.t);
    const [cx, cy] = arcPoint(b.x0, b.y0, b.x1, b.y1, t, w.arc);
    const rot = t * (w.turns ?? 1.5) * 360 * (b.x1 < b.x0 ? -1 : 1);  // tumble toward throw direction
    b.node.style.transform = `translate(${cx}px,${cy}px) rotate(${rot}deg) scale(${1 - 0.4 * t})`;
    if (now - b.lastTrail > 13) { trail(cx, cy, w.trail); b.lastTrail = now; }
    if (t >= 1) resolveThrow(b);
  }
  function trail(x, y, color) {
    const d = document.createElement("div"); d.className = "ball-trail";
    d.style.left = x + "px"; d.style.top = y + "px";
    if (color) d.style.background = `radial-gradient(circle, ${color}, rgba(255,255,255,0))`;
    el.balllayer.appendChild(d); later(() => d.remove(), 450);
  }

  function resolveThrow(b) {
    b.node.remove(); S.ball = null;
    const wpn = b.weapon || { radius: 1 };
    const radius = diff().catchRadius * (wpn.radius || 1);
    impact(b.x1, b.y1, radius, wpn);   // weapon-specific hit effect + catch-area ring
    if (wpn.special === "deploy") { deployTrap(b.x1, b.y1, wpn, radius); S.ballActive = false; return; }
    resolveHit(b.x1, b.y1, wpn, radius);
  }
  function resolveHit(x, y, wpn, radius) {
    let best = null, bestD = radius;
    S.creatures.forEach((c) => { if (!c.alive || c.frozen || !c.visible) return; const d = Math.hypot(c.sx - x, c.sy - y); if (d < bestD) { bestD = d; best = c; } });
    if (best) {
      if (best.hazard) { hitHazard(best); S.ballActive = false; return; }
      catchSequence(best);
      if (wpn.special === "splash") {   // flare gun: also catch nearby
        const extra = [];
        S.creatures.forEach((c) => { if (c !== best && c.alive && !c.frozen && c.visible && !c.hazard && Math.hypot(c.sx - x, c.sy - y) < radius * 1.6) extra.push(c); });
        extra.slice(0, 3).forEach((c, i) => later(() => { if (c.alive && S.running) catchSequence(c); }, 150 * (i + 1)));
      }
    } else {
      A.sfx.miss(); S.ballActive = false;
      S.creatures.forEach((c) => { if (c.alive && !c.hazard && c.visible && Math.hypot(c.sx - x, c.sy - y) < 130) scare(c); });
    }
  }

  // ---------- deployed bear trap (stays in the world, auto-catches) ----------
  function screenToWorld(sx, sy) {
    const halfH = HFOV / 2, halfV = (HFOV * (H / W)) / 2;
    return { yaw: (S.view.yaw + (sx - W / 2) / (W / 2) * halfH + 360) % 360, pitch: S.view.pitch - (sy - H / 2) / (H / 2) * halfV };
  }
  function deployTrap(sx, sy, w, radius) {
    const wp = screenToWorld(sx, sy);
    const node = document.createElement("div"); node.className = "trap-deployed";
    const img = document.createElement("img"); img.src = w.uri; node.appendChild(img);
    el.playfield.appendChild(node);
    const tr = { yaw: wp.yaw, pitch: wp.pitch, node, life: later(() => removeTrap(tr), 7000), catches: 0, lastCatch: 0, sx, sy };
    S.traps.add(tr);
    A.sfx.wobble(); toast("🪤 מלכודת הוצבה — תופסת לבד!");
  }
  function removeTrap(tr) { if (tr.dead) return; tr.dead = true; clearTimeout(tr.life); S.traps.delete(tr); tr.node.style.opacity = "0"; later(() => tr.node.remove(), 250); }
  function updateTraps(now) {
    S.traps.forEach((tr) => {
      // project to screen
      const dy = angDiff(tr.yaw - S.view.yaw), dp = tr.pitch - S.view.pitch;
      const halfH = HFOV / 2, halfV = (HFOV * (H / W)) / 2;
      tr.sx = W / 2 + (dy / halfH) * (W / 2); tr.sy = H / 2 - (dp / halfV) * (H / 2);
      const vis = Math.abs(dy) <= halfH * 1.12 && Math.abs(dp) <= halfV * 1.3;
      tr.node.style.display = vis ? "" : "none";
      if (vis) tr.node.style.transform = `translate(${tr.sx}px, ${tr.sy}px)`;
      // auto-catch by world angle (works even when you look away)
      if (now - tr.lastCatch < 320) return;
      for (const c of S.creatures) {
        if (!c.alive || c.frozen || c.hazard) continue;
        if (Math.abs(angDiff(c.yaw - tr.yaw)) < 8 && Math.abs(c.pitch - tr.pitch) < 8) {
          tr.lastCatch = now; tr.catches++;
          c.frozen = true; clearTimeout(c.life);
          impact(tr.sx, tr.sy, 70, { fx: "snap" });
          finishCatch(c, tr.sx, tr.sy);
          if (tr.catches >= 4) removeTrap(tr);
          break;
        }
      }
    });
  }
  function clearTraps() { S.traps.forEach((tr) => { clearTimeout(tr.life); tr.node.remove(); }); S.traps.clear(); }
  function hitHazard(c) {
    const x = c.sx, y = c.sy; removeCreature(c, false);
    S.score = Math.max(0, S.score - 25); S.combo = 1; S.fever = Math.max(0, S.fever - 25); updateCombo();
    A.sfx.fine(); vibrate([60, 40, 60]); flash(); shake(16, 320);
    burst(x, y, "-25", "bad"); particles(x, y, "#ff4d5e", 14); refreshHud();
  }
  function catchSequence(c) {
    c.frozen = true; clearTimeout(c.life);
    const x = c.sx, y = c.sy; shake(6, 160); hitStop(70);
    const wb = document.createElement("div"); wb.className = "ball wobble";
    const im = document.createElement("img"); im.src = D.BALL_URI; wb.appendChild(im);
    wb.style.transform = `translate(${x}px,${y}px) scale(.85)`; el.balllayer.appendChild(wb);
    c.node.style.opacity = "0"; A.sfx.wobble(); later(() => A.sfx.wobble(), 250);
    later(() => { wb.remove(); finishCatch(c, x, y); S.ballActive = false; }, 600);
  }
  function finishCatch(c, x, y) {
    const sp = c.sp; removeCreature(c, false);
    const now = performance.now();
    S.combo = (now - S.lastCatchAt < COMBO_WINDOW_MS) ? Math.min(S.combo + 1, 9) : 1;
    S.lastCatchAt = now; S.bestCombo = Math.max(S.bestCombo, S.combo);

    const mult = (S.feverMode ? 2 : 1);
    const gained = sp.points * S.combo * mult;
    S.score += gained; S.caught += 1;
    S.coinsRun += Math.max(1, Math.round(sp.points / 5)) * mult;
    S.xpRun += sp.points;

    if (D.discover(sp.id)) { S.newNames.push(sp.name); S.score += 25; S.coinsRun += 10; toast(`✨ מין חדש: ${sp.name}!  +25`); }
    bumpMission(sp);
    addFever(sp);

    const tier = sp.rarity;
    if (tier === "legendary") { A.sfx.legend(); vibrate([30, 40, 30, 40, 80]); shake(14, 300); particles(x, y, "#ffc82d", 22); }
    else if (tier === "rare") { A.sfx.rare(); vibrate(40); shake(8, 220); particles(x, y, "#bcd8ff", 16); }
    else { A.sfx.catch(); vibrate(22); particles(x, y, "#7fc0ff", 12); }
    burst(x, y - 8, `+${gained}`, tier === "common" ? "good" : "gold");
    if (S.combo >= 3) burst(x, y - 44, `קומבו x${S.combo}!`, "gold");

    updateCombo(); addLevelProgress(gained); refreshHud();
  }

  function addFever(sp) {
    if (S.feverMode) return;
    const base = sp.rarity === "legendary" ? 40 : sp.rarity === "rare" ? 28 : sp.rarity === "uncommon" ? 22 : 18;
    S.fever = Math.min(FEVER_MAX, S.fever + base + S.combo * 2);  // streaks fill it faster
    if (S.fever >= FEVER_MAX) startFever();
  }
  function startFever() {
    S.feverMode = true; S.feverEndsAt = performance.now() + FEVER_SECONDS * 1000;
    document.body.classList.add("fever"); A.sfx.levelup(); vibrate([40, 30, 40, 30, 80]); shake(12, 400);
    toast("🔥 PANGO FEVER!  ניקוד כפול!");
    restartSpawn();
    // quick burst of spawns
    for (let i = 0; i < 4; i++) later(spawn, i * 120);
  }
  function endFever() { S.feverMode = false; S.fever = 0; document.body.classList.remove("fever"); restartSpawn(); }

  function bumpMission(sp) {
    const m = D.mission(); if (m.done) return;
    if (m.kind === "any") m.progress++;
    else if (m.kind === "rare" && (sp.rarity === "rare" || sp.rarity === "legendary")) m.progress++;
    else if (m.kind === "combo") m.progress = Math.max(m.progress, S.combo);
    else if (m.kind === "score") m.progress = S.score;
    D.saveMission(m);
  }
  function addLevelProgress(amount) {
    S.levelProgress += amount;
    while (S.levelProgress >= 130) {
      S.levelProgress -= 130; S.level++; A.sfx.levelup(); vibrate([30, 30, 30]);
      restartSpawn(); toast(`🚀 שלב ${S.level}`);
    }
  }
  function restartSpawn() { clearInterval(S.spawnTimer); S.spawnTimer = setInterval(spawn, S.feverMode ? Math.max(280, diff().spawnMs * 0.5) : diff().spawnMs); }

  // ---------- juice ----------
  function shake(m, d) { S.shakeMag = m; S.shakeUntil = performance.now() + d; }
  function hitStop(ms) { S.timeScale = 0; later(() => { S.timeScale = 1; }, ms); }
  function flash() { const f = document.createElement("div"); f.className = "flash"; el.fx.appendChild(f); later(() => f.remove(), 420); }
  function ringFx(x, y, r) {
    const e = document.createElement("div"); e.className = "impact";
    e.style.left = x + "px"; e.style.top = y + "px"; e.style.width = e.style.height = (2 * r) + "px";
    el.fx.appendChild(e); later(() => e.remove(), 450);
  }
  function disc(x, y, size, grad) {
    const e = document.createElement("div"); e.className = "boom";
    e.style.left = x + "px"; e.style.top = y + "px"; e.style.width = e.style.height = size + "px"; e.style.background = grad;
    el.fx.appendChild(e); later(() => e.remove(), 440);
  }
  function smoke(x, y, size) {
    const e = document.createElement("div"); e.className = "smoke";
    e.style.left = x + "px"; e.style.top = y + "px"; e.style.width = e.style.height = size + "px";
    el.fx.appendChild(e); later(() => e.remove(), 650);
  }
  // Each weapon hits with its own signature effect.
  function impact(x, y, r, w) {
    const fx = (w && w.fx) || "pop";
    ringFx(x, y, r);
    if (fx === "boom") { disc(x, y, 2.4 * r, "radial-gradient(circle,#fff 0%,#ffd86b 30%,rgba(255,110,30,.78) 60%,transparent 78%)"); particles(x, y, "#ffae42", 22); particles(x, y, "#ffd23f", 10); shake(13, 340); }
    else if (fx === "spark") { disc(x, y, 1.1 * r, "radial-gradient(circle,#fff 0%,#fff3b0 40%,transparent 70%)"); particles(x, y, "#fff7c0", 16); particles(x, y, "#ffd23f", 8); shake(5, 130); }
    else if (fx === "smoke") { disc(x, y, 1.0 * r, "radial-gradient(circle,#fff 0%,#ffe08a 35%,transparent 70%)"); smoke(x, y, 1.7 * r); particles(x, y, "#cfd3d9", 8); shake(7, 170); }
    else if (fx === "fire") { disc(x, y, 1.5 * r, "radial-gradient(circle,#fff 0%,#ffb24a 40%,rgba(255,80,20,.6) 65%,transparent 80%)"); particles(x, y, "#ff7a2a", 16); particles(x, y, "#ffd23f", 8); shake(7, 200); }
    else if (fx === "debris") { disc(x, y, 1.3 * r, "radial-gradient(circle,#fff 0%,#ffe9c0 40%,transparent 72%)"); particles(x, y, "#d8b88a", 14); particles(x, y, "#ffffff", 6); shake(9, 210); }
    else if (fx === "snap") { disc(x, y, 1.2 * r, "radial-gradient(circle,#fff 0%,#cdd3dd 45%,transparent 72%)"); particles(x, y, "#c9ced8", 16); shake(10, 240); }
    else { disc(x, y, 1.5 * r, "radial-gradient(circle,#fff 0%,#ffe08a 40%,rgba(255,150,40,.5) 65%,transparent 78%)"); particles(x, y, "#ffffff", 12); shake(5, 150); }
  }
  function burst(x, y, t, cls) { const b = document.createElement("div"); b.className = "burst " + cls; b.style.left = x + "px"; b.style.top = y + "px"; b.textContent = t; el.fx.appendChild(b); later(() => b.remove(), 900); }
  function particles(x, y, color, n) {
    for (let i = 0; i < n; i++) { const p = document.createElement("div"); p.className = "particle"; p.style.left = x + "px"; p.style.top = y + "px"; p.style.background = color;
      const a = Math.random() * 6.28, d = 40 + Math.random() * 70; p.style.setProperty("--dx", Math.cos(a) * d + "px"); p.style.setProperty("--dy", Math.sin(a) * d + "px"); el.fx.appendChild(p); later(() => p.remove(), 650); }
  }
  let toastT = null;
  function toast(text) { el.toast.textContent = text; show(el.toast); requestAnimationFrame(() => el.toast.classList.add("show")); clearTimeout(toastT); toastT = setTimeout(() => { el.toast.classList.remove("show"); setTimeout(() => hide(el.toast), 300); }, 2200); }

  // ---------- HUD ----------
  function refreshWeaponBtn() { el.weaponImg.src = D.selectedWeapon().uri; }
  function cycleWeapon() {
    const owned = D.WEAPONS.filter((w) => D.ownsWeapon(w.id));
    if (owned.length < 2) { toast("פתח עוד נשקים בבית 🏠"); return; }
    const cur = D.selectedWeapon().id;
    const i = owned.findIndex((w) => w.id === cur);
    const next = owned[(i + 1) % owned.length];
    D.selectWeapon(next.id); refreshWeaponBtn(); A.sfx.blip(); toast("נשק: " + next.name);
  }
  function refreshHud() { el.score.textContent = S.score; el.timer.textContent = S.timeLeft; }
  function updateCombo() {
    el.combo.textContent = "x" + S.combo;
    el.comboPill.classList.toggle("hidden", S.combo < 2);
    el.comboPill.classList.add("bump"); later(() => el.comboPill.classList.remove("bump"), 160);
  }

  // ---------- input ----------
  function bindInput() {
    addEventListener("pointerdown", (e) => {
      if (!S.running || S.paused) return;
      const t = e.target;
      if (t && t.closest && t.closest(".hud,.weapon-btn,.fever,.overlay")) return; // taps on UI aren't throws
      S.pointer = { sx: e.clientX, sy: e.clientY, moved: 0, look: false };
      drawAim(e.clientX, e.clientY);   // always preview the throw arc on press
    });
    addEventListener("pointermove", (e) => {
      const p = S.pointer; if (!p || !S.running || S.paused) return;
      p.moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (!S.view.hasGyro && p.moved > 12) {
        p.look = true; clearAim();
        S.view.tYaw = (S.view.tYaw - (e.clientX - p.sx) * 0.18 + 360) % 360;
        S.view.tPitch = clamp(S.view.tPitch + (e.clientY - p.sy) * 0.16, -45, 45);
        p.sx = e.clientX; p.sy = e.clientY;
      } else if (S.view.hasGyro || p.moved <= 12) {
        drawAim(e.clientX, e.clientY);
      }
    });
    addEventListener("pointerup", (e) => {
      const p = S.pointer; S.pointer = null; clearAim();
      if (!p || !S.running || S.paused) return;
      if (p.look) return;
      if (!S.view.hasGyro && p.moved > 12) return;
      throwBall(e.clientX, e.clientY);
    });
  }

  // ---------- flow ----------
  function startGame() {
    A.init(); if (D.settings().sound) A.startMusic();
    Object.assign(S, { running: true, paused: false, score: 0, caught: 0, combo: 1, bestCombo: 1, level: 1, levelProgress: 0,
      timeLeft: ROUND_SECONDS, lastCatchAt: 0, coinsRun: 0, xpRun: 0, newNames: [], fever: 0, feverMode: false, timeScale: 1, ballActive: false, ball: null });
    clearCreatures(); clearTraps(); clearLaters();
    [el.balllayer, el.fx, el.radar, el.aim].forEach((n) => n.innerHTML = "");
    document.body.classList.remove("fever");
    document.body.classList.add("playing");
    [el.homeScreen, el.endScreen].forEach(hide);
    [el.hud, el.fever, el.weaponBtn].forEach(show);
    el.comboPill.classList.add("hidden");
    refreshWeaponBtn();
    refreshHud(); el.feverFill.style.width = "0%";
    if (!S.rafId) { S.lastFrame = performance.now(); S.rafId = requestAnimationFrame(frame); }
    countdown(() => { restartSpawn(); S.tickTimer = setInterval(tick, 1000); toast("🧭 הזז את הטלפון כדי לחפש"); });
    clearInterval(S.camKeep); S.camKeep = setInterval(resumeCamera, 1000);
  }
  function tick() { if (S.paused) return; S.timeLeft--; refreshHud(); if (S.timeLeft <= 5 && S.timeLeft > 0) A.sfx.count(true); if (S.timeLeft <= 0) endGame(); }

  function endGame() {
    S.running = false; clearInterval(S.spawnTimer); clearInterval(S.tickTimer); clearInterval(S.camKeep); clearCreatures(); clearTraps(); clearLaters();
    el.balllayer.innerHTML = ""; el.aim.innerHTML = "";
    document.body.classList.remove("playing", "fever");
    [el.hud, el.fever, el.weaponBtn].forEach(hide); el.stage.style.transform = "";
    A.stopMusic(); A.sfx.end();

    const prof = D.profile(); const lvlBefore = D.levelFromXp(prof.xp);
    prof.xp += S.xpRun; prof.coins += S.coinsRun; prof.totalCaught += S.caught;
    const lvlAfter = D.levelFromXp(prof.xp);
    const m = D.mission(); let missionJustDone = false;
    if (!m.done && m.progress >= m.target) { m.done = true; prof.coins += m.reward; D.saveMission(m); missionJustDone = true; }
    D.saveProfile(prof);

    const best = D.bestScore(); const record = S.score > best && S.score > 0;
    el.finalScore.textContent = S.score;
    el.endEmoji.textContent = record ? "🏆" : (S.score > 0 ? "🎉" : "🙂");
    el.eCaught.textContent = S.caught; el.eCombo.textContent = "x" + S.bestCombo; el.eCoins.textContent = S.coinsRun;
    el.newRecord.classList.toggle("hidden", !record);
    if (record) vibrate([40, 40, 40, 40, 120]);
    el.newSpecies.classList.toggle("hidden", S.newNames.length === 0);
    if (S.newNames.length) el.newSpecies.textContent = "🆕 מינים חדשים: " + S.newNames.join(", ");
    el.missionDone.classList.toggle("hidden", !missionJustDone);

    const saved = localStorage.getItem("pangogo.name"); if (saved) el.playerName.value = saved;
    show(el.nameRow); renderTop3();
    show(el.endScreen);
    if (lvlAfter > lvlBefore) later(() => toast(`⭐ עלית לשלב שחקן ${lvlAfter}!`), 700);
  }

  function countdown(done) {
    const cd = document.createElement("div"); cd.className = "countdown"; document.body.appendChild(cd);
    const steps = ["3", "2", "1", "צא!"]; let i = 0;
    (function step() { if (i >= steps.length) { cd.remove(); done(); return; } cd.innerHTML = `<span>${steps[i]}</span>`; A.sfx.count(i >= 3); i++; setTimeout(step, 700); })();
  }
  function togglePause() {
    if (!S.running) return; S.paused = !S.paused; el.pauseBtn.textContent = S.paused ? "▶" : "⏸";
    if (S.paused) { clearInterval(S.spawnTimer); A.stopMusic(); toast("הופסק ⏸"); } else { restartSpawn(); if (D.settings().sound) A.startMusic(); }
  }

  // ---------- home / end rendering ----------
  function renderDexStrip() {
    const dex = D.dex(); el.dexStrip.innerHTML = "";
    D.SPECIES.forEach((sp) => {
      const got = dex[sp.id];
      const cell = document.createElement("div"); cell.className = "dex-mini" + (got ? "" : " locked");
      cell.innerHTML = `<img src="${sp.uri}" alt="">${got ? `<b>${got.count}</b>` : ""}`;
      el.dexStrip.appendChild(cell);
    });
  }
  function renderTop3() {
    const list = D.board().slice(0, 3); el.top3.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    if (!list.length) { el.top3.innerHTML = `<li><span class="n" style="text-align:center">היה הראשון בלוח! 🚀</span></li>`; return; }
    list.forEach((e, i) => { const li = document.createElement("li"); li.innerHTML = `<span class="r">${medals[i]}</span><span class="n">${esc(e.name)}</span><span class="p">${e.score}</span>`; el.top3.appendChild(li); });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function renderWeaponBar() {
    const bar = el.weapBar; if (!bar) return;
    const sel = D.selectedWeapon().id;
    bar.innerHTML = "";
    D.WEAPONS.forEach((w) => {
      const owned = D.ownsWeapon(w.id);
      const chip = document.createElement("button");
      chip.className = "weap" + (w.id === sel ? " sel" : "") + (owned ? "" : " locked");
      chip.innerHTML = `<img src="${w.uri}" alt=""><span class="weap-name">${w.name}</span>` +
        (owned ? "" : `<span class="weap-cost">🪙${w.cost}</span>`);
      chip.addEventListener("click", () => {
        if (D.ownsWeapon(w.id)) { D.selectWeapon(w.id); A.sfx.blip(); renderWeaponBar(); }
        else {
          const r = D.buyWeapon(w.id);
          if (r === "bought") { A.sfx.coin(); toast(`נפתח: ${w.name}! 🗡️`); refreshHome(); }
          else if (r === "poor") { A.sfx.miss(); toast(`חסרים מטבעות (${w.cost}🪙) — תפוס עוד!`); }
        }
      });
      bar.appendChild(chip);
    });
  }

  function refreshHome() {
    const p = D.profile();
    renderWeaponBar();
    el.homeMascot.src = D.SPECIES[0].uri;
    el.homeBest.textContent = D.bestScore();
    el.homeLevel.textContent = D.levelFromXp(p.xp);
    el.homeCoins.textContent = p.coins;
    const m = D.mission();
    el.missionText.textContent = m.text + (m.done ? " ✅" : ` (${Math.min(m.progress, m.target)}/${m.target})`);
    el.missionReward.textContent = "+" + m.reward;
    renderDexStrip();
  }

  // ---------- wire up ----------
  function goHome() { hide(el.endScreen); refreshHome(); show(el.homeScreen); }

  function bind() {
    bindInput();
    el.playBtn.addEventListener("click", () => { A.init(); startCamera(); startGyro(); startGame(); });
    el.againBtn.addEventListener("click", () => { A.init(); startGame(); });
    el.homeBtn.addEventListener("click", goHome);
    el.pauseBtn.addEventListener("click", togglePause);
    el.weaponBtn.addEventListener("click", cycleWeapon);
    el.saveScoreBtn.addEventListener("click", () => {
      const name = el.playerName.value.trim() || "אנונימי";
      localStorage.setItem("pangogo.name", name); D.addScore(name, S.score);
      hide(el.nameRow); renderTop3();
    });
    el.soundBtn.addEventListener("click", () => {
      const s = D.settings(); s.sound = !s.sound; D.saveSettings(s); A.toggle(s.sound);
      el.soundBtn.textContent = s.sound ? "🔊" : "🔇";
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden && S.running && !S.paused) togglePause(); else if (!document.hidden) resumeCamera(); });
    addEventListener("resize", () => { W = innerWidth; H = innerHeight; });
    el.soundBtn.textContent = D.settings().sound ? "🔊" : "🔇";
    refreshHome();
  }

  if ("serviceWorker" in navigator) {
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller; // only reload on real UPDATES, not first install
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (refreshing || !hadController || S.running) return; refreshing = true; location.reload(); });
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  bind();
})();
