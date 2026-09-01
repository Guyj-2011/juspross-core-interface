import * as THREE from "three";

export interface CoreSample {
  positions: Float32Array;
  colors: Float32Array;
  seeds: Float32Array;
  sizes: Float32Array;
  count: number;
}

/**
 * Convierte el logo de Juspross en una nube de partículas 3D.
 * El fondo claro del archivo se descarta: sólo sobreviven los trazos azules,
 * proyectados sobre una cáscara esférica para darles profundidad real.
 */
export function sampleLogo(img: HTMLImageElement, radius: number, res = 220): CoreSample {
  const cvs = document.createElement("canvas");
  cvs.width = res;
  cvs.height = res;
  const ctx = cvs.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, res, res);
  const data = ctx.getImageData(0, 0, res, res).data;

  const pos: number[] = [];
  const col: number[] = [];
  const seed: number[] = [];
  const size: number[] = [];

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = (y * res + x) * 4;
      const a = data[i + 3]! / 255;
      if (a < 0.5) continue;
      let r = data[i]! / 255;
      let g = data[i + 1]! / 255;
      let b = data[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = max === 0 ? 0 : (max - min) / max;
      // descartar fondo claro y el vacío blanco interior del logo
      if (lum > 0.8 && sat < 0.2) continue;
      if (b < r + 0.02 && b < 0.25) continue;

      // realce: los azules profundos deben seguir siendo visibles en negro
      if (lum < 0.28) {
        const k = 2.35;
        r = r * k;
        g = g * k + 0.03;
        b = b * k + 0.14;
      } else {
        r *= 0.9;
        g = g * 1.02;
        b = Math.min(1, b * 1.12);
      }

      const nx = (x / res) * 2 - 1;
      const ny = -((y / res) * 2 - 1);
      const rr = Math.sqrt(nx * nx + ny * ny);
      if (rr > 1.02) continue;

      // densidad: se descartan pixeles al azar para dejar respirar la nube
      if (Math.random() > 0.62) continue;

      const shell = Math.sqrt(Math.max(0, 1 - Math.min(1, rr) ** 2));
      const sign = Math.random() < 0.5 ? -1 : 1;
      const z = sign * shell * radius * 0.46 * (0.35 + Math.random() * 0.65);

      pos.push(nx * radius, ny * radius, z + (Math.random() - 0.5) * radius * 0.03);
      col.push(Math.min(1, r), Math.min(1, g), Math.min(1, b));
      seed.push(Math.random());
      size.push(0.75 + Math.random() * 1.5 + (lum > 0.45 ? 0.6 : 0));
    }
  }

  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    seeds: new Float32Array(seed),
    sizes: new Float32Array(size),
    count: seed.length,
  };
}

export const CORE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSeed;
attribute float aSize;

uniform float uTime;
uniform float uAmp;      // amplitud de voz 0..1
uniform float uEnergy;   // energía global del estado
uniform float uThink;    // reorganización
uniform float uErr;
uniform float uWave;     // onda de éxito
uniform float uDpr;

varying vec3 vColor;
varying float vGlow;

void main() {
  vec3 p = position;
  float s = aSeed * 6.2831;
  vec3 dir = normalize(p + vec3(0.0001));

  // respiración permanente
  float breathe = 1.0 + 0.018 * sin(uTime * 0.7 + s);

  // deformación por voz: el logo completo se expande con la amplitud
  float voice = uAmp * (0.05 + 0.07 * sin(uTime * 4.2 + s * 3.0));

  // reorganización al pensar
  vec3 drift = vec3(
    sin(uTime * 0.62 + s * 3.1),
    cos(uTime * 0.51 + s * 4.7),
    sin(uTime * 0.43 + s * 2.3)
  );

  float jitter = 0.005 + uThink * 0.045 + uAmp * 0.018 + uEnergy * 0.005;
  p *= breathe + voice + uEnergy * 0.02 + uWave * 0.16;
  p += drift * jitter * length(position) * 0.9;
  p += dir * uWave * 0.35;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float glow = 0.55 + uEnergy * 0.5 + uAmp * 0.9 + uWave * 1.2;
  vec3 c = aColor;
  // degradado cian (izquierda) -> magenta/violeta (derecha), como la referencia
  float hx = clamp(position.x / 3.0 * 0.5 + 0.5, 0.0, 1.0);
  float hz = clamp(position.z / 1.6 * 0.5 + 0.5, 0.0, 1.0);
  float h = clamp(hx * 0.78 + hz * 0.22, 0.0, 1.0);
  vec3 magenta = vec3(0.92, 0.22, 0.95);
  vec3 violet  = vec3(0.52, 0.32, 1.0);
  c = mix(c, violet,  smoothstep(0.48, 0.80, h) * 0.55);
  c = mix(c, magenta, smoothstep(0.66, 1.0, h) * 0.85);
  c = mix(c, vec3(1.0, 0.45, 0.12), uErr * 0.75);
  c = mix(c, c * vec3(0.75, 1.05, 1.25), uThink * 0.5);
  vColor = c;
  vGlow = glow;

  gl_PointSize = aSize * uDpr * (30.0 / max(0.001, -mv.z)) * (1.0 + uAmp * 0.16 + uWave * 0.3);
}
`;

export const CORE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vGlow;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  // borde marcado: punto compacto con caída rápida -> el logo se lee mejor
  float core = smoothstep(0.5, 0.22, d);
  float dot = smoothstep(0.30, 0.10, d);
  float halo = pow(core, 2.0);
  vec3 c = vColor * (0.4 + vGlow * 0.85) * (0.3 + halo * 1.3 + dot * 0.9);
  gl_FragColor = vec4(c, min(1.0, core * 0.55 + dot * 0.75));
}
`;

export function makeCoreMaterial(dpr: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uEnergy: { value: 0.15 },
      uThink: { value: 0 },
      uErr: { value: 0 },
      uWave: { value: 0 },
      uDpr: { value: dpr },
    },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}