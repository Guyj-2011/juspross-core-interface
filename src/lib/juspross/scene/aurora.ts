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

/** Layered, folded curtains of light: no voice coupling or cursor motion. */
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
        uStrength: { value: layer === 0 ? 0.8 : 0.46 },
        uBlue: { value: blue },
        uCyan: { value: cyan },
        uRed: { value: red },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime; uniform float uPhase;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.x * 13.0 + uPhase + uTime * 0.025) * 5.0;
          p.y += sin(uv.x * 8.0 + uPhase + uTime * 0.018) * 2.0;
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
          float x = vUv.x;
          float ridge = 0.26 + sin(x * 8.0 + uPhase + time) * 0.13
            + sin(x * 19.0 - uPhase * 0.6 - time * 0.7) * 0.045;
          float height = vUv.y - ridge;
          float fold = noise(vec2(x * 25.0 + time * 0.6, uPhase));
          float rays = noise(vec2(x * 210.0 + fold * 4.0 - time, height * 1.9 + uPhase));
          rays = rays * 0.6 + noise(vec2(x * 480.0 + time * 0.4, height * 3.0 + uPhase)) * 0.4;
          float base = exp(-pow(height / 0.028, 2.0));
          float curtain = smoothstep(-0.02, 0.025, height) * exp(-max(height, 0.0) * (7.0 + fold * 5.0));
          float wisps = 0.35 + 0.65 * noise(vec2(x * 11.0 + time * 0.3, height * 5.0 - time * 0.4 + uPhase));
          float light = base * 0.27 + curtain * pow(rays, 1.7) * wisps * 1.5;
          float edge = smoothstep(0.0, 0.14, x) * (1.0 - smoothstep(0.86, 1.0, x))
            * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.76, 1.0, vUv.y));
          vec3 color = mix(uBlue, uCyan, base * 0.55 + rays * 0.24);
          float redAccent = smoothstep(0.30, 0.65, noise(vec2(x * 5.0 + uPhase, time * 0.25)))
            * smoothstep(0.04, 0.18, height);
          color = mix(color, uRed, redAccent * 0.88);
          float alpha = min(0.65, light * edge * uStrength);
          gl_FragColor = vec4(color * 1.4, alpha);
        }
      `,
    });
    materials.push(material);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(160, 38, 128, 16), material);
    curtain.position.set((layer - 1) * 12, 24 + layer * 7, -65 - layer * 22);
    curtain.rotation.z = (layer - 1) * 0.06;
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