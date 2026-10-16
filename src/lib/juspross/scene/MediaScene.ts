import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* =====================================================================
 *  Lado IMA/VID — selva tropical con riachuelo y una bola de agua.
 *  · Selva densa a ambos lados, con profundidad: troncos, lianas, helechos,
 *    hojas grandes que se mecen, dosel, rayos de luz y niebla.
 *  · Riachuelo con agua realista: reflejos, fondo con cáusticas, espuma
 *    en las rocas y corriente que fluye hacia la cámara.
 *  · El núcleo es una bola de agua que ondula, con burbujas y gotas que
 *    caen al arroyo y rizan la superficie.
 *  Todo procedural (sin imágenes externas).
 * ===================================================================== */

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- ruido y forma del terreno (CPU) ---------- */
const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise2(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy),
    c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x: number, y: number, oct = 4) {
  let a = 0.5,
    s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise2(x, y);
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    a *= 0.5;
  }
  return s;
}
const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
function vnoise3(x: number, y: number, z: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(
      l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u),
      l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u),
      v,
    ),
    l(
      l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u),
      l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u),
      v,
    ),
    w,
  );
}

/** Eje del arroyo (serpentea a lo largo de z). Debe coincidir con cxz() de los shaders. */
const cx = (z: number) => 1.4 * Math.sin(z * 0.11 + 0.6) + 0.6 * Math.sin(z * 0.27);
const halfW = (z: number) => 1.9 + 0.4 * Math.sin(z * 0.19 + 1.0);

/** Altura del terreno: cauce hundido, orillas y colinas que suben a los lados. El agua está en y = 0. */
function terrainH(x: number, z: number): number {
  const ad = Math.abs(x - cx(z));
  const hw = halfW(z);
  const chan = 1 - sstep(hw * 0.55, hw + 1.6, ad);
  const base = fbm2(x * 0.22, z * 0.22) * 0.9 + fbm2(x * 1.1, z * 1.1) * 0.18;
  const bank = sstep(hw, hw + 2.5, ad) * 0.45;
  const hill =
    sstep(5, 16, ad) * (1.2 + 3.5 * sstep(12, 30, ad)) * (0.55 + 0.9 * fbm2(x * 0.08, z * 0.08));
  const bed = fbm2(x * 0.9 + 3, z * 0.9) * 0.12;
  return base * 0.35 + bank + hill - chan * (0.75 - bed);
}

function randDir(): THREE.Vector3 {
  const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
  return v.lengthSq() < 1e-4 ? v.set(0, 1, 0) : v.normalize();
}

/* ---------- texturas procedurales ---------- */
type LeafKind = "banana" | "monstera" | "fern" | "palm";

function leafCanvas(kind: LeafKind): HTMLCanvasElement {
  const W = 256,
    H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.lineCap = "round";
  const hw = (y: number) =>
    118 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0.02, (H - y) / H))), 0.7);

  if (kind === "fern") {
    const stem = (t: number) => ({ x: 128 + Math.sin(t * 2.0) * 14 * t, y: 506 - t * 494 });
    g.strokeStyle = "#2c5e1a";
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const s = stem(i / 40);
      if (i === 0) g.moveTo(s.x, s.y);
      else g.lineTo(s.x, s.y);
    }
    g.stroke();
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const s = stem(t);
      const len = 98 * Math.pow(1 - t, 0.65) + 10;
      const up = 0.95 - 0.35 * t;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(Math.atan2(-Math.sin(up), side * Math.cos(up)));
        const grad = g.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, "#245414");
        grad.addColorStop(1, i % 2 ? "#3f8a24" : "#4a9a2a");
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(len / 2, 0, len / 2, Math.max(3, len * 0.11), 0, 0, TAU);
        g.fill();
        g.strokeStyle = "rgba(180,230,120,0.35)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(len * 0.95, 0);
        g.stroke();
        g.restore();
      }
    }
    return c;
  }

  if (kind === "palm") {
    g.strokeStyle = "#2a5a18";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(128, 508);
    g.lineTo(128, 6);
    g.stroke();
    for (let i = 0; i < 64; i++) {
      const t = i / 64;
      const y = 496 - t * 480;
      const len = 108 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.06)), 0.8) + 8;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(128, y);
        g.rotate(Math.atan2(-0.55, side));
        const grad = g.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0, "#1f4f12");
        grad.addColorStop(1, "#4b9a2b");
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(len / 2, 0, len / 2, 3.2, 0, 0, TAU);
        g.fill();
        g.restore();
      }
    }
    return c;
  }

  // hojas anchas (banano / monstera)
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, "#1a4410");
  grad.addColorStop(0.5, "#2f7b1c");
  grad.addColorStop(1, "#43953a");
  g.beginPath();
  if (kind === "monstera") {
    g.moveTo(128, 506);
    g.bezierCurveTo(14, 470, 4, 210, 128, 10);
    g.bezierCurveTo(252, 210, 242, 470, 128, 506);
  } else {
    g.moveTo(128, 508);
    g.bezierCurveTo(34, 420, 10, 130, 128, 6);
    g.bezierCurveTo(246, 130, 222, 420, 128, 508);
  }
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = "rgba(12,44,6,0.55)";
  g.lineWidth = 3;
  g.stroke();

  // nervaduras
  for (let i = 1; i < 24; i++) {
    const y = 492 - i * 19.5;
    const w = hw(y);
    for (const side of [-1, 1]) {
      g.strokeStyle = "rgba(200,235,130,0.33)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(128, y + 6);
      g.quadraticCurveTo(128 + side * w * 0.55, y - 4, 128 + side * w * 0.96, y - 38);
      g.stroke();
    }
  }
  const mid = g.createLinearGradient(0, H, 0, 0);
  mid.addColorStop(0, "rgba(210,235,140,0.85)");
  mid.addColorStop(1, "rgba(210,235,140,0.35)");
  g.strokeStyle = mid;
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(128, 506);
  g.lineTo(128, 14);
  g.stroke();

  // recortes
  g.globalCompositeOperation = "destination-out";
  if (kind === "monstera") {
    for (let k = 0; k < 12; k++) {
      const side = k % 2 ? 1 : -1;
      const y = rnd(110, 430);
      g.beginPath();
      g.ellipse(128 + side * rnd(36, 74), y, rnd(5, 14), rnd(9, 24), rnd(-0.6, 0.6), 0, TAU);
      g.fill();
    }
    g.lineWidth = 6;
    for (let k = 0; k < 10; k++) {
      const side = k % 2 ? 1 : -1;
      const y = rnd(90, 440);
      const e = hw(y);
      g.beginPath();
      g.moveTo(128 + side * (e + 6), y);
      g.lineTo(128 + side * (e - rnd(36, 66)), y - rnd(8, 30));
      g.stroke();
    }
  } else {
    g.lineWidth = 2.6;
    for (let k = 0; k < 44; k++) {
      const side = k % 2 ? 1 : -1;
      const y = rnd(60, 470);
      const e = hw(y);
      g.beginPath();
      g.moveTo(128 + side * (e + 4), y);
      g.lineTo(128 + side * (e - rnd(18, 70)), y - rnd(14, 40));
      g.stroke();
    }
  }
  g.globalCompositeOperation = "source-atop";
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(0,20,0,0.06)" : "rgba(255,255,150,0.045)";
    g.beginPath();
    g.arc(rnd(0, W), rnd(0, H), rnd(0.8, 3), 0, TAU);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  return c;
}

