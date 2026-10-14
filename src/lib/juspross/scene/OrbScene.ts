import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { V2State } from "../v2Store";

/* =====================================================================
 *  Núcleo 2.0 — un cerebro holográfico 3D, solo azul y rojo.
 *  · Corteza con circunvoluciones (surcos que brillan) y hemisferios.
 *  · Red neuronal: neuronas + sinapsis con señales que viajan por ellas.
 *  · Zonas de actividad que se encienden en rojo cuando "piensa".
 *  · Anillos HUD alrededor, sobre fondo negro, orbitable 360°.
 * ===================================================================== */

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- ruido 3D (Perlin) para las circunvoluciones ---------- */
const perm = (() => {
  const p = new Uint8Array(256).map((_, i) => i);
  let s = 1337;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255]!;
  return out;
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);
function grad(h: number, x: number, y: number, z: number) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
}
function noise3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255,
    Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x),
    v = fade(y),
    w = fade(z);
  const P = perm;
  const A = P[X]! + Y,
    AA = P[A]! + Z,
    AB = P[A + 1]! + Z;
  const B = P[X + 1]! + Y,
    BA = P[B]! + Z,
    BB = P[B + 1]! + Z;
  return lerp(
    lerp(
      lerp(grad(P[AA]!, x, y, z), grad(P[BA]!, x - 1, y, z), u),
      lerp(grad(P[AB]!, x, y - 1, z), grad(P[BB]!, x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(P[AA + 1]!, x, y, z - 1), grad(P[BA + 1]!, x - 1, y, z - 1), u),
      lerp(grad(P[AB + 1]!, x, y - 1, z - 1), grad(P[BB + 1]!, x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

/* ---------- forma del cerebro ---------- */
const S = 1.25; // escala global
const RX = 1.85,
  RY = 1.15,
  RZ = 1.45; // largo (x, frente = +x), alto, ancho

/** Radio de la corteza (sin pliegues) en la dirección unitaria d. */
function baseR(d: THREE.Vector3): number {
  let r = 1 / Math.sqrt((d.x / RX) ** 2 + (d.y / RY) ** 2 + (d.z / RZ) ** 2);
  if (d.y < 0) r *= 1 + d.y * 0.14; // base más plana
  const fiss = Math.exp(-(d.z * d.z) / 0.01) * smooth(-0.15, 0.55, d.y); // fisura entre hemisferios
  r *= 1 - 0.16 * fiss;
  r *=
    1 +
    0.07 * Math.exp(-((Math.abs(d.z) - 0.78) ** 2 + (d.y + 0.42) ** 2 + (d.x - 0.22) ** 2) / 0.14); // lóbulos temporales
  r *= 1 + 0.1 * Math.exp(-((d.y + 0.62) ** 2 + (d.x + 0.62) ** 2 + d.z * d.z * 0.5) / 0.09); // cerebelo
  return r * S;
}

/** 0 = surco (hendidura), 1 = cresta de la circunvolución. */
function foldAt(d: THREE.Vector3): number {
  const k = 4.2;
  const x = d.x * k,
    y = d.y * k,
    z = d.z * k;
  const wx = noise3(x * 0.6 + 11.3, y * 0.6, z * 0.6) * 0.85;
  const wy = noise3(x * 0.6, y * 0.6 + 7.1, z * 0.6) * 0.85;
  const wz = noise3(x * 0.6, y * 0.6, z * 0.6 + 3.7) * 0.85;
  const qx = x + wx,
    qy = y + wy,
    qz = z + wz;
  const n = noise3(qx, qy, qz) * 0.78 + noise3(qx * 2.3, qy * 2.3, qz * 2.3) * 0.22;
  let h = smooth(0, 0.13, Math.abs(n));
  const fiss = Math.exp(-(d.z * d.z) / 0.004) * smooth(-0.2, 0.5, d.y);
  h *= 1 - fiss;
  return h;
}

function randDir(): THREE.Vector3 {
  const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
  return v.lengthSq() < 1e-4 ? v.set(0, 1, 0) : v.normalize();
}

/* ---------- shaders ---------- */
const HOT = /* glsl */ `
  uniform vec4 uHot[6];
  uniform float uErr;
  float activityAt(vec3 d){
    float a = 0.0;
    for (int i = 0; i < 6; i++) a += uHot[i].w * exp(-(1.0 - dot(d, uHot[i].xyz)) * 4.5);
    return clamp(a + uErr, 0.0, 1.4);
  }
`;

const SURF_VERT = /* glsl */ `
  attribute float aFold;
  uniform float uTime, uThink, uAmp, uPulse;
  varying vec3 vN, vV, vDir, vObj;
  varying float vFold;
  void main(){
    float wave = sin(uTime * 2.2 + position.x * 5.0 + position.y * 7.0) * (0.004 + uThink * 0.012 + uAmp * 0.02);
    vec3 p = (position + normal * wave) * (1.0 + uPulse * 0.03 + uAmp * 0.025);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vDir = normalize(position);
    vObj = p;
    vFold = aFold;
    gl_Position = projectionMatrix * mv;
  }
`;
const SURF_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uThink, uEnergy, uAmp, uGain;
  uniform vec3 uBlue, uRed;
  ${HOT}
  varying vec3 vN, vV, vDir, vObj;
  varying float vFold;
  void main(){
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    float ndv = clamp(dot(N, normalize(vV)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.2);
    float act = activityAt(normalize(vDir));
    act = clamp(act + uThink * 0.14 * sin(uTime * 3.0 + vFold * 18.0 + vObj.x * 5.0), 0.0, 1.4);
    float heat = smoothstep(0.22, 0.95, act);
    vec3 base = mix(uBlue, uRed, heat);
    float crown = smoothstep(0.15, 1.0, vFold);
    float groove = 1.0 - smoothstep(0.0, 0.42, vFold);
    float diff = 0.55 + 0.45 * dot(N, normalize(vec3(0.35, 0.85, 0.55)));
    vec3 col = base * (0.10 + 0.38 * crown * diff);
    col += base * fres * (0.9 + uEnergy * 0.5);
    col += mix(uBlue, uRed, clamp(heat * 1.2, 0.0, 1.0)) * groove * (0.22 + heat * 1.5 + uThink * 0.3);
    float sq = (fract(vObj.y * 0.24 - uTime * 0.08) - 0.5) * 18.0;
    float scan = exp(-sq * sq);
    col += uBlue * scan * 0.45;
    col *= 1.0 + uAmp * 0.8;
    gl_FragColor = vec4(col * uGain, 1.0);
  }
`;

const EDGE_VERT = /* glsl */ `
  attribute float aU; attribute float aSeed; attribute float aSpeed;
  uniform float uTime, uEnergy, uThink, uAmp, uOpacity;
  uniform vec3 uBlue, uRed;
  ${HOT}
  varying vec3 vC; varying float vA;
  float hash(float n){ return fract(sin(n * 127.1) * 43758.5453); }
  void main(){
    float act = activityAt(normalize(position + vec3(1e-4)));
    float rate = 0.35 + uThink * 1.1 + uEnergy * 0.3 + uAmp * 0.8;
    float t = uTime * aSpeed * rate + aSeed * 10.0;
    float head = fract(t) * 1.5;
    float on = step(hash(floor(t) + aSeed * 91.0), 0.16 + uThink * 0.5 + act * 0.35);
    float d = head - aU;
    float pulse = (d > 0.0 && d < 0.6) ? exp(-d * 10.0) * on : 0.0;
    vec3 base = mix(uBlue, uRed, smoothstep(0.22, 0.95, act));
    vC = base * (0.5 + pulse * 2.6) + vec3(pulse * 0.3);
    vA = (0.1 + pulse * 0.9 + act * 0.08) * uOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const EDGE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vC; varying float vA;
  void main(){ gl_FragColor = vec4(vC, vA); }
`;

const NEURON_VERT = /* glsl */ `
  attribute float aSeed; attribute float aSize;
  uniform float uTime, uEnergy, uThink, uAmp, uDpr;
  uniform vec3 uBlue, uRed;
  ${HOT}
  varying vec3 vColor; varying float vA;
  void main(){
    float act = activityAt(normalize(position + vec3(1e-4)));
    float flash = pow(max(0.0, sin(uTime * (1.5 + uThink * 3.0) * (0.5 + aSeed) + aSeed * 40.0)), 14.0) * (0.3 + uThink + act);
    vec3 base = mix(uBlue, uRed, smoothstep(0.22, 0.95, act));
    vColor = base * (0.6 + flash * 2.2) + vec3(flash * 0.3);
    vA = 0.55 + 0.45 * min(1.0, flash + act * 0.5);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (1.0 + flash * 2.6 + uAmp * 0.6) * uDpr * (14.0 / max(0.1, -mv.z));
  }
`;
const DOT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float halo = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.2, 0.0, d);
    gl_FragColor = vec4(vColor * (0.4 + halo * 0.9 + core * 1.1), (halo * 0.5 + core * 0.6) * vA * uOpacity);
  }
`;

const HUD_VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aA; attribute float aSeed;
  uniform float uTime, uEnergy;
  varying vec3 vC; varying float vAlpha;
  void main(){
    vC = aColor;
    float fl = 0.7 + 0.3 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 40.0);
    vAlpha = aA * fl * (0.8 + uEnergy * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const HUD_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vC; varying float vAlpha;
  void main(){ gl_FragColor = vec4(vC, vAlpha * uOpacity); }
`;

const BLUE = new THREE.Color(0.08, 0.3, 1.0);
const RED = new THREE.Color(1.0, 0.06, 0.12);

const STATE_TARGET: Record<V2State, { energy: number; think: number; err: number }> = {
  idle: { energy: 0.35, think: 0, err: 0 },
  thinking: { energy: 0.8, think: 1, err: 0 },
  speaking: { energy: 0.65, think: 0.3, err: 0 },
  error: { energy: 0.9, think: 0.5, err: 0.55 },
};

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
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
  private huds: { g: THREE.Group; speed: number }[] = [];
  private glows: { s: THREE.Sprite; base: number }[] = [];
  private hot = Array.from({ length: 6 }, () => new THREE.Vector4());
  private hotSeed = Array.from({ length: 6 }, (_, i) => ({
    a: rnd(0, 6.28),
    b: rnd(-1, 1),
    wa: rnd(0.12, 0.3) * (i % 2 ? 1 : -1),
    wb: rnd(0.1, 0.25),
    s: i < 2 ? 0.62 : rnd(0.55, 1),
  }));
  private shared: {
    uTime: THREE.IUniform<number>;
    uEnergy: THREE.IUniform<number>;
    uThink: THREE.IUniform<number>;
    uAmp: THREE.IUniform<number>;
    uPulse: THREE.IUniform<number>;
    uDpr: THREE.IUniform<number>;
    uErr: THREE.IUniform<number>;
    uHot: THREE.IUniform<THREE.Vector4[]>;
    uBlue: THREE.IUniform<THREE.Vector3>;
    uRed: THREE.IUniform<THREE.Vector3>;
  };
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
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.02, 200);
    this.camera.position.set(0.5, 1.6, w / h < 1 ? 15 : 10.5);

    this.shared = {
      uTime: { value: 0 },
      uEnergy: { value: 0.35 },
      uThink: { value: 0 },
      uAmp: { value: 0 },
      uPulse: { value: 0 },
      uDpr: { value: dpr },
      uErr: { value: 0 },
      uHot: { value: this.hot },
      uBlue: { value: new THREE.Vector3(BLUE.r, BLUE.g, BLUE.b) },
      uRed: { value: new THREE.Vector3(RED.r, RED.g, RED.b) },
    };

    const neurons = this.buildNeurons();
    this.buildBrainSurface();
    this.buildNetwork(neurons);
    this.buildHuds();
    this.buildGlows();
    this.buildBokeh();
    this.scene.add(this.orb);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.6;
    this.controls.minDistance = 0.38; // permite atravesar el núcleo
    this.controls.maxDistance = 18;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      window.clearTimeout(this.resumeTimer);
    });
    this.controls.addEventListener("end", () => {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => (this.controls.autoRotate = true), 4500);
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 0.16);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /* ---------- construcción ---------- */

  private mat(
    vs: string,
    fs: string,
    extra: Record<string, THREE.IUniform>,
    side: THREE.Side = THREE.FrontSide,
  ) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side,
      vertexShader: vs,
      fragmentShader: fs,
      uniforms: { ...this.shared, ...extra },
    });
  }

  /** Corteza: malla con surcos reales. Dos pasadas (cara trasera tenue + delantera) = volumen holográfico. */
  private buildBrainSurface() {
    let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, 240, 180);
    g.deleteAttribute("normal");
    g.deleteAttribute("uv");
    g = mergeVertices(g, 1e-4);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const fold = new Float32Array(pos.count);
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const h = foldAt(d);
      fold[i] = h;
      const r = baseR(d) + 0.1 * S * (h - 1);
      pos.setXYZ(i, d.x * r, d.y * r, d.z * r);
    }
    g.setAttribute("aFold", new THREE.BufferAttribute(fold, 1));
    g.computeVertexNormals();

    const back = new THREE.Mesh(
      g,
      this.mat(SURF_VERT, SURF_FRAG, { uGain: { value: 0.3 } }, THREE.BackSide),
    );
    const front = new THREE.Mesh(
      g,
      this.mat(SURF_VERT, SURF_FRAG, { uGain: { value: 0.85 } }, THREE.FrontSide),
    );
    back.frustumCulled = front.frustumCulled = false;
    back.renderOrder = 1;
    front.renderOrder = 2;
    this.orb.add(back, front);
  }

  /** Neuronas repartidas por la corteza y el interior. */
  private buildNeurons(): THREE.Vector3[] {
    const list: THREE.Vector3[] = [];
    for (let i = 0; i < 1100; i++) {
      const d = randDir();
      const f = i < 700 ? rnd(0.8, 0.97) : rnd(0.3, 0.8);
      list.push(d.multiplyScalar(baseR(d) * f));
    }
    const pos: number[] = [],
      seed: number[] = [],
      size: number[] = [];
    for (const p of list) {
      pos.push(p.x, p.y, p.z);
      seed.push(Math.random());
      size.push(rnd(1.4, 3.2));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    const pts = new THREE.Points(g, this.mat(NEURON_VERT, DOT_FRAG, { uOpacity: { value: 1 } }));
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    this.orb.add(pts);
    return list;
  }

  /** Sinapsis entre vecinas + grandes tractos que cruzan los hemisferios; por ellas viajan las señales. */
  private buildNetwork(n: THREE.Vector3[]) {
    const pos: number[] = [],
      us: number[] = [],
      seeds: number[] = [],
      speeds: number[] = [];
    const curve = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      c: THREE.Vector3,
      steps: number,
      speed: number,
    ) => {
      const seed = Math.random();
      const at = (u: number) =>
        new THREE.Vector3(
          (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
          (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
          (1 - u) * (1 - u) * a.z + 2 * (1 - u) * u * c.z + u * u * b.z,
        );
      for (let k = 0; k < steps; k++) {
        const u0 = k / steps,
          u1 = (k + 1) / steps;
        const p0 = at(u0),
          p1 = at(u1);
        pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        us.push(u0, u1);
        seeds.push(seed, seed);
        speeds.push(speed, speed);
      }
    };

    // vecinas cercanas (3 más próximas)
    const seen = new Set<number>();
    for (let i = 0; i < n.length; i++) {
      const a = n[i]!;
      const near: { j: number; d: number }[] = [];
      for (let j = 0; j < n.length; j++) {
        if (j === i) continue;
        const d = a.distanceToSquared(n[j]!);
        if (d < 0.7 * 0.7 * S * S) near.push({ j, d });
      }
      near.sort((x, y) => x.d - y.d);
      for (const { j } of near.slice(0, 3)) {
        const key = Math.min(i, j) * 5000 + Math.max(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        const b = n[j]!;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const c = mid.add(randDir().multiplyScalar(a.distanceTo(b) * 0.25));
        curve(a, b, c, 9, rnd(0.8, 1.3));
      }
    }

    // tractos largos: entre hemisferios (corpus callosum) y de frente a nuca
    for (let t = 0; t < 80; t++) {
      const a = n[Math.floor(Math.random() * n.length)]!;
      if (Math.abs(a.z) < 0.25) continue;
      let best: THREE.Vector3 | null = null,
        bd = Infinity;
      const mirror = new THREE.Vector3(a.x, a.y, -a.z);
      for (const b of n) {
        if (b.z * a.z > 0) continue;
        const d = b.distanceToSquared(mirror);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best) continue;
      const mid = a.clone().add(best).multiplyScalar(0.5);
      curve(a, best, new THREE.Vector3(mid.x, mid.y + rnd(0.25, 0.7) * S, 0), 26, rnd(1.2, 1.9));
    }
    for (let t = 0; t < 60; t++) {
      const a = n[Math.floor(Math.random() * n.length)]!;
      const b = n[Math.floor(Math.random() * n.length)]!;
      if (a.z * b.z < 0 || Math.abs(a.x - b.x) < 1.4 * S) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      curve(a, b, mid.multiplyScalar(1.15), 26, rnd(1.0, 1.7));
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(us, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speeds, 1));
    const lines = new THREE.LineSegments(
      g,
      this.mat(EDGE_VERT, EDGE_FRAG, { uOpacity: { value: 1 } }),
    );
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    this.orb.add(lines);
  }

  /** Anillos HUD con marcas, inclinados alrededor del cerebro. */
  private buildHuds() {
    const defs = [
      { r: 3.7, tilt: [1.25, 0.2], speed: 0.16, blue: true },
      { r: 4.3, tilt: [0.35, 0.9], speed: -0.11, blue: true },
      { r: 5.0, tilt: [1.0, 2.1], speed: 0.07, blue: false },
      { r: 3.25, tilt: [1.9, 1.3], speed: -0.2, blue: true },
    ];
    for (const d of defs) {
      const pos: number[] = [],
        col: number[] = [],
        a: number[] = [],
        seed: number[] = [];
      const c = d.blue ? BLUE : RED;
      const push = (x0: number, y0: number, x1: number, y1: number, al: number, s: number) => {
        pos.push(x0, y0, 0, x1, y1, 0);
        for (let k = 0; k < 2; k++) {
          col.push(c.r, c.g, c.b);
          a.push(al);
          seed.push(s);
        }
      };
      const N = 240,
        arcs = Math.floor(rnd(3, 6));
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2,
          a1 = ((i + 1) / N) * Math.PI * 2;
        if (Math.sin(a0 * arcs) > 0.7) continue;
        push(
          Math.cos(a0) * d.r,
          Math.sin(a0) * d.r,
          Math.cos(a1) * d.r,
          Math.sin(a1) * d.r,
          0.55,
          Math.random(),
        );
        if (i % 2 === 0) {
          const major = i % 10 === 0;
          const r2 = d.r + (major ? 0.16 : 0.06);
          push(
            Math.cos(a0) * d.r,
            Math.sin(a0) * d.r,
            Math.cos(a0) * r2,
            Math.sin(a0) * r2,
            major ? 0.85 : 0.5,
            Math.random(),
          );
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute("aA", new THREE.Float32BufferAttribute(a, 1));
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
      const l = new THREE.LineSegments(
        g,
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexShader: HUD_VERT,
          fragmentShader: HUD_FRAG,
          uniforms: {
            uTime: this.shared.uTime,
            uEnergy: this.shared.uEnergy,
            uOpacity: { value: 0.7 },
          },
        }),
      );
      l.frustumCulled = false;
      const grp = new THREE.Group();
      grp.rotation.set(d.tilt[0]!, d.tilt[1]!, 0);
      grp.add(l);
      this.orb.add(grp);
      this.huds.push({ g: l as unknown as THREE.Group, speed: d.speed });
    }
  }

  /** Resplandores del interior (se ven a través de la corteza). */
  private buildGlows() {
    const add = (c: THREE.Color, base: number, op: number) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.tex,
          color: c,
          transparent: true,
          opacity: op,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.position.set(0.1, -0.15, 0);
      s.scale.set(base, base, 1);
      s.renderOrder = 0;
      this.orb.add(s);
      this.glows.push({ s, base });
    };
    add(BLUE, 6.5, 0.2);
    add(RED, 2.6, 0.2);
    add(new THREE.Color(0.8, 0.9, 1), 0.9, 0.4);
  }

  /** Motas desenfocadas muy tenues para dar profundidad. */
  private buildBokeh() {
    const pos: number[] = [],
      seed: number[] = [],
      size: number[] = [];
    for (let i = 0; i < 60; i++) {
      const d = randDir().multiplyScalar(rnd(3, 6.5));
      pos.push(d.x, d.y, d.z);
      seed.push(Math.random());
      size.push(rnd(16, 40));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    const p = new THREE.Points(g, this.mat(NEURON_VERT, DOT_FRAG, { uOpacity: { value: 0.1 } }));
    p.frustumCulled = false;
    this.orb.add(p);
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

    const u = this.shared;
    u.uTime.value = t;
    u.uEnergy.value = this.cur.energy;
    u.uThink.value = this.cur.think;
    u.uAmp.value = this.ampS;
    u.uPulse.value = this.pulseV * this.pulseV;
    u.uErr.value = this.cur.err;

    // zonas de actividad que vagan por la corteza (más y más rojas al pensar)
    const speedMul = 0.6 + this.cur.think * 1.8;
    this.hotSeed.forEach((h, i) => {
      const a = h.a + t * h.wa * speedMul;
      const b = h.b + Math.sin(t * h.wb * speedMul) * 0.9;
      const cb = Math.cos(b * 1.2);
      const dir = new THREE.Vector3(
        Math.cos(a) * cb,
        Math.sin(b * 1.2) * 0.8,
        Math.sin(a) * cb,
      ).normalize();
      const baseS = i < 2 ? 0.5 : 0.22;
      const str =
        h.s *
        (baseS + this.cur.think * 0.95 + this.ampS * 0.6 + this.pulseV * 0.4) *
        (0.75 + 0.25 * Math.sin(t * 1.3 + i));
      this.hot[i]!.set(dir.x, dir.y, dir.z, str);
    });

    for (const h of this.huds)
      h.g.parent!.rotation.z += h.speed * dt * (0.7 + this.cur.energy + this.cur.think);

    // resplandor interior: azul en reposo, rojo al pensar
    const breath = 1 + 0.05 * Math.sin(t * 1.4) + this.ampS * 0.35 + this.pulseV * 0.4;
    const [gb, gr, gw] = this.glows;
    gb!.s.scale.setScalar(gb!.base * breath);
    gr!.s.scale.setScalar(gr!.base * breath * (1 + this.cur.think * 0.4));
    gw!.s.scale.setScalar(gw!.base * breath * (1 + this.ampS * 0.8));
    (gb!.s.material as THREE.SpriteMaterial).opacity =
      0.18 + this.cur.energy * 0.1 - this.cur.think * 0.05;
    (gr!.s.material as THREE.SpriteMaterial).opacity =
      0.1 + this.cur.think * 0.3 + this.cur.err * 0.25;
    (gw!.s.material as THREE.SpriteMaterial).opacity = 0.3 + this.cur.energy * 0.3;

    this.bloom.strength = 0.4 + this.cur.energy * 0.2 + this.ampS * 0.15 + this.pulseV * 0.15;

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
    });
    this.tex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
