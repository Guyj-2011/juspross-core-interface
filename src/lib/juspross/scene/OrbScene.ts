import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { V2State } from "../v2Store";

/* =====================================================================
 *  Núcleo 2.0 — energía azul, muy compleja y siempre en movimiento.
 *  De lejos: plasma en capas, retículas geodésicas con ondas, miles de
 *  partículas en órbita, rayos que chisporrotean, ondas de choque y
 *  anillos HUD. Sin brillo exagerado, pero con destellos.
 *  De cerca (zoom máximo): aparecen miles de engranajes microscópicos
 *  que engranan entre sí, escondidos en el corazón del núcleo.
 * ===================================================================== */

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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

/** Engranajes microscópicos: acero azul oscuro con filo de energía; se difuminan por cercanía. */
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
    float q = (fract(rc * 0.45 - uSpin * 0.13) - 0.5) * 6.0;
    vWave = exp(-q * q);
    gl_Position = projectionMatrix * mv;
  }
`;
const GEAR_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uThink, uAmp, uErr, uVis;
  varying vec3 vN, vV;
  varying float vR, vFace, vHot, vShade, vDist, vWave;
  void main(){
    // aparición por "trama" (dither): los engranajes solo existen con el zoom al máximo
    float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (h > uVis) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float d1 = max(dot(N, normalize(vec3(0.35, 0.6, 0.7))), 0.0);
    float d2 = max(dot(N, normalize(vec3(-0.6, -0.2, 0.5))), 0.0);
    float rim = pow(1.0 - abs(dot(N, V)), 2.5);
    vec3 glow = mix(vec3(0.1, 0.48, 1.0), vec3(1.0, 0.12, 0.15), uErr);
    vec3 steel = mix(vec3(0.012, 0.035, 0.1), vec3(0.12, 0.02, 0.03), uErr);
    float face = smoothstep(0.7, 1.0, vFace);
    float bands = 0.65 + 0.35 * sin(vR * 38.0);
    vec3 col = steel * (0.4 + 1.0 * d1 + 0.4 * d2) * mix(1.0, bands, face * 0.6) * vShade;
    col += glow * rim * 0.5;
    float sp = pow(max(0.0, sin(uTime * (2.0 + vHot * 5.0) + vHot * 60.0)), 24.0);
    float tip = smoothstep(0.88, 1.0, vR) * (1.0 - face);
    col += glow * tip * (0.3 + vWave * 1.1 + sp * 1.6);
    col += glow * (1.0 - face) * 0.06;
    col += glow * vWave * (0.12 + uThink * 0.35 + uAmp * 0.35) * (0.4 + 0.6 * face);
    col += vec3(0.6, 0.85, 1.0) * sp * 0.18 * face;
    gl_FragColor = vec4(col * exp(-vDist * 0.22), 1.0);
  }
`;

