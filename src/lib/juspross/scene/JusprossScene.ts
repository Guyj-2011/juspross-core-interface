import * as THREE from "three";
import { makeCoreMaterial, sampleLogo } from "./core";
import {
  createAtmosphere,
  createAura,
  createCircuits,
  createDust,
  createOrbit,
  createStructures,
  createWaveField,
  type EnvLayer,
} from "./environment";
import type { SystemState } from "../types";

export type Quality = "high" | "balanced" | "low";

const PRESET: Record<
  Quality,
  { wave: number; struct: number; circuits: number; dustNear: number; dustMid: number; dustFar: number; orbit: number; aura: number; bloom: number; dpr: number }
> = {
  high: { wave: 240, struct: 190, circuits: 22, dustNear: 700, dustMid: 1100, dustFar: 1600, orbit: 260, aura: 900, bloom: 0.42, dpr: 2 },
  balanced: { wave: 180, struct: 130, circuits: 16, dustNear: 450, dustMid: 750, dustFar: 1000, orbit: 180, aura: 600, bloom: 0.38, dpr: 1.6 },
  low: { wave: 110, struct: 70, circuits: 10, dustNear: 220, dustMid: 340, dustFar: 460, orbit: 90, aura: 280, bloom: 0.3, dpr: 1 },
};

const STATE_ENERGY: Record<SystemState, { energy: number; think: number; orbit: number; err: number }> = {
  idle: { energy: 0.22, think: 0.0, orbit: 0.0, err: 0 },
  listening: { energy: 0.6, think: 0.08, orbit: 0.3, err: 0 },
  thinking: { energy: 0.75, think: 0.85, orbit: 0.75, err: 0 },
  processing: { energy: 0.9, think: 0.45, orbit: 1.0, err: 0 },
  speaking: { energy: 0.7, think: 0.1, orbit: 0.4, err: 0 },
  success: { energy: 0.55, think: 0.0, orbit: 0.25, err: 0 },
  error: { energy: 0.4, think: 0.15, orbit: 0.1, err: 1 },
};