function leafTexture(kind: LeafKind): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(leafCanvas(kind));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Mapa de normales periódico para el agua (ondas finas que se desplazan). */
function waterNormalMap(): THREE.DataTexture {
  const N = 256;
  const h = new Float32Array(N * N);
  const octs: [number, number][] = [
    [4, 0.5],
    [8, 0.3],
    [16, 0.16],
    [32, 0.08],
  ];
  const per = (px: number, py: number, P: number, seed: number) => {
    const x = (px / N) * P,
      y = (py / N) * P;
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const H = (a: number, b: number) =>
      hash2((((a % P) + P) % P) + seed, (((b % P) + P) % P) + seed * 1.7);
    const a = H(ix, iy),
      b = H(ix + 1, iy),
      c = H(ix, iy + 1),
      d = H(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      octs.forEach(([P, w], i) => {
        const n = per(x, y, P, i * 13.1);
        v += w * (1 - Math.abs(2 * n - 1)); // crestas → rizos de agua
      });
      h[y * N + x] = v;
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hl = h[y * N + ((x + N - 1) % N)]!,
        hr = h[y * N + ((x + 1) % N)]!;
      const hd = h[((y + N - 1) % N) * N + x]!,
        hu = h[((y + 1) % N) * N + x]!;
      const nx = (hl - hr) * 6,
        ny = (hd - hu) * 6;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Textura suave para rayos de luz y niebla. */
function softTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- shaders ---------- */

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uFogCol;
  uniform float uFogDen;
  float cxz(float z){ return 1.4 * sin(z * 0.11 + 0.6) + 0.6 * sin(z * 0.27); }
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn2(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm2(vec2 p){
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vn2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x){
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p){
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
  float openAt(vec3 w){ return smoothstep(7.0, 2.5, abs(w.x - cxz(w.z))); }
  float dapple(vec3 w){
    vec2 q = w.xz * 0.24 + w.y * vec2(0.06, 0.04) + vec2(uTime * 0.012, uTime * 0.008);
    return smoothstep(0.36, 0.62, fbm2(q));
  }
  float sunVis(vec3 w){ return mix(dapple(w) * 0.85, 1.0, openAt(w)); }
  vec3 fogMix(vec3 col, float dist){
    float f = 1.0 - exp(-dist * uFogDen);
    return mix(col, uFogCol, f);
  }
  vec3 litShade(vec3 alb, vec3 N, vec3 w, float ao){
    float vis = sunVis(w);
    float ndl = max(dot(N, uSun), 0.0);
    vec3 sunC = vec3(1.0, 0.9, 0.72) * 2.6;
    vec3 amb = mix(vec3(0.025, 0.05, 0.035), vec3(0.12, 0.2, 0.15), N.y * 0.5 + 0.5);
    return alb * (sunC * ndl * vis + amb) * ao;
  }
  float caustic(vec2 p){
    float t = uTime * 0.6;
    vec2 q = p * 2.6;
    float a = vn2(q + vec2(t, t * 0.7));
    float b = vn2(q * 1.15 - vec2(t * 0.8, -t));
    float c = abs(a - b);
    float k = 1.0 - smoothstep(0.0, 0.16, c);
    return k * k;
  }
  // entorno visto en reflejos y refracciones: follaje oscuro, claros de cielo y el sol
  vec3 envCol(vec3 d){
    float y = d.y;
    vec3 c = mix(vec3(0.02, 0.05, 0.035), vec3(0.06, 0.16, 0.09), smoothstep(-0.3, 0.4, y));
    float gap = smoothstep(0.55, 0.95, y) * 0.9 + smoothstep(0.2, -0.95, d.z) * smoothstep(-0.1, 0.5, y) * 0.7;
    c = mix(c, vec3(0.65, 0.82, 0.72), clamp(gap, 0.0, 1.0) * 0.8);
    float s = max(dot(d, uSun), 0.0);
    c += vec3(1.0, 0.85, 0.55) * (pow(s, 8.0) * 0.5 + pow(s, 500.0) * 25.0);
    return c;
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSun;
  uniform vec3 uFogCol;
  varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    vec3 col = mix(uFogCol, vec3(0.04, 0.1, 0.08), smoothstep(0.0, 0.7, d.y));
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.85, 0.55) * (pow(s, 6.0) * 0.6 + pow(s, 300.0) * 8.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TERRAIN_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const TERRAIN_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  varying vec3 vW;
  varying vec3 vN;
  void main(){
    vec3 N = normalize(vN);
    float h = vW.y;
    vec2 q = vW.xz;
    float n1 = fbm2(q * 1.6);
    float n2 = fbm2(q * 7.0);
    float n3 = vn2(q * 28.0);
    float slope = 1.0 - N.y;
    vec3 moss = mix(vec3(0.045, 0.15, 0.025), vec3(0.1, 0.23, 0.045), n1);
    vec3 litter = mix(vec3(0.15, 0.09, 0.045), vec3(0.08, 0.06, 0.035), n2);
    vec3 mud = mix(vec3(0.08, 0.06, 0.045), vec3(0.14, 0.105, 0.07), n2);
    vec3 gravel = mix(vec3(0.19, 0.17, 0.13), vec3(0.33, 0.29, 0.23), n3);
    vec3 rock = vec3(0.2, 0.215, 0.19) * (0.7 + 0.6 * n2);
    vec3 alb = mix(moss, litter, smoothstep(0.3, 0.75, n2 * n1 * 2.2));
    alb = mix(alb, mud, smoothstep(0.3, -0.05, h) * 0.85);
    alb = mix(alb, gravel, smoothstep(-0.02, -0.3, h));
    alb = mix(alb, rock, smoothstep(0.35, 0.62, slope + (n2 - 0.5) * 0.3));
    alb *= 0.8 + 0.4 * n3;
    alb *= mix(1.0, 0.55, smoothstep(0.35, -0.1, h));
    float ao = mix(0.55, 1.0, smoothstep(-0.7, 0.4, h));
    vec3 col = litShade(alb, N, vW, ao);
    float depth = max(-h, 0.0);
    float caus = caustic(q) * smoothstep(0.0, 0.1, depth) * exp(-depth * 1.4) * sunVis(vW);
    col += vec3(0.55, 0.8, 0.65) * caus * 0.5;
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), 1.0);
  }
`;

const WATER_VERT = /* glsl */ `
  attribute float aDepth;
  attribute float aAcross;
  varying vec3 vW;
  varying float vDepth;
  varying float vAcross;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vDepth = aDepth;
    vAcross = aAcross;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const WATER_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform sampler2D uNorm;
  uniform vec4 uRocks[24];
  uniform vec3 uBall;
  varying vec3 vW;
  varying float vDepth;
  varying float vAcross;
  void main(){
    vec2 uv = vW.xz;
    float depth = vDepth;
    float center = 1.0 - smoothstep(0.0, 1.0, abs(vAcross));
    float flow = 0.6 + 0.9 * center + 0.4 * smoothstep(0.0, 0.5, depth);
    float t = uTime;
    vec3 n1 = texture2D(uNorm, uv * 0.30 + vec2(0.0, -t * 0.16 * flow)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm, uv * 0.83 + vec2(0.13, -t * 0.42 * flow)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(uNorm, uv * 2.3 + vec2(0.31, -t * 0.95 * flow)).xyz * 2.0 - 1.0;
    float rough = 0.6 + 0.8 * smoothstep(0.35, 0.05, depth);
    vec2 slope = n1.xy * 0.45 + n2.xy * 0.35 * rough + n3.xy * 0.25 * rough;
    // ondas circulares de las gotas que caen de la bola
    vec2 db = uv - uBall.xy;
    float rr = length(db);
    float ring = sin(rr * 16.0 - t * 7.0) * exp(-rr * 1.4) * smoothstep(0.0, 0.3, rr);
    slope += db / max(rr, 1e-4) * ring * 0.35 * uBall.z;
    // espuma: orilla, alrededor de las rocas y su estela
    float foam = smoothstep(0.14, 0.0, depth) * (0.5 + 0.5 * vn2(uv * 5.0 + vec2(0.0, -t * 0.6)));
    for (int i = 0; i < 24; i++) {
      vec4 r = uRocks[i];
      if (r.z <= 0.0) continue;
      vec2 d = uv - r.xy;
      float dist = length(d) - r.z;
      foam += smoothstep(0.35, 0.0, dist) * (0.5 + 0.5 * sin(dist * 30.0 - t * 4.0 + n2.x * 3.0));
      if (d.y > 0.0) {
        float w = exp(-d.y * 0.5) * (1.0 - smoothstep(0.0, r.z * 1.3 + 0.15 * d.y, abs(d.x)));
        foam += w * 0.7 * (0.6 + 0.4 * n3.x);
      }
      slope += normalize(d + vec2(1e-4)) * sin(dist * 22.0 - t * 5.0) * exp(-max(dist, 0.0) * 3.0) * 0.12;
    }
    foam = clamp(foam, 0.0, 1.0);
    vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
    vec3 V = normalize(cameraPosition - vW);
    float ndv = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 refl = envCol(R);
    float vis = sunVis(vW);
    float absorb = 1.0 - exp(-depth * 1.7);
    vec3 bedShallow = vec3(0.3, 0.26, 0.16);
    vec3 deepC = vec3(0.01, 0.09, 0.08);
    vec3 body = mix(bedShallow * 0.9, deepC, absorb);
    float caus = caustic(uv) * (1.0 - absorb) * 1.5;
    body += vec3(0.5, 0.7, 0.5) * caus * 0.35;
    body *= 0.35 + 0.65 * vis;
    vec3 col = mix(body, refl, F);
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.9, 0.7) * pow(max(dot(N, H), 0.0), 350.0) * 9.0 * vis;
    col = mix(col, vec3(0.9, 0.97, 0.95) * (0.45 + 0.55 * vis), foam * 0.85);
    float alpha = (0.12 + absorb * 0.88) * smoothstep(0.0, 0.06, depth);
    alpha = max(alpha, foam * 0.9 * smoothstep(0.0, 0.03, depth + 0.02));
    alpha = clamp(alpha + F * (1.0 - alpha), 0.0, 1.0);
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), alpha);
  }
`;

const LEAF_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uBend, uWind;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vUv = uv;
    vSeed = aSeed;
    vec3 p = position;
    float u = uv.y;
    float bend = uBend * (0.6 + 0.8 * fract(aSeed * 7.31));
    p.z += bend * u * u;
    p.x += sin(u * 3.0 + aSeed * 9.0) * 0.04 * u;
    p.z += sin(p.x * 14.0 + aSeed * 20.0 + u * 5.0) * 0.012 * u;
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    float len = length(instanceMatrix[1].xyz);
    float ph = uTime * 1.4 + wp.x * 0.35 + wp.z * 0.3 + aSeed * 6.0;
    wp.x += sin(ph) * uWind * u * u * len * 0.06;
    wp.z += cos(ph * 0.83) * uWind * u * u * len * 0.045;
    wp.y += sin(ph * 1.3) * uWind * u * len * 0.02;
    vW = wp.xyz;
    vec3 nl = normalize(vec3(0.0, -2.0 * bend * u, 1.0));
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nl);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const LEAF_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform sampler2D uTex;
  uniform vec3 uTone;
  uniform float uTrans, uSheen;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vec4 t = texture2D(uTex, vUv);
    if (t.a < 0.5) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    if (dot(N, V) < 0.0) N = -N;
    float vis = sunVis(vW);
    float ndl = dot(N, uSun);
    float diff = max(ndl, 0.0);
    float trans = max(-ndl, 0.0) * uTrans;
    vec3 alb = t.rgb * uTone * (0.8 + 0.4 * fract(vSeed * 13.7));
    alb = mix(alb, alb * vec3(1.25, 1.1, 0.55), smoothstep(0.7, 1.0, fract(vSeed * 3.3)) * 0.5);
    float ao = mix(0.5, 1.0, smoothstep(0.0, 1.5, vW.y)) * (0.7 + 0.3 * vUv.y);
    vec3 amb = mix(vec3(0.03, 0.06, 0.04), vec3(0.13, 0.22, 0.16), N.y * 0.5 + 0.5);
    vec3 sunC = vec3(1.0, 0.9, 0.72) * 2.6;
    vec3 col = alb * (sunC * diff * vis + vec3(0.9, 1.0, 0.45) * sunC * trans * vis * 0.55 + amb) * ao;
    vec3 Hh = normalize(uSun + V);
    col += vec3(1.0, 0.95, 0.8) * pow(max(dot(N, Hh), 0.0), 40.0) * uSheen * vis;
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), 1.0);
  }
`;

const BARK_VERT = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vUv = uv;
    vSeed = aSeed;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const VINE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vUv = uv;
    vSeed = 0.5;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BARK_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform float uVine;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vec3 N = normalize(vN);
    float s1 = vn2(vec2(vUv.x * 38.0 + vSeed * 10.0, vUv.y * 2.5 + vSeed * 5.0));
    float s2 = vn2(vec2(vUv.x * 90.0, vUv.y * 6.0 + vSeed * 3.0));
    float ridge = 0.5 * s1 + 0.5 * s2;
    vec3 alb = mix(vec3(0.09, 0.07, 0.055), vec3(0.2, 0.16, 0.12), ridge);
    float low = 1.0 - smoothstep(0.0, 6.0, vW.y);
    float moss = smoothstep(0.45, 0.8, vn2(vec2(vUv.x * 8.0 + vSeed * 4.0, vUv.y * 10.0))) * (0.35 + 0.65 * low);
    alb = mix(alb, vec3(0.05, 0.2, 0.04) * (0.7 + 0.6 * ridge), clamp(moss, 0.0, 1.0) * (1.0 - uVine * 0.5));
    alb = mix(alb, vec3(0.06, 0.13, 0.05) * (0.6 + 0.8 * ridge), uVine);
    float cav = 0.55 + 0.9 * ridge;
    vec3 col = litShade(alb * cav, N, vW, mix(0.5, 1.0, smoothstep(0.0, 3.0, vW.y)));
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), 1.0);
  }