const NOISE = /* glsl */ `
  float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

/** Plasma: venas eléctricas y nubes de energía que fluyen sobre una esfera. */
const PLASMA_VERT = /* glsl */ `
  varying vec3 vObj, vN, vV;
  void main(){
    vObj = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const PLASMA_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uThink, uAmp, uErr, uScale, uSpeed, uOpacity;
  varying vec3 vObj, vN, vV;
  ${NOISE}
  void main(){
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 p = normalize(vObj) * uScale;
    float t = uTime * uSpeed;
    vec3 q = vec3(fbm3(p + vec3(0.0, t, 0.0)), fbm3(p + vec3(5.2, 1.3, -t)), fbm3(p + vec3(-t, 8.3, 2.8)));
    float n = fbm3(p + 1.8 * q + vec3(0.0, t * 0.5, 0.0));
    float veins = pow(1.0 - abs(2.0 * n - 1.0), 7.0);
    float cloud = smoothstep(0.3, 0.8, n);
    float fres = pow(1.0 - abs(dot(N, normalize(vV))), 2.0);
    vec3 col = vec3(0.015, 0.09, 0.42) * cloud * 0.4;
    col += vec3(0.08, 0.5, 1.0) * veins * (0.7 + uThink * 1.3);
    col += vec3(0.7, 0.9, 1.0) * veins * veins * (0.25 + uThink * 0.6);
    col += vec3(0.05, 0.3, 1.0) * fres * 0.3;
    col = mix(col, vec3(col.b, col.g * 0.2, col.r * 0.2), uErr);
    gl_FragColor = vec4(col * uOpacity * (1.0 + uAmp * 0.7), 1.0);
  }
`;

/** Miles de partículas en órbitas inclinadas, con zonas brillantes que viajan. */
const ORBIT_VERT = /* glsl */ `
  attribute vec4 aOrbit;
  attribute vec3 aRot;
  uniform float uTime, uSpin, uThink, uAmp, uDpr, uEnergy, uErr;
  varying vec3 vColor;
  varying float vA;
  void main(){
    float a = aOrbit.z + aOrbit.y * uSpin;
    float r = aOrbit.x * (1.0 + 0.025 * sin(uTime * 0.7 + aRot.z * 20.0) + uAmp * 0.05);
    vec3 p = vec3(cos(a) * r, sin(a * 3.0 + aRot.z * 9.0) * r * 0.035, sin(a) * r);
    float ct = cos(aRot.x), st = sin(aRot.x);
    p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
    float ca = cos(aRot.y), sa = sin(aRot.y);
    p = vec3(p.x * ca + p.z * sa, p.y, -p.x * sa + p.z * ca);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float comet = pow(0.5 + 0.5 * sin(a * 2.0 + aRot.z * 31.0 - uSpin * 0.6), 3.0);
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aRot.z * 3.0) + aRot.z * 60.0);
    vA = 0.22 + 0.78 * comet * (0.6 + 0.4 * tw);
    vec3 c = mix(vec3(0.04, 0.25, 0.95), vec3(0.55, 0.85, 1.0), comet * comet) * (0.8 + uThink * 0.6);
    vColor = mix(c, vec3(c.b, c.g * 0.2, c.r * 0.2), uErr);
    gl_PointSize = aOrbit.w * uDpr * (1.0 + uEnergy * 0.2) * (12.0 / max(0.05, -mv.z));
  }
`;
const DOT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float halo = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.2, 0.0, d);
    gl_FragColor = vec4(vColor * (0.4 + halo * 0.8 + core), (halo * 0.5 + core * 0.6) * vA * uOpacity);
  }
`;

/** Retículas geodésicas con ondas de luz que las recorren. */
const LATT_VERT = /* glsl */ `
  uniform float uSpin, uThink;
  varying float vB;
  void main(){
    vec3 d = normalize(position);
    float w = sin(dot(d, normalize(vec3(0.6, 0.5, 0.62))) * 7.0 - uSpin * 1.6);
    float w2 = sin(dot(d, normalize(vec3(-0.4, 0.8, -0.3))) * 11.0 + uSpin * 2.3);
    vB = 0.09 + 0.8 * pow(max(0.0, w), 8.0) * (0.5 + uThink) + 0.5 * pow(max(0.0, w2), 10.0) * (0.3 + uThink);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LATT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity, uErr;
  varying float vB;
  void main(){
    vec3 c = mix(vec3(0.05, 0.3, 1.0), vec3(0.7, 0.9, 1.0), clamp(vB, 0.0, 1.0)) * vB * uOpacity;
    gl_FragColor = vec4(mix(c, vec3(c.b, c.g * 0.2, c.r * 0.2), uErr), 1.0);
  }
`;
const NODE_VERT = /* glsl */ `
  uniform float uSpin, uThink, uDpr;
  varying vec3 vColor;
  varying float vA;
  void main(){
    vec3 d = normalize(position);
    float w = sin(dot(d, normalize(vec3(0.6, 0.5, 0.62))) * 7.0 - uSpin * 1.6);
    float b = 0.25 + 0.9 * pow(max(0.0, w), 8.0) * (0.5 + uThink);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = mix(vec3(0.1, 0.4, 1.0), vec3(0.8, 0.93, 1.0), clamp(b, 0.0, 1.0));
    vA = clamp(b, 0.0, 1.0);
    gl_PointSize = 2.4 * uDpr * (0.8 + b) * (12.0 / max(0.05, -mv.z));
  }
`;

