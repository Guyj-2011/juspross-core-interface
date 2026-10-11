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

/** Broad overhead curtains extending beyond both sides of the visible sky. */
export function createSkyAurora(): EnvLayer {
  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const blue = paletteColor("--aurora-blue");
  const cyan = paletteColor("--aurora-cyan");
  const red = paletteColor("--aurora-red");

  for (let layer = 0; layer < 3; layer++) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: layer * 2.7 },
        uStrength: { value: layer === 1 ? 0.66 : 0.5 },
        uLane: { value: layer - 1 },
        uBlue: { value: blue },
        uCyan: { value: cyan },
        uRed: { value: red },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime; uniform float uPhase; uniform float uLane;
        void main() {
          vUv = uv;
          // The ends lie well outside the view, keeping the curtains
          // continuous across the sky rather than converging ahead.
          float path = (uv.x - 0.5) * 5.19;
          float depth = 125.0 + uLane * 32.0;
          vec3 p = vec3(path * 340.0,
            44.0 + uLane * 8.0 + (uv.y - 0.5) * 38.0,
            -depth + sin(path * 3.0 + uPhase) * 12.0);
          p.y += sin(path * 5.0 + uv.y * 3.0 + uPhase) * 4.0;
          p.y += sin(path * 7.0 + uPhase + uTime * 0.015) * 0.8;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime; uniform float uPhase; uniform float uStrength;
        uniform vec3 uBlue; uniform vec3 uCyan; uniform vec3 uRed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
        }
        void main() {
          float time = uTime * 0.025;
          float x = (vUv.x - 0.5) * 5.19;
          float ridge = 0.38 + sin(x * 5.0 + uPhase) * 0.07
            + sin(x * 13.0 - uPhase * 0.6) * 0.035;
          float height = vUv.y - ridge;
          float fold = noise(vec2(x * 15.0 - time * 0.35, uPhase));
          float rays = noise(vec2(x * 80.0 - time * 0.4, height * 2.0 + uPhase));
          float base = exp(-pow(height / 0.115, 2.0));
          float curtain = exp(-pow((height - 0.09) / 0.24, 2.0));
          float wisps = 0.4 + 0.6 * noise(vec2(x * 9.0 - time * 0.3, height * 7.0 + uPhase));
          float light = (base * 0.38 + curtain * (0.25 + rays * 0.65)) * wisps;
          float edge = smoothstep(0.0, 0.16, vUv.y)
            * (1.0 - smoothstep(0.78, 1.0, vUv.y));
          vec3 color = mix(uBlue, uCyan, base * 0.5 + rays * 0.15);
          float redAccent = smoothstep(0.2, 0.62, noise(vec2(x * 4.0 + uPhase, 0.5)))
            * smoothstep(0.04, 0.24, height);
          color = mix(color, uRed, redAccent * 0.85);
          float alpha = min(0.65, light * edge * uStrength);
          gl_FragColor = vec4(color * 1.4, alpha);
        }
      `,
    });
    materials.push(material);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 512, 24), material);
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