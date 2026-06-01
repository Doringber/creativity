/* ===========================================================
   Pango GO — data: species, generated vector art, persistence
   =========================================================== */
window.PANGO = window.PANGO || {};

PANGO.Data = (() => {
  // ---- species (each is a recoloured Pango mascot) ----
  const SPECIES = [
    { id: "azure",  name: "אזורי",  rarity: "common",    points: 10, weight: 42, body: ["#4485FF", "#1E54E0"], belly: "#7CA8FF", stripe: "#3D7BFF" },
    { id: "leaf",   name: "עלוני",  rarity: "common",    points: 10, weight: 30, body: ["#46D17F", "#1FA85A"], belly: "#9BE9BE", stripe: "#2EBF6E" },
    { id: "sunset", name: "שקיעי",  rarity: "uncommon",  points: 15, weight: 16, body: ["#FF9F45", "#F2691C"], belly: "#FFC58A", stripe: "#FF8A2A" },
    { id: "berry",  name: "גרגרי",  rarity: "uncommon",  points: 15, weight: 14, body: ["#A06BFF", "#6E36E0"], belly: "#C9A8FF", stripe: "#8A52F0" },
    { id: "bubble", name: "בועי",   rarity: "rare",      points: 25, weight: 7,  body: ["#FF6FB5", "#E0368A"], belly: "#FFB0D6", stripe: "#FF52A0" },
    { id: "golden", name: "הזהב",   rarity: "legendary", points: 50, weight: 3,  body: ["#FFD86B", "#F2A900"], belly: "#FFE9A8", stripe: "#FFC32B" },
  ];
  const byId = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

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

  // pre-render normal + blink for each species
  SPECIES.forEach((sp) => { sp.uri = svg(sp); sp.uriBlink = svg(sp, { blink: true }); });

  // the "fine" hazard + the throwing ball as data URIs
  const FINE_URI = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="44" fill="#FF4D5E" stroke="#C32436" stroke-width="5"/>
<circle cx="50" cy="50" r="34" fill="#fff"/>
<text x="50" y="69" font-size="50" font-weight="900" text-anchor="middle" fill="#FF4D5E" font-family="Arial">P</text>
<line x1="22" y1="22" x2="78" y2="78" stroke="#FF4D5E" stroke-width="9" stroke-linecap="round"/></svg>`);

  const BALL_URI = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4485FF"/><stop offset="1" stop-color="#1E54E0"/></linearGradient></defs>
<circle cx="50" cy="50" r="46" fill="#fff" stroke="#0B1B3A" stroke-width="4"/>
<path d="M4 50 a46 46 0 0 1 92 0 z" fill="url(#t)"/>
<rect x="4" y="46" width="92" height="8" fill="#0B1B3A"/>
<circle cx="50" cy="50" r="13" fill="#fff" stroke="#0B1B3A" stroke-width="5"/>
<circle cx="50" cy="50" r="5" fill="#cfe0ff"/>
<ellipse cx="36" cy="28" rx="10" ry="6" fill="#fff" opacity="0.5" transform="rotate(-25 36 28)"/></svg>`);

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

  function profile() { return load(K.profile, { xp: 0, coins: 0, totalCaught: 0 }); }
  function saveProfile(p) { save(K.profile, p); }
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
    SPECIES, byId, FINE_URI, BALL_URI,
    profile, saveProfile, levelFromXp, xpForLevel,
    dex, discover,
    board, addScore, bestScore, clearBoard,
    mission, saveMission,
    settings, saveSettings,
  };
})();
