import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const film = document.getElementById('film');
const stick = film.querySelector('.fl-stick');
const canvas = document.getElementById('flCanvas');
const chaps = [...film.querySelectorAll('.fl-ch')];
const rail = [...document.querySelectorAll('#flRail span')];
const hud = document.getElementById('flHud'), hudMode = document.getElementById('flMode'), hudClock = document.getElementById('flClock');
const hudEng = [...document.querySelectorAll('#flEng div')];
const cue = document.getElementById('flCue');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sm = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- story timing (fractions of the film's scroll length) ----
const HOSE = [.42, .54];          // hoses draw in from the manifold
const FLUSH = [.58, .86];         // engines flush one after another
const N_ENG = 4;                  // matches the PORT / ENG 2 / ENG 3 / STBD panel
const ENG_NAMES = ['Port', 'Eng 2', 'Eng 3', 'Stbd'];
function engineState(i, p) {
  const w = (FLUSH[1] - FLUSH[0]) / N_ENG, s = FLUSH[0] + i * w;
  return clamp((p - s) / w, -1, 2);           // <0 waiting, 0..1 flushing, >1 done
}

// ---- overlays ----
function overlays(p) {
  const mobile = innerWidth <= 820;
  chaps.forEach(c => {
    const a = +c.dataset.a, b = +c.dataset.b, f = .045;
    const o = Math.min(sm(a, a + f, p), 1 - sm(b - f, b, p));
    const y = (1 - o) * 26 * (p < (a + b) / 2 ? 1 : -1);
    c.style.opacity = o.toFixed(3); c.classList.toggle('on', o > .5);
    if (c.classList.contains('fl-c')) c.style.transform = mobile ? `translateY(${y}px)` : `translate(-50%,${y}px)`;
    else c.style.transform = mobile ? `translateY(${y}px)` : `translateY(calc(-50% + ${y}px))`;
  });
  const marks = [0, .11, .36, .57, .87, 1];
  rail.forEach((r, i) => {
    const k = clamp((p - marks[i]) / (marks[i + 1] - marks[i]));
    r.style.setProperty('--k', (k * 100).toFixed(1) + '%');
    r.classList.toggle('on', p >= marks[i] && p < marks[i + 1] + (i === 4 ? 1 : 0));
  });
  cue.style.opacity = p > .02 ? 0 : 1;

  // flush HUD
  hud.classList.toggle('on', p > FLUSH[0] - .03 && p < FLUSH[1] + .04);
  let mode = 'Standby';
  hudEng.forEach((el, i) => {
    const k = engineState(i, p);
    const run = k >= 0 && k <= 1, ok = k > 1;
    el.classList.toggle('run', run); el.classList.toggle('ok', ok);
    let txt = 'Salted';
    if (run) {
      txt = k < .2 ? 'Pre-soak' : (Math.floor((k - .2) / .2) % 2 ? 'Continuous' : 'Pulsating');
      mode = `${ENG_NAMES[i]} · ${txt}`;
    } else if (ok) txt = 'Clean';
    el.querySelector('small').textContent = txt;
  });
  if (p >= FLUSH[1]) mode = 'Cycle complete';
  hudMode.textContent = mode;
  const secs = Math.round(clamp((p - FLUSH[0]) / (FLUSH[1] - FLUSH[0])) * 300);
  hudClock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { film.classList.add('nogl'); }

function readP() { const r = film.getBoundingClientRect(); return clamp(-r.top / (film.offsetHeight - stick.clientHeight)); }

if (!renderer) {
  const f = () => overlays(readP()); addEventListener('scroll', f, { passive: true }); f();
} else {
  const mobile = matchMedia('(max-width:820px)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.6 : 1.8));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.setClearColor('#04070D');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#04070D', 16, 46);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .55;
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 120);

  const T = { t: { value: 0 } };
  const texLoader = new THREE.TextureLoader();
  const tex = src => { const t = texLoader.load(src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

  // ---------- water: caustic shader in the brand blues ----------
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1), new THREE.ShaderMaterial({
    uniforms: { t: T.t, fogC: { value: new THREE.Color('#04070D') } },
    vertexShader: `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform float t;uniform vec3 fogC;varying vec3 vW;
      float caus(vec2 p){vec2 q=p;float c=0.;for(int i=0;i<4;i++){float fi=float(i);
        q+=vec2(sin(q.y*1.35+t*.55+fi*1.7),cos(q.x*1.15-t*.45+fi*2.3))*.55;c+=.5+.5*sin(q.x*1.9+q.y*1.4+fi);}
        return pow(c/4.,10.)*6.;}
      void main(){vec2 p=vW.xz*.55;
        float c=caus(p)+caus(p*1.9+3.1)*.55;
        float band=.5+.5*sin(vW.x*.18+vW.z*.11+t*.2);
        vec3 deep=vec3(.004,.025,.06),mid=vec3(.012,.12,.22),glint=vec3(.4,.8,1.);
        vec3 col=mix(deep,mid,.3+.4*band)+glint*c*.55;
        float d=length(vW.xz-cameraPosition.xz);
        col=mix(col,fogC*.6,smoothstep(14.,44.,d));
        gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.6; scene.add(water);

  // ---------- salt crust: a noise mask injected into the engine materials ----------
  const saltChunk = `
    varying vec3 vSP;uniform float uSalt;
    float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    float n3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
      return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
    float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n3(p);p*=2.03;a*=.5;}return s;}`;
  function saltable(mat, saltU) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSalt = saltU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSP=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + saltChunk)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float low=smoothstep(1.5,-1.7,vSP.y);
          float sn=fbm(vSP*vec3(18.,3.2,18.)+vec3(0.,n3(vSP*4.)*1.5,0.));
          float thr=.7-uSalt*(.06+.06*low);
          float crust=smoothstep(thr,thr+.035,sn)*step(.02,uSalt);
          float film=uSalt*.05*smoothstep(.45,.7,fbm(vSP*7.));
          float m=clamp(crust*.8+film,0.,1.);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.74,.77,.76),m);
          roughnessFactor=mix(roughnessFactor,.92,m);`);
    };
    mat.customProgramCacheKey = () => 'salt';
    return mat;
  }

  // ---------- an outboard built from primitives ----------
  // taper(geo, bottomX, topX, bottomZ, topZ): scales a part's width/depth from its base to its top
  function taper(geo, bx, tx, bz, tz) {
    geo.computeBoundingBox(); const { min, max } = geo.boundingBox, pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = (pos.getY(i) - min.y) / (max.y - min.y);
      pos.setX(i, pos.getX(i) * lerp(bx, tx, k)); pos.setZ(i, pos.getZ(i) * lerp(bz, tz, k));
    }
    geo.computeVertexNormals(); return geo;
  }
  const engines = [];
  const xs = [-2.4, -.8, .8, 2.4];
  for (let i = 0; i < N_ENG; i++) {
    const saltU = { value: 1 };
    const cowlM = saltable(new THREE.MeshPhysicalMaterial({ color: '#0d1118', metalness: .2, roughness: .36, clearcoat: 1, clearcoatRoughness: .22, envMapIntensity: .7 }), saltU);
    const bodyM = saltable(new THREE.MeshPhysicalMaterial({ color: '#1a212c', metalness: .5, roughness: .4 }), saltU);
    const g = new THREE.Group(); g.position.x = xs[i];
    const cowl = new THREE.Mesh(taper(new RoundedBoxGeometry(1.0, 1.15, 1.55, 6, .4), 1, .74, 1, .86), cowlM); cowl.position.set(0, 1.24, .05); g.add(cowl);
    const lower = new THREE.Mesh(taper(new RoundedBoxGeometry(.9, .44, 1.32, 4, .16), .9, 1, .92, 1), bodyM); lower.position.set(0, .5, .02); g.add(lower);
    const mid = new THREE.Mesh(taper(new RoundedBoxGeometry(.5, 1.55, .66, 4, .12), .62, 1, .8, 1), bodyM); mid.position.set(0, -.45, .05); g.add(mid);
    const bandM = new THREE.MeshBasicMaterial({ color: '#2E9BFF', toneMapped: false });
    for (const sx of [-1, 1]) { const band = new THREE.Mesh(new THREE.BoxGeometry(.012, .03, 1.3), bandM); band.position.set(sx * .5, .76, .05); g.add(band); }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.86, .05, .95), bodyM); plate.position.set(0, -1.18, .18); g.add(plate);
    const gear = new THREE.Mesh(new THREE.CapsuleGeometry(.17, .82, 6, 16), bodyM); gear.rotation.x = Math.PI / 2; gear.position.set(0, -1.52, .14); g.add(gear);
    const skeg = new THREE.Mesh(new THREE.BoxGeometry(.06, .5, .34), bodyM); skeg.position.set(0, -1.85, .05); g.add(skeg);
    const prop = new THREE.Group(); prop.position.set(0, -1.52, .72);
    prop.add(new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, .22, 16).rotateX(Math.PI / 2), bodyM));
    for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(new RoundedBoxGeometry(.24, .5, .03, 2, .012), bodyM); bl.position.y = .24; const piv = new THREE.Group(); piv.rotation.z = b * Math.PI * 2 / 3; bl.rotation.y = .5; piv.add(bl); prop.add(piv); }
    g.add(prop);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(.5, .7, .5), bodyM); bracket.position.set(0, .15, -.62); g.add(bracket);
    // status light strip on the rear of the cowl
    const ledM = new THREE.MeshBasicMaterial({ color: '#C4562F', toneMapped: false });
    const led = new THREE.Mesh(new THREE.BoxGeometry(.62, .035, .02), ledM); led.position.set(0, .93, .81); g.add(led);
    // brass flush port on the cowl's lower side
    const port = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .14, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#D2A93F', metalness: 1, roughness: .25 }));
    port.position.set(.48, .5, -.3); g.add(port);
    scene.add(g);
    engines.push({ g, saltU, ledM, prop, port: new THREE.Vector3(xs[i] + .55, .5, -.3), tell: new THREE.Vector3(xs[i] + .2, .58, .68), intake: new THREE.Vector3(xs[i], -1.6, .3) });
  }

  // ---------- the boat's stern ----------
  const hullM = new THREE.MeshPhysicalMaterial({ color: '#0b1220', metalness: .3, roughness: .35, clearcoat: .6 });
  const hull = new THREE.Mesh(new RoundedBoxGeometry(10.2, 2.6, 7, 4, .18), hullM); hull.position.set(0, -.55, -4.4); scene.add(hull);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(10.1, .03, .03), new THREE.MeshBasicMaterial({ color: '#2E9BFF', toneMapped: false })); trim.position.set(0, .72, -.9); scene.add(trim);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, .06, 6.6), new THREE.MeshStandardMaterial({ color: '#141b28', roughness: .8 })); deck.position.set(0, .76, -4.4); scene.add(deck);

  // ---------- the Quantum 25 unit, wearing its real panel artwork ----------
  const unit = new THREE.Group(); unit.position.set(-4.0, .12, -.86); scene.add(unit);
  const caseM = new THREE.MeshPhysicalMaterial({ color: '#07090d', metalness: .6, roughness: .35, clearcoat: .8 });
  const faceM = new THREE.MeshStandardMaterial({ map: tex('img/panel-main.jpg'), roughness: .45, metalness: .1, emissive: '#ffffff', emissiveMap: tex('img/panel-main.jpg'), emissiveIntensity: .45 });
  const box = new THREE.Mesh(new RoundedBoxGeometry(1.06, 1.0, .26, 4, .05), caseM); box.position.z = .13; unit.add(box);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, .95), faceM); face.position.z = .262; unit.add(face);
  const swM = new THREE.MeshStandardMaterial({ map: tex('img/panel-switch.jpg'), roughness: .45, emissive: '#ffffff', emissiveMap: tex('img/panel-switch.jpg'), emissiveIntensity: .5 });
  const sw = new THREE.Mesh(new RoundedBoxGeometry(.98, .58, .14, 3, .04), caseM); sw.position.set(0, -.86, .07); unit.add(sw);
  const swf = new THREE.Mesh(new THREE.PlaneGeometry(.94, .55), swM); swf.position.set(0, -.86, .142); unit.add(swf);
  const brass = new THREE.MeshStandardMaterial({ color: '#D2A93F', metalness: 1, roughness: .22 });
  const portsW = [];
  for (let i = 0; i < N_ENG; i++) {
    const x = -.35 + i * .233;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .2, 16), brass); b.position.set(x, -1.25, .1); unit.add(b);
    portsW.push(new THREE.Vector3(-4.0 + x, .12 - 1.36, -.86 + .1));
  }
  const unitGlow = new THREE.PointLight('#2E9BFF', 3, 3.2, 1.6); unitGlow.position.set(-4.0, -.2, -.1); scene.add(unitGlow);

  // ---------- hoses: clear tube + a flow tube inside ----------
  const hoseM = new THREE.MeshPhysicalMaterial({ color: '#6FCBFF', transparent: true, opacity: .32, roughness: .1, metalness: 0, clearcoat: 1, depthWrite: false });
  const hoses = [];
  for (let i = 0; i < N_ENG; i++) {
    const a = portsW[i], e = engines[i].port;
    const sag = -1.25 - i * .07;
    const curve = new THREE.CatmullRomCurve3([
      a.clone(), new THREE.Vector3(a.x, a.y - .22, a.z + .06),
      new THREE.Vector3(lerp(a.x, e.x, .3), sag, -.62 + i * .02),
      new THREE.Vector3(lerp(a.x, e.x, .78), sag + .2, -.6),
      new THREE.Vector3(e.x + .25, e.y - .2, e.z - .05), e.clone()
    ], false, 'catmullrom', .4);
    const geo = new THREE.TubeGeometry(curve, 140, .045, 10, false);
    const mesh = new THREE.Mesh(geo, hoseM); mesh.renderOrder = 2; scene.add(mesh);
    const flowU = { head: { value: 0 }, amt: { value: 0 }, pulse: { value: 0 } };
    const flow = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, .028, 8, false), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { t: T.t, ...flowU },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float t,head,amt,pulse;varying vec2 vUv;
        void main(){float x=fract(vUv.x*22.-t*(pulse>.5?3.2:4.6));
          float dash=smoothstep(0.,.12,x)*smoothstep(.6,.3,x);
          float throb=pulse>.5?(.35+.65*step(.5,fract(t*2.2))):1.;
          float front=smoothstep(head,head-.03,vUv.x);
          float a=amt*front*(.28+.72*dash)*throb;
          gl_FragColor=vec4(vec3(.35,.75,1.)*1.8,a);}`
    }));
    flow.renderOrder = 3; scene.add(flow);
    hoses.push({ mesh, geo, count: geo.index.count, flowU, curve });
  }

  // ---------- particles: tell-tale streams + run-off at the lower unit ----------
  const PN = mobile ? 500 : 900;
  const pg = new THREE.BufferGeometry(), pp = new Float32Array(PN * 3), pv = new Float32Array(PN * 3), pl = new Float32Array(PN), pa = new Float32Array(PN);
  for (let i = 0; i < PN; i++) pp[i * 3 + 1] = -99;
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('a', new THREE.BufferAttribute(pa, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { px: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float a;varying float va;uniform float px;void main(){va=a;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=(9.+16.*a)*px*(10./-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float va;void main(){float d=length(gl_PointCoord-.5);float s=smoothstep(.5,.0,d);gl_FragColor=vec4(vec3(.6,.88,1.),s*va*.85);}`
  });
  const parts = new THREE.Points(pg, pMat); parts.frustumCulled = false; scene.add(parts);
  let pIdx = 0;
  function emit(pos, vel, spread) {
    const i = pIdx++ % PN; pl[i] = 1;
    pp[i * 3] = pos.x; pp[i * 3 + 1] = pos.y; pp[i * 3 + 2] = pos.z;
    pv[i * 3] = vel.x + (Math.random() - .5) * spread; pv[i * 3 + 1] = vel.y + (Math.random() - .5) * spread; pv[i * 3 + 2] = vel.z + (Math.random() - .5) * spread;
  }

  // salt flakes drifting off an engine while it is flushed
  const FN = mobile ? 160 : 300;
  const fg = new THREE.BufferGeometry(), fp = new Float32Array(FN * 3), fv = new Float32Array(FN * 3), fl = new Float32Array(FN), fa = new Float32Array(FN);
  for (let i = 0; i < FN; i++) fp[i * 3 + 1] = -99;
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setAttribute('a', new THREE.BufferAttribute(fa, 1));
  const flakes = new THREE.Points(fg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { px: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float a;varying float va;uniform float px;void main(){va=a;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=6.*px*(10./-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying float va;void main(){if(length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(vec3(.86,.88,.86),va);}`
  }));
  flakes.frustumCulled = false; scene.add(flakes);
  let fIdx = 0;

  // ---------- light ----------
  const key = new THREE.DirectionalLight('#dbe9ff', 2.2); key.position.set(5, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight('#2E9BFF', 2.4); rim.position.set(-6, 3, -4); scene.add(rim);
  const under = new THREE.PointLight('#2E9BFF', 8, 9, 1.4); under.position.set(0, -1.2, 2.2); scene.add(under);

  // ---------- camera path ----------
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const CAM = [
    [0,   V(.8, 12, 10.5), V(0, -1.6, 8)],     // looking down into the water
    [.12, V(.6, 4.0, 11.5), V(-1.3, .1, 0)],    // the engines rise into view
    [.30, V(3.6, 2.0, 5.8), V(-.3, .8, 0)],    // close on the salted cowls
    [.40, V(-1.2, .5, 3.6), V(-2.9, -.4, -.6)], // the Quantum 25 on the transom
    [.54, V(-.2, 2.6, 8.4), V(-1.2, -.1, -.4)], // hoses run to every engine
    [.62, V(3.4, 3.2, 9.2), V(-1.5, -.1, 0)],   // wide, as the cycle starts
    [.84, V(.6, 2.8, 9.6), V(-2.3, -.35, 0)],   // slow orbit through the cycle
    [.95, V(0, 2.3, 11.2), V(0, -1.0, 0)]       // finished
  ];
  const cp = new THREE.Vector3(), ct = new THREE.Vector3();
  function camAt(p) {
    let i = 0; while (i < CAM.length - 2 && p > CAM[i + 1][0]) i++;
    const [p0, a0, b0] = CAM[i], [p1, a1, b1] = CAM[i + 1];
    const k = sm(p0, p1, p);
    cp.lerpVectors(a0, a1, k); ct.lerpVectors(b0, b1, k);
  }

  let W0 = 0, H0 = 0;
  function resize() {
    const w = stick.clientWidth, h = stick.clientHeight;
    if (w === W0 && Math.abs(h - H0) < 100) return; W0 = w; H0 = h;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = camera.aspect < .8 ? 52 : 36; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  let target = readP(), p = target, last = performance.now(), visible = true;
  addEventListener('scroll', () => { target = readP(); }, { passive: true });
  new IntersectionObserver(([e]) => visible = e.isIntersecting).observe(film);
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
  const C_SALT = new THREE.Color('#C4562F'), C_RUN = new THREE.Color('#2E9BFF'), C_OK = new THREE.Color('#39C07C');

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!visible) return;
    T.t.value += dt;
    p += (target - p) * (1 - Math.exp(-dt * 6));
    overlays(p);
    const narrow = camera.aspect < .8;

    camAt(p);
    if (narrow) { const nk = sm(.05, .14, p); tmpV.subVectors(cp, ct).multiplyScalar(lerp(1, 1.3, nk)); cp.copy(ct).add(tmpV); ct.y -= .9 * nk; const uk = sm(.32, .4, p) * (1 - sm(.45, .54, p)); cp.x -= 2.6 * uk; cp.z += .6 * uk; ct.x -= 1.1 * uk; ct.y += .5 * uk; }
    camera.position.copy(cp); camera.position.x += Math.sin(T.t.value * .25) * .06; camera.position.y += Math.sin(T.t.value * .4) * .04;
    camera.lookAt(ct);

    // hoses draw in
    const hk = sm(HOSE[0], HOSE[1], p);
    hoses.forEach((h, i) => {
      const k = clamp(hk * 1.3 - i * .1);
      h.geo.setDrawRange(0, Math.floor(h.count * k / 3) * 3);
      h.mesh.visible = k > 0;
    });

    // flush sequence
    let anyRun = false;
    engines.forEach((e, i) => {
      const k = engineState(i, p);
      const run = k >= 0 && k <= 1;
      const fu = hoses[i].flowU;
      fu.head.value = k < 0 ? 0 : clamp(k / .15) * 1.04;
      fu.amt.value = run ? 1 : k > 1 ? .18 : 0;
      fu.pulse.value = run && k >= .2 && Math.floor((k - .2) / .2) % 2 === 0 ? 1 : 0;
      e.saltU.value = 1 - sm(.2, .92, k);
      e.ledM.color.copy(k > 1 ? C_OK : run ? C_RUN : C_SALT);
      e.prop.rotation.z += run ? dt * .4 : 0;
      if (run && k > .15) {
        anyRun = true;
        const rate = mobile ? 2 : 3;
        for (let n = 0; n < rate; n++) {
          emit(e.tell, tmpV.set(.15, .55, 1.25), .12);                                   // tell-tale stream
          if (Math.random() < .6) emit(tmpW.set(e.intake.x + (Math.random() - .5) * .3, -1.45, e.intake.z + .3), tmpV.set(0, -.3, .5), .5); // run-off
        }
        if (e.saltU.value > .05 && Math.random() < .9) {
          const i2 = fIdx++ % FN; fl[i2] = 1;
          fp[i2 * 3] = e.g.position.x + (Math.random() - .5) * .9; fp[i2 * 3 + 1] = .6 + Math.random() * 1.1; fp[i2 * 3 + 2] = .1 + (Math.random() - .3) * 1.4;
          fv[i2 * 3] = (Math.random() - .5) * .4; fv[i2 * 3 + 1] = -.2 - Math.random() * .4; fv[i2 * 3 + 2] = .2 + Math.random() * .4;
        }
      }
    });
    unitGlow.intensity = 2.5 + (anyRun ? 2.5 + Math.sin(T.t.value * 9) * 1.2 : 0);
    faceM.emissiveIntensity = swM.emissiveIntensity = .42 + (anyRun ? .2 : 0);

    // integrate particles
    for (let i = 0; i < PN; i++) {
      if (pl[i] <= 0) { pa[i] = 0; continue; }
      pl[i] -= dt * .9; pv[i * 3 + 1] -= dt * 3.2;
      pp[i * 3] += pv[i * 3] * dt; pp[i * 3 + 1] += pv[i * 3 + 1] * dt; pp[i * 3 + 2] += pv[i * 3 + 2] * dt;
      if (pp[i * 3 + 1] < -1.6) pl[i] = 0;
      pa[i] = Math.max(0, pl[i]);
    }
    pg.attributes.position.needsUpdate = pg.attributes.a.needsUpdate = true;
    for (let i = 0; i < FN; i++) {
      if (fl[i] <= 0) { fa[i] = 0; continue; }
      fl[i] -= dt * .5; fv[i * 3 + 1] -= dt * 1.4;
      fp[i * 3] += fv[i * 3] * dt; fp[i * 3 + 1] += fv[i * 3 + 1] * dt; fp[i * 3 + 2] += fv[i * 3 + 2] * dt;
      if (fp[i * 3 + 1] < -1.6) fl[i] = 0;
      fa[i] = Math.max(0, fl[i]);
    }
    fg.attributes.position.needsUpdate = fg.attributes.a.needsUpdate = true;

    renderer.render(scene, camera);
  }
  renderer.compile(scene, camera);
  requestAnimationFrame(t0 => { last = t0; frame(t0); });
}
