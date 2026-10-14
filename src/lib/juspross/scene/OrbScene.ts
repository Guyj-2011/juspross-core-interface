import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { V2State } from "../v2Store";

/* =====================================================================
 *  Núcleo 2.0 — una máquina de miles de engranajes (azul y rojo).
 *  · Cadenas de engranajes que ENGRANAN de verdad (dientes calzados).
 *  · 4 capas esféricas que giran a distinto ritmo + anillos dentados.
 *  · Una onda de energía recorre el mecanismo; al pensar se aceleran
 *    y se encienden en rojo.
 *  · Centro tenue y zoom hasta el interior del núcleo.
 * ===================================================================== */

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

function randDir(): THREE.Vector3 {
  const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
  return v.lengthSq() < 1e-4 ? v.set(0, 1, 0) : v.normalize();
}

/* ---------- geometría de un engranaje de radio exterior = 1 ---------- */
interface GearOpts {
  windows?: number;
  fill?: number;
  inner?: number;
  outer?: number;
  hub?: number;
}

/** Radio de raíz relativo al de la punta para N dientes con el mismo módulo. */
const rootRatio = (N: number) => (N - 2.5) / (N + 2);

function gearGeometry(N: number, o: GearOpts = {}): THREE.BufferGeometry {
  const root = rootRatio(N);
  const P = TAU / N;
  const shape = new THREE.Shape();
  for (let i = 0; i < N; i++) {
    const a = i * P;
    const pts: [number, number][] = [
      [root, a - 0.27 * P],
      [1, a - 0.11 * P],
      [1, a + 0.11 * P],
      [root, a + 0.27 * P],
    ];
    pts.forEach(([r, ang], k) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  const hub = new THREE.Path();
  hub.absarc(0, 0, o.hub ?? 0.13, 0, TAU, true);
  shape.holes.push(hub);

  const wN = o.windows ?? 0;
  if (wN > 0) {
    const inn = o.inner ?? 0.3;
    const out = Math.min(o.outer ?? 0.62, root - 0.08);
    const gap = (1 - (o.fill ?? 0.62)) * (TAU / wN);
    for (let w = 0; w < wN; w++) {
      const a0 = (w * TAU) / wN + gap / 2;
      const a1 = ((w + 1) * TAU) / wN - gap / 2;
      const p = new THREE.Path();
      p.moveTo(Math.cos(a0) * inn, Math.sin(a0) * inn);
      p.absarc(0, 0, out, a0, a1, false);
      p.lineTo(Math.cos(a1) * inn, Math.sin(a1) * inn);
      p.absarc(0, 0, inn, a1, a0, true);
      shape.holes.push(p);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.15);
  g.deleteAttribute("uv");
  return g;
}

/* ---------- shaders ---------- */
const GEAR_VERT = /* glsl */ `
  attribute float aPhase, aSpeed, aThick, aHot, aShade;
  uniform float uSpin;
  varying vec3 vN, vV;
  varying float vR, vFace, vHot, vShade, vDist, vWave;
  void main(){
    float ang = aPhase + aSpeed * uSpin;
    float c = cos(ang), s = sin(ang);
    vec3 p = position;
    p.z *= aThick;
    vec3 pr = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
    vec3 nr = vec3(normal.x * c - normal.y * s, normal.x * s + normal.y * c, normal.z);
    mat4 mvi = modelViewMatrix * instanceMatrix;
    vec4 mv = mvi * vec4(pr, 1.0);
    vN = normalize(mat3(mvi) * nr);
    vV = -mv.xyz;
    vR = length(position.xy);
    vFace = abs(normal.z);
    vHot = aHot;
    vShade = aShade;
    vDist = length(mv.xyz);
    float rc = length(instanceMatrix[3].xyz);
    float q = (fract(rc * 0.16 - uSpin * 0.11) - 0.5) * 6.0;
    vWave = exp(-q * q);
    gl_Position = projectionMatrix * mv;
  }
`;
const GEAR_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uBlue, uRed;
  uniform float uThink, uEnergy, uAmp, uErr, uFogK;
  varying vec3 vN, vV;
  varying float vR, vFace, vHot, vShade, vDist, vWave;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float d1 = max(dot(N, normalize(vec3(0.35, 0.6, 0.7))), 0.0);
    float d2 = max(dot(N, normalize(vec3(-0.6, -0.2, 0.5))), 0.0);
    float rim = pow(1.0 - abs(dot(N, V)), 2.5);
    float level = 0.1 + uThink * 0.65 + uErr * 0.6;
    float red = smoothstep(vHot - 0.06, vHot + 0.06, level);
    vec3 steel = mix(vec3(0.03, 0.06, 0.15), vec3(0.2, 0.035, 0.05), red);
    vec3 glow = mix(uBlue, uRed, red);
    float face = smoothstep(0.7, 1.0, vFace);
    float bands = 0.65 + 0.35 * sin(vR * 38.0);
    vec3 col = steel * (0.35 + 0.9 * d1 + 0.35 * d2) * mix(1.0, bands, face * 0.6) * vShade;
    col += glow * rim * 0.55;
    float tip = smoothstep(0.88, 1.0, vR) * (1.0 - face);
    col += glow * tip * (0.35 + vWave * 1.2);
    col += glow * (1.0 - face) * 0.07;
    col += glow * vWave * (0.15 + uThink * 0.4 + uAmp * 0.4) * (0.4 + 0.6 * face);
    float fog = exp(-vDist * uFogK);
    gl_FragColor = vec4(col * fog, 1.0);
  }
`;

const BLUE = new THREE.Vector3(0.08, 0.3, 1.0);
const RED = new THREE.Vector3(1.0, 0.06, 0.12);

const STATE_TARGET: Record<V2State, { energy: number; think: number; err: number }> = {
  idle: { energy: 0.35, think: 0, err: 0 },
  thinking: { energy: 0.8, think: 1, err: 0 },
  speaking: { energy: 0.65, think: 0.3, err: 0 },
  error: { energy: 0.9, think: 0.5, err: 0.55 },
};

const GEAR_SIZES = [8, 10, 12, 14, 16, 20, 24, 30];
const GEAR_W = [1.2, 1.2, 1.5, 1, 1, 0.8, 0.6, 0.4];
function pickN(): number {
  const tot = GEAR_W.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < GEAR_SIZES.length; i++) {
    r -= GEAR_W[i]!;
    if (r <= 0) return GEAR_SIZES[i]!;
  }
  return 12;
}

interface GearRec {
  N: number;
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  r: number;
  phase: number;
  speed: number;
  thick: number;
  hot: number;
  shade: number;
}

/** Cadenas de engranajes engranados dentro de una capa esférica [rmin, rmax]. */
function buildChains(
  rmin: number,
  rmax: number,
  target: number,
  mRange: [number, number],
): GearRec[] {
  const gears: GearRec[] = [];
  const REF = 6; // velocidad lineal de dientes (rad·dientes/s)
  let guard = 0;
  while (gears.length < target && guard++ < 6000) {
    const m = rnd(mRange[0], mRange[1]);
    const dirP = randDir();
    let pos = dirP.clone().multiplyScalar(rnd(rmin, rmax));
    const n =
      Math.random() < 0.55
        ? dirP.clone().add(randDir().multiplyScalar(0.25)).normalize()
        : randDir();
    const tmp = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    let e1 = tmp.clone().cross(n).normalize();
    let e2 = n.clone().cross(e1);
    const rot = rnd(0, TAU);
    const e1r = e1.clone().multiplyScalar(Math.cos(rot)).addScaledVector(e2, Math.sin(rot));
    const e2r = e2.clone().multiplyScalar(Math.cos(rot)).addScaledVector(e1, -Math.sin(rot));
    e1 = e1r;
    e2 = e2r;
    const basis = new THREE.Matrix4().makeBasis(e1, e2, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);

    const len = Math.floor(rnd(5, 16));
    const thick = rnd(0.7, 1.6);
    const mult = rnd(0.6, 1.8) * (Math.random() < 0.5 ? -1 : 1);
    let Nprev = pickN();
    let alphaPrev = rnd(0, TAU);
    let omegaPrev = (REF * mult) / Nprev;
    let theta = rnd(0, TAU);
    const push = (N: number, p: THREE.Vector3, alpha: number, omega: number) =>
      gears.push({
        N,
        pos: p.clone(),
        q,
        r: (N / 2 + 1) * m,
        phase: alpha,
        speed: omega,
        thick,
        hot: Math.random(),
        shade: rnd(0.75, 1.25),
      });
    push(Nprev, pos, alphaPrev, omegaPrev);

    for (let i = 1; i < len; i++) {
      theta += rnd(-0.8, 0.8);
      const Ni = pickN();
      const d = ((Nprev + Ni) * m) / 2;
      pos = pos
        .clone()
        .addScaledVector(e1, Math.cos(theta) * d)
        .addScaledVector(e2, Math.sin(theta) * d);
      const L = pos.length();
      if (L < rmin - 0.15 || L > rmax + 0.15) break;
      // fase que calza los dientes de Ni en los huecos del engranaje anterior
      const alpha = ((Nprev + Ni) * theta + (Ni - 1) * Math.PI - Nprev * alphaPrev) / Ni;
      const omega = (-omegaPrev * Nprev) / Ni;
      push(Ni, pos, alpha, omega);
      Nprev = Ni;
      alphaPrev = alpha;
      omegaPrev = omega;
    }
  }
  return gears;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class OrbScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private orb = new THREE.Group();
  private shells: { g: THREE.Group; axis: THREE.Vector3; w: number }[] = [];
  private glows: { s: THREE.Sprite; base: number }[] = [];
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private u: {
    uSpin: THREE.IUniform<number>;
    uEnergy: THREE.IUniform<number>;
    uThink: THREE.IUniform<number>;
    uAmp: THREE.IUniform<number>;
    uErr: THREE.IUniform<number>;
    uFogK: THREE.IUniform<number>;
    uBlue: THREE.IUniform<THREE.Vector3>;
    uRed: THREE.IUniform<THREE.Vector3>;
  };
  private gearMat: THREE.ShaderMaterial;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private resumeTimer = 0;
  private ro: ResizeObserver;
  private tex = glowTexture();
  private target = { ...STATE_TARGET.idle };
  private cur = { ...STATE_TARGET.idle };
  private amp = 0;
  private ampS = 0;
  private pulseV = 0;
  private spin = 0;
  private speaking = false;
  private inSecretV3 = false;

  constructor(private container: HTMLElement) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 1); // fondo completamente negro
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 90);
    this.camera.position.set(0, 2.4, w / h < 1 ? 19 : 13.5);

    this.u = {
      uSpin: { value: 0 },
      uEnergy: { value: 0.35 },
      uThink: { value: 0 },
      uAmp: { value: 0 },
      uErr: { value: 0 },
      uFogK: { value: 0.07 },
      uBlue: { value: BLUE },
      uRed: { value: RED },
    };
    this.gearMat = new THREE.ShaderMaterial({
      vertexShader: GEAR_VERT,
      fragmentShader: GEAR_FRAG,
      uniforms: { ...this.u },
    });

    this.buildMachine();
    this.buildRings();
    this.buildGlows();
    this.scene.add(this.orb);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 1.1; // zoom ágil: hay mucho recorrido hacia el interior
    this.controls.minDistance = 0.05; // llega hasta el centro del núcleo
    this.controls.maxDistance = 30;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      window.clearTimeout(this.resumeTimer);
    });
    this.controls.addEventListener("end", () => {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => (this.controls.autoRotate = true), 4500);
    });

    // render target multimuestreado: bordes de dientes sin dientes de sierra
    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.4, 0.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /* ---------- construcción ---------- */

  private gearGeo(N: number, o: GearOpts, key: string): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = gearGeometry(N, o);
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** Crea las mallas instanciadas (engranajes + ejes) de un conjunto de engranajes. */
  private addGears(parent: THREE.Object3D, gears: GearRec[]) {
    const byN = new Map<number, GearRec[]>();
    for (const g of gears) {
      const l = byN.get(g.N);
      if (l) l.push(g);
      else byN.set(g.N, [g]);
    }
    const M = new THREE.Matrix4();
    const sc = new THREE.Vector3();
    for (const [N, list] of byN) {
      const opts: GearOpts = N >= 14 ? { windows: 5, fill: 0.62, inner: 0.3, outer: 0.62 } : {};
      const base = this.gearGeo(N, opts, `g${N}`);
      const axleBase = this.gearGeo(0, {}, "axle");
      const count = list.length;
      const mk = (f: (g: GearRec) => number) => {
        const a = new Float32Array(count);
        list.forEach((g, i) => (a[i] = f(g)));
        return new THREE.InstancedBufferAttribute(a, 1);
      };
      const attrs = {
        aPhase: mk((g) => g.phase),
        aSpeed: mk((g) => g.speed),
        aThick: mk((g) => g.thick),
        aHot: mk((g) => g.hot),
        aShade: mk((g) => g.shade),
      };
      const make = (geo: THREE.BufferGeometry, noSpin: boolean) => {
        const gg = geo.clone();
        for (const [k, v] of Object.entries(attrs)) {
          gg.setAttribute(k, noSpin && k === "aSpeed" ? mk(() => 0) : v);
        }
        const mesh = new THREE.InstancedMesh(gg, this.gearMat, count);
        list.forEach((g, i) => {
          sc.setScalar(g.r);
          mesh.setMatrixAt(i, M.compose(g.pos, g.q, sc));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        parent.add(mesh);
      };
      make(base, false);
      make(axleBase, true);
    }
  }

  /** 4 capas esféricas de cadenas de engranajes; cada capa gira a su ritmo. */
  private buildMachine() {
    // el eje de los ejes: cilindro fino a lo largo de z
    const axle = new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1);
    axle.rotateX(Math.PI / 2);
    axle.deleteAttribute("uv");
    this.geoCache.set("axle", axle);

    const bands: { r0: number; r1: number; n: number; m: [number, number]; w: number }[] = [
      { r0: 0.35, r1: 2.0, n: 520, m: [0.016, 0.045], w: 0.09 },
      { r0: 2.0, r1: 3.4, n: 700, m: [0.022, 0.065], w: -0.06 },
      { r0: 3.4, r1: 4.7, n: 700, m: [0.03, 0.085], w: 0.045 },
      { r0: 4.7, r1: 5.8, n: 600, m: [0.04, 0.1], w: -0.03 },
    ];
    for (const b of bands) {
      const g = new THREE.Group();
      this.addGears(g, buildChains(b.r0, b.r1, b.n, b.m));
      this.orb.add(g);
      this.shells.push({ g, axis: randDir(), w: b.w });
    }
  }

  /** Anillos dentados grandes (ruedas con radios) inclinados que giran. */
  private buildRings() {
    const radii = [2.6, 3.6, 4.6, 5.6, 6.5];
    radii.forEach((R, i) => {
      const m = 0.09;
      const N = Math.round(2 * (R / m - 1));
      const geo = gearGeometry(N, { windows: 8, fill: 0.84, inner: 0.22, outer: 0.93, hub: 0.07 });
      const g = geo.clone();
      const one = (v: number) => new THREE.InstancedBufferAttribute(new Float32Array([v]), 1);
      g.setAttribute("aPhase", one(rnd(0, TAU)));
      g.setAttribute("aSpeed", one((0.12 + 0.05 * i) * (i % 2 ? 1 : -1)));
      g.setAttribute("aThick", one(0.18));
      g.setAttribute("aHot", one(rnd(0.05, 0.9)));
      g.setAttribute("aShade", one(1.1));
      const mesh = new THREE.InstancedMesh(g, this.gearMat, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(R, R, R));
      mesh.frustumCulled = false;
      const grp = new THREE.Group();
      grp.rotation.set(rnd(0.2, 1.4), rnd(0, TAU), 0);
      grp.add(mesh);
      this.orb.add(grp);
    });
  }

  /** Brasa muy tenue en el centro (no deslumbra). */
  private buildGlows() {
    const add = (c: THREE.Vector3, base: number, op: number) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.tex,
          color: new THREE.Color(c.x, c.y, c.z),
          transparent: true,
          opacity: op,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.scale.set(base, base, 1);
      this.orb.add(s);
      this.glows.push({ s, base });
    };
    add(BLUE, 4.5, 0.07);
    add(RED, 2.0, 0.07);
  }

  /* ---------- API ---------- */

  setState(s: V2State) {
    this.target = { ...STATE_TARGET[s] };
    this.speaking = s === "speaking";
    if (s === "idle") this.pulseV = Math.max(this.pulseV, 0.6);
  }

  setAmplitude(v: number) {
    this.amp = v;
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const k = 1 - Math.pow(0.002, dt);

    this.cur.energy += (this.target.energy - this.cur.energy) * k;
    this.cur.think += (this.target.think - this.cur.think) * k;
    this.cur.err += (this.target.err - this.cur.err) * k;
    const synth =
      this.speaking && this.amp < 0.02 ? 0.3 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.1) : 0;
    this.ampS += (Math.max(this.amp, synth) - this.ampS) * Math.min(1, dt * 12);
    this.pulseV = Math.max(0, this.pulseV - dt * 0.9);

    // reloj de giro: se acelera al pensar / hablar
    const speedMul =
      0.55 + this.cur.think * 2.4 + this.cur.energy * 0.35 + this.ampS * 1.8 + this.cur.err;
    this.spin += dt * speedMul;
    const u = this.u;
    u.uSpin.value = this.spin;
    u.uEnergy.value = this.cur.energy;
    u.uThink.value = this.cur.think;
    u.uAmp.value = this.ampS;
    u.uErr.value = this.cur.err;

    for (const s of this.shells) s.g.rotateOnAxis(s.axis, s.w * dt * speedMul);

    const breath = 1 + 0.05 * Math.sin(t * 1.4) + this.ampS * 0.3 + this.pulseV * 0.3;
    const [gb, gr] = this.glows;
    gb!.s.scale.setScalar(gb!.base * breath);
    gr!.s.scale.setScalar(gr!.base * breath * (1 + this.cur.think * 0.5));
    (gr!.s.material as THREE.SpriteMaterial).opacity =
      0.06 + this.cur.think * 0.12 + this.cur.err * 0.15;

    this.bloom.strength = 0.34 + this.cur.energy * 0.18 + this.ampS * 0.12 + this.pulseV * 0.12;

    this.controls.update(dt);
    // acceso oculto: al atravesar el núcleo con el zoom aparece "JUSPROSS 3.0"
    const inside = this.camera.position.distanceTo(this.controls.target) < 1.15;
    if (inside !== this.inSecretV3) {
      this.inSecretV3 = inside;
      window.dispatchEvent(new CustomEvent("juspross:secret-v3", { detail: { active: inside } }));
    }
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.resumeTimer);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.geoCache.forEach((g) => g.dispose());
    this.gearMat.dispose();
    this.tex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
