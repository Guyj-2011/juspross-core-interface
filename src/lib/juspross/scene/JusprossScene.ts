import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { makeCoreMaterial, sampleLogo } from "./core";
import {
  createCircuits,
  createCity,
  createDust,
  createOrbit,
  createWaveField,
  type EnvLayer,
} from "./environment";
import type { SystemState } from "../types";

export type Quality = "high" | "balanced" | "low";

const PRESET: Record<Quality, { wave: number; city: number; circuits: number; dust: number; orbit: number; bloom: number; dpr: number }> = {
  high: { wave: 150, city: 150, circuits: 16, dust: 900, orbit: 260, bloom: 0.85, dpr: 2 },
  balanced: { wave: 110, city: 100, circuits: 12, dust: 600, orbit: 180, bloom: 0.7, dpr: 1.5 },
  low: { wave: 70, city: 60, circuits: 8, dust: 320, orbit: 90, bloom: 0.5, dpr: 1 },
};

const STATE_ENERGY: Record<SystemState, { energy: number; think: number; orbit: number; err: number }> = {
  idle: { energy: 0.15, think: 0.0, orbit: 0.0, err: 0 },
  listening: { energy: 0.55, think: 0.08, orbit: 0.25, err: 0 },
  thinking: { energy: 0.7, think: 0.85, orbit: 0.7, err: 0 },
  processing: { energy: 0.85, think: 0.45, orbit: 1.0, err: 0 },
  speaking: { energy: 0.65, think: 0.1, orbit: 0.35, err: 0 },
  success: { energy: 0.5, think: 0.0, orbit: 0.2, err: 0 },
  error: { energy: 0.35, think: 0.15, orbit: 0.1, err: 1 },
};

export class JusprossScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private layers: EnvLayer[] = [];
  private orbit = createOrbit(1);
  private coreGroup = new THREE.Group();
  private coreMat: THREE.ShaderMaterial;
  private ring: THREE.Mesh;
  private raf = 0;
  private clock = new THREE.Clock();
  private mouse = new THREE.Vector2();
  private mouseSmooth = new THREE.Vector2();
  private target = { energy: 0.15, think: 0, orbit: 0, err: 0 };
  private cur = { energy: 0.15, think: 0, orbit: 0, err: 0 };
  private amp = 0;
  private ampSmooth = 0;
  private wave = 0;
  private disposed = false;
  private preset: (typeof PRESET)[Quality];

  constructor(
    private container: HTMLElement,
    logo: HTMLImageElement,
    quality: Quality,
  ) {
    this.preset = PRESET[quality];
    const dpr = Math.min(this.preset.dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1);

    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== "low", alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 1400);
    this.camera.position.set(0, 3.4, 15.5);
    this.camera.lookAt(0, 0.4, 0);

    this.scene.fog = new THREE.FogExp2(0x02060f, 0.0042);

    // entorno
    this.layers.push(createWaveField(this.preset.wave));
    this.layers.push(createCity(this.preset.city));
    this.layers.push(createCircuits(this.preset.circuits));
    this.layers.push(createDust(this.preset.dust));
    this.orbit = createOrbit(this.preset.orbit);
    this.layers.push(this.orbit);
    this.layers.forEach((l) => this.scene.add(l.object));

    // núcleo de partículas a partir del logo
    const sample = sampleLogo(logo, 3.0, quality === "low" ? 150 : 230);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(sample.positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(sample.colors, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(sample.seeds, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sample.sizes, 1));
    this.coreMat = makeCoreMaterial(dpr);
    const core = new THREE.Points(geo, this.coreMat);
    core.frustumCulled = false;
    this.coreGroup.add(core);
    this.coreGroup.position.set(0, 0.6, 0);
    this.scene.add(this.coreGroup);

    // onda de energía (listening / success)
    const ringGeo = new THREE.RingGeometry(3.3, 3.42, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x5fd0ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.copy(this.coreGroup.position);
    this.scene.add(this.ring);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      this.preset.bloom,
      0.72,
      0.18,
    );
    this.composer.addPass(bloom);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer);
    this.loop();
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

  private onPointer = (e: PointerEvent) => {
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };

  setState(state: SystemState) {
    this.target = { ...STATE_ENERGY[state] };
    if (state === "success") this.wave = 1;
  }

  setAmplitude(v: number) {
    this.amp = v;
  }

  pulse() {
    this.wave = 1;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    const k = 1 - Math.pow(0.001, dt);
    this.cur.energy += (this.target.energy - this.cur.energy) * k;
    this.cur.think += (this.target.think - this.cur.think) * k;
    this.cur.orbit += (this.target.orbit - this.cur.orbit) * k;
    this.cur.err += (this.target.err - this.cur.err) * k;
    this.ampSmooth += (this.amp - this.ampSmooth) * Math.min(1, dt * 14);
    this.wave = Math.max(0, this.wave - dt * 1.6);

    this.mouseSmooth.lerp(this.mouse, Math.min(1, dt * 2.2));

    const u = this.coreMat.uniforms;
    u["uTime"]!.value = t;
    u["uAmp"]!.value = this.ampSmooth;
    u["uEnergy"]!.value = this.cur.energy;
    u["uThink"]!.value = this.cur.think;
    u["uErr"]!.value = this.cur.err;
    u["uWave"]!.value = this.wave * this.wave;

    this.coreGroup.rotation.y = Math.sin(t * 0.16) * 0.22 + this.mouseSmooth.x * 0.16;
    this.coreGroup.rotation.x = Math.sin(t * 0.12) * 0.06 + this.mouseSmooth.y * 0.08;

    const rmat = this.ring.material as THREE.MeshBasicMaterial;
    const ringPulse = this.wave * 0.7 + (this.cur.energy > 0.45 ? 0.06 + 0.05 * Math.sin(t * 2.2) : 0);
    rmat.opacity = Math.min(0.6, ringPulse);
    const rs = 1 + (1 - this.wave) * this.wave * 2.2;
    this.ring.scale.setScalar(0.85 + rs * 0.35);
    this.ring.rotation.x = Math.PI / 2.15 + this.mouseSmooth.y * 0.08;
    this.ring.rotation.z = t * 0.05;

    this.orbit.setActive(this.cur.orbit);
    for (const l of this.layers) l.update(t, dt, this.cur.energy, this.ampSmooth);

    this.camera.position.x += (this.mouseSmooth.x * 1.6 - this.camera.position.x) * Math.min(1, dt * 1.6);
    this.camera.position.y += (3.4 - this.mouseSmooth.y * 1.1 - this.camera.position.y) * Math.min(1, dt * 1.6);
    this.camera.lookAt(0, 0.6, 0);

    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function loadLogo(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar el logo"));
    img.src = url;
  });
}