import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { V2State } from "../v2Store";

type RGB = readonly [number, number, number];
const PAL = {
  blue: [0.05, 0.26, 1.0],
  sky: [0.2, 0.6, 1.0],
  red: [1.0, 0.06, 0.12],
  crimson: [0.8, 0.03, 0.28],
  green: [0.08, 1.0, 0.42],
  white: [0.82, 0.92, 1.0],
} as const satisfies Record<string, RGB>;

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

/** Color por zonas: azul dominante, parches rojos y un poco de verde. */
function zoneColor(x: number, y: number, z: number): RGB {
  const v =
    Math.sin(x * 1.15 + 1.7) * Math.sin(y * 0.95 + 0.4) * Math.sin(z * 1.05 + 2.1) +
    (Math.random() - 0.5) * 0.5;
  const r = Math.random();
  if (v > 0.12) return r < 0.75 ? PAL.red : PAL.crimson;
  if (v < -0.3 && r < 0.4) return PAL.green;
  return r < 0.72 ? PAL.blue : PAL.sky;
}

function randDir(): THREE.Vector3 {
  const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
  return v.lengthSq() < 1e-4 ? v.set(0, 1, 0) : v.normalize();
}

interface Shared {
  uTime: THREE.IUniform<number>;
  uEnergy: THREE.IUniform<number>;
  uThink: THREE.IUniform<number>;
  uAmp: THREE.IUniform<number>;
  uPulse: THREE.IUniform<number>;
  uDpr: THREE.IUniform<number>;
}

const POINT_VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aSeed; attribute float aSize;
  uniform float uTime, uEnergy, uThink, uAmp, uPulse, uDpr, uSwirl, uSizeMul;
  varying vec3 vColor; varying float vA;
  void main(){
    vec3 p = position;
    if (uSwirl > 0.0) {
      float r = length(p.xz);
      float ang = uTime * (0.5 + 2.4 / (0.35 + r)) * (0.6 + uThink * 1.4) * uSwirl;
      float cs = cos(ang), sn = sin(ang);
      p = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
    }
    float s = aSeed * 6.2831;
    vec3 n = normalize(p + vec3(1e-4));
    p *= 1.0 + 0.012 * sin(uTime * 0.6 + s) + uAmp * 0.05 + uPulse * 0.06;
    p += n * sin(uTime * (0.4 + aSeed) + s * 3.0) * (0.02 + uThink * 0.06 + uAmp * 0.06);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = 0.65 + 0.35 * sin(uTime * (1.2 + aSeed * 2.5) + s * 5.0);
    vColor = aColor;
    gl_PointSize = aSize * uSizeMul * uDpr * (1.0 + uEnergy * 0.25) * (14.0 / max(0.1, -mv.z));
  }
`;
const POINT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vColor; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float halo = smoothstep(0.5, 0.0, d);
    float dot = smoothstep(0.2, 0.0, d);
    vec3 c = vColor * (0.4 + halo * 0.9 + dot * 1.1);
    gl_FragColor = vec4(c, (halo * 0.5 + dot * 0.6) * vA * uOpacity);
  }
`;
const LINE_VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aA; attribute float aSeed;
  uniform float uTime, uEnergy;
  varying vec3 vC; varying float vAlpha;
  void main(){
    vC = aColor;
    float fl = 0.6 + 0.4 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 40.0);
    vAlpha = aA * fl * (0.8 + uEnergy * 0.6);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LINE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec3 vC; varying float vAlpha;
  void main(){ gl_FragColor = vec4(vC * 1.15, vAlpha * uOpacity); }
`;

const STATE_TARGET: Record<V2State, { energy: number; think: number; err: number }> = {
  idle: { energy: 0.35, think: 0, err: 0 },
  thinking: { energy: 0.8, think: 1, err: 0 },
  speaking: { energy: 0.65, think: 0.25, err: 0 },
  error: { energy: 0.9, think: 0.5, err: 1 },
};

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Núcleo 2.0: esfera de partículas azul/roja/verde sobre fondo negro, en 3D real.
 * Se puede girar 360° con el cursor (arrastrar) y acercar con la rueda.
 */
export class OrbScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private orb = new THREE.Group();
  private rings: { pts: THREE.Points; speed: number }[] = [];
  private swirl: THREE.Points[] = [];
  private lineMats: THREE.ShaderMaterial[] = [];
  private glows: { s: THREE.Sprite; base: number; k: number }[] = [];
  private shared: Shared;
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
  private speaking = false;

  constructor(private container: HTMLElement) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    this.camera.position.set(0, 1.2, w / h < 1 ? 13 : 9.6);

    this.shared = {
      uTime: { value: 0 },
      uEnergy: { value: 0.35 },
      uThink: { value: 0 },
      uAmp: { value: 0 },
      uPulse: { value: 0 },
      uDpr: { value: dpr },
    };

    this.buildShell(9000, 3.0, 0.14, 1.0, 0.85);
    this.buildShell(2400, 2.05, 0.1, 0.8, 0.6);
    this.buildRings();
    this.buildShards();
    this.buildSpokes();
    this.buildCore();
    this.buildBokeh();
    this.scene.add(this.orb);

    // controles: arrastrar = girar 360°, rueda/pellizco = zoom
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.6;
    this.controls.minDistance = 3.4;
    this.controls.maxDistance = 17;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      window.clearTimeout(this.resumeTimer);
    });
    this.controls.addEventListener("end", () => {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = window.setTimeout(() => (this.controls.autoRotate = true), 4500);
    });

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.6, 0.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  /* ---------- construcción ---------- */

  private pointMat(opacity: number, sizeMul: number, swirl = 0): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        ...this.shared,
        uOpacity: { value: opacity },
        uSizeMul: { value: sizeMul },
        uSwirl: { value: swirl },
      },
    });
  }

  private lineMat(opacity: number): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: {
        uTime: this.shared.uTime,
        uEnergy: this.shared.uEnergy,
        uOpacity: { value: opacity },
      },
    });
    this.lineMats.push(m);
    return m;
  }

  private points(
    pos: number[],
    col: number[],
    seed: number[],
    size: number[],
    mat: THREE.ShaderMaterial,
    parent: THREE.Object3D = this.orb,
  ): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    parent.add(p);
    return p;
  }

  /** Cáscara esférica de partículas con zonas densas y vacías. */
  private buildShell(
    count: number,
    radius: number,
    thick: number,
    opacity: number,
    sizeMul: number,
  ) {
    const pos: number[] = [],
      col: number[] = [],
      seed: number[] = [],
      size: number[] = [];
    let guard = 0;
    while (pos.length / 3 < count && guard++ < count * 8) {
      const n = randDir();
      const clump =
        0.5 + 0.5 * Math.sin(n.x * 3.1) * Math.sin(n.y * 2.7 + 1) * Math.sin(n.z * 3.3 + 2);
      if (Math.random() > 0.3 + 0.7 * clump) continue;
      const spike = Math.random() < 0.04 ? Math.random() * 0.5 : 0;
      const r = radius * (1 - thick * 0.5 + thick * Math.random() ** 2) + spike;
      pos.push(n.x * r, n.y * r, n.z * r);
      const c = zoneColor(n.x * 3, n.y * 3, n.z * 3);
      col.push(c[0], c[1], c[2]);
      seed.push(Math.random());
      size.push(rnd(0.8, 2.4) + (Math.random() < 0.06 ? 1.6 : 0));
    }
    this.points(pos, col, seed, size, this.pointMat(opacity, sizeMul));
  }

  /** Anillos inclinados (como un astrolabio) que giran a distinta velocidad. */
  private buildRings() {
    const defs: { r: number; tilt: [number, number]; speed: number; color: RGB; n: number }[] = [
      { r: 1.35, tilt: [1.2, 0.3], speed: 0.9, color: PAL.red, n: 520 },
      { r: 1.8, tilt: [0.4, 1.1], speed: -0.55, color: PAL.sky, n: 640 },
      { r: 2.3, tilt: [1.9, 0.7], speed: 0.38, color: PAL.blue, n: 760 },
      { r: 2.7, tilt: [0.9, 2.2], speed: -0.3, color: PAL.crimson, n: 820 },
      { r: 3.15, tilt: [1.5, 1.6], speed: 0.22, color: PAL.sky, n: 900 },
      { r: 3.55, tilt: [0.2, 0.5], speed: -0.16, color: PAL.blue, n: 960 },
      { r: 2.05, tilt: [2.6, 1.0], speed: 0.6, color: PAL.green, n: 380 },
    ];
    for (const d of defs) {
      const grp = new THREE.Group();
      grp.rotation.set(d.tilt[0], d.tilt[1], 0);
      const segs = Math.floor(rnd(5, 9));
      const pos: number[] = [],
        col: number[] = [],
        seed: number[] = [],
        size: number[] = [];
      for (let i = 0; i < d.n * 2 && pos.length / 3 < d.n; i++) {
        const a = Math.random() * Math.PI * 2;
        if (Math.sin(a * segs) > 0.55) continue; // huecos → arcos segmentados
        const rr = d.r + rnd(-0.035, 0.035);
        pos.push(Math.cos(a) * rr, Math.sin(a) * rr, rnd(-0.03, 0.03));
        const c = Math.random() < 0.15 ? PAL.white : d.color;
        col.push(c[0], c[1], c[2]);
        seed.push(Math.random());
        size.push(rnd(0.9, 2.2));
      }
      const pts = this.points(pos, col, seed, size, this.pointMat(0.95, 1), grp);

      // trazo fino continuo del anillo
      const lp: number[] = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        lp.push(Math.cos(a) * d.r, Math.sin(a) * d.r, 0);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      const loop = new THREE.LineLoop(
        lg,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(d.color[0], d.color[1], d.color[2]),
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      grp.add(loop);
      this.orb.add(grp);
      this.rings.push({ pts, speed: d.speed });
      // el trazo gira junto con los puntos
      pts.add(loop.clone());
      grp.remove(loop);
    }
  }

  /** Fragmentos tipo circuito sobre la superficie. */
  private buildShards() {
    const pos: number[] = [],
      col: number[] = [],
      a: number[] = [],
      seed: number[] = [];
    const push = (p: THREE.Vector3, q: THREE.Vector3, c: RGB, al: number, s: number) => {
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      for (let k = 0; k < 2; k++) {
        col.push(c[0], c[1], c[2]);
        a.push(al);
        seed.push(s);
      }
    };
    for (let i = 0; i < 1100; i++) {
      const n = randDir();
      const r = rnd(2.1, 3.4);
      const p = n.clone().multiplyScalar(r);
      const t1 = new THREE.Vector3().crossVectors(n, randDir()).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
      const q = p.clone().addScaledVector(t1, rnd(0.08, 0.4));
      const c = zoneColor(p.x, p.y, p.z);
      const al = rnd(0.35, 1);
      const s = Math.random();
      push(p, q, c, al, s);
      if (Math.random() < 0.45)
        push(
          q,
          q.clone().addScaledVector(t2, rnd(0.06, 0.28) * (Math.random() < 0.5 ? 1 : -1)),
          c,
          al,
          s,
        );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aA", new THREE.Float32BufferAttribute(a, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    const l = new THREE.LineSegments(g, this.lineMat(0.75));
    l.frustumCulled = false;
    this.orb.add(l);
  }

  /** Líneas radiales largas, finas, que se desvanecen en los extremos. */
  private buildSpokes() {
    const pos: number[] = [],
      col: number[] = [],
      a: number[] = [],
      seed: number[] = [];
    const STEPS = 8;
    for (let i = 0; i < 70; i++) {
      const n = randDir();
      const r0 = rnd(0.5, 1.2);
      const r1 = rnd(3.4, 5.2);
      const c = Math.random() < 0.55 ? PAL.sky : Math.random() < 0.7 ? PAL.red : PAL.green;
      const s = Math.random();
      for (let k = 0; k < STEPS; k++) {
        const u0 = k / STEPS,
          u1 = (k + 1) / STEPS;
        for (const u of [u0, u1]) {
          const r = r0 + (r1 - r0) * u;
          pos.push(n.x * r, n.y * r, n.z * r);
          col.push(c[0], c[1], c[2]);
          a.push(Math.sin(Math.PI * u) ** 1.5 * 0.5);
          seed.push(s);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aA", new THREE.Float32BufferAttribute(a, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    const l = new THREE.LineSegments(g, this.lineMat(0.6));
    l.frustumCulled = false;
    this.orb.add(l);
  }

  /** Corazón luminoso: remolino de partículas, anillo-ojo y resplandores. */
  private buildCore() {
    const pos: number[] = [],
      col: number[] = [],
      seed: number[] = [],
      size: number[] = [];
    for (let i = 0; i < 2800; i++) {
      const n = randDir();
      const r = 0.95 * Math.pow(Math.random(), 1.7);
      pos.push(n.x * r, n.y * r * 0.7, n.z * r);
      const c =
        r < 0.2
          ? PAL.white
          : r < 0.45
            ? Math.random() < 0.6
              ? PAL.sky
              : PAL.blue
            : Math.random() < 0.65
              ? PAL.red
              : PAL.crimson;
      col.push(c[0], c[1], c[2]);
      seed.push(Math.random());
      size.push(rnd(0.9, 2.2));
    }
    this.swirl.push(this.points(pos, col, seed, size, this.pointMat(0.55, 1, 1)));

    // anillo-ojo
    const ep: number[] = [],
      ec: number[] = [],
      es: number[] = [],
      ez: number[] = [];
    for (let i = 0; i < 260; i++) {
      const ang = (i / 260) * Math.PI * 2;
      ep.push(Math.cos(ang) * 0.34, 0, Math.sin(ang) * 0.34);
      ec.push(PAL.white[0], PAL.white[1], PAL.white[2]);
      es.push(Math.random());
      ez.push(rnd(1.2, 2.2));
    }
    this.swirl.push(this.points(ep, ec, es, ez, this.pointMat(0.9, 1, 1.6)));

    const add = (color: RGB, base: number, op: number, k: number) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.tex,
          color: new THREE.Color(color[0], color[1], color[2]),
          transparent: true,
          opacity: op,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.scale.set(base, base, 1);
      this.orb.add(s);
      this.glows.push({ s, base, k });
    };
    add(PAL.blue, 7.5, 0.28, 0.2);
    add(PAL.red, 3.4, 0.3, 0.5);
    add(PAL.white, 1.3, 0.55, 0.3);
  }

  /** Puntos grandes y difusos (bokeh) alrededor del núcleo. */
  private buildBokeh() {
    const pos: number[] = [],
      col: number[] = [],
      seed: number[] = [],
      size: number[] = [];
    for (let i = 0; i < 130; i++) {
      const n = randDir();
      const r = rnd(0.8, 4.6);
      pos.push(n.x * r, n.y * r, n.z * r);
      const c = zoneColor(n.x * 3, n.y * 3, n.z * 3);
      col.push(c[0], c[1], c[2]);
      seed.push(Math.random());
      size.push(rnd(14, 38));
    }
    this.points(pos, col, seed, size, this.pointMat(0.16, 1));
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

    const u = this.shared;
    u.uTime.value = t;
    u.uEnergy.value = this.cur.energy;
    u.uThink.value = this.cur.think;
    u.uAmp.value = this.ampS;
    u.uPulse.value = this.pulseV * this.pulseV;

    for (const r of this.rings)
      r.pts.rotation.z += r.speed * dt * (0.6 + this.cur.energy + this.cur.think);

    // los resplandores reaccionan al estado: rojo al pensar, azul en reposo
    const g = this.glows;
    const e = this.cur.energy;
    const breath = 1 + 0.06 * Math.sin(t * 1.4) + this.ampS * 0.35 + this.pulseV * 0.4;
    g[0]!.s.scale.setScalar(g[0]!.base * breath);
    g[1]!.s.scale.setScalar(g[1]!.base * breath * (1 + this.cur.think * 0.35));
    g[2]!.s.scale.setScalar(g[2]!.base * breath * (1 + this.ampS * 0.8));
    (g[0]!.s.material as THREE.SpriteMaterial).opacity = 0.22 + e * 0.12 - this.cur.think * 0.06;
    (g[1]!.s.material as THREE.SpriteMaterial).opacity =
      0.16 + this.cur.think * 0.3 + this.cur.err * 0.25;
    (g[2]!.s.material as THREE.SpriteMaterial).opacity = 0.4 + e * 0.35;

    this.bloom.strength = 0.75 + e * 0.5 + this.ampS * 0.4 + this.pulseV * 0.4;

    this.controls.update(dt);
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
    });
    this.tex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
