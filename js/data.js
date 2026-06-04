/* ===========================================================
   Pango GO — data: species, generated vector art, persistence
   =========================================================== */
window.PANGO = window.PANGO || {};

PANGO.Data = (() => {
  // ---- species (each is a recoloured Pango mascot) ----
  // Cohesive Pango palette: shades of blue + a white one, gold as the legendary.
  const SPECIES = [
    { id: "azure", name: "פַּנְגּוֹ",  rarity: "common",    points: 10, weight: 44, body: ["#2f86ff", "#1f6dff"], belly: "#bcd8ff", stripe: "#1f6dff" },
    { id: "sky",   name: "תְּכֵלֶת",  rarity: "common",    points: 10, weight: 30, body: ["#7fc0ff", "#3f97ff"], belly: "#e3f1ff", stripe: "#5fa8ff" },
    { id: "teal",  name: "טוּרְקִיז", rarity: "uncommon",  points: 15, weight: 14, body: ["#34d6c8", "#12a99c"], belly: "#b6f0ea", stripe: "#1fc4b6" },
    { id: "royal", name: "מַלְכוּתִי", rarity: "uncommon",  points: 15, weight: 12, body: ["#5b6bff", "#2f3fe0"], belly: "#c8ccff", stripe: "#4452f0" },
    { id: "snow",  name: "שַׁלְגִּי",  rarity: "rare",      points: 25, weight: 7,  body: ["#ffffff", "#dbe7ff"], belly: "#f2f7ff", stripe: "#1f6dff" },
    { id: "golden",name: "הַזָּהָב",  rarity: "legendary", points: 50, weight: 3,  body: ["#ffd86b", "#f2a900"], belly: "#ffe9a8", stripe: "#ffc32b" },
  ];
  let byId = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

  // Build a Pango mascot SVG with the given palette → data URI.
  function svg(sp, { blink = false } = {}) {
    const [c1, c2] = sp.body;
    const eye = blink
      ? `<line x1="42" y1="58" x2="52" y2="58" stroke="#0B1B3A" stroke-width="4.5" stroke-linecap="round"/>
         <line x1="66" y1="58" x2="76" y2="58" stroke="#0B1B3A" stroke-width="4.5" stroke-linecap="round"/>`
      : `<circle cx="47" cy="58" r="5" fill="#0B1B3A"/><circle cx="71" cy="58" r="5" fill="#0B1B3A"/>
         <circle cx="48.5" cy="56" r="1.6" fill="#fff"/><circle cx="72.5" cy="56" r="1.6" fill="#fff"/>`;
    const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 144">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<radialGradient id="sh" cx="0.5" cy="0.35" r="0.7">
<stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="60" cy="138" rx="34" ry="6" fill="#000" opacity="0.18"/>
<path d="M82 46 q24 -22 32 -3 q4 13 -16 19 q-13 4 -20 -5 z" fill="url(#g)"/>
<ellipse cx="42" cy="132" rx="13" ry="8" fill="${c2}"/><ellipse cx="74" cy="132" rx="13" ry="8" fill="${c2}"/>
<ellipse cx="58" cy="78" rx="42" ry="56" fill="url(#g)"/>
<ellipse cx="58" cy="60" rx="40" ry="40" fill="url(#sh)"/>
<ellipse cx="58" cy="94" rx="26" ry="34" fill="${sp.belly}" opacity="0.55"/>
<ellipse cx="20" cy="88" rx="10" ry="15" fill="${c2}" transform="rotate(-16 20 88)"/>
${eye}
<circle cx="40" cy="70" r="5" fill="${sp.belly}" opacity="0.8"/><circle cx="78" cy="70" r="5" fill="${sp.belly}" opacity="0.8"/>
<path d="M46 70 q13 13 26 0" stroke="#0B1B3A" stroke-width="4.5" fill="none" stroke-linecap="round"/>
<path d="M30 104 q28 13 56 0 l-2 13 q-26 11 -52 0 z" fill="#fff"/>
<path d="M41 108 l-3 11 M53 111 l-1 11 M66 111 l1 11 M78 108 l3 11" stroke="${sp.stripe}" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;
    return "data:image/svg+xml," + encodeURIComponent(s);
  }

  // pre-render normal + blink for each built-in (fallback) species
  SPECIES.forEach((sp) => { sp.uri = svg(sp); sp.uriBlink = svg(sp, { blink: true }); });

  // If real sprite art was provided (assets/sprites + assets/sprites/sprites.js),
  // use those PNG characters instead of the built-in vector mascots.
  let SPECIES_ACTIVE = SPECIES;
  if (Array.isArray(window.PANGO_SPRITES) && window.PANGO_SPRITES.length) {
    const monsters = window.PANGO_SPRITES.map((s) => ({
      id: s.id, name: s.name, rarity: s.rarity, points: s.points, weight: s.weight,
      uri: "assets/sprites/" + s.file, uriBlink: "assets/sprites/" + s.file,
    }));
    // keep the blue Pango mascot (the brand character) as the signature creature
    const pango = SPECIES.find((s) => s.id === "azure");
    SPECIES_ACTIVE = [pango, ...monsters];
    byId = Object.fromEntries(SPECIES_ACTIVE.map((s) => [s.id, s]));
  }

  // the "fine" hazard + the throwing ball as data URIs
  const FINE_URI = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="44" fill="#FF4D5E" stroke="#C32436" stroke-width="5"/>
<circle cx="50" cy="50" r="34" fill="#fff"/>
<text x="50" y="69" font-size="50" font-weight="900" text-anchor="middle" fill="#FF4D5E" font-family="Arial">P</text>
<line x1="22" y1="22" x2="78" y2="78" stroke="#FF4D5E" stroke-width="9" stroke-linecap="round"/></svg>`);

  // Big, clear Pango catch-ball: bright blue top, white bottom, bold band, "P" button.
  const BALL_URI = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f97ff"/><stop offset="1" stop-color="#1f6dff"/></linearGradient>
<linearGradient id="bm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6efff"/></linearGradient></defs>
<circle cx="50" cy="50" r="47" fill="url(#bm)" stroke="#103a8e" stroke-width="3"/>
<path d="M3 50 a47 47 0 0 1 94 0 z" fill="url(#t)"/>
<rect x="3" y="45" width="94" height="10" fill="#103a8e"/>
<circle cx="50" cy="50" r="16" fill="#fff" stroke="#103a8e" stroke-width="5"/>
<text x="50" y="59" font-size="20" font-weight="900" text-anchor="middle" fill="#1f6dff" font-family="Arial">P</text>
<ellipse cx="34" cy="26" rx="13" ry="7" fill="#fff" opacity="0.55" transform="rotate(-25 34 26)"/></svg>`);

  // ---- weapons (what you throw to catch) ----
  // ball is the default Pango ball (SVG); the rest are rendered from the pack.
  // radius = catch-radius multiplier, speed = flight-speed multiplier.
  const WEAPONS = [
    { id: "ball",     name: "כדור פנגו",     uri: BALL_URI,            radius: 1.0,  speed: 1.0,  cost: 0,    arc: 120, turns: 1.5, trail: "#cfe0ff", fx: "pop" },
    { id: "pan",      name: "מחבת",          file: "Pan.png",          radius: 1.45, speed: 1.0,  cost: 0,    arc: 120, turns: 2,   trail: "#e9eefc", fx: "pop" },
    { id: "axe",      name: "גרזן",          file: "Axe.png",          radius: 1.2,  speed: 1.05, cost: 80,   arc: 165, turns: 3,   trail: "#dfe7ff", fx: "debris" },
    { id: "knife",    name: "סכין",          file: "Knife.png",        radius: 0.9,  speed: 1.45, cost: 80,   arc: 80,  turns: 4,   trail: "#eaf0ff", fx: "spark" },
    { id: "shovel",   name: "את חפירה",      file: "Shovel.png",       radius: 1.3,  speed: 0.95, cost: 120,  arc: 165, turns: 2.5, trail: "#e2c9a8", fx: "debris" },
    { id: "torch",    name: "לפיד",          file: "Torch.png",        radius: 1.15, speed: 1.1,  cost: 150,  arc: 120, turns: 2,   trail: "#ff9f45", fx: "fire" },
    { id: "revolver", name: "אקדח",          file: "Revolver_1.png",   radius: 1.0,  speed: 1.7,  cost: 200,  arc: 45,  turns: 0.4, trail: "#ffe08a", fx: "smoke", special: "hitscan" },
    { id: "flare",    name: "רובה זיקוקים",  file: "FlareGun.png",     radius: 1.35, speed: 1.2,  cost: 350,  arc: 60,  turns: 0.6, trail: "#ff7a2a", special: "splash", fx: "boom" },
    { id: "trap",     name: "מלכודת דובים",  file: "BearTrap_Open.png", radius: 1.6, speed: 0.85, cost: 400,  arc: 150, turns: 1.2, trail: "#c9ced8", fx: "snap", special: "deploy" },
  ].map((w) => ({ ...w, uri: w.uri || ("assets/weapons/" + w.file) }));
  const weaponById = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

  // ---- persistence ----
  const K = {
    profile: "pangogo.profile.v1",
    dex: "pangogo.dex.v1",
    board: "pangogo.leaderboard.v1",
    mission: "pangogo.mission.v1",
    settings: "pangogo.settings.v1",
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function profile() {
    const p = load(K.profile, {});
    p.xp = p.xp || 0; p.coins = p.coins || 0; p.totalCaught = p.totalCaught || 0;
    p.owned = p.owned || ["ball", "pan"];
    p.weapon = p.weapon && p.owned.includes(p.weapon) ? p.weapon : "ball";
    return p;
  }
  function saveProfile(p) { save(K.profile, p); }

  // one-time welcome gift so players can try a weapon or two right away
  (function welcomeGift() {
    const p = profile();
    if (!p.gift) { p.gift = true; p.coins = (p.coins || 0) + 800; saveProfile(p); }
  })();

  function selectedWeapon() { return weaponById[profile().weapon] || WEAPONS[0]; }
  function ownsWeapon(id) { return profile().owned.includes(id); }
  function selectWeapon(id) { const p = profile(); if (p.owned.includes(id)) { p.weapon = id; saveProfile(p); return true; } return false; }
  function buyWeapon(id) {
    const p = profile(), w = weaponById[id];
    if (!w || p.owned.includes(id)) return "owned";
    if (p.coins < w.cost) return "poor";
    p.coins -= w.cost; p.owned.push(id); p.weapon = id; saveProfile(p); return "bought";
  }
  function levelFromXp(xp) { return Math.floor(Math.sqrt(xp / 60)) + 1; }
  function xpForLevel(lvl) { return Math.pow(lvl - 1, 2) * 60; }

  function dex() { return load(K.dex, {}); } // { speciesId: {count, first} }
  function discover(id) {
    const d = dex();
    if (!d[id]) d[id] = { count: 0, first: Date.now() };
    d[id].count++;
    save(K.dex, d);
    return d[id].count === 1; // newly discovered?
  }

  function board() { return load(K.board, []); }
  function addScore(name, score) {
    const b = board();
    const stamp = Date.now();
    b.push({ name: name || "אנונימי", score, date: stamp });
    b.sort((a, z) => z.score - a.score);
    save(K.board, b.slice(0, 10));
    return stamp;
  }
  function bestScore() { const b = board(); return b.length ? b[0].score : 0; }
  function clearBoard() { localStorage.removeItem(K.board); }

  // ---- daily mission ----
  const MISSIONS = [
    { id: "catch20", text: "תפוס 20 דמויות", target: 20, reward: 60, kind: "any" },
    { id: "combo5",  text: "הגע לקומבו x5",  target: 5,  reward: 80, kind: "combo" },
    { id: "rare2",   text: "תפוס 2 דמויות נדירות", target: 2, reward: 120, kind: "rare" },
    { id: "score300",text: "צבור 300 נקודות בסבב", target: 300, reward: 100, kind: "score" },
  ];
  function today() { return new Date().toISOString().slice(0, 10); }
  function mission() {
    let m = load(K.mission, null);
    if (!m || m.day !== today()) {
      const pick = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
      m = { day: today(), ...pick, progress: 0, done: false };
      save(K.mission, m);
    }
    return m;
  }
  function saveMission(m) { save(K.mission, m); }

  function settings() { return load(K.settings, { sound: true }); }
  function saveSettings(s) { save(K.settings, s); }

  return {
    SPECIES: SPECIES_ACTIVE, byId, FINE_URI, BALL_URI,
    WEAPONS, selectedWeapon, ownsWeapon, selectWeapon, buyWeapon,
    profile, saveProfile, levelFromXp, xpForLevel,
    dex, discover,
    board, addScore, bestScore, clearBoard,
    mission, saveMission,
    settings, saveSettings,
  };
})();