`;

const ROCK_VERT = /* glsl */ `
  attribute float aSeed;
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vSeed = aSeed;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const ROCK_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  varying vec3 vN;
  varying vec3 vW;
  varying float vSeed;
  void main(){
    vec3 N = normalize(vN);
    float n = fbm2(vW.xz * 5.0 + vW.y * 3.0 + vSeed * 10.0);
    vec3 alb = mix(vec3(0.17, 0.18, 0.16), vec3(0.3, 0.3, 0.26), n);
    float mossK = smoothstep(0.45, 0.85, N.y + (n - 0.5) * 0.5);
    alb = mix(alb, vec3(0.06, 0.21, 0.05) * (0.7 + 0.6 * n), mossK * 0.85);
    float wet = smoothstep(0.35, 0.0, vW.y);
    alb *= mix(1.0, 0.5, wet);
    float ao = mix(0.5, 1.0, smoothstep(-0.3, 0.5, vW.y));
    vec3 col = litShade(alb, N, vW, ao);
    vec3 V = normalize(cameraPosition - vW);
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(N, H), 0.0), 60.0) * wet * 0.5 * sunVis(vW);
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), 1.0);
  }
`;

/** Bola de agua: la superficie ondula; se ve el fondo refractado, reflejos y remolinos internos. */
const BALL_VERT = /* glsl */ `
  uniform float uTime, uAmp, uR;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vObj;
  float disp(vec3 n){
    float t = uTime;
    float w = 0.0;
    w += sin(n.x * 3.1 + t * 1.3) * sin(n.y * 2.7 - t * 1.1 + n.z) * 0.5;
    w += sin(n.z * 4.3 + t * 1.9 + n.x * 2.0) * 0.35;
    w += sin(dot(n, vec3(0.7, 0.5, 0.3)) * 7.0 - t * 2.4) * 0.22;
    w += sin(dot(n, vec3(-0.3, 0.8, 0.5)) * 11.0 + t * 3.1) * 0.1;
    return w;
  }
  void main(){
    vec3 n = normalize(position);
    float amp = 0.06 + uAmp * 0.07;
    vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.001)));
    vec3 t2 = cross(n, t1);
    float e = 0.02;
    vec3 n1 = normalize(n + t1 * e);
    vec3 n2 = normalize(n + t2 * e);
    vec3 p0 = n * (1.0 + disp(n) * amp);
    vec3 p1 = n1 * (1.0 + disp(n1) * amp);
    vec3 p2 = n2 * (1.0 + disp(n2) * amp);
    vec3 nn = normalize(cross(p1 - p0, p2 - p0));
    vec4 wp = modelMatrix * vec4(p0 * uR, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * nn);
    vObj = n;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BALL_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform float uBack;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vObj;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    if (!gl_FrontFacing) N = -N;
    float ndv = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 Rt = refract(-V, N, 1.0 / 1.33);
    vec3 refl = envCol(R);
    vec3 refr = envCol(Rt);
    vec3 q = vObj * 2.2 + vec3(0.0, uTime * 0.35, 0.0);
    float c1 = fbm3(q + fbm3(q * 1.7 + uTime * 0.2) * 1.2);
    float caus = pow(1.0 - abs(2.0 * c1 - 1.0), 6.0);
    vec3 body = mix(vec3(0.02, 0.18, 0.22), vec3(0.05, 0.55, 0.6), pow(1.0 - ndv, 1.5));
    vec3 col = body * 0.5 + refr * 0.55 + caus * vec3(0.4, 0.9, 0.9) * 0.45;
    col = mix(col, refl, F);
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.92, 0.75) * pow(max(dot(N, H), 0.0), 300.0) * 10.0;
    float rim = pow(1.0 - ndv, 3.0);
    col += vec3(0.2, 0.7, 0.75) * rim * 0.35;
    float alpha = clamp(0.5 + 0.5 * pow(1.0 - ndv, 1.2), 0.0, 0.92);
    if (uBack > 0.5) {
      col = body * 0.25 + caus * vec3(0.3, 0.8, 0.8) * 0.35;
      alpha = 0.35;
    }
    gl_FragColor = vec4(fogMix(col, length(cameraPosition - vW)), alpha);
  }
