import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { V2State } from "../v2Store";

/* =====================================================================
 *  Núcleo 2.0 — bola de fuego volumétrica (azul → amarillo).
 *  · Llamas reales: ray-marching de ruido 3D con turbulencia; azules en la
 *    base, blancas y amarillas hacia las puntas.
 *  · El interior es oscuro: el brillo está en las llamas del borde.
 *  · Al pensar, las llamas se expanden y estallan hacia afuera.
 *  · En el corazón oscuro hay miles de engranajes microscópicos que solo
 *    aparecen con el zoom al máximo.
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

/** Textura 3D de ruido (3 canales, periódica) para el fuego. */
function makeNoise3D(): THREE.Data3DTexture {
  const N = 64;
  const P = 8; // celdas por periodo
  const lat: Float32Array[] = [0, 1, 2].map(() => {
    const a = new Float32Array(P * P * P);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
  });
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) {
    const gz = (z / N) * P;
    const z0 = Math.floor(gz);
    const fz = fade(gz - z0);
    const z1 = (z0 + 1) % P;
    for (let y = 0; y < N; y++) {
      const gy = (y / N) * P;
      const y0 = Math.floor(gy);
      const fy = fade(gy - y0);
      const y1 = (y0 + 1) % P;
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * P;
        const x0 = Math.floor(gx);
        const fx = fade(gx - x0);
        const x1 = (x0 + 1) % P;
        const o = ((z * N + y) * N + x) * 4;
        for (let c = 0; c < 3; c++) {
          const L = lat[c]!;
          const at = (i: number, j: number, k: number) => L[(k * P + j) * P + i]!;
          const a = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * fx;
          const b = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * fx;
          const c2 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * fx;
          const d = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * fx;
          const v = a + (b - a) * fy + (c2 + (d - c2) * fy - (a + (b - a) * fy)) * fz;
          data[o + c] = Math.round(v * 255);
        }
        data[o + 3] = 255;
      }
    }
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/* ---------- shaders del fuego ---------- */

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Fuego volumétrico: ray-marching de ruido 3D avanzado hacia afuera, con turbulencia. */
const FIRE_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform mat4 uProjInv, uCamWorld;
  uniform vec3 uCamPos;
  uniform float uFlame, uTime, uR0, uYtop, uHs, uWide, uTurb, uBright, uErr;
  varying vec2 vUv;

  vec3 N3(vec3 p){ return texture(uNoise, p).rgb; }

  vec2 hitSphere(vec3 ro, vec3 rd, float R){
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  // cilindro vertical (eje y) que envuelve la bola y la columna de llamas
  vec2 hitCyl(vec3 ro, vec3 rd, float Rc, float y0, float y1){
    float a = dot(rd.xz, rd.xz);
    float b = dot(ro.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - Rc * Rc;
    float t0;
    float t1;
    if (a < 1e-8) {
      if (c > 0.0) return vec2(-1.0);
      t0 = -1e9;
      t1 = 1e9;
    } else {
      float h = b * b - a * c;
      if (h < 0.0) return vec2(-1.0);
      h = sqrt(h);
      t0 = (-b - h) / a;
      t1 = (-b + h) / a;
    }
    if (abs(rd.y) < 1e-6) {
      if (ro.y < y0 || ro.y > y1) return vec2(-1.0);
    } else {
      float ta = (y0 - ro.y) / rd.y;
      float tb = (y1 - ro.y) / rd.y;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    }
    if (t1 < t0) return vec2(-1.0);
    return vec2(t0, t1);
  }

  float plumeRadius(float y){
    float u = clamp(y / uYtop, 0.0, 1.0);
    return uR0 * uWide * pow(1.0 - u, 0.6);
  }
  float sdBall(vec3 p){ return length(p) - uR0; }
  float sdPlume(vec3 p){
    float dxz = length(p.xz) - plumeRadius(p.y);
    float dy = max(-p.y, p.y - uYtop);
    return max(dxz * 0.7, dy);
  }

  // densidad: piel de llamas sobre la bola (interior oscuro, borde brillante) + columna que sube con la caída
  float fireDensity(vec3 p, vec3 rd, out vec3 col){
    float sb = sdBall(p);
    float sp = sdPlume(p);
    float hgt = clamp(p.y / uYtop, 0.0, 1.0);
    float sway = (0.2 + hgt) * (0.4 + uTurb);
    vec3 pw = p;
    pw.x += sin(uTime * 1.7 + p.y * 1.1) * 0.22 * sway;
    pw.z += cos(uTime * 1.3 + p.y * 0.9 + 1.7) * 0.22 * sway;
    float ang = pw.y * 0.3 + uTime * 0.35;
    float ca = cos(ang);
    float sa = sin(ang);
    pw.xz = vec2(pw.x * ca - pw.z * sa, pw.x * sa + pw.z * ca);
    // ruido estirado en vertical y subiendo: lenguas largas que flamean
    vec3 q = (vec3(pw.x, pw.y * 0.2, pw.z) - vec3(0.0, uFlame * 0.2, 0.0)) * 0.38;
    vec3 w = N3(q * 0.8 + vec3(0.17, 0.53, 0.91)) - 0.5;
    q += w * (0.7 + 0.22 * uTurb);
    float a = 0.5;
    float n = 0.0;
    vec3 qq = q;
    for (int i = 0; i < 4; i++) {
      n += a * N3(qq).r;
      qq = qq * 2.03 + vec3(0.13, 0.27, 0.31);
      a *= 0.5;
    }
    float rdg = 1.0 - abs(2.0 * n - 1.0);
    float rdg2 = rdg * rdg;
    float rdg3 = rdg2 * rdg;
    // piel sobre la bola: brilla en el borde (más camino visto de canto) y casi vacía de frente
    float rimv = 1.0 - abs(dot(normalize(p), rd));
    float skinT = uHs * (0.7 + 0.8 * n);
    float baseS = 1.0 - abs(sb - 0.12) / (0.5 * skinT + 0.25);
    float skinD = smoothstep(0.0, 0.45, baseS + (n - 0.5) * 1.3) * (0.05 + rdg3 * rdg) * (0.3 + 1.6 * rimv * rimv);
    // columna de llamas con bordes irregulares (lenguas)
    float ep = clamp(-sp / 0.9, -0.6, 1.0);
    float outb = smoothstep(-0.05, 0.6, sb);
    float val = (n - 0.45) * 2.0 + ep * 0.5 + (1.0 - hgt) * 0.4 - 0.35;
    float plumeD = smoothstep(0.0, 0.3, val) * (1.0 - smoothstep(0.4, 0.7, sp)) * outb * (0.5 + 1.3 * rdg3) * (1.0 - smoothstep(0.7, 1.0, hgt));
    float d = skinD + plumeD;
    col = vec3(0.0);
    if (d > 0.003) {
      float kSkin = clamp(sb / (uHs * 1.2), 0.0, 1.0);
      float k = clamp(max(kSkin * 0.8, hgt * 1.1) + (n - 0.5) * 0.3, 0.0, 1.0);
      vec3 c = mix(vec3(0.02, 0.1, 0.9), vec3(0.1, 0.45, 1.0), smoothstep(0.0, 0.35, k));
      c = mix(c, vec3(0.8, 0.92, 1.0), pow(rdg, 6.0) * 0.2);
      c = mix(c, vec3(1.0, 0.1, 0.12), smoothstep(0.78, 1.0, k) * 0.75);
      col = c * (0.7 + 1.6 * rdg2);
    }
    return d;
  }

  void main(){
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vp /= vp.w;
    vec3 rd = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
    vec3 ro = uCamPos;
    float edge = 1.5 * uHs + 0.15;
    float Rc = uR0 * uWide + 1.5 * uHs + 0.5;
    vec2 hc = hitCyl(ro, rd, Rc, -uR0 - edge, uYtop + 0.5);
    vec3 L = vec3(0.0);
    float T = 1.0;
    if (hc.y > 0.0) {
      float t = max(hc.x, 0.0);
      float t1 = hc.y;
      float Rin = max(0.0, uR0 - 0.7);
      vec2 hi = hitSphere(ro, rd, Rin);
      bool hasIn = hi.y > 0.0 && Rin > 0.0;
      float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      t += 0.09 * dith;
      for (int i = 0; i < 120; i++) {
        if (t >= t1) break;
        vec3 p = ro + rd * t;
        if (hasIn && t > hi.x && t < hi.y) { t = hi.y; continue; }
        float sd = min(sdBall(p), sdPlume(p));
        if (sd > edge) {
          t += clamp((sd - edge) * 0.6, 0.09, 0.7);
          continue;
        }
        vec3 col;
        float d = fireDensity(p, rd, col);
        if (d > 0.003) {
          vec3 c = mix(col, vec3(1.0, 0.12, 0.05) * dot(col, vec3(0.66)), uErr);
          L += T * c * d * uBright * 0.09 * 1.7 * 0.5;
          T *= exp(-d * 1.8 * 0.09);
        }
        t += 0.09;
        if (T < 0.02) break;
      }
    }
    gl_FragColor = vec4(L, 1.0);
  }
`;

const BLIT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  varying vec2 vUv;
  void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }
`;

/** Chispas y brasas que salen despedidas de la bola de fuego. */
const EMBER_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute vec4 aRnd;
  uniform float uTime, uSpin, uR0, uYtop, uThink, uDpr, uErr;
  varying vec3 vColor;
  varying float vA;
  void main(){
    float u = fract(aRnd.x + uSpin * aRnd.y * 0.16);
    vec3 base = aDir * uR0;
    float rise = u * uYtop * (0.45 + aRnd.z * 0.9) * (1.0 + uThink * 0.5);
    vec3 drift = vec3(sin(u * 7.0 + aRnd.w * 40.0), 0.0, cos(u * 6.0 + aRnd.w * 23.0)) * (0.1 + 0.6 * u) * (1.0 + uThink);
    vec3 p = base + vec3(0.0, rise, 0.0) + drift;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = 1.0 - u;
    vA = pow(life, 1.4) * (0.5 + 0.5 * sin(uTime * (6.0 + aRnd.w * 10.0) + aRnd.w * 50.0));
    vec3 c = mix(vec3(0.55, 0.8, 1.0), vec3(1.0, 0.15, 0.1), smoothstep(0.25, 0.85, u));
    vColor = mix(c, vec3(1.0, 0.15, 0.08), uErr);
    gl_PointSize = (1.0 + 2.2 * aRnd.z * life) * uDpr * (12.0 / max(0.05, -mv.z));
  }
`;

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
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private u: {
    uTime: THREE.IUniform<number>;
    uSpin: THREE.IUniform<number>;
    uThink: THREE.IUniform<number>;
    uAmp: THREE.IUniform<number>;
    uErr: THREE.IUniform<number>;
    uDpr: THREE.IUniform<number>;
    uVis: THREE.IUniform<number>;
  };
  private fu: {
    uNoise: THREE.IUniform<THREE.Data3DTexture>;
    uProjInv: THREE.IUniform<THREE.Matrix4>;
    uCamWorld: THREE.IUniform<THREE.Matrix4>;
    uCamPos: THREE.IUniform<THREE.Vector3>;
    uFlame: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>;
    uR0: THREE.IUniform<number>;
    uYtop: THREE.IUniform<number>;
    uHs: THREE.IUniform<number>;
    uWide: THREE.IUniform<number>;
    uTurb: THREE.IUniform<number>;
    uBright: THREE.IUniform<number>;
    uErr: THREE.IUniform<number>;
  };
  private gearMat: THREE.ShaderMaterial;
  private fireMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial;
  private fireScene = new THREE.Scene();
  private fireRT: THREE.WebGLRenderTarget;
  private noiseTex: THREE.Data3DTexture;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private resumeTimer = 0;
  private ro: ResizeObserver;
  private target = { ...STATE_TARGET.idle };
  private cur = { ...STATE_TARGET.idle };
  private amp = 0;
  private ampS = 0;
  private kick = 0;
  private spin = 0;
  private fireT = 0;
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
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.004, 120);
    this.camera.position.set(0, 2.2, w / h < 1 ? 21 : 15);

    this.u = {
      uTime: { value: 0 },
      uSpin: { value: 0 },
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

    this.noiseTex = makeNoise3D();
    this.fu = {
      uNoise: { value: this.noiseTex },
      uProjInv: { value: this.camera.projectionMatrixInverse },
      uCamWorld: { value: this.camera.matrixWorld },
      uCamPos: { value: this.camera.position },
      uFlame: { value: 0 },
      uTime: { value: 0 },
      uR0: { value: 2.0 },
      uYtop: { value: 5.4 },
      uHs: { value: 0.65 },
      uWide: { value: 1.0 },
      uTurb: { value: 0.2 },
      uBright: { value: 1 },
      uErr: { value: 0 },
    };

    // el fuego se calcula a menor resolución (es suave) y se proyecta como fondo
    const fs = this.fireScale(w, h);
    this.fireRT = new THREE.WebGLRenderTarget(Math.ceil(w * fs), Math.ceil(h * fs), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    this.fireMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: { ...this.fu },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fireMat);
    fq.frustumCulled = false;
    this.fireScene.add(fq);

    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { uTex: { value: this.fireRT.texture } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat);
    blit.frustumCulled = false;
    blit.renderOrder = -10; // primero: los engranajes (opacos) quedan por delante
    this.scene.add(blit);

    this.buildGears();
    this.buildEmbers();
    this.orb.add(this.gearRoot);
    this.scene.add(this.orb);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 2.0;
    this.controls.minDistance = 0.03; // zoom máximo hasta el corazón
    this.controls.maxDistance = 34;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.55, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /** Escala de resolución del fuego para mantener ~0.5 Mpx. */
  private fireScale(w: number, h: number) {
    return Math.min(1, Math.max(0.35, Math.sqrt(520000 / Math.max(1, w * h))));
  }

  /* ---------- engranajes microscópicos (solo con el zoom al máximo) ---------- */

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

  /* ---------- chispas ---------- */

  private buildEmbers() {
    const COUNT = 3500;
    const dir = new Float32Array(COUNT * 3);
    const rn = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const d = randDir();
      d.y = Math.abs(d.y) * 0.9 + 0.1;
      d.normalize();
      dir.set([d.x, d.y, d.z], i * 3);
      rn.set([Math.random(), rnd(0.5, 1.4), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 3));
    g.setAttribute("aRnd", new THREE.Float32BufferAttribute(rn, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: EMBER_VERT,
      fragmentShader: DOT_FRAG,
      uniforms: { ...this.u, uR0: this.fu.uR0, uYtop: this.fu.uYtop, uOpacity: { value: 0.9 } },
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    this.orb.add(p);
  }

  /* ---------- API ---------- */

  setState(s: V2State) {
    if (s === "thinking" && this.target.think < 0.5) this.kick = 1; // ignición: las llamas estallan
    this.target = { ...STATE_TARGET[s] };
    this.speaking = s === "speaking";
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
    const fs = this.fireScale(w, h);
    this.fireRT.setSize(Math.ceil(w * fs), Math.ceil(h * fs));
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const k = 1 - Math.pow(0.002, dt);

    this.cur.think += (this.target.think - this.cur.think) * k;
    this.cur.err += (this.target.err - this.cur.err) * k;
    const synth =
      this.speaking && this.amp < 0.02 ? 0.3 + 0.25 * Math.sin(t * 9) * Math.sin(t * 3.1) : 0;
    this.ampS += (Math.max(this.amp, synth) - this.ampS) * Math.min(1, dt * 12);
    this.kick = Math.max(0, this.kick - dt * 0.55);

    const T = this.cur.think;
    const kick = this.kick * this.kick;
    const throb = Math.pow(0.5 + 0.5 * Math.sin(t * 2.4), 2);

    // el tiempo de las llamas se acelera al pensar → avanzan y estallan hacia afuera
    this.fireT += dt * (1.0 + T * 2.4 + kick * 3.0 + this.ampS * 1.5);
    this.spin += dt * (0.6 + T * 2.2 + this.ampS * 1.6);

    const f = this.fu;
    f.uFlame.value = this.fireT * 1.4;
    f.uTime.value = t;
    f.uR0.value = 2.0 + T * 0.1 + kick * 0.2;
    f.uWide.value = 1.0 + T * 0.3 + kick * 0.35;
    f.uYtop.value = f.uR0.value + 4.2 + T * (3.0 + throb * 1.0) + kick * 3.4 + this.ampS * 1.0;
    f.uHs.value = 0.65 + T * 0.45 + kick * 0.6;
    f.uTurb.value = 0.2 + T * 1.0 + kick * 0.6;
    f.uBright.value = 1.0 + T * 0.45 + kick * 0.7 + this.ampS * 0.5;
    f.uErr.value = this.cur.err;

    const u = this.u;
    u.uTime.value = t;
    u.uSpin.value = this.spin;
    u.uThink.value = T;
    u.uAmp.value = this.ampS;
    u.uErr.value = this.cur.err;

    for (const s of this.spinners) s.o.rotateOnAxis(s.axis, s.w * dt * (0.6 + T * 2));

    this.bloom.strength = 0.36 + T * 0.22 + kick * 0.3 + this.ampS * 0.12;

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

    // 1) fuego a baja resolución  2) escena completa con bloom
    this.camera.updateMatrixWorld();
    this.renderer.setRenderTarget(this.fireRT);
    this.renderer.render(this.fireScene, this.camera);
    this.renderer.setRenderTarget(null);
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
    this.fireScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.geoCache.forEach((g) => g.dispose());
    this.gearMat.dispose();
    this.fireMat.dispose();
    this.blitMat.dispose();
    this.fireRT.dispose();
    this.noiseTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
