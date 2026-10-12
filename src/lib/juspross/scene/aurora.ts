import * as THREE from "three";
import type { EnvLayer } from "./environment";
import type { AuroraStyle } from "../types";

export interface AuroraLayer extends EnvLayer {
  setStyle: (style: AuroraStyle) => void;
}

/** Resolve CSS palette tokens through the browser's color-space conversion. */
function paletteColor(token: string): THREE.Color {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  const color = new THREE.Color();
  if (!context) return color;
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return color.setRGB((pixel[0] ?? 0) / 255, (pixel[1] ?? 0) / 255, (pixel[2] ?? 0) / 255, THREE.SRGBColorSpace);
}

/**
 * Continuous auroral canopy: the curtain folds keep their shape but wrap the
 * entire dome. Longitudes use integer frequencies so the pattern is seamless,
 * and warp noise is sampled on the world-plane so there is no seam anywhere.
 */
export function createSkyAurora(): AuroraLayer {
  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  const depthMaterials: THREE.ShaderMaterial[] = [];
  const canopy = new THREE.Group();
  const depth = new THREE.Group();
  group.add(canopy, depth);
  let style: AuroraStyle = "canopy";
  let blend = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const blue = paletteColor("--aurora-blue");
  const cyan = paletteColor("--aurora-cyan");
  const red = paletteColor("--aurora-red");

  const layers = [
    { strength: 0.85, freq: 1.0, phase: 0.0, rise: 1.0 },
    { strength: 0.55, freq: 1.7, phase: 2.6, rise: 0.7 },
  ];

  for (const cfg of layers) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: cfg.phase },
        uFreq: { value: cfg.freq },
        uRise: { value: cfg.rise },
        uStrength: { value: cfg.strength },
        uOpacity: { value: 1 },
        uBlue: { value: blue },
        uCyan: { value: cyan },
        uRed: { value: red },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDirection;
        uniform float uTime; uniform float uPhase; uniform float uFreq;
        uniform float uRise; uniform float uStrength;
        uniform float uOpacity;
        uniform vec3 uBlue; uniform vec3 uCyan; uniform vec3 uRed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          return noise(p) * 0.57 + noise(p * 2.03 + 7.1) * 0.28
            + noise(p * 4.1 + 19.7) * 0.15;
        }
        void main() {
          vec3 d = normalize(vDirection);
          float elev = d.y;
          float lon = atan(d.z, d.x);
          vec2 gp = d.xz * 2.6; // continuous world-plane coords, seam-free
          float sky = smoothstep(0.03, 0.2, elev);
          if (sky < 0.001) discard;
          float time = uTime * 0.008;

          // slow drift of the whole canopy
          vec2 warpIn = vec2(fbm(gp * 0.55 + time + uPhase), fbm(gp * 0.55 + 11.3 - time));
          vec2 warp = (warpIn - 0.5) * 2.6;

          // curtain folds around the full sky: integer lon frequencies wrap seamlessly
          float f1 = sin(lon * (5.0 * uFreq) + warp.x * 1.9 + uPhase + fbm(gp * 1.2 + 4.0 - time) * 3.2);
          float f2 = sin(lon * (9.0 * uFreq) - warp.y * 1.4 + uPhase * 1.7 + elev * 2.4 * uRise);
          float f3 = sin(lon * (14.0 * uFreq) + warp.x * 0.8 + uPhase * 2.3 - elev * 3.2);
          float fold = (f1 * 0.55 + f2 * 0.3 + f3 * 0.18) * 0.5 + 0.5;

          float crest = pow(max(fold, 0.0), 6.0);
          float curtain = pow(max(fold, 0.0), 1.7);
          float rays = noise(vec2(gp.x * 24.0 + uPhase, gp.y * 24.0 - time * 1.4));
          float secondary = pow(0.5 + 0.5 * sin(gp.x * 1.6 - gp.y * 1.1
            + fbm(gp * 1.1 + 8.0 - time) * 5.5), 2.0);
          float wisps = 0.32 + 0.68 * fbm(gp * 1.7 - time * 0.8);

          // breadth variation: some regions richer, others calmer, everywhere lit
          float region = 0.7 + 0.7 * fbm(gp * 0.8 + 31.0 + uPhase);

          // curtains rise across the sky; a broad glow keeps the zenith covered
          float rise = smoothstep(0.05, 0.5, elev) * uRise + (1.0 - uRise) * 0.4;
          float zenithGlow = smoothstep(0.45, 0.95, elev)
            * (0.35 + 0.4 * fbm(gp * 1.4 + time * 0.6 + uPhase));

          float light = (0.07 + crest * 0.26 + curtain * (0.22 + rays * 0.4)
            + secondary * (0.16 + rays * 0.18)) * wisps * region * rise
            + zenithGlow * 0.22;

          vec3 color = mix(uBlue, uCyan, crest * 0.55 + rays * 0.1);
          float redAccent = smoothstep(0.49, 0.7, fbm(gp * 1.1 + 21.0 + uPhase))
            * (1.0 - crest * 0.7);
          color = mix(color, uRed, redAccent * 0.8);
          float alpha = min(0.62, light * sky * uStrength);
          gl_FragColor = vec4(color * 1.4, alpha * uOpacity);
        }
      `,
    });
    materials.push(material);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 48), material);
    dome.frustumCulled = false;
    canopy.add(dome);
  }

  // Earlier perspective curtains: broad overhead ribbons running into the distance.
  for (const [index, lane] of [-1, 0, 1].entries()) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uLane: { value: lane },
        uPhase: { value: index * 2.1 },
        uOpacity: { value: 0 },
        uBlue: { value: blue },
        uCyan: { value: cyan },
        uRed: { value: red },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime; uniform float uLane; uniform float uPhase;
        void main() {
          vUv = uv;
          float path = uv.x * 5.19;
          float depth = 35.0 + path * 340.0;
          float width = 44.0 + (1.0 - exp(-path)) * 36.0;
          float time = uTime * 0.008;
          float bend = sin(path * 5.0 + uPhase + time) * 8.0;
          vec3 p = vec3(uLane * 35.0 + (uv.y - 0.5) * width + bend,
            24.0 + depth * 0.18, -depth);
          p.y += sin(path * 4.0 + uv.y * 3.0 + uPhase - time) * 6.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime; uniform float uPhase; uniform float uOpacity;
        uniform vec3 uBlue; uniform vec3 uCyan; uniform vec3 uRed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        void main() {
          float path = vUv.x * 5.19;
          float time = uTime * 0.008;
          float flow = path * 5.0 + sin(path * 2.7 + uPhase - time) * 1.4;
          float fold = 0.5 + 0.5 * sin(flow + vUv.y * 4.0 + time);
          float crest = pow(fold, 5.0);
          float rays = noise(vec2(path * 38.0 + uPhase, vUv.y * 3.0 - time));
          float edge = smoothstep(0.0, 0.045, path) * (1.0 - smoothstep(4.3, 5.19, path));
          edge *= smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
          float light = (0.10 + fold * 0.22 + crest * 0.25) * (0.55 + rays * 0.45);
          vec3 color = mix(uBlue, uCyan, crest * 0.55);
          float red = smoothstep(0.5, 0.8, noise(vec2(path * 1.7 + uPhase, 21.0)))
            * smoothstep(0.35, 0.85, vUv.y);
          color = mix(color, uRed, red * 0.8);
          gl_FragColor = vec4(color * 1.4, light * edge * uOpacity);
        }
      `,
    });
    depthMaterials.push(material);
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 512, 24), material);
    ribbon.frustumCulled = false;
    depth.add(ribbon);
  }

  return {
    object: group,
    parallax: 0,
    setStyle: (next) => { style = next; },
    update: (t, dt) => {
      const target = style === "depth" ? 1 : 0;
      blend = reducedMotion ? target : THREE.MathUtils.clamp(
        blend + Math.sign(target - blend) * dt / 1.2, 0, 1,
      );
      canopy.visible = blend < 1;
      depth.visible = blend > 0;
      for (const material of [...materials, ...depthMaterials]) {
        const time = material.uniforms["uTime"];
        if (time) time.value = reducedMotion ? 0 : t;
      }
      for (const material of materials) {
        const opacity = material.uniforms["uOpacity"];
        if (opacity) opacity.value = 1 - blend;
      }
      for (const material of depthMaterials) {
        const opacity = material.uniforms["uOpacity"];
        if (opacity) opacity.value = blend;
      }
    },
  };
}
