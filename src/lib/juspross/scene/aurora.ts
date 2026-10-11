import * as THREE from "three";
import type { EnvLayer } from "./environment";

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

/** Continuous auroral canopy, distributed across the whole upper sky. */
export function createSkyAurora(): EnvLayer {
  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const blue = paletteColor("--aurora-blue");
  const cyan = paletteColor("--aurora-cyan");
  const red = paletteColor("--aurora-red");

  for (let layer = 0; layer < 1; layer++) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: layer * 2.7 },
        uStrength: { value: 0.65 },
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
        uniform float uTime; uniform float uPhase; uniform float uStrength;
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
          vec3 direction = normalize(vDirection);
          float sky = smoothstep(0.06, 0.24, direction.y);
          if (sky < 0.001) discard;
          float time = uTime * 0.008;
          // Dome projection has no lateral endpoints or horizon-aligned strip.
          vec2 p = direction.xz / (direction.y + 0.45) * 2.5;
          vec2 warp = vec2(fbm(p * 0.8 + time), fbm(p * 0.8 + 11.3 - time));
          vec2 folded = p + (warp - 0.5) * 2.8;
          float flow = folded.x * 2.1 + folded.y * 1.7
            + fbm(folded * 1.4 + time) * 7.0;
          float fold = sin(flow) * 0.5 + 0.5;
          float crest = pow(fold, 7.0);
          float curtain = pow(fold, 1.8);
          float secondary = pow(0.5 + 0.5 * sin(folded.y * 3.4 - folded.x * 1.6
            + fbm(folded + 8.0 - time) * 6.0), 2.0);
          float rays = noise(vec2(folded.x * 65.0, folded.y * 5.0 - time));
          float wisps = 0.3 + 0.7 * fbm(p * 2.0 - time);
          float light = (0.09 + crest * 0.24 + curtain * (0.25 + rays * 0.42)
            + secondary * (0.2 + rays * 0.2)) * wisps;
          vec3 color = mix(uBlue, uCyan, crest * 0.55 + rays * 0.1);
          float redAccent = smoothstep(0.49, 0.7, fbm(p * 1.3 + 21.0))
            * (1.0 - crest * 0.7);
          color = mix(color, uRed, redAccent * 0.8);
          float alpha = min(0.65, light * sky * uStrength);
          gl_FragColor = vec4(color * 1.4, alpha);
        }
      `,
    });
    materials.push(material);
    const curtain = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), material);
    curtain.frustumCulled = false;
    group.add(curtain);
  }

  return {
    object: group,
    parallax: 0,
    update: (t) => {
      for (const material of materials) {
        const time = material.uniforms["uTime"];
        if (time) time.value = reducedMotion ? 0 : t;
      }
    },
  };
}