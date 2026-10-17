import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/* =====================================================================
 *  Lado IMA/VID — fondo negro, agua dorada ondulando en toda la base y
 *  una bola de agua que ondula con fuerza. Todo en amarillo.
 *  · Suelo de agua: olas grandes que viajan, anillos que nacen bajo la
 *    bola, detalle fino con mapas de normales, reflejos de luces de
 *    estudio y de la propia bola (reflejo analítico).
 *  · Bola: la superficie se deforma mucho, con remolinos de luz dorada
 *    por dentro, burbujas y gotas que caen y rizan el agua.
 *  Todo procedural (sin imágenes externas).
 * ===================================================================== */

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Mapa de normales periódico para el detalle fino del agua. */
function waterNormalMap(): THREE.DataTexture {
  const N = 256;
  const h = new Float32Array(N * N);
  const octs: [number, number][] = [
    [4, 0.5],
    [8, 0.3],
    [16, 0.16],
    [32, 0.08],
  ];
  const per = (px: number, py: number, P: number, seed: number) => {
    const x = (px / N) * P,
      y = (py / N) * P;
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const H = (a: number, b: number) =>
      hash2((((a % P) + P) % P) + seed, (((b % P) + P) % P) + seed * 1.7);
    const a = H(ix, iy),
      b = H(ix + 1, iy),
      c = H(ix, iy + 1),
      d = H(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      octs.forEach(([P, w], i) => {
        const n = per(x, y, P, i * 13.1);
        v += w * (1 - Math.abs(2 * n - 1)); // crestas → rizos de agua
      });
      h[y * N + x] = v;
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hl = h[y * N + ((x + N - 1) % N)]!,
        hr = h[y * N + ((x + 1) % N)]!;
      const hd = h[((y + N - 1) % N) * N + x]!,
        hu = h[((y + 1) % N) * N + x]!;
      const nx = (hl - hr) * 6,
        ny = (hd - hu) * 6;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* ---------- shaders ---------- */

const COMMON = /* glsl */ `
  uniform float uTime;
  float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x){
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p){
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
  // estudio oscuro con luces amarillas: caja de luz superior, tiras laterales y contraluz
  vec3 envCol(vec3 d){
    float top = smoothstep(0.55, 0.9, d.y);
    float s1 = smoothstep(0.8, 0.95, dot(d, normalize(vec3(-0.7, 0.35, -0.3))));
    float s2 = smoothstep(0.82, 0.96, dot(d, normalize(vec3(0.75, 0.3, -0.45))));
    float back = smoothstep(0.7, 0.98, dot(d, normalize(vec3(0.0, 0.25, -1.0))));
    vec3 c = vec3(1.0, 0.82, 0.35) * (top * 0.9 + s1 * 1.4 + s2 * 1.2 + back * 0.8);
    c += vec3(0.05, 0.03, 0.0) * smoothstep(-0.2, 0.6, d.y);
    return c;
  }
  // brillos puntuales de las luces del estudio
  vec3 lights(vec3 N, vec3 V){
    vec3 c = vec3(0.0);
    vec3 L1 = normalize(vec3(-0.4, 0.9, -0.2));
    vec3 L2 = normalize(vec3(0.5, 0.85, -0.3));
    vec3 L3 = normalize(vec3(0.0, 0.8, 0.6));
    c += pow(max(dot(N, normalize(L1 + V)), 0.0), 260.0) * 3.0;
    c += pow(max(dot(N, normalize(L2 + V)), 0.0), 260.0) * 2.4;
    c += pow(max(dot(N, normalize(L3 + V)), 0.0), 200.0) * 1.6;
    return c * vec3(1.0, 0.86, 0.4);
  }
`;

/** Suelo de agua: olas grandes que viajan + anillos desde la bola. */
const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBallPos;
  varying vec3 vW;
  varying vec3 vNg;
  void wave(vec2 p, vec2 dir, float k, float a, float w, inout float h, inout vec2 g){
    float ph = dot(dir, p) * k - uTime * w;
    h += a * sin(ph);
    g += a * k * cos(ph) * dir;
  }
  void main(){
    vec2 p = position.xz;
    float h = 0.0;
    vec2 g = vec2(0.0);
    wave(p, normalize(vec2(1.0, 0.4)), 0.55, 0.10, 1.1, h, g);
    wave(p, normalize(vec2(-0.6, 1.0)), 0.9, 0.07, 1.5, h, g);
    wave(p, normalize(vec2(0.3, -1.0)), 1.4, 0.045, 1.9, h, g);
    wave(p, normalize(vec2(-1.0, -0.5)), 2.3, 0.03, 2.6, h, g);
    wave(p, normalize(vec2(0.8, 0.9)), 3.4, 0.018, 3.4, h, g);
    // anillos que nacen bajo la bola y se expanden
    vec2 d = p - uBallPos.xz;
    float r = length(d);
    float env = exp(-r * 0.18) * smoothstep(0.0, 1.2, r);
    float rp = r * 3.0 - uTime * 3.2;
    h += 0.14 * sin(rp) * env;
    g += d / max(r, 1e-3) * 0.14 * 3.0 * cos(rp) * env;
    vec3 P = vec3(position.x, h, position.z);
    vec4 wp = modelMatrix * vec4(P, 1.0);
    vW = wp.xyz;
    vNg = normalize(vec3(-g.x, 1.0, -g.y));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const WATER_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform sampler2D uNorm;
  uniform vec3 uBallPos;
  uniform float uBallR;
  varying vec3 vW;
  varying vec3 vNg;
  void main(){
    vec2 uv = vW.xz;
    vec3 n1 = texture2D(uNorm, uv * 0.18 + vec2(uTime * 0.020, uTime * 0.013)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm, uv * 0.47 + vec2(-uTime * 0.035, uTime * 0.028)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(uNorm, uv * 1.3 + vec2(uTime * 0.07, -uTime * 0.05)).xyz * 2.0 - 1.0;
    vec2 sl = n1.xy * 0.5 + n2.xy * 0.35 + n3.xy * 0.22;
    vec3 N = normalize(normalize(vNg) + vec3(sl.x, 0.0, sl.y));
    vec3 V = normalize(cameraPosition - vW);
    float ndv = max(dot(N, V), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 refl = envCol(R);
    // reflejo de la bola: intersección analítica del rayo reflejado
    vec3 oc = vW - uBallPos;
    float b = dot(oc, R);
    float c = dot(oc, oc) - uBallR * uBallR;
    float hh = b * b - c;
    if (hh > 0.0 && b < 0.0) {
      float t = -b - sqrt(hh);
      if (t > 0.0) {
        vec3 nh = normalize(vW + R * t - uBallPos);
        float rim = pow(1.0 - max(dot(nh, -R), 0.0), 1.5);
        refl = mix(vec3(1.0, 0.78, 0.15), vec3(1.0, 0.95, 0.6), rim) * 1.3;
      }
    }
    // cuerpo del líquido: ámbar, con un charco de luz dorada bajo la bola
    float dB = length(uv - uBallPos.xz);
    float pool = exp(-dB * dB * 0.12);
    float crest = smoothstep(0.1, 0.9, length(sl));
    vec3 body = vec3(0.16, 0.085, 0.008) * (0.45 + 0.8 * crest) + vec3(0.95, 0.55, 0.05) * pool * 0.6;
    vec3 col = body * (1.0 - F) + refl * F;
    col += lights(N, V);
    float fade = exp(-length(cameraPosition - vW) * 0.022) * smoothstep(70.0, 22.0, length(uv));
    gl_FragColor = vec4(col * fade, 1.0);
  }
`;

/** Bola de agua: la superficie se deforma mucho; interior dorado con remolinos. */
const BALL_VERT = /* glsl */ `
  uniform float uTime, uAmp, uR;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vObj;
  float disp(vec3 n){
    float t = uTime;
    float w = 0.0;
    w += sin(n.x * 2.6 + t * 1.1) * sin(n.y * 2.3 - t * 0.9 + n.z * 1.5) * 0.9;
    w += sin(n.z * 3.4 + t * 1.7 + n.x * 2.0) * 0.55;
    w += sin(dot(n, vec3(0.7, 0.5, 0.3)) * 6.0 - t * 2.2) * 0.4;
    w += sin(dot(n, vec3(-0.3, 0.8, 0.5)) * 9.0 + t * 2.9) * 0.22;
    w += sin(dot(n, vec3(0.4, -0.6, 0.7)) * 14.0 - t * 4.1) * 0.1;
    return w;
  }
  void main(){
    vec3 n = normalize(position);
    float amp = 0.15 + uAmp * 0.12;
    vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.001)));
    vec3 t2 = cross(n, t1);
    float e = 0.02;
    vec3 n1 = normalize(n + t1 * e);
    vec3 n2 = normalize(n + t2 * e);
    vec3 p0 = n * (1.0 + disp(n) * amp);
    vec3 p1 = n1 * (1.0 + disp(n1) * amp);
    vec3 p2 = n2 * (1.0 + disp(n2) * amp);
    vec3 nn = normalize(cross(p1 - p0, p2 - p0));
    vec4 wp = modelMatrix * vec4(p0 * uR, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * nn);
    vObj = n;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BALL_FRAG = /* glsl */ `
  precision highp float;
  ${COMMON}
  uniform float uBack;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vObj;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    if (!gl_FrontFacing) N = -N;
    float ndv = max(dot(N, V), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 Rt = refract(-V, N, 1.0 / 1.33);
    vec3 q = vObj * 2.4 + vec3(0.0, uTime * 0.4, 0.0);
    float c1 = fbm3(q + fbm3(q * 1.7 + uTime * 0.25) * 1.4);
    float caus = pow(1.0 - abs(2.0 * c1 - 1.0), 5.0);
    float thick = pow(1.0 - ndv, 1.2);
    vec3 body = mix(vec3(0.75, 0.3, 0.0), vec3(1.0, 0.68, 0.04), 0.35 + 0.65 * thick);
    vec3 col = body * 0.8 + envCol(Rt) * 0.22 + caus * vec3(1.0, 0.78, 0.18) * 0.6;
    col = mix(col, envCol(R), F);
    col += lights(N, V);
    col += vec3(1.0, 0.7, 0.1) * pow(1.0 - ndv, 3.0) * 0.4;
    float alpha = clamp(0.62 + 0.38 * thick, 0.0, 0.95);
    if (uBack > 0.5) {
      col = body * 0.5 + caus * vec3(1.0, 0.85, 0.3) * 0.4;
      alpha = 0.5;
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

const BUBBLE_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform vec3 uBallPos;
  uniform float uTime, uDpr, uR;
  varying float vA;
  void main(){
    float sp = 0.15 + aRnd.w * 0.3;
    vec3 rel = vec3(aRnd.x, mod(aRnd.y * 0.5 + 0.5 + uTime * sp, 1.0) * 2.0 - 1.0, aRnd.z) * 0.9;
    float l = length(rel);
    rel *= min(1.0, 0.9 / max(l, 0.001));
    rel += 0.05 * vec3(sin(uTime * 2.0 + aRnd.w * 30.0), 0.0, cos(uTime * 1.7 + aRnd.w * 20.0));
    vec4 mv = viewMatrix * vec4(uBallPos + rel * uR, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + 3.0 * aRnd.w) * uDpr * (10.0 / max(0.1, -mv.z));
    vA = 0.5 + 0.3 * sin(uTime * 2.0 + aRnd.w * 50.0);
  }
`;
const DROP_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform vec3 uBallPos;
  uniform float uTime, uDpr, uR;
  varying float vA;
  void main(){
    float Tf = 0.75 + aRnd.w * 0.4;
    float ph = fract(aRnd.x + uTime * (0.25 + aRnd.z * 0.2));
    float t = ph * Tf * 1.6;
    float az = aRnd.y * 6.2831;
    vec3 dir = normalize(vec3(cos(az) * 0.8, -0.6, sin(az) * 0.8));
    vec3 v = vec3(cos(az), 0.0, sin(az)) * (0.15 + 0.3 * aRnd.w);
    vec3 wp = uBallPos + dir * uR * 0.98 + v * t + vec3(0.0, -3.0 * t * t, 0.0);
    vA = wp.y > 0.0 ? (1.0 - smoothstep(0.7, 1.0, ph)) * (0.5 + 0.5 * aRnd.z) : 0.0;
    wp.y = max(wp.y, 0.0);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + 2.4 * aRnd.w) * uDpr * (10.0 / max(0.1, -mv.z));
  }
`;
const MOTE_VERT = /* glsl */ `
  attribute vec4 aRnd;
  uniform float uTime, uDpr;
  varying float vA;
  void main(){
    vec3 p = position + vec3(sin(uTime * 0.3 + aRnd.w * 40.0), sin(uTime * 0.22 + aRnd.w * 23.0) * 0.6, cos(uTime * 0.27 + aRnd.w * 57.0)) * 0.8;
    p.y += mod(uTime * 0.05 * (0.3 + aRnd.x) + aRnd.y * 10.0, 3.0) * 0.2;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = pow(max(0.0, sin(uTime * (0.8 + aRnd.x * 2.0) + aRnd.w * 80.0)), 4.0);
    vA = 0.15 + 0.85 * tw * aRnd.z;
    gl_PointSize = (1.2 + 2.4 * aRnd.y) * uDpr * (12.0 / max(0.1, -mv.z));
  }
`;
const MOTE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float h = smoothstep(0.5, 0.0, d);
    float c = smoothstep(0.2, 0.0, d);
    gl_FragColor = vec4(uColor * (0.5 + c), (h * 0.5 + c * 0.6) * vA * uOpacity);
  }
`;

export class MediaScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private ballMeshes: THREE.Mesh[] = [];
  private ballPos = new THREE.Vector3(0, 2.2, 0);
  private ballAmp: THREE.IUniform<number> = { value: 0 };
  private normTex: THREE.DataTexture;
  private sh: {
    uTime: THREE.IUniform<number>;
    uDpr: THREE.IUniform<number>;
  };
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;

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
    this.renderer.setClearColor(0x000000, 1); // fondo negro
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    container.appendChild(this.renderer.domElement);

    this.sh = { uTime: { value: 0 }, uDpr: { value: dpr } };
    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.05, 300);
    this.normTex = waterNormalMap();

    this.buildWater();
    this.buildBall();
    this.buildMotes();

    this.camera.position.set(0, 2.5, 9.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.ballPos);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 18;
    this.controls.minPolarAngle = 0.9;
    this.controls.maxPolarAngle = 1.62; // la cámara siempre queda por encima del agua
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    let resume = 0;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      window.clearTimeout(resume);
    });
    this.controls.addEventListener("end", () => {
      window.clearTimeout(resume);
      resume = window.setTimeout(() => (this.controls.autoRotate = true), 4500);
    });
    this.controls.update();

    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.7, 0.6));
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(container);
    this.loop();
  }

  private mat(
    vs: string,
    fs: string,
    extra: Record<string, THREE.IUniform> = {},
    opts: THREE.ShaderMaterialParameters = {},
  ) {
    return new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      uniforms: { ...this.sh, ...extra },
      ...opts,
    });
  }

  private add(o: THREE.Object3D, order = 0) {
    o.frustumCulled = false;
    o.renderOrder = order;
    this.scene.add(o);
  }

  /** Agua en toda la base. */
  private buildWater() {
    const g = new THREE.PlaneGeometry(160, 160, 360, 360);
    g.rotateX(-Math.PI / 2);
    const m = this.mat(WATER_VERT, WATER_FRAG, {
      uNorm: { value: this.normTex },
      uBallPos: { value: this.ballPos },
      uBallR: { value: 1.2 },
    });
    this.add(new THREE.Mesh(g, m), 0);
  }

  /** Bola de agua, burbujas y gotas. */
  private buildBall() {
    const geo = new THREE.SphereGeometry(1, 128, 96);
    const mk = (back: boolean) =>
      this.mat(
        BALL_VERT,
        BALL_FRAG,
        { uAmp: this.ballAmp, uR: { value: 1.15 }, uBack: { value: back ? 1 : 0 } },
        { transparent: true, depthWrite: false, side: back ? THREE.BackSide : THREE.FrontSide },
      );
    const back = new THREE.Mesh(geo, mk(true));
    const front = new THREE.Mesh(geo, mk(false));
    this.ballMeshes = [back, front];
    this.add(back, 3);
    this.add(front, 4);

    const pts = (count: number, vs: string, color: THREE.Vector3, op: number, drop: boolean) => {
      const rn = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) rn[i * 4 + k] = drop ? Math.random() : rnd(-1, 1);
        rn[i * 4 + 3] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute("aRnd", new THREE.Float32BufferAttribute(rn, 4));
      const m = this.mat(
        vs,
        MOTE_FRAG,
        {
          uBallPos: { value: this.ballPos },
          uR: { value: 1.15 },
          uColor: { value: color },
          uOpacity: { value: op },
        },
        { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending },
      );
      this.add(new THREE.Points(g, m), 5);
    };
    pts(140, BUBBLE_VERT, new THREE.Vector3(1.0, 0.9, 0.45), 0.9, false);
    pts(200, DROP_VERT, new THREE.Vector3(1.0, 0.85, 0.3), 0.95, true);
  }

  /** Polvo dorado flotando en la oscuridad. */
  private buildMotes() {
    const count = 420;
    const pos = new Float32Array(count * 3);
    const rn = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const a = rnd(0, TAU),
        r = rnd(2, 16);
      pos.set([Math.cos(a) * r, rnd(0.3, 8), Math.sin(a) * r], i * 3);
      rn.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aRnd", new THREE.Float32BufferAttribute(rn, 4));
    const m = this.mat(
      MOTE_VERT,
      MOTE_FRAG,
      { uColor: { value: new THREE.Vector3(1.0, 0.82, 0.3) }, uOpacity: { value: 0.8 } },
      { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending },
    );
    this.add(new THREE.Points(g, m), 6);
  }

  /** Intensidad extra de las ondulaciones de la bola (0..1). */
  setLevel(v: number) {
    this.ballAmp.value = v;
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
    this.sh.uTime.value = t;

    // la bola flota y respira sobre el agua
    this.ballPos.set(0, 2.2 + 0.18 * Math.sin(t * 0.9), 0);
    const sq = 1 + 0.05 * Math.sin(t * 1.7);
    for (const m of this.ballMeshes) {
      m.position.copy(this.ballPos);
      m.scale.set(sq, 1 / sq, sq);
      m.rotation.y += dt * 0.15;
    }
    this.controls.target.copy(this.ballPos);
    this.controls.update(dt);
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.normTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
