/* FlushStar home page as one scroll-driven film.
   Real footage (scrubbed frame by frame with the scroll) + FlushStar's own photography,
   drawn into one canvas. Text chapters and the flush HUD sit on top as HTML. */
(function () {
  const film = document.getElementById('film');
  const stick = film.querySelector('.fl-stick');
  const cv = document.getElementById('flCanvas');
  const cx = cv.getContext('2d');
  const chaps = [...film.querySelectorAll('.fl-ch')];
  const rail = [...document.querySelectorAll('#flRail span')];
  const hud = document.getElementById('flHud'), hudMode = document.getElementById('flMode'), hudClock = document.getElementById('flClock');
  const hudEng = [...document.querySelectorAll('#flEng div')];
  const cue = document.getElementById('flCue');
  const loadEl = document.getElementById('flLoad'), loadBar = document.getElementById('flLoadBar');

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const sm = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const portrait = () => innerWidth / innerHeight < .8;

  // ---------- media ----------
  const pad = n => String(n).padStart(3, '0');
  function seq(dir, n) { return { dir, n, imgs: new Array(n), ok: new Array(n).fill(false) }; }
  const SEQ = {
    prop:  { d: seq('prop', 90),  m: seq('propM', 90) },
    twin:  { d: seq('twinD', 66), m: seq('twinM', 66) },
    honda: { d: seq('hondaD', 72), m: seq('hondaM', 72) }
  };
  const PHOTO = {};
  ['unit-corrosion', 'manifold', 'outboards', 'wake'].forEach(k => { const i = new Image(); i.src = `img/${k}.jpg`; PHOTO[k] = i; });

  let mob = portrait();
  const pick = k => mob ? SEQ[k].m : SEQ[k].d;
  function loadSeq(s, step, onEach) {
    return new Promise(res => {
      let left = 0;
      for (let i = 0; i < s.n; i += step) {
        if (s.imgs[i]) continue;
        left++;
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { s.ok[i] = true; onEach && onEach(); if (--left === 0) res(); };
        im.onerror = () => { if (--left === 0) res(); };
        im.src = `frames/${s.dir}/${pad(i + 1)}.webp`; s.imgs[i] = im;
      }
      if (!left) res();
    });
  }
  // first: every 3rd frame of the opening clip (fast start), then fill in, then the rest
  (async () => {
    const first = pick('prop');
    let got = 0; const need = Math.ceil(first.n / 3);
    await loadSeq(first, 3, () => { got++; loadBar.style.width = (got / need * 100) + '%'; });
    loadEl.classList.add('done');
    await loadSeq(first, 1);
    await loadSeq(pick('twin'), 2); await loadSeq(pick('twin'), 1);
    await loadSeq(pick('honda'), 2); await loadSeq(pick('honda'), 1);
  })();
  function frameOf(s, k) {
    let i = Math.round(clamp(k) * (s.n - 1));
    for (let j = i; j >= 0; j--) if (s.ok[j]) return s.imgs[j];
    for (let j = i; j < s.n; j++) if (s.ok[j]) return s.imgs[j];
    return null;
  }

  // ---------- drawing ----------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = stick.clientWidth; H = stick.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const m = portrait(); if (m !== mob) { mob = m; }
  }
  addEventListener('resize', resize); resize();

  // cover-fit an image, zoomed around a focus point (fractions of the image); returns the mapping
  function place(img, zoom = 1, fx = .5, fy = .5) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(cv.width / iw, cv.height / ih) * zoom;
    const dw = iw * s, dh = ih * s;
    let x = cv.width / 2 - fx * dw, y = cv.height / 2 - fy * dh;
    x = clamp(x, cv.width - dw, 0); y = clamp(y, cv.height - dh, 0);
    return { x, y, s, map: (u, v) => [x + u * dw, y + v * dh] };
  }
  function draw(img, a, zoom, fx, fy, filter) {
    if (!img || !(img.naturalWidth || img.width) || a <= 0) return null;
    const P = place(img, zoom, fx, fy);
    cx.globalAlpha = a; cx.filter = filter || 'none';
    cx.drawImage(img, P.x, P.y, (img.naturalWidth || img.width) * P.s, (img.naturalHeight || img.height) * P.s);
    cx.filter = 'none'; cx.globalAlpha = 1;
    return P;
  }

  // the three hose runs traced from the manifold photograph (1200x800 space, as on the live site)
  const HOSES = [
    [[700, 469], [767, 487], [835, 423], [902, 367]],
    [[700, 580], [830, 587], [960, 507], [1090, 383]],
    [[700, 626], [867, 719], [1033, 600], [1200, 496]]
  ];
  const bez = (P, t) => {
    const u = 1 - t;
    return [u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
            u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]];
  };
  function flows(P, amt, pulse, time) {
    if (!P || amt <= 0) return;
    const S = (x, y) => P.map(x / 1200, y / 800);
    cx.save(); cx.lineCap = 'round'; cx.lineJoin = 'round';
    HOSES.forEach((h, hi) => {
      // glow along the hose
      cx.beginPath();
      for (let k = 0; k <= 40; k++) { const [x, y] = S(...bez(h, k / 40)); k ? cx.lineTo(x, y) : cx.moveTo(x, y); }
      const throb = pulse ? (.5 + .5 * (Math.sin(time * 14) > 0 ? 1 : .25)) : 1;
      cx.strokeStyle = `rgba(46,155,255,${.28 * amt * throb})`; cx.lineWidth = 16 * P.s * 1.28; cx.shadowColor = '#2E9BFF'; cx.shadowBlur = 30 * DPR; cx.stroke();
      // travelling chevrons
      const n = 6, speed = pulse ? .55 : .8;
      for (let i = 0; i < n; i++) {
        const t = ((time * speed + i / n + hi * .13) % 1);
        const [x, y] = S(...bez(h, t)), [x2, y2] = S(...bez(h, Math.min(1, t + .01)));
        const ang = Math.atan2(y2 - y, x2 - x), sz = 11 * P.s * 1.28;
        const fade = Math.sin(t * Math.PI);
        cx.save(); cx.translate(x, y); cx.rotate(ang);
        cx.strokeStyle = `rgba(160,220,255,${amt * fade * throb})`; cx.lineWidth = 3.2 * P.s * 1.28; cx.shadowBlur = 14 * DPR;
        cx.beginPath(); cx.moveTo(-sz, -sz); cx.lineTo(0, 0); cx.lineTo(-sz, sz); cx.moveTo(-sz * 2.1, -sz); cx.lineTo(-sz * 1.1, 0); cx.lineTo(-sz * 2.1, sz); cx.stroke();
        cx.restore();
      }
    });
    cx.restore();
  }

  // ---------- story ----------
  const FLUSH = [.5, .69];
  const ENG = ['Port', 'Eng 2', 'Eng 3', 'Stbd'];
  const engK = (i, p) => clamp((p - FLUSH[0] - i * (FLUSH[1] - FLUSH[0]) / 4) / ((FLUSH[1] - FLUSH[0]) / 4), -1, 2);

  function scene(p, time) {
    cx.fillStyle = '#04070D'; cx.fillRect(0, 0, cv.width, cv.height);
    const fadeIn = (a, b) => sm(a, b, p), fadeOut = (a, b) => 1 - sm(a, b, p);

    // 1. underwater: the propeller turning in saltwater (footage)
    const a1 = fadeOut(.16, .19);
    if (a1 > 0) draw(frameOf(pick('prop'), p / .19), a1, 1 + p * .5, mob ? .5 : .45, .45);

    // 2. twin outboards running, wake behind (footage)
    const a2 = fadeIn(.16, .19) * fadeOut(.295, .32);
    if (a2 > 0) draw(frameOf(pick('twin'), (p - .16) / .16), a2, 1 + (p - .16) * .4, .5, .5, 'brightness(.82) contrast(1.05)');

    // 3. FlushStar's own photo: salt on a part, pulling back to reveal the Quantum 25
    const a3 = fadeIn(.295, .32) * fadeOut(.47, .5);
    if (a3 > 0) {
      const k = sm(.31, .45, p);
      draw(PHOTO['unit-corrosion'], a3, lerp(mob ? 2.4 : 2.3, mob ? 1 : 1.02, k), lerp(mob ? .74 : .6, mob ? .7 : .55, k), lerp(.22, mob ? .6 : .55, k));
    }

    // 4. the real install: manifold + hoses, the flush cycle running
    const a4 = fadeIn(.47, .5) * fadeOut(.695, .72);
    if (a4 > 0) {
      const k = sm(.48, .7, p);
      const P = draw(PHOTO['manifold'], a4, lerp(1.02, mob ? 1.12 : 1.12, k), mob ? lerp(.6, .74, k) : lerp(.42, .5, k), lerp(.46, mob ? .55 : .5, k));
      let running = -1;
      for (let i = 0; i < 4; i++) { const e = engK(i, p); if (e >= 0 && e <= 1) running = i; }
      const e = running >= 0 ? engK(running, p) : 0;
      const pulse = running >= 0 && e >= .2 && Math.floor((e - .2) / .2) % 2 === 0;
      const amt = a4 * (running >= 0 ? (e < .2 ? e / .2 : 1) : (p > FLUSH[1] ? .25 : 0));
      flows(P, amt, pulse, time);
    }

    // 5. specs over the outboards at the dock
    const a5 = fadeIn(.695, .72) * fadeOut(.8, .82);
    if (a5 > 0) draw(PHOTO['manifold'], a5, lerp(1.7, 1.9, sm(.7, .82, p)), mob ? .8 : .62, .32, 'brightness(.5) saturate(.9)');

    // 6. how to buy: clean engines running (footage)
    const a6 = fadeIn(.8, .82) * fadeOut(.885, .91);
    if (a6 > 0) draw(frameOf(pick('honda'), (p - .8) / .11), a6, 1.04, .5, .5, 'brightness(.8)');

    // 7. contact: open water, the wake behind you
    const a7 = fadeIn(.885, .91);
    if (a7 > 0) draw(PHOTO['wake'], a7, lerp(1.25, 1.05, sm(.89, 1, p)), .5, .55, 'brightness(.55) saturate(1.1)');
  }

  // ---------- overlays ----------
  const marks = [0, .075, .385, .48, .7, .81, .895, 1];
  function overlays(p) {
    const narrow = innerWidth <= 820;
    chaps.forEach(c => {
      const a = +c.dataset.a, b = +c.dataset.b, f = .022;
      const o = Math.min(sm(a, a + f, p), 1 - sm(b - f, b, p));
      const y = (1 - o) * 26 * (p < (a + b) / 2 ? 1 : -1);
      c.style.opacity = o.toFixed(3); c.classList.toggle('on', o > .5);
      if (c.classList.contains('fl-c')) c.style.transform = narrow ? `translateY(${y}px)` : `translate(-50%,${y}px)`;
      else c.style.transform = narrow ? `translateY(${y}px)` : `translateY(calc(-50% + ${y}px))`;
    });
    rail.forEach((r, i) => {
      const k = clamp((p - marks[i]) / (marks[i + 1] - marks[i]));
      r.style.setProperty('--k', (k * 100).toFixed(1) + '%');
      r.classList.toggle('on', p >= marks[i] && (p < marks[i + 1] || i === rail.length - 1));
    });
    rail[0].parentNode.style.opacity = p > .895 ? 0 : 1;
    cue.style.opacity = p > .015 ? 0 : 1;

    hud.classList.toggle('on', p > FLUSH[0] - .02 && p < FLUSH[1] + .012);
    let mode = 'Standby';
    hudEng.forEach((el, i) => {
      const k = engK(i, p), run = k >= 0 && k <= 1, ok = k > 1;
      el.classList.toggle('run', run); el.classList.toggle('ok', ok);
      let txt = 'Salted';
      if (run) { txt = k < .2 ? 'Pre-soak' : (Math.floor((k - .2) / .2) % 2 ? 'Continuous' : 'Pulsating'); mode = `${ENG[i]} · ${txt}`; }
      else if (ok) txt = 'Clean';
      el.querySelector('small').textContent = txt;
    });
    if (p >= FLUSH[1]) mode = 'Cycle complete';
    hudMode.textContent = mode;
    const secs = Math.round(clamp((p - FLUSH[0]) / (FLUSH[1] - FLUSH[0])) * 300);
    hudClock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  // ---------- loop ----------
  const readP = () => { const r = film.getBoundingClientRect(); return clamp(-r.top / (film.offsetHeight - stick.clientHeight)); };
  let target = readP(), p = target, last = performance.now(), time = 0, visible = true;
  addEventListener('scroll', () => { target = readP(); }, { passive: true });
  new IntersectionObserver(([e]) => visible = e.isIntersecting).observe(film);
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt;
    if (!visible) return;
    p += (target - p) * (1 - Math.exp(-dt * 9));
    if (Math.abs(target - p) < 1e-5) p = target;
    overlays(p);
    scene(p, time);
  }
  requestAnimationFrame(t => { last = t; frame(t); });
})();