`;

const BUBBLE_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform vec3 uBallPos;
  uniform float uTime, uDpr, uR;
  varying float vA;
  void main(){
    float sp = 0.15 + aRnd.w * 0.3;
    vec3 rel = vec3(aRnd.x, mod(aRnd.y * 0.5 + 0.5 + uTime * sp, 1.0) * 2.0 - 1.0, aRnd.z) * 0.92;
    float l = length(rel);
    rel *= min(1.0, 0.92 / max(l, 0.001));
    rel += 0.03 * vec3(sin(uTime * 2.0 + aRnd.w * 30.0), 0.0, cos(uTime * 1.7 + aRnd.w * 20.0));
    vec4 mv = viewMatrix * vec4(uBallPos + rel * uR, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + 3.0 * aRnd.w) * uDpr * (10.0 / max(0.1, -mv.z));
    vA = 0.5 + 0.3 * sin(uTime * 2.0 + aRnd.w * 50.0);
  }
`;
const DROP_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform vec3 uBallPos;
  uniform float uTime, uDpr, uR;
  varying float vA;
  void main(){
    float Tf = 0.75 + aRnd.w * 0.4;
    float ph = fract(aRnd.x + uTime * (0.25 + aRnd.z * 0.2));
    float t = ph * Tf * 1.6;
    float az = aRnd.y * 6.2831;
    vec3 dir = normalize(vec3(cos(az) * 0.8, -0.6, sin(az) * 0.8));
    vec3 v = vec3(cos(az), 0.0, sin(az)) * (0.15 + 0.3 * aRnd.w);
    vec3 wp = uBallPos + dir * uR * 0.98 + v * t + vec3(0.0, -3.0 * t * t, 0.0);
    vA = wp.y > 0.0 ? (1.0 - smoothstep(0.7, 1.0, ph)) * (0.5 + 0.5 * aRnd.z) : 0.0;
    wp.y = max(wp.y, 0.0);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + 2.4 * aRnd.w) * uDpr * (10.0 / max(0.1, -mv.z));
  }
