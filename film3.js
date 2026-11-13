/* FlushStar home page as one scroll-driven film.
   Real footage (scrubbed frame by frame with the scroll) + FlushStar's own photography,
   drawn into one canvas. Text chapters and the flush HUD sit on top as HTML. */
(function () {
  const film = document.getElementById('film');
  const stick = film.querySelector('.fl-stick');
  const cv = document.getElementById('flCanvas');
  const cx = cv.getContext('2d');
  cx.imageSmoothingQuality = 'high';
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
  ['unit-corrosion', 'manifold', 'product', 'wake'].forEach(k => { const i = new Image(); i.src = `img/${k}.jpg`; PHOTO[k] = i; });

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
    const first = pick('twin');
    let got = 0; const need = Math.ceil(first.n / 3);
    await loadSeq(first, 3, () => { got++; loadBar.style.width = (got / need * 100) + '%'; });
    loadEl.classList.add('done');
    await loadSeq(first, 1);
    await loadSeq(pick('honda'), 2); await loadSeq(pick('honda'), 1);
  })();
  function frameOf(s, k) {
    let i = Math.round(clamp(k) * (s.n - 1));
    for (let j = i; j >= 0; j--) if (s.ok[j]) return s.imgs[j];
    for (let j = i; j < s.n; j++) if (s.ok[j]) return s.imgs[j];
    return null;
  }

  // ---------- drawing ----------
  const MAXS = 1.3;   // never blow a photo up past 1.3x its own pixels (unless the screen needs it to cover)
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = stick.clientWidth; H = stick.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cx.imageSmoothingQuality = 'high';
    const m = portrait(); if (m !== mob) { mob = m; }
  }
  addEventListener('resize', resize); resize();

  // cover-fit an image, zoomed around a focus point (fractions of the image); returns the mapping
  function place(img, zoom = 1, fx = .5, fy = .5) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cov = Math.max(cv.width / iw, cv.height / ih), s = Math.max(cov, Math.min(cov * zoom, MAXS));
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
  // Product callouts: anchor points on img/product.jpg (fractions of 1040x624), visited one by one
  const CALLS = [
    { u: .087, v: .49, z: 2.6, t: 'One-touch operation', p: 'Press once. The Quantum 25 runs the whole cycle by itself, start to finish.' },
    { u: .23,  v: .4,  z: 2.0, t: 'Every engine on its own line', p: 'PORT, ENG 2, ENG 3, STBD. Each outboard gets its own flush, up to six engines.' },
    { u: .24,  v: .78, z: 2.2, t: 'Marine-grade brass outlets', p: 'One garden hose in, a dedicated line out to each engine\'s flush port.' },
    { u: .87,  v: .5,  z: 2.4, t: 'Quantum Pulse Technology', p: 'Alternates pulsating and continuous water flow through the full cooling circuit.' },
    { u: .72,  v: .88, z: 2.2, t: '12VDC Plug n Play', p: 'Runs off the boat\'s 12 volt power. No programming required.' },
    { u: .65,  v: .7,  z: 2.3, t: 'Made in the U.S.A.', p: 'Built for saltwater and backed by a 3-year limited warranty.' }
  ];
  const BTN = [[.087, .49], [.186, .49], [.286, .49], [.386, .49]];   // the four switch buttons
  const PROD = [.215, .435], CALL0 = .29, CALLW = (PROD[1] - .005 - CALL0) / CALLS.length;
  const FLUSH = [.555, .695];
  const ENG = ['Port', 'Eng 2', 'Eng 3', 'Stbd'];
  const engK = (i, p) => clamp((p - FLUSH[0] - i * (FLUSH[1] - FLUSH[0]) / 4) / ((FLUSH[1] - FLUSH[0]) / 4), -1, 2);
  let lastProd = null;

  // place an image so that image point (fu,fv) lands at screen point (sx,sy), at `zoom` x cover scale
  function placeAt(img, zoom, fu, fv, sx, sy) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const cov = Math.max(cv.width / iw, cv.height / ih), s = Math.max(cov, Math.min(cov * zoom, MAXS)), dw = iw * s, dh = ih * s;
    let x = sx * cv.width - fu * dw, y = sy * cv.height - fv * dh;
    x = clamp(x, cv.width - dw, 0); y = clamp(y, cv.height - dh, 0);
    return { x, y, s, map: (u, v) => [x + u * dw, y + v * dh] };
  }
  // the product shot with feathered edges, so it can float in darkness during the reveal
  let featherImg = null;
  function feathered() {
    const img = PHOTO.product; if (featherImg || !img.naturalWidth) return featherImg;
    const w = Math.min(1600, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), px = d.data, fw = w * .07, fh = h * .1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = Math.min(x / fw, (w - 1 - x) / fw, y / fh, (h - 1 - y) / fh, 1);
      px[(y * w + x) * 4 + 3] = 255 * e * e * (3 - 2 * e);
    }
    g.putImageData(d, 0, 0); featherImg = c; return c;
  }
  function productScene(p, a, time) {
    const img = PHOTO.product; if (!img.naturalWidth || a <= 0) return null;
    const fimg = feathered();
    // camera: whole product during the reveal, then travel feature to feature
    const ci = clamp((p - CALL0) / CALLW, -1, CALLS.length - .001);
    let fu = .5, fv = .5, z = 1.02, sx = mob ? .5 : .62, sy = mob ? .34 : .5;
    if (ci >= 0) {
      const i = Math.floor(ci), f = ci - i, k = sm(0, .35, f);
      const A = CALLS[Math.max(0, i - 1)], B = CALLS[i];
      const from = i === 0 ? { u: .5, v: .5, z: 1.02 } : A;
      fu = lerp(from.u, B.u, k); fv = lerp(from.v, B.v, k); z = lerp(from.z, B.z, k) * (mob ? .62 : 1);
    } else z = lerp(1.25, 1.02, sm(PROD[0], CALL0, p));
    // pull back out at the end of the walkthrough
    const out = sm(PROD[1] - .025, PROD[1], p);
    fu = lerp(fu, .5, out); fv = lerp(fv, .5, out); z = lerp(z, 1.02, out);
    // reveal: product floats at a fixed share of the screen width; tour: cover-scale close-ups
    const iw = img.naturalWidth, ih = img.naturalHeight, cover = Math.max(cv.width / iw, cv.height / ih);
    const reveal = (mob ? .96 : .6) * cv.width / iw;
    const tour = clamp((p - CALL0 + .02) / .03) * (1 - out);
    const S = lerp(reveal * (1.12 - .12 * sm(PROD[0], CALL0, p)), Math.max(cover, Math.min(cover * z, MAXS)), tour);
    const dw = iw * S, dh = ih * S;
    let X = (tour > 0 ? sx : lerp(sx, mob ? .5 : .64, 1 - tour)) * cv.width - lerp(.5, fu, tour) * dw;
    let Y = sy * cv.height - lerp(.5, fv, tour) * dh;
    if (tour >= 1 && !mob) { X = clamp(X, cv.width - dw, 0); Y = clamp(Y, cv.height - dh, 0); }
    const P = { x: X, y: Y, s: S, map: (u, v) => [X + u * dw, Y + v * dh] };
    cx.globalAlpha = a; cx.drawImage(tour >= 1 && !mob ? img : (fimg || img), P.x, P.y, dw, dh);
    // light sweep across the panels
    const sw = ((time * .18) % 1.6) - .3;
    const g = cx.createLinearGradient(P.map(sw - .12, 0)[0], 0, P.map(sw + .12, 0)[0], 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(180,215,255,.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g; cx.globalCompositeOperation = 'screen'; cx.fillRect(0, 0, cv.width, cv.height); cx.globalCompositeOperation = 'source-over';
    // switch buttons light up one after another
    BTN.forEach(([u, v], i) => {
      const on = .5 + .5 * Math.sin(time * 3 - i * .9);
      const [x, y] = P.map(u, v), r = 52 * P.s;
      const rg = cx.createRadialGradient(x, y, r * .3, x, y, r * 1.6);
      rg.addColorStop(0, `rgba(80,170,255,${.35 * on})`); rg.addColorStop(1, 'rgba(46,155,255,0)');
      cx.fillStyle = rg; cx.globalCompositeOperation = 'lighter'; cx.beginPath(); cx.arc(x, y, r * 1.6, 0, 7); cx.fill(); cx.globalCompositeOperation = 'source-over';
    });
    cx.globalAlpha = 1;
    // soft vignette so the product sits in darkness
    const vg = cx.createRadialGradient(cv.width * sx, cv.height * sy, Math.min(cv.width, cv.height) * .35, cv.width * sx, cv.height * sy, Math.max(cv.width, cv.height) * .8);
    vg.addColorStop(0, 'rgba(4,7,13,0)'); vg.addColorStop(1, `rgba(4,7,13,${.75 * a})`);
    cx.fillStyle = vg; cx.fillRect(0, 0, cv.width, cv.height);
    return P;
  }

  // blue sparks drifting up through the opening shot
  const SPARK = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), v: .03 + Math.random() * .08, r: .6 + Math.random() * 1.8, ph: Math.random() * 6 }));
  function opener(p, a, time) {
    const k = sm(0, .075, p);
    const lit = sm(0, 1.4, time);                       // lights come up when the page opens
    const P = draw(PHOTO.manifold, a * lit, lerp(mob ? 1.9 : 2.0, mob ? 1.15 : 1.06, k), lerp(mob ? .8 : .78, .5, k), lerp(mob ? .58 : .34, .5, k),
      `brightness(${lerp(.9, 1.05, k)}) saturate(1.45) contrast(1.15)`);
    flows(P, a * lit * (.8 + .2 * Math.sin(time * 2.2)), false, time);
    cx.save(); cx.globalCompositeOperation = 'lighter';
    // light sweep across the cowls
    const sx = ((time * .22) % 1.8 - .4) * cv.width;
    const g = cx.createLinearGradient(sx - cv.width * .15, 0, sx + cv.width * .15, cv.height * .3);
    g.addColorStop(0, 'rgba(46,155,255,0)'); g.addColorStop(.5, `rgba(120,190,255,${.16 * a * lit})`); g.addColorStop(1, 'rgba(46,155,255,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, cv.width, cv.height);
    // sparks
    SPARK.forEach(sp => {
      const y = (sp.y - time * sp.v) % 1, yy = (y < 0 ? y + 1 : y) * cv.height, xx = (sp.x + Math.sin(time * .7 + sp.ph) * .01) * cv.width;
      const tw = .5 + .5 * Math.sin(time * 3 + sp.ph), r = sp.r * DPR * 3;
      const rg = cx.createRadialGradient(xx, yy, 0, xx, yy, r);
      rg.addColorStop(0, `rgba(170,220,255,${.9 * tw * a * lit})`); rg.addColorStop(1, 'rgba(46,155,255,0)');
      cx.fillStyle = rg; cx.beginPath(); cx.arc(xx, yy, r, 0, 7); cx.fill();
    });
    cx.restore();
  }

  function scene(p, time) {
    cx.fillStyle = '#04070D'; cx.fillRect(0, 0, cv.width, cv.height);
    const fadeIn = (a, b) => sm(a, b, p), fadeOut = (a, b) => 1 - sm(a, b, p);

    // 1. underwater: the propeller turning in saltwater (footage)
    // 1. opening: FlushStar's own rig, black race outboards lit electric blue, camera pulling back
    const a1 = fadeOut(.065, .085);
    if (a1 > 0) opener(p, a1, time);

    // 2. twin outboards running, wake behind (footage)
    const a2 = fadeIn(.065, .085) * fadeOut(.145, .16);
    if (a2 > 0) draw(frameOf(pick('twin'), (p - .065) / .095), a2, 1 + (p - .065) * .8, .5, .5, 'brightness(.82) contrast(1.05)');

    // 3. salt on a part (FlushStar photo)
    const a3 = fadeIn(.145, .16) * fadeOut(.212, .232);
    if (a3 > 0) draw(PHOTO['unit-corrosion'], a3, lerp(mob ? 2.0 : 2.4, mob ? 1.7 : 1.9, sm(.15, .23, p)), mob ? .74 : .62, .22);

    // 4. THE PRODUCT: reveal, then a guided tour of its features
    const a4 = fadeIn(.212, .235) * fadeOut(.43, .45);
    lastProd = a4 > 0 ? productScene(p, a4, time) : null;

    // 5. programs: the switch panel on the real install
    const a5 = fadeIn(.43, .45) * fadeOut(.525, .545);
    if (a5 > 0) draw(PHOTO.product, a5, lerp(mob ? 1.15 : 1.5, mob ? 1.3 : 1.65, sm(.43, .545, p)), mob ? .24 : .3, mob ? .55 : .5, mob ? 'brightness(.42) saturate(1.15)' : 'brightness(.3) saturate(1.15)');

    // 6. the real install: manifold + hoses, the flush cycle running
    const a6 = fadeIn(.525, .545) * fadeOut(.705, .725);
    if (a6 > 0) {
      const k = sm(.53, .72, p);
      const P = draw(PHOTO['manifold'], a6, lerp(1.02, 1.12, k), mob ? lerp(.6, .74, k) : lerp(.42, .5, k), lerp(.46, mob ? .55 : .5, k));
      let running = -1;
      for (let i = 0; i < 4; i++) { const e = engK(i, p); if (e >= 0 && e <= 1) running = i; }
      const e = running >= 0 ? engK(running, p) : 0;
      const pulse = running >= 0 && e >= .2 && Math.floor((e - .2) / .2) % 2 === 0;
      const amt = a6 * (running >= 0 ? (e < .2 ? e / .2 : 1) : (p > FLUSH[1] ? .25 : 0));
      flows(P, amt, pulse, time);
    }

    // 7. abilities over the product, dimmed
    const a7 = fadeIn(.705, .725) * fadeOut(.805, .825);
    if (a7 > 0) draw(PHOTO.product, a7, lerp(1.05, 1.15, sm(.71, .82, p)), mob ? .24 : .7, mob ? .82 : .45, mob ? 'brightness(.24) saturate(1.1)' : 'brightness(.24) saturate(1.15)');

    // 8. how to buy: clean engines running (footage)
    const a8 = fadeIn(.805, .825) * fadeOut(.885, .905);
    if (a8 > 0) draw(frameOf(pick('honda'), (p - .805) / .1), a8, 1.04, .5, .5, 'brightness(.78)');

    // 9. contact: open water, the wake behind you
    const a9 = fadeIn(.885, .905);
    if (a9 > 0) draw(PHOTO['wake'], a9, lerp(1.25, 1.05, sm(.89, 1, p)), .5, .55, 'brightness(.55) saturate(1.1)');
  }
  // ---------- overlays ----------
  const marks = [0, .065, .215, .435, .54, .715, .815, .865, .915, 1];
  const call = document.getElementById('flCall'), callN = document.getElementById('flCallN'), callT = document.getElementById('flCallT'), callP = document.getElementById('flCallP');
  const progs = [...document.querySelectorAll('#flProgs div')], tlHead = document.getElementById('flTlHead');
  let callIdx = -1;
  function overlays(p) {
    const narrow = innerWidth <= 820;
    chaps.forEach(c => {
      const a = +c.dataset.a, b = +c.dataset.b, f = .018;
      const o = Math.min(sm(a, a + f, p), 1 - sm(b - f, b, p));
      const y = (1 - o) * 26 * (p < (a + b) / 2 ? 1 : -1);
      c.style.opacity = o.toFixed(3); c.classList.toggle('on', o > .5);
      if (c.classList.contains('fl-abil-wrap') && !narrow) c.style.transform = `translate(-50%,calc(-50% + ${y}px))`;
      else if (c.classList.contains('fl-c')) c.style.transform = narrow ? `translateY(${y}px)` : `translate(-50%,${y}px)`;
      else c.style.transform = narrow ? `translateY(${y}px)` : `translateY(calc(-50% + ${y}px))`;
    });
    rail.forEach((r, i) => {
      const k = clamp((p - marks[i]) / (marks[i + 1] - marks[i]));
      r.style.setProperty('--k', (k * 100).toFixed(1) + '%');
      r.classList.toggle('on', p >= marks[i] && (p < marks[i + 1] || i === rail.length - 1));
    });
    rail[0].parentNode.style.opacity = p > .915 ? 0 : 1;
    cue.style.opacity = p > .012 ? 0 : 1;

    // product callout card
    const ci = (p - CALL0) / CALLW;
    const idx = ci >= 0 && p < PROD[1] - .01 ? Math.min(CALLS.length - 1, Math.floor(ci)) : -1;
    if (idx !== callIdx && idx >= 0) {
      callIdx = idx; const C = CALLS[idx];
      callN.textContent = `0${idx + 1} / 0${CALLS.length}`; callT.textContent = C.t; callP.textContent = C.p;
      call.classList.remove('swap'); void call.offsetWidth; call.classList.add('swap');
    }
    const f = ci - Math.floor(ci);
    call.style.opacity = idx >= 0 ? Math.min(sm(.12, .3, f), 1 - sm(.92, 1, f) * (idx === CALLS.length - 1 ? 1 : 0)).toFixed(3) : 0;

    // programs: highlight 5 / 7 / 9 and run the timeline head
    const pk = clamp((p - .445) / (.515 - .445));
    progs.forEach((d, i) => d.classList.toggle('on', i === Math.min(2, Math.floor(pk * 3))));
    tlHead.style.left = ((pk * 3 % 1) * 100).toFixed(1) + '%';

    hud.classList.toggle('on', p > FLUSH[0] - .015 && p < FLUSH[1] + .01);
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

  // callout pointer: a ring on the feature and a line to the card
  function pointer(p) {
    const ci = (p - CALL0) / CALLW;
    if (!lastProd || ci < 0 || p > PROD[1] - .012) return;
    const idx = Math.min(CALLS.length - 1, Math.floor(ci)), f = ci - Math.floor(ci);
    const a = sm(.3, .45, f) * (idx === CALLS.length - 1 ? 1 - sm(.85, 1, f) : 1);
    if (a <= 0) return;
    const [x, y] = lastProd.map(CALLS[idx].u, CALLS[idx].v);
    const r = cv.getBoundingClientRect(), b = call.getBoundingClientRect();
    const tx = ((narrow() ? b.left + b.width * .5 : b.right) - r.left) * DPR, ty = ((narrow() ? b.top : b.top + b.height * .5) - r.top) * DPR;
    const t = performance.now() / 1000;
    cx.save(); cx.globalAlpha = a; cx.strokeStyle = '#6FCBFF'; cx.fillStyle = '#6FCBFF'; cx.shadowColor = '#2E9BFF'; cx.shadowBlur = 16 * DPR;
    cx.lineWidth = 1.5 * DPR;
    cx.beginPath(); cx.moveTo(tx, ty); cx.lineTo(x, y); cx.stroke();
    cx.beginPath(); cx.arc(x, y, 6 * DPR, 0, 7); cx.fill();
    for (let k = 0; k < 2; k++) { const ph = (t * .8 + k * .5) % 1; cx.globalAlpha = a * (1 - ph); cx.beginPath(); cx.arc(x, y, (8 + ph * 30) * DPR, 0, 7); cx.stroke(); }
    cx.restore();
  }
  const narrow = () => innerWidth <= 820;
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
    pointer(p);
  }
  requestAnimationFrame(t => { last = t; frame(t); });
})();