/** Rayos que chisporrotean entre capas. */
const ARC_VERT = /* glsl */ `
  attribute float aU, aSeed;
  attribute vec3 aJit;
  uniform float uTime, uThink, uAmp;
  varying float vA;
  void main(){
    float env = sin(3.14159 * aU);
    float j = sin(uTime * (6.0 + aSeed * 8.0) + aSeed * 90.0 + aU * 12.0);
    vec3 p = position + aJit * env * j * (0.12 + uThink * 0.25 + uAmp * 0.2);
    float flash = pow(max(0.0, sin(uTime * (0.5 + aSeed * 0.9) + aSeed * 60.0)), 24.0);
    vA = (0.03 + flash * (0.6 + uThink * 1.4)) * env;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const ARC_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity, uErr;
  varying float vA;
  void main(){
    vec3 c = mix(vec3(0.1, 0.45, 1.0), vec3(0.85, 0.95, 1.0), clamp(vA * 1.3, 0.0, 1.0)) * vA * uOpacity;
    gl_FragColor = vec4(mix(c, vec3(c.b, c.g * 0.2, c.r * 0.2), uErr), 1.0);
  }
`;

/** Ondas de choque: cáscaras de luz que se expanden desde el centro. */
const WAVE_VERT = /* glsl */ `
  varying vec3 vN, vV;
  void main(){
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const WAVE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uLife, uOpacity, uThink, uErr;
  varying vec3 vN, vV;
  void main(){
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
    float a = f * pow(1.0 - uLife, 2.0) * uOpacity * (0.7 + uThink);
    vec3 c = vec3(0.1, 0.5, 1.0) * a;
    gl_FragColor = vec4(mix(c, vec3(c.b, c.g * 0.2, c.r * 0.2), uErr), 1.0);
  }
`;

/** Anillos HUD con marcas. */
const HUD_VERT = /* glsl */ `
  attribute float aA, aSeed;
  uniform float uTime, uEnergy;
  varying float vAlpha;
  void main(){
    float fl = 0.7 + 0.3 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 40.0);
    vAlpha = aA * fl * (0.8 + uEnergy * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const HUD_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity, uErr;
  varying float vAlpha;
  void main(){
    vec3 c = vec3(0.08, 0.38, 1.0) * vAlpha * uOpacity;
    gl_FragColor = vec4(mix(c, vec3(c.b, c.g * 0.2, c.r * 0.2), uErr), 1.0);
  }
`;

const STATE_TARGET: Record<V2State, { energy: number; think: number; err: number }> = {
  idle: { energy: 0.35, think: 0, err: 0 },
  thinking: { energy: 0.8, think: 1, err: 0 },
  speaking: { energy: 0.65, think: 0.3, err: 0 },
  error: { energy: 0.9, think: 0.5, err: 1 },
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

interface Spinner {
  o: THREE.Object3D;
  axis: THREE.Vector3;
  w: number;
}

export class OrbScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private orb = new THREE.Group();
  private gearRoot = new THREE.Group();
  private spinners: Spinner[] = [];
  private waves: { m: THREE.Mesh; mat: THREE.ShaderMaterial; k: number }[] = [];
  private glow!: THREE.Sprite;
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private u: {
    uTime: THREE.IUniform<number>;
    uSpin: THREE.IUniform<number>;
    uEnergy: THREE.IUniform<number>;
    uThink: THREE.IUniform<number>;
    uAmp: THREE.IUniform<number>;
    uErr: THREE.IUniform<number>;
    uDpr: THREE.IUniform<number>;
    uVis: THREE.IUniform<number>;
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
    this.renderer.setClearColor(0x000000, 1); // fondo completamente negro
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.004, 90);
    this.camera.position.set(0, 2.4, w / h < 1 ? 19 : 13.5);

    this.u = {
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uEnergy: { value: 0.35 },
      uThink: { value: 0 },
      uAmp: { value: 0 },
      uErr: { value: 0 },
      uDpr: { value: dpr },
      uVis: { value: 0 },
    };
    this.gearMat = new THREE.ShaderMaterial({
      vertexShader: GEAR_VERT,
      fragmentShader: GEAR_FRAG,
      uniforms: { ...this.u },
    });

    this.buildGears();
    this.buildPlasma();
    this.buildLattices();
    this.buildOrbits();
    this.buildArcs();
    this.buildWaves();
    this.buildHuds();
    this.buildGlow();
    this.orb.add(this.gearRoot);
    this.scene.add(this.orb);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 2.0; // mucho recorrido: de lejos hasta el corazón del núcleo
    this.controls.minDistance = 0.03; // zoom máximo
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

    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 0.22);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /* ---------- material helpers ---------- */

  private addMat(
    vs: string,
    fs: string,
    extra: Record<string, THREE.IUniform>,
    side: THREE.Side = THREE.FrontSide,
  ) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side,
      vertexShader: vs,
      fragmentShader: fs,
      uniforms: { ...this.u, ...extra },
    });
  }

  private spinner(o: THREE.Object3D, w: number) {
    this.orb.add(o);
    this.spinners.push({ o, axis: randDir(), w });
  }

  /* ---------- engranajes microscópicos (solo visibles con el zoom al máximo) ---------- */

  private gearGeo(N: number, o: GearOpts, key: string): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = gearGeometry(N, o);
      this.geoCache.set(key, g);
    }
    return g;
  }

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
      const opts: GearOpts = N >= 16 ? { windows: 5, fill: 0.62, inner: 0.3, outer: 0.62 } : {};
      const geo = this.gearGeo(N, opts, `g${N}`).clone();
      const count = list.length;
      const mk = (f: (g: GearRec) => number) => {
        const a = new Float32Array(count);
        list.forEach((g, i) => (a[i] = f(g)));
        return new THREE.InstancedBufferAttribute(a, 1);
      };
      geo.setAttribute(
        "aPhase",
        mk((g) => g.phase),
      );
      geo.setAttribute(
        "aSpeed",
        mk((g) => g.speed),
      );
      geo.setAttribute(
        "aThick",
        mk((g) => g.thick),
      );
      geo.setAttribute(
        "aHot",
        mk((g) => g.hot),
      );
      geo.setAttribute(
        "aShade",
        mk((g) => g.shade),
      );
      const mesh = new THREE.InstancedMesh(geo, this.gearMat, count);
      list.forEach((g, i) => {
        sc.setScalar(g.r);
        mesh.setMatrixAt(i, M.compose(g.pos, g.q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
  }

  private buildGears() {
    // radio de cada engranaje ≈ 0.004–0.02: invisibles de lejos
    const bands: { r0: number; r1: number; n: number; m: [number, number]; w: number }[] = [
      { r0: 0.04, r1: 0.35, n: 1200, m: [0.0007, 0.0017], w: 0.25 },
      { r0: 0.35, r1: 0.8, n: 1700, m: [0.001, 0.0024], w: -0.18 },
      { r0: 0.8, r1: 1.3, n: 1700, m: [0.0014, 0.0034], w: 0.12 },
      { r0: 1.3, r1: 1.9, n: 1400, m: [0.002, 0.004], w: -0.09 },
    ];
    for (const b of bands) {
      const g = new THREE.Group();
      this.addGears(g, buildChains(b.r0, b.r1, b.n, b.m));
      this.gearRoot.add(g);
      this.spinners.push({ o: g, axis: randDir(), w: b.w });
    }
    this.gearRoot.visible = false;
  }

  /* ---------- energía ---------- */

  /** Tres capas de plasma azul con venas eléctricas, una dentro de otra. */
  private buildPlasma() {
    const defs = [
      { r: 1.3, scale: 2.2, speed: 0.5, op: 0.5, w: 0.07 },
      { r: 2.3, scale: 2.8, speed: 0.35, op: 0.4, w: -0.05 },
      { r: 3.5, scale: 3.4, speed: 0.25, op: 0.32, w: 0.035 },
    ];
    for (const d of defs) {
      const mat = this.addMat(
        PLASMA_VERT,
        PLASMA_FRAG,
        { uScale: { value: d.scale }, uSpeed: { value: d.speed }, uOpacity: { value: d.op } },
        THREE.DoubleSide,
      );
      mat.depthTest = true;
      const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, 64, 48), mat);
      m.frustumCulled = false;
      this.spinner(m, d.w);
    }
  }

  /** Retículas geodésicas (como mallas de energía) con ondas de luz y nodos. */
  private buildLattices() {
    const defs = [
      { r: 4.3, detail: 3, w: 0.03, op: 0.55 },
      { r: 2.9, detail: 2, w: -0.045, op: 0.6 },
    ];
    for (const d of defs) {
      const ico = new THREE.IcosahedronGeometry(d.r, d.detail);
      const edges = new THREE.EdgesGeometry(ico);
      const grp = new THREE.Group();
      const lines = new THREE.LineSegments(
        edges,
        this.addMat(LATT_VERT, LATT_FRAG, { uOpacity: { value: d.op } }),
      );
      lines.frustumCulled = false;
      const pts = new THREE.Points(
        ico,
        this.addMat(NODE_VERT, DOT_FRAG, { uOpacity: { value: 0.35 } }),
      );
      pts.frustumCulled = false;
      grp.add(lines, pts);
      this.spinner(grp, d.w);
      ico.deleteAttribute("normal");
    }
  }

  /** Miles de partículas en órbitas inclinadas. */
  private buildOrbits() {
    const orbit: number[] = [];
    const rot: number[] = [];
    const ORB = 90;
    for (let k = 0; k < ORB; k++) {
      const R = 0.5 + Math.pow(Math.random(), 1.6) * 4.9;
      const tilt = rnd(0, Math.PI);
      const az = rnd(0, TAU);
      const sp = (Math.random() < 0.5 ? -1 : 1) * (0.25 + 0.9 / Math.sqrt(R));
      const n = Math.round(60 + R * 22);
      for (let i = 0; i < n; i++) {
        orbit.push(R * (1 + rnd(-0.015, 0.015)), sp * rnd(0.92, 1.08), rnd(0, TAU), rnd(0.8, 2.2));
        rot.push(tilt + rnd(-0.01, 0.01), az, Math.random());
      }
    }
    const count = orbit.length / 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aOrbit", new THREE.Float32BufferAttribute(orbit, 4));
    g.setAttribute("aRot", new THREE.Float32BufferAttribute(rot, 3));
    const p = new THREE.Points(g, this.addMat(ORBIT_VERT, DOT_FRAG, { uOpacity: { value: 0.9 } }));
    p.frustumCulled = false;
    this.orb.add(p);
  }

  /** Rayos entre capas: casi invisibles hasta que destellan. */
  private buildArcs() {
    const pos: number[] = [],
      us: number[] = [],
      seeds: number[] = [],
      jit: number[] = [];
    const STEPS = 14;
    for (let i = 0; i < 160; i++) {
      const d0 = randDir();
      const d1 =
        Math.random() < 0.7 ? d0.clone().add(randDir().multiplyScalar(0.5)).normalize() : randDir();
      const a = d0.multiplyScalar(rnd(1.3, 2.4));
      const b = d1.multiplyScalar(rnd(3.0, 4.4));
      const c = a.clone().add(b).multiplyScalar(0.5).add(randDir().multiplyScalar(0.8));
      const seed = Math.random();
      const j = randDir();
      const at = (u: number) =>
        new THREE.Vector3(
          (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
          (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
          (1 - u) * (1 - u) * a.z + 2 * (1 - u) * u * c.z + u * u * b.z,
        );
      for (let k = 0; k < STEPS; k++) {
        for (const u of [k / STEPS, (k + 1) / STEPS]) {
          const p = at(u);
          pos.push(p.x, p.y, p.z);
          us.push(u);
          seeds.push(seed);
          jit.push(j.x + rnd(-0.4, 0.4), j.y + rnd(-0.4, 0.4), j.z + rnd(-0.4, 0.4));
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(us, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute("aJit", new THREE.Float32BufferAttribute(jit, 3));
    const l = new THREE.LineSegments(
      g,
      this.addMat(ARC_VERT, ARC_FRAG, { uOpacity: { value: 1 } }),
    );
    l.frustumCulled = false;
    this.spinner(l, 0.02);
  }

  /** Ondas de choque que salen del centro una tras otra. */
  private buildWaves() {
    for (let k = 0; k < 3; k++) {
      const mat = this.addMat(
        WAVE_VERT,
        WAVE_FRAG,
        { uLife: { value: 0 }, uOpacity: { value: 0.7 } },
        THREE.DoubleSide,
      );
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
      m.frustumCulled = false;
      this.orb.add(m);
      this.waves.push({ m, mat, k });
    }
  }

  /** Anillos exteriores con marcas. */
  private buildHuds() {
    const defs = [
      { r: 5.3, tilt: [1.25, 0.2], w: 0.1 },
      { r: 5.9, tilt: [0.4, 1.0], w: -0.07 },
    ];
    for (const d of defs) {
      const pos: number[] = [],
        a: number[] = [],
        seed: number[] = [];
      const push = (x0: number, y0: number, x1: number, y1: number, al: number, s: number) => {
        pos.push(x0, y0, 0, x1, y1, 0);
        a.push(al, al);
        seed.push(s, s);
      };
      const N = 260,
        arcs = Math.floor(rnd(3, 6));
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU,
          a1 = ((i + 1) / N) * TAU;
        if (Math.sin(a0 * arcs) > 0.7) continue;
        push(
          Math.cos(a0) * d.r,
          Math.sin(a0) * d.r,
          Math.cos(a1) * d.r,
          Math.sin(a1) * d.r,
          0.5,
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
            major ? 0.8 : 0.45,
            Math.random(),
          );
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("aA", new THREE.Float32BufferAttribute(a, 1));
      g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
      const l = new THREE.LineSegments(
        g,
        this.addMat(HUD_VERT, HUD_FRAG, { uOpacity: { value: 0.75 } }),
      );
      l.frustumCulled = false;
      const grp = new THREE.Group();
      grp.rotation.set(d.tilt[0]!, d.tilt[1]!, 0);
      grp.add(l);
      this.orb.add(grp);
      // el anillo gira sobre su propio eje (z local)
      this.spinners.push({ o: l, axis: new THREE.Vector3(0, 0, 1), w: d.w });
    }
  }

  /** Brasa azul muy tenue en el centro. */
  private buildGlow() {
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex,
        color: new THREE.Color(0.08, 0.35, 1),
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.scale.set(4, 4, 1);
    this.orb.add(this.glow);
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

    const speedMul =
      0.6 + this.cur.think * 2.2 + this.cur.energy * 0.3 + this.ampS * 1.6 + this.cur.err * 0.8;
    this.spin += dt * speedMul;
    const u = this.u;
    u.uTime.value = t;
    u.uSpin.value = this.spin;
    u.uEnergy.value = this.cur.energy;
    u.uThink.value = this.cur.think;
    u.uAmp.value = this.ampS;
    u.uErr.value = this.cur.err;

    for (const s of this.spinners) s.o.rotateOnAxis(s.axis, s.w * dt * speedMul);

    // ondas de choque
    for (const w of this.waves) {
      const life = (this.spin * 0.1 + w.k / this.waves.length) % 1;
      w.mat.uniforms["uLife"]!.value = life;
      w.m.scale.setScalar(0.4 + life * 6.4);
    }

    const breath = 1 + 0.05 * Math.sin(t * 1.4) + this.ampS * 0.3 + this.pulseV * 0.3;
    this.glow.scale.setScalar(4 * breath);
    (this.glow.material as THREE.SpriteMaterial).opacity =
      0.06 + this.cur.think * 0.06 + this.ampS * 0.05;

    this.bloom.strength = 0.28 + this.cur.energy * 0.14 + this.ampS * 0.12 + this.pulseV * 0.1;

    this.controls.update(dt);
    const dist = this.camera.position.distanceTo(this.controls.target);

    // los engranajes aparecen solo al acercarse al máximo
    const vis = 1 - smoothstep(0.9, 1.8, dist);
    u.uVis.value = vis;
    this.gearRoot.visible = vis > 0.01;

    // acceso oculto: al atravesar el núcleo con el zoom aparece "JUSPROSS 3.0"
    const inside = dist < 1.15;
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
