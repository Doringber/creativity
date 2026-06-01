/* ===========================================================
   Pango GO — audio engine
   Procedural SFX + a light ambient music loop. Zero asset files.
   =========================================================== */
window.PANGO = window.PANGO || {};

PANGO.Audio = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicTimer = null;
  let enabled = true;

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
  }

  function tone(freq, dur, type = "sine", gain = 0.18, when = 0, dest = master) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, gain = 0.15, when = 0) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1200;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const sfx = {
    throw:  () => { noise(0.18, 0.10); tone(300, 0.18, "sine", 0.10); },
    wobble: () => { tone(420, 0.08, "square", 0.10); tone(360, 0.08, "square", 0.08, 0.12); },
    catch:  () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.14, "triangle", 0.16, i * 0.06)); },
    coin:   () => { tone(880, 0.06, "square", 0.12); tone(1320, 0.09, "square", 0.10, 0.05); },
    rare:   () => { [659, 784, 988, 1318, 1568].forEach((f, i) => tone(f, 0.16, "triangle", 0.16, i * 0.07)); },
    legend: () => { [523,659,784,1046,1318,1568,2093].forEach((f,i)=>tone(f,0.2,"sawtooth",0.13,i*0.08)); },
    miss:   () => { noise(0.12, 0.07); tone(180, 0.12, "sine", 0.07); },
    fine:   () => { tone(150, 0.32, "sawtooth", 0.22); tone(120, 0.32, "sawtooth", 0.18, 0.02); },
    flee:   () => { tone(520, 0.05, "sine", 0.07); tone(680, 0.05, "sine", 0.06, 0.05); },
    levelup:() => { [659, 880, 1175, 1568].forEach((f, i) => tone(f, 0.16, "sawtooth", 0.14, i * 0.09)); },
    blip:   () => tone(740, 0.05, "triangle", 0.1),
    count:  (hi) => tone(hi ? 880 : 440, 0.15, "triangle", 0.2),
    end:    () => { [784, 587, 392].forEach((f, i) => tone(f, 0.24, "sine", 0.18, i * 0.16)); },
  };

  // ---- light ambient music: a slow pad chord + gentle arpeggio ----
  const SCALE = [261.63, 329.63, 392.0, 523.25, 659.25]; // C E G C E
  let step = 0;
  function musicStep() {
    if (!ctx || !enabled) return;
    const f = SCALE[step % SCALE.length] * (step % 8 < 4 ? 1 : 1.5);
    tone(f, 0.5, "sine", 0.05, 0, musicGain);
    if (step % 4 === 0) tone(SCALE[0] / 2, 1.6, "triangle", 0.04, 0, musicGain);
    step++;
  }
  function startMusic() {
    if (!ctx || !enabled || musicTimer) return;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.2);
    musicTimer = setInterval(musicStep, 320);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (ctx && musicGain) musicGain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.5);
  }
  function toggle(on) { enabled = on; if (!on) stopMusic(); }

  return { init, sfx, startMusic, stopMusic, toggle, get enabled() { return enabled; } };
})();