export class JusprossScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private layers: EnvLayer[] = [];
  private basePos = new WeakMap<THREE.Object3D, THREE.Vector3>();
  private orbit = createOrbit(1);
  private aura = createAura(1);
  private coreGroup = new THREE.Group();
  private coreMat: THREE.ShaderMaterial;
  private rings: THREE.Mesh[] = [];
  private ringPhase = [0.0, 0.45, 0.8];
  private coreGlow: THREE.Mesh | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private mouse = new THREE.Vector2();
  private mouseSmooth = new THREE.Vector2();
  private target = { energy: 0.22, think: 0, orbit: 0, err: 0 };
  private cur = { energy: 0.22, think: 0, orbit: 0, err: 0 };
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

    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== "low", alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x01060d, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(52, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.camera.position.set(0, 3.6, 16);
    this.camera.lookAt(0, 0.6, 0);

    // niebla atmosférica azul: las estructuras lejanas se disuelven en el azul
    this.scene.fog = new THREE.FogExp2(0x02090f, 0.0018);

    // capas del entorno (orden = profundidad conceptual)
    this.layers.push(createAtmosphere());
    this.layers.push(createDust(this.preset.dustFar, "far"));
    this.layers.push(createStructures(this.preset.struct));
    this.layers.push(createCircuits(this.preset.circuits));
    this.layers.push(createWaveField(this.preset.wave));
    this.layers.push(createDust(this.preset.dustMid, "mid"));
    this.layers.push(createDust(this.preset.dustNear, "near"));
    this.orbit = createOrbit(this.preset.orbit);
    this.aura = createAura(this.preset.aura);
    this.layers.push(this.orbit);
    this.layers.push(this.aura);
    this.layers.forEach((l) => {
      this.scene.add(l.object);
      this.basePos.set(l.object, l.object.position.clone());
    });

    // núcleo de partículas a partir del logo
    const sample = sampleLogo(logo, 3.0, quality === "low" ? 150 : 240);
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
    this.aura.object.position.copy(this.coreGroup.position);
    this.orbit.object.position.copy(this.coreGroup.position);

    // el núcleo ilumina el espacio a su alrededor
    const coreLight = new THREE.PointLight(0x49b9ff, 2.0, 220, 1.8);
    coreLight.position.set(0, 1.2, 0);
    this.scene.add(coreLight);
    this.scene.add(new THREE.AmbientLight(0x123a5e, 0.7));

    // ondas de energía que se propagan hacia el entorno
    for (let i = 0; i < 3; i++) {
      const ringGeo = new THREE.RingGeometry(3.4, 3.62, 160);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x6fd8ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(this.coreGroup.position);
      ring.rotation.x = Math.PI / 2.1;
      this.scene.add(ring);
      this.rings.push(ring);
    }


    const glowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uEnergy: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float; varying vec2 vUv; uniform float uEnergy;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 3.2) * (0.16 + uEnergy * 0.18);
          gl_FragColor = vec4(vec3(0.20, 0.62, 1.0) * (0.7 + uEnergy), a);
        }
      `,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), glowMat);
    glow.position.copy(this.coreGroup.position);
    this.coreGlow = glow;
    this.scene.add(glow);

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
    this.wave = Math.max(0, this.wave - dt * 0.9);

    this.mouseSmooth.lerp(this.mouse, Math.min(1, dt * 2.6));

    const u = this.coreMat.uniforms;
    u["uTime"]!.value = t;
    u["uAmp"]!.value = this.ampSmooth;
    u["uEnergy"]!.value = this.cur.energy;
    u["uThink"]!.value = this.cur.think;
    u["uErr"]!.value = this.cur.err;
    u["uWave"]!.value = this.wave * this.wave;

    this.coreGroup.rotation.y = Math.sin(t * 0.16) * 0.22 + this.mouseSmooth.x * 0.34;
    this.coreGroup.rotation.x = Math.sin(t * 0.12) * 0.06 + this.mouseSmooth.y * 0.16;
    this.aura.setEnergy(this.cur.energy);

    // ondas de energía escalonadas
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i]!;
      const rmat = ring.material as THREE.MeshBasicMaterial;
      const phase = (t * 0.26 + this.ringPhase[i]!) % 1;
      const boost = this.wave * 0.8;
      const life = 1 - phase;
      rmat.opacity = Math.min(0.55, life * life * (0.09 + this.cur.energy * 0.22 + boost));
      const s = 1 + phase * (5.5 + this.cur.energy * 4.0);
      ring.scale.setScalar(s);
      ring.rotation.x = Math.PI / 2.1 + this.mouseSmooth.y * 0.12;
      ring.rotation.z = t * 0.05;
    }

    this.orbit.setActive(this.cur.orbit);

    // parallax por capas: cada capa se desplaza a distinta velocidad
    for (const l of this.layers) {
      l.update(t, dt, this.cur.energy, this.ampSmooth);
      const p = l.parallax ?? 0;
      if (p > 0) {
        const base = this.basePos.get(l.object);
        if (base) {
          l.object.position.x += (base.x - this.mouseSmooth.x * 9.0 * p - l.object.position.x) * Math.min(1, dt * 2.0);
          l.object.position.y += (base.y + this.mouseSmooth.y * 5.0 * p - l.object.position.y) * Math.min(1, dt * 2.0);
        }
      }
    }

    // cámara: movimiento claramente perceptible pero suavizado
    const camX = this.mouseSmooth.x * 5.6;
    const camY = 3.6 - this.mouseSmooth.y * 3.4;
    const camZ = 16 + Math.abs(this.mouseSmooth.x) * 1.2 + Math.sin(t * 0.18) * 0.5;
    const ease = Math.min(1, dt * 1.8);
    this.camera.position.x += (camX - this.camera.position.x) * ease;
    this.camera.position.y += (camY - this.camera.position.y) * ease;
    this.camera.position.z += (camZ - this.camera.position.z) * ease;
    this.camera.lookAt(this.mouseSmooth.x * 1.2, 0.6 - this.mouseSmooth.y * 0.6, 0);
    this.camera.rotation.z = -this.mouseSmooth.x * 0.02;

    if (this.coreGlow) {
      this.coreGlow.quaternion.copy(this.camera.quaternion);
      (this.coreGlow.material as THREE.ShaderMaterial).uniforms["uEnergy"]!.value = this.cur.energy;
    }
    this.renderer.render(this.scene, this.camera);
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