`;
const MOTE_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform float uTime, uDpr;
  varying float vA;
  void main(){
    vec3 p = position + vec3(sin(uTime * 0.3 + aRnd.w * 40.0), sin(uTime * 0.22 + aRnd.w * 23.0) * 0.6, cos(uTime * 0.27 + aRnd.w * 57.0)) * 0.8;
    p.y += mod(uTime * 0.05 * (0.3 + aRnd.x) + aRnd.y * 10.0, 3.0) * 0.2;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = pow(max(0.0, sin(uTime * (0.8 + aRnd.x * 2.0) + aRnd.w * 80.0)), 4.0);
    vA = 0.15 + 0.85 * tw * aRnd.z;
    gl_PointSize = (1.2 + 2.4 * aRnd.y) * uDpr * (12.0 / max(0.1, -mv.z));
  }
`;
const MOTE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float h = smoothstep(0.5, 0.0, d);
    float c = smoothstep(0.2, 0.0, d);
    gl_FragColor = vec4(uColor * (0.5 + c), (h * 0.5 + c * 0.6) * vA * uOpacity);
  }
`;

const RAY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RAY_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uSeed, uOpacity;
  varying vec2 vUv;
  void main(){
    float across = smoothstep(0.0, 0.6, 1.0 - abs(vUv.x * 2.0 - 1.0));
    across *= across;
    float s = 1.0 - vUv.y;
    float along = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.6, 1.0, s));
    float fl = 0.65 + 0.35 * sin(uTime * 0.4 + uSeed * 20.0 + vUv.y * 3.0);
    float n = 0.7 + 0.3 * sin(vUv.x * 9.0 + uTime * 0.2 + uSeed * 7.0);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.62) * across * along * fl * n * uOpacity, 1.0);
  }
`;
const MIST_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main(){
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const MIST_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vW;
  void main(){
    vec2 q = vW.xz * 0.12 + vec2(0.0, -uTime * 0.03);
    float m = smoothstep(0.42, 0.75, fbm2(q));
    float edge = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x)) * smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
    gl_FragColor = vec4(vec3(0.62, 0.78, 0.68) * m * edge * uOpacity, 1.0);
  }
`;

interface LeafInst {
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3;
}
interface LeafStyle {
  tone: [number, number, number];
  bend: number;
  wind: number;
  trans: number;
  sheen: number;
}

export class MediaScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sky!: THREE.Mesh;
  private ballMeshes: THREE.Mesh[] = [];
  private ballPos = new THREE.Vector3();
  private ballU = { value: new THREE.Vector3() };
  private ballAmp: THREE.IUniform<number> = { value: 0 };
  private ballBase = new THREE.Vector2();
  private rockVecs: THREE.Vector4[] = Array.from({ length: 24 }, () => new THREE.Vector4());
  private normTex: THREE.DataTexture;
  private soft: THREE.CanvasTexture;
  private leafTex: Record<LeafKind, THREE.CanvasTexture>;
  private leafGeo: THREE.BufferGeometry;
  private sh: {
    uTime: THREE.IUniform<number>;
    uSun: THREE.IUniform<THREE.Vector3>;
    uFogCol: THREE.IUniform<THREE.Vector3>;
    uFogDen: THREE.IUniform<number>;
    uDpr: THREE.IUniform<number>;
  };
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;

  constructor(private container: HTMLElement) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.sh = {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(-0.34, 0.74, -0.58).normalize() },
      uFogCol: { value: new THREE.Vector3(0.33, 0.5, 0.4) },
      uFogDen: { value: 0.028 },
      uDpr: { value: dpr },
    };
    this.renderer.setClearColor(new THREE.Color(0.33, 0.5, 0.4), 1);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.05, 400);

    this.normTex = waterNormalMap();
    this.soft = softTexture();
    this.leafTex = {
      banana: leafTexture("banana"),
      monstera: leafTexture("monstera"),
      fern: leafTexture("fern"),
      palm: leafTexture("palm"),
    };
    this.leafGeo = new THREE.PlaneGeometry(1, 1, 2, 6);
    this.leafGeo.translate(0, 0.5, 0);

    // posición de la bola sobre el arroyo
    const bz = -1.5;
    this.ballBase.set(cx(bz), bz);
    this.ballPos.set(this.ballBase.x, 2.3, bz);

    this.buildSky();
    this.buildTerrain();
    this.buildRocks();
    this.buildWater();
    this.buildTrees();
    this.buildVines();
    this.buildFoliage();
    this.buildBall();
    this.buildLight();
    this.buildMotes();

    this.camera.position.set(this.ballPos.x, 1.9, this.ballPos.z + 9.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.ballPos);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 13;
    this.controls.minPolarAngle = 1.15;
    this.controls.maxPolarAngle = 1.75;
    this.controls.minAzimuthAngle = -1.0;
    this.controls.maxAzimuthAngle = 1.0;
    this.controls.update();

    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /* ---------- utilidades ---------- */

  private mat(
    vs: string,
    fs: string,
    extra: Record<string, THREE.IUniform> = {},
    opts: THREE.ShaderMaterialParameters = {},
  ) {
    return new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      uniforms: { ...this.sh, ...extra },
      ...opts,
    });
  }

  private add(o: THREE.Object3D, order = 0) {
    o.frustumCulled = false;
    o.renderOrder = order;
    this.scene.add(o);
  }

  private seedAttr(n: number) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.random();
    return new THREE.InstancedBufferAttribute(a, 1);
  }

  /* ---------- cielo y terreno ---------- */

  private buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(220, 32, 16),
      this.mat(SKY_VERT, SKY_FRAG, {}, { side: THREE.BackSide, depthWrite: false }),
    );
    this.add(this.sky, -10);
  }

  private buildTerrain() {
    const g = new THREE.PlaneGeometry(100, 110, 330, 360);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) - 35;
      pos.setXYZ(i, x, terrainH(x, z), z);
    }
    g.computeVertexNormals();
    this.add(new THREE.Mesh(g, this.mat(TERRAIN_VERT, TERRAIN_FRAG)), 0);
  }

  /* ---------- rocas ---------- */

  private buildRocks() {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      const k =
        1 +
        0.32 * (vnoise3(x * 1.3 + 5, y * 1.3, z * 1.3) - 0.5) +
        0.12 * (vnoise3(x * 3.1, y * 3.1 + 2, z * 3.1) - 0.5);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();

    const items: { pos: THREE.Vector3; s: THREE.Vector3; q: THREE.Quaternion }[] = [];
    const foam: [number, number, number][] = [];
    for (let n = 0; n < 70; n++) {
      const z = rnd(-80, 10);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = cx(z) + side * (halfW(z) + rnd(0.2, 3.5));
      const r = rnd(0.2, 0.9);
      items.push({
        pos: new THREE.Vector3(x, terrainH(x, z) + r * 0.15, z),
        s: new THREE.Vector3(r * rnd(0.9, 1.4), r * rnd(0.55, 0.9), r * rnd(0.9, 1.4)),
        q: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rnd(-0.3, 0.3), rnd(0, TAU), rnd(-0.3, 0.3)),
        ),
      });
    }
    for (let n = 0; n < 26; n++) {
      const z = rnd(-34, 9);
      const x = cx(z) + rnd(-1.3, 1.3);
      const r = rnd(0.22, 0.6);
      const y = terrainH(x, z) + r * 0.35;
      items.push({
        pos: new THREE.Vector3(x, y, z),
        s: new THREE.Vector3(r * rnd(0.9, 1.3), r * rnd(0.7, 1.0), r * rnd(0.9, 1.3)),
        q: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rnd(-0.2, 0.2), rnd(0, TAU), rnd(-0.2, 0.2)),
        ),
      });
      if (y + r * 0.6 > 0.02) foam.push([x, z, r * 1.15]);
    }
    foam
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .forEach(([x, z, r], i) => this.rockVecs[i]!.set(x, z, r, 0));

    const g = geo.clone();
    g.setAttribute("aSeed", this.seedAttr(items.length));
    const mesh = new THREE.InstancedMesh(g, this.mat(ROCK_VERT, ROCK_FRAG), items.length);
    const M = new THREE.Matrix4();
    items.forEach((it, i) => mesh.setMatrixAt(i, M.compose(it.pos, it.q, it.s)));
    mesh.instanceMatrix.needsUpdate = true;
    this.add(mesh, 0);
  }

  /* ---------- agua del arroyo ---------- */

  private buildWater() {
    const rows = 320,
      cols = 40,
      z0 = 18,
      z1 = -88,
      half = 5.5;
    const pos = new Float32Array((rows + 1) * (cols + 1) * 3);
    const dep = new Float32Array((rows + 1) * (cols + 1));
    const acr = new Float32Array((rows + 1) * (cols + 1));
    let k = 0;
    for (let j = 0; j <= rows; j++) {
      const z = z0 + ((z1 - z0) * j) / rows;
      const c = cx(z);
      for (let i = 0; i <= cols; i++) {
        const u = -half + (2 * half * i) / cols;
        const x = c + u;
        pos[k * 3] = x;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = z;
        dep[k] = Math.max(0, -terrainH(x, z));
        acr[k] = u / (halfW(z) + 1.0);
        k++;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i,
          b = a + 1,
          c = a + cols + 1,
          d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aDepth", new THREE.BufferAttribute(dep, 1));
    g.setAttribute("aAcross", new THREE.BufferAttribute(acr, 1));
    g.setIndex(idx);
    const m = this.mat(
      WATER_VERT,
      WATER_FRAG,
      { uNorm: { value: this.normTex }, uRocks: { value: this.rockVecs }, uBall: this.ballU },
      {
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      },
    );
    this.add(new THREE.Mesh(g, m), 1);
  }

  /* ---------- troncos y lianas ---------- */

  private buildTrees() {
    const geo = new THREE.CylinderGeometry(0.7, 1.0, 1, 14, 10, false);
    geo.translate(0, 0.5, 0);
    const items: { pos: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
    const put = (x: number, z: number) => {
      const r = rnd(0.35, 0.95);
      items.push({
        pos: new THREE.Vector3(x, terrainH(x, z) - 0.3, z),
        q: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rnd(-0.05, 0.05), rnd(0, TAU), rnd(-0.05, 0.05)),
        ),
        s: new THREE.Vector3(r, rnd(20, 30), r),
      });
    };
    for (let n = 0; n < 62; n++) {
      const z = rnd(-82, 10);
      const side = Math.random() < 0.5 ? -1 : 1;
      put(cx(z) + side * (4.4 + Math.pow(Math.random(), 1.5) * 22), z);
    }
    for (let n = 0; n < 7; n++) {
      const z = rnd(1.5, 6.5);
      put(cx(z) + (n % 2 ? 1 : -1) * rnd(5.2, 7.5), z); // troncos que enmarcan la vista
    }
    const g = geo.clone();
    g.setAttribute("aSeed", this.seedAttr(items.length));
    const mesh = new THREE.InstancedMesh(
      g,
      this.mat(BARK_VERT, BARK_FRAG, { uVine: { value: 0 } }),
      items.length,
    );
    const M = new THREE.Matrix4();
    items.forEach((it, i) => mesh.setMatrixAt(i, M.compose(it.pos, it.q, it.s)));
    mesh.instanceMatrix.needsUpdate = true;
    this.add(mesh, 0);
  }

  private buildVines() {
    const geos: THREE.BufferGeometry[] = [];
    for (let n = 0; n < 46; n++) {
      const z = rnd(-70, 8);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = cx(z) + side * rnd(3.4, 18);
      const y0 = rnd(12, 20);
      const yEnd = terrainH(x, z) + rnd(0.3, 3.5);
      const pts = [
        new THREE.Vector3(x, y0, z),
        new THREE.Vector3(x + rnd(-1, 1), y0 * 0.65 + yEnd * 0.35, z + rnd(-1, 1)),
        new THREE.Vector3(x + rnd(-1.5, 1.5), y0 * 0.3 + yEnd * 0.7, z + rnd(-1.5, 1.5)),
        new THREE.Vector3(x + rnd(-1, 1), yEnd, z + rnd(-1, 1)),
      ];
      geos.push(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, rnd(0.025, 0.06), 5, false),
      );
    }
    const merged = mergeGeometries(geos);
    if (merged)
      this.add(new THREE.Mesh(merged, this.mat(VINE_VERT, BARK_FRAG, { uVine: { value: 1 } })), 0);
    geos.forEach((g) => g.dispose());
  }

  /* ---------- follaje ---------- */

  private leafMat(kind: LeafKind, st: LeafStyle) {
    return this.mat(
      LEAF_VERT,
      LEAF_FRAG,
      {
        uTex: { value: this.leafTex[kind] },
        uTone: { value: new THREE.Vector3(...st.tone) },
        uBend: { value: st.bend },
        uWind: { value: st.wind },
        uTrans: { value: st.trans },
        uSheen: { value: st.sheen },
      },
      { side: THREE.DoubleSide },
    );
  }

  private leaves(list: LeafInst[], kind: LeafKind, st: LeafStyle) {
    if (!list.length) return;
    const g = this.leafGeo.clone();
    g.setAttribute("aSeed", this.seedAttr(list.length));
    const mesh = new THREE.InstancedMesh(g, this.leafMat(kind, st), list.length);
    const M = new THREE.Matrix4();
    list.forEach((l, i) => mesh.setMatrixAt(i, M.compose(l.pos, l.q, l.s)));
    mesh.instanceMatrix.needsUpdate = true;
    this.add(mesh, 0);
  }

  private cluster(
    list: LeafInst[],
    base: THREE.Vector3,
    n: number,
    len: [number, number],
    wid: [number, number],
    pitch: [number, number],
  ) {
    const yaw0 = rnd(0, TAU);
    for (let i = 0; i < n; i++) {
      const phi = yaw0 + (i / n) * TAU + rnd(-0.4, 0.4);
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rnd(pitch[0], pitch[1]), phi, 0, "YXZ"),
      );
      list.push({
        pos: base.clone(),
        q,
        s: new THREE.Vector3(rnd(wid[0], wid[1]), rnd(len[0], len[1]), 1),
      });
    }
  }

  private spot(zr: [number, number], near: number, far: number, pw: number): THREE.Vector3 | null {
    for (let t = 0; t < 24; t++) {
      const z = rnd(zr[0], zr[1]);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = cx(z) + side * (halfW(z) + near + Math.pow(Math.random(), pw) * (far - near));
      const y = terrainH(x, z);
      if (y > 0.08) return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  private buildFoliage() {
    const banana: LeafInst[] = [],
      monstera: LeafInst[] = [],
      fern: LeafInst[] = [],
      palm: LeafInst[] = [],
      canopy: LeafInst[] = [];

    for (let n = 0; n < 92; n++) {
      const p = this.spot([-76, 11], 0.5, 15, 1.6);
      if (p) this.cluster(banana, p, Math.floor(rnd(6, 9)), [1.6, 3.0], [0.7, 1.2], [0.7, 1.3]);
    }
    for (let n = 0; n < 72; n++) {
      const p = this.spot([-76, 11], 0.4, 14, 1.6);
      if (p) this.cluster(monstera, p, Math.floor(rnd(5, 8)), [0.9, 1.7], [0.7, 1.2], [0.9, 1.5]);
    }
    for (let n = 0; n < 230; n++) {
      const p = this.spot([-76, 11], 0.2, 17, 1.4);
      if (p) this.cluster(fern, p, Math.floor(rnd(9, 13)), [0.9, 1.6], [0.55, 0.9], [0.9, 1.4]);
    }
    // plantas grandes en primer plano, a los lados de la cámara
    for (let n = 0; n < 16; n++) {
      const z = rnd(2.5, 7);
      const side = n % 2 ? 1 : -1;
      const x = cx(z) + side * rnd(2.8, 5.5);
      const y = terrainH(x, z);
      if (y < 0.08) continue;
      this.cluster(
        n % 3 ? monstera : banana,
        new THREE.Vector3(x, y, z),
        6,
        [2.4, 3.6],
        [1.4, 2.1],
        [0.5, 1.1],
      );
      if (n % 2)
        this.cluster(
          fern,
          new THREE.Vector3(x + rnd(-0.6, 0.6), y, z + rnd(-0.6, 0.6)),
          10,
          [1.4, 2.0],
          [0.8, 1.2],
          [0.8, 1.3],
        );
    }
    // palmeras: tronco delgado + corona
    const palmTrunks: { pos: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
    for (let n = 0; n < 24; n++) {
      const p = this.spot([-70, 8], 3, 20, 1.2);
      if (!p) continue;
      const h = rnd(3, 8);
      palmTrunks.push({
        pos: p.clone().add(new THREE.Vector3(0, -0.2, 0)),
        q: new THREE.Quaternion(),
        s: new THREE.Vector3(rnd(0.1, 0.17), h, rnd(0.1, 0.17)),
      });
      this.cluster(
        palm,
        p.clone().add(new THREE.Vector3(0, h, 0)),
        13,
        [2.2, 3.4],
        [0.9, 1.3],
        [0.5, 1.5],
      );
    }
    if (palmTrunks.length) {
      const g = new THREE.CylinderGeometry(0.75, 1.0, 1, 8, 6, false);
      g.translate(0, 0.5, 0);
      g.setAttribute("aSeed", this.seedAttr(palmTrunks.length));
      const mesh = new THREE.InstancedMesh(
        g,
        this.mat(BARK_VERT, BARK_FRAG, { uVine: { value: 0 } }),
        palmTrunks.length,
      );
      const M = new THREE.Matrix4();
      palmTrunks.forEach((it, i) => mesh.setMatrixAt(i, M.compose(it.pos, it.q, it.s)));
      mesh.instanceMatrix.needsUpdate = true;
      this.add(mesh, 0);
    }
    // dosel: hojas enormes en lo alto, con un claro sobre el arroyo
    for (let n = 0; n < 520; n++) {
      const z = rnd(-86, 12);
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = cx(z) + side * rnd(3.4, 34);
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rnd(1.25, 1.75), rnd(0, TAU), 0, "YXZ"),
      );
      canopy.push({
        pos: new THREE.Vector3(x, rnd(11, 22), z),
        q,
        s: new THREE.Vector3(rnd(2.2, 4), rnd(3.5, 7), 1),
      });
    }

    this.leaves(banana, "banana", {
      tone: [0.95, 1.0, 0.9],
      bend: 0.9,
      wind: 1.0,
      trans: 0.9,
      sheen: 0.25,
    });
    this.leaves(monstera, "monstera", {
      tone: [0.9, 1.0, 0.9],
      bend: 0.5,
      wind: 0.8,
      trans: 0.7,
      sheen: 0.35,
    });
    this.leaves(fern, "fern", {
      tone: [0.95, 1.05, 0.9],
      bend: 0.5,
      wind: 1.2,
      trans: 1.0,
      sheen: 0.1,
    });
    this.leaves(palm, "palm", {
      tone: [1.0, 1.0, 0.9],
      bend: 1.2,
      wind: 1.0,
      trans: 0.8,
      sheen: 0.15,
    });
    this.leaves(canopy, "banana", {
      tone: [0.55, 0.75, 0.5],
      bend: 0.8,
      wind: 0.5,
      trans: 1.2,
      sheen: 0.2,
    });
  }

  /* ---------- la bola de agua ---------- */

  private buildBall() {
    const geo = new THREE.SphereGeometry(1, 128, 96);
    const mk = (back: boolean) =>
      this.mat(
        BALL_VERT,
        BALL_FRAG,
        { uAmp: this.ballAmp, uR: { value: 1.15 }, uBack: { value: back ? 1 : 0 } },
        { transparent: true, depthWrite: false, side: back ? THREE.BackSide : THREE.FrontSide },
      );
    const back = new THREE.Mesh(geo, mk(true));
    const front = new THREE.Mesh(geo, mk(false));
    this.ballMeshes = [back, front];
    this.add(back, 3);
    this.add(front, 4);

    const pts = (count: number, vs: string, color: THREE.Vector3, op: number) => {
      const rn = new Float32Array(count * 4);
      for (let i = 0; i < count * 4; i++) rn[i] = i % 4 === 3 ? Math.random() : rnd(-1, 1);
      if (vs === DROP_VERT)
        for (let i = 0; i < count; i++) {
          rn[i * 4] = Math.random();
          rn[i * 4 + 1] = Math.random();
          rn[i * 4 + 2] = Math.random();
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute("aRnd", new THREE.Float32BufferAttribute(rn, 4));
      const m = this.mat(
        vs,
        MOTE_FRAG,
        {
          uBallPos: { value: this.ballPos },
          uR: { value: 1.15 },
          uColor: { value: color },
          uOpacity: { value: op },
        },
        { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending },
      );
      this.add(new THREE.Points(g, m), 5);
    };
    pts(140, BUBBLE_VERT, new THREE.Vector3(0.8, 1.0, 1.0), 0.9);
    pts(160, DROP_VERT, new THREE.Vector3(0.75, 0.95, 1.0), 0.95);
  }

  /* ---------- luz: rayos y niebla ---------- */

  private buildLight() {
    const sun = this.sh.uSun.value;
    const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sun);
    for (let k = 0; k < 12; k++) {
      const w = rnd(1.5, 3.5);
      const L = 26;
      const top = new THREE.Vector3(rnd(-8, 8), 20, rnd(-48, 4));
      const center = top.clone().addScaledVector(sun, -L / 2);
      const seed = Math.random();
      for (let c = 0; c < 2; c++) {
        const m = this.mat(
          RAY_VERT,
          RAY_FRAG,
          { uSeed: { value: seed }, uOpacity: { value: rnd(0.05, 0.1) } },
          {
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          },
        );
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, L), m);
        mesh.position.copy(center);
        const spin = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          seed * TAU + c * (Math.PI / 2),
        );
        mesh.quaternion.copy(align).multiply(spin);
        this.add(mesh, 7);
      }
    }
    [0.25, 0.6, 1.1].forEach((y, i) => {
      const g = new THREE.PlaneGeometry(16, 96);
      g.rotateX(-Math.PI / 2);
      const m = this.mat(
        MIST_VERT,
        MIST_FRAG,
        { uOpacity: { value: 0.12 - i * 0.03 } },
        {
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        },
      );
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, y, -36);
      this.add(mesh, 2);
    });
  }

  private buildMotes() {
    const make = (count: number, color: THREE.Vector3, op: number) => {
      const pos = new Float32Array(count * 3);
      const rn = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        pos.set([rnd(-14, 14), rnd(0.3, 9), rnd(-45, 8)], i * 3);
        rn.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aRnd", new THREE.Float32BufferAttribute(rn, 4));
      const m = this.mat(
        MOTE_VERT,
        MOTE_FRAG,
        { uColor: { value: color }, uOpacity: { value: op } },
        { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending },
      );
      this.add(new THREE.Points(g, m), 6);
    };
    make(520, new THREE.Vector3(0.9, 0.95, 0.8), 0.7); // polvo / polen en los rayos
    make(130, new THREE.Vector3(0.75, 1.0, 0.35), 1.0); // luciérnagas
  }

  /* ---------- API ---------- */

  /** Intensidad extra del oleaje de la bola (0..1). */
  setLevel(v: number) {
    this.ballAmp.value = v;
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
    this.sh.uTime.value = t;

    // la bola flota sobre el arroyo
    this.ballPos.set(this.ballBase.x, 2.3 + 0.12 * Math.sin(t * 0.9), this.ballBase.y);
    this.ballU.value.set(this.ballPos.x, this.ballPos.z, 1);
    for (const m of this.ballMeshes) {
      m.position.copy(this.ballPos);
      m.rotation.y += dt * 0.15;
    }
    this.sky.position.copy(this.camera.position);

    this.controls.update(dt);
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
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
    this.leafGeo.dispose();
    this.normTex.dispose();
    this.soft.dispose();
    Object.values(this.leafTex).forEach((t) => t.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
