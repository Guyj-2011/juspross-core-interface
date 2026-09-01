import * as THREE from "three";

export interface EnvLayer {
  object: THREE.Object3D;
  /** Factor de parallax respecto al cursor (0 = fijo, 1 = muy reactivo). */
  parallax?: number;
  update: (t: number, dt: number, energy: number, amp: number) => void;
}

const DPR = () => Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1);

/* ------------------------------------------------------------------ */
/* ATMÓSFERA: cúpula de gradiente azul profundo, evita el negro puro    */
/* ------------------------------------------------------------------ */
export function createAtmosphere(): EnvLayer {
  const geo = new THREE.SphereGeometry(720, 40, 28);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vP;
      uniform float uTime; uniform float uEnergy;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main(){
        vec3 d = normalize(vP);
        float h = d.y * 0.5 + 0.5;
        // fondo más oscuro: azul casi negro abajo -> azul profundo arriba
        vec3 deep   = vec3(0.001, 0.003, 0.010);
        vec3 teal   = vec3(0.002, 0.012, 0.028);
        vec3 upper  = vec3(0.001, 0.006, 0.018);
        vec3 c = mix(deep, teal, smoothstep(0.18, 0.52, h));
        c = mix(c, upper, smoothstep(0.52, 0.95, h));
        // resplandor de horizonte cian más contenido
        float hor = exp(-pow((h - 0.47) * 7.5, 2.0));
        c += vec3(0.004, 0.018, 0.040) * hor * (0.5 + uEnergy * 0.3);
        // nubes de energía muy sutiles
        float n = noise(d.xz * 3.2 + uTime * 0.012) * noise(d.xy * 2.1 - uTime * 0.008);
        c += vec3(0.002, 0.010, 0.022) * smoothstep(0.5, 0.95, n);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    parallax: 0,
    update: (t, _dt, energy) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uEnergy"]!.value = energy;
    },
  };
}

/* ------------------------------------------------------------------ */
/* OCÉANO DIGITAL: superficie de partículas con topografía multi-octava */
/* ------------------------------------------------------------------ */
export function createWaveField(density: number): EnvLayer {
  const N = density;
  const spread = 260;
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  let i = 0;
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      const jx = (Math.random() - 0.5) * (spread / N) * 1.1;
      const jz = (Math.random() - 0.5) * (spread / N) * 1.1;
      pos[i * 3] = (x / (N - 1) - 0.5) * spread + jx;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = (z / (N - 1) - 0.5) * spread + jz;
      seed[i] = Math.random();
      i++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uAmp: { value: 0 },
      uDpr: { value: DPR() },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uEnergy; uniform float uAmp; uniform float uDpr;
      varying float vI; varying float vH; varying float vSide; varying float vSeed;
      void main(){
        vec3 p = position;
        float d = length(p.xz);
        // dunas de datos: crestas largas que suben a izquierda y derecha
        float w  = sin(p.x * 0.085 + uTime * 0.22) * 3.4;
        w += cos(p.z * 0.062 - uTime * 0.17) * 2.8;
        w += sin((p.x * 0.7 + p.z) * 0.13 + uTime * 0.31) * 1.5;
        w += cos(p.x * 0.24 - uTime * 0.45) * 0.6;
        w += sin(d * 0.20 - uTime * 0.8) * (0.5 + uEnergy * 0.9 + uAmp * 2.0);
        // las laderas crecen al alejarse del núcleo (valle central despejado)
        float rise = smoothstep(6.0, 46.0, abs(p.x)) * 5.5 + smoothstep(10.0, 70.0, abs(p.z)) * 2.5;
        w = w * smoothstep(5.0, 26.0, d) + rise;
        p.y += w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float fade = smoothstep(300.0, 20.0, d);
        vH = smoothstep(-2.0, 9.0, w);
        vSide = smoothstep(10.0, 90.0, abs(p.x));
        vSeed = aSeed;
        vI = fade * (0.42 + 0.75 * vH) * (0.6 + aSeed * 0.8);
        gl_PointSize = (1.1 + aSeed * 1.6 + vH * 1.0) * uDpr * (26.0 / max(0.001, dist));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vI; varying float vH; varying float vSide; varying float vSeed;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.05, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 deepBlue = vec3(0.03, 0.20, 0.72);
        vec3 cyan     = vec3(0.16, 0.78, 1.00);
        vec3 white    = vec3(0.78, 0.96, 1.00);
        vec3 magenta  = vec3(0.85, 0.22, 0.95);
        vec3 c = mix(deepBlue, cyan, vH);
        c = mix(c, white, smoothstep(0.75, 1.0, vH) * 0.85);
        // vetas magenta en las laderas exteriores, como en la referencia
        c = mix(c, magenta, vSide * step(0.82, vSeed) * 0.9);
        float a = (halo * 0.30 + core * 0.72) * (0.30 + vI * 0.95);
        gl_FragColor = vec4(c * (0.8 + vI * 1.1), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = -9.5;
  points.frustumCulled = false;

  return {
    object: points,
    parallax: 0.35,
    update: (t, _dt, energy, amp) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uEnergy"]!.value = energy;
      mat.uniforms["uAmp"]!.value = amp;
    },
  };
}

/* ------------------------------------------------------------------ */
/* INFRAESTRUCTURA DIGITAL: volúmenes translúcidos + nubes de puntos    */
/* ------------------------------------------------------------------ */
export function createStructures(count: number): EnvLayer {
  const group = new THREE.Group();
  const FLOOR = -9.5;

  type Bar = { x: number; z: number; w: number; h: number; c: THREE.Color };
  const bars: Bar[] = [];
  const cyan = new THREE.Color(0x2ea6ff);
  const ice = new THREE.Color(0x7fe6ff);
  const magenta = new THREE.Color(0xc23bff);
  const total = count * 6;
  for (let i = 0; i < total; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 55 + Math.pow(Math.random(), 0.5) * 210;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad - 30;
    if (z > 30) continue;                    // nada delante de la cámara
    if (Math.abs(x) < 22 && z > -60) continue; // corredor central despejado
    const w = 0.4 + Math.random() * 1.9;
    const h = 6 + Math.pow(Math.random(), 1.7) * 78;
    const r = Math.random();
    const c = r < 0.14 ? magenta : r < 0.42 ? ice : cyan;
    bars.push({ x, z, w, h, c });
  }

  // torres finas y luminosas: la "ciudad de datos" del horizonte
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    fog: true,
  });
  const inst = new THREE.InstancedMesh(geo, mat, bars.length);
  const m4 = new THREE.Matrix4();
  const col = new Float32Array(bars.length * 3);
  bars.forEach((b, k) => {
    m4.makeScale(b.w, b.h, b.w);
    m4.setPosition(b.x, FLOOR + b.h / 2, b.z);
    inst.setMatrixAt(k, m4);
    const dim = 0.25 + 0.75 * (1 - Math.min(1, Math.hypot(b.x, b.z) / 280));
    col[k * 3] = b.c.r * dim;
    col[k * 3 + 1] = b.c.g * dim;
    col[k * 3 + 2] = b.c.b * dim;
  });
  inst.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  inst.frustumCulled = false;
  group.add(inst);

  // ventanas / píxeles de datos que recorren las torres
  const per = 10;
  const n = bars.length * per;
  const ppos = new Float32Array(n * 3);
  const pcol = new Float32Array(n * 3);
  const pseed = new Float32Array(n);
  let p = 0;
  for (const b of bars) {
    for (let k = 0; k < per; k++) {
      ppos[p * 3] = b.x + (Math.random() - 0.5) * b.w;
      ppos[p * 3 + 1] = FLOOR + Math.random() * b.h;
      ppos[p * 3 + 2] = b.z + (Math.random() - 0.5) * b.w;
      pcol[p * 3] = b.c.r;
      pcol[p * 3 + 1] = b.c.g;
      pcol[p * 3 + 2] = b.c.b;
      pseed[p] = Math.random();
      p++;
    }
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute("aColor", new THREE.BufferAttribute(pcol, 3));
  pgeo.setAttribute("aSeed", new THREE.BufferAttribute(pseed, 1));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: DPR() }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute vec3 aColor;
      uniform float uTime; uniform float uDpr; uniform float uEnergy;
      varying float vI; varying vec3 vC;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float blink = 0.35 + 0.65 * step(0.35, fract(aSeed * 17.0 + uTime * (0.15 + aSeed * 0.4)));
        vC = aColor;
        vI = blink * smoothstep(320.0, 20.0, dist) * (0.7 + uEnergy * 0.5);
        gl_PointSize = (1.0 + aSeed * 1.4) * uDpr * (24.0 / max(0.001, dist));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI; varying vec3 vC;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35) * (0.7 + vI), a * vI * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(pgeo, pmat);
  pts.frustumCulled = false;
  group.add(pts);

  return {
    object: group,
    parallax: 0.18,
    update: (t, _dt, energy) => {
      pmat.uniforms["uTime"]!.value = t;
      pmat.uniforms["uEnergy"]!.value = energy;
      mat.opacity = 0.6 + energy * 0.2 + 0.05 * Math.sin(t * 0.7);
    },
  };
}

/* ------------------------------------------------------------------ */
/* CIRCUITOS: tráfico de datos                                          */
/* ------------------------------------------------------------------ */
export function createCircuits(paths: number): EnvLayer {
  const group = new THREE.Group();
  const lineVerts: number[] = [];
  const routes: THREE.Vector3[][] = [];

  for (let p = 0; p < paths; p++) {
    const pts: THREE.Vector3[] = [];
    let x = (Math.random() - 0.5) * 460;
    let y = -44 + Math.random() * 90;
    let z = -300 + Math.random() * 380;
    const segs = 5 + Math.floor(Math.random() * 6);
    pts.push(new THREE.Vector3(x, y, z));
    for (let s = 0; s < segs; s++) {
      const axis = Math.floor(Math.random() * 3);
      const len = 22 + Math.random() * 70;
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (axis === 0) x += len * dir;
      else if (axis === 1) y += len * dir * 0.35;
      else z += len * dir;
      pts.push(new THREE.Vector3(x, y, z));
    }
    routes.push(pts);
    for (let s = 0; s < pts.length - 1; s++) {
      lineVerts.push(pts[s]!.x, pts[s]!.y, pts[s]!.z, pts[s + 1]!.x, pts[s + 1]!.y, pts[s + 1]!.z);
    }
  }

  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
  const lmat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0x114b8c),
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.LineSegments(lgeo, lmat));

  const N = paths * 3;
  const ppos = new Float32Array(N * 3);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) } },
    vertexShader: /* glsl */ `
      uniform float uDpr;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 2.6 * uDpr * (90.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.45, 0.85, 1.0), a * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const packets = new THREE.Points(pgeo, pmat);
  packets.frustumCulled = false;
  group.add(packets);

  const progress = Array.from({ length: N }, () => Math.random());
  const speeds = Array.from({ length: N }, () => 0.03 + Math.random() * 0.08);
  const v = new THREE.Vector3();

  return {
    object: group,
    parallax: 0.35,
    update: (_t, dt, energy) => {
      for (let i = 0; i < N; i++) {
        progress[i] = (progress[i]! + speeds[i]! * dt * (0.5 + energy * 1.8)) % 1;
        const route = routes[i % routes.length]!;
        const segCount = route.length - 1;
        const f = progress[i]! * segCount;
        const si = Math.min(segCount - 1, Math.floor(f));
        v.copy(route[si]!).lerp(route[si + 1]!, f - si);
        ppos[i * 3] = v.x;
        ppos[i * 3 + 1] = v.y;
        ppos[i * 3 + 2] = v.z;
      }
      pgeo.attributes["position"]!.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* POLVO: tres profundidades para parallax real                         */
/* ------------------------------------------------------------------ */
export function createDust(count: number, band: "near" | "mid" | "far"): EnvLayer {
  const range = band === "near" ? [45, 120] : band === "mid" ? [120, 260] : [260, 520];
  const scale = band === "near" ? 1.7 : band === "mid" ? 1.25 : 0.9;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = range[0]! + Math.random() * (range[1]! - range[0]!);
    const a = Math.random() * Math.PI * 2;
    const b = (Math.random() - 0.5) * Math.PI * 0.55;
    pos[i * 3] = Math.cos(a) * Math.cos(b) * r;
    pos[i * 3 + 1] = Math.sin(b) * r * 0.55 + 6;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: DPR() },
      uScale: { value: scale },
      uAmp: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uDpr; uniform float uScale; uniform float uAmp;
      varying float vI; varying float vT;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * 0.22 + aSeed * 30.0) * 3.0;
        p.x += cos(uTime * 0.16 + aSeed * 20.0) * 2.4;
        p *= 1.0 + uAmp * 0.05 * (0.3 + aSeed);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        vI = (0.25 + 0.75 * aSeed) * smoothstep(760.0, 60.0, dist);
        vT = fract(aSeed * 13.0);
        gl_PointSize = (0.8 + aSeed * 1.5) * uScale * uDpr * (60.0 / max(0.001, dist));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI; varying float vT;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.05, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 c = mix(vec3(0.22,0.58,1.0), vec3(0.70,0.95,1.0), vT);
        c = mix(c, vec3(0.45,0.42,1.0), step(0.94, vT) * 0.7);
        gl_FragColor = vec4(c * (0.55 + vI * 0.6), (halo * 0.10 + core * 0.26) * vI);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    parallax: band === "near" ? 1.0 : band === "mid" ? 0.55 : 0.18,
    update: (t, _dt, _e, amp) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uAmp"]!.value = amp;
    },
  };
}

/* ------------------------------------------------------------------ */
/* AURA DEL NÚCLEO: nube orgánica que envuelve el logo                  */
/* ------------------------------------------------------------------ */
export function createAura(count: number): EnvLayer & { setEnergy: (v: number) => void } {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const r = 3.0 + Math.pow(Math.random(), 1.6) * 3.6;
    pos[i * 3] = Math.sin(b) * Math.cos(a) * r;
    pos[i * 3 + 1] = Math.cos(b) * r * 0.8;
    pos[i * 3 + 2] = Math.sin(b) * Math.sin(a) * r;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: DPR() }, uEnergy: { value: 0 }, uAmp: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uDpr; uniform float uEnergy; uniform float uAmp;
      varying float vI;
      void main(){
        vec3 p = position;
        float s = aSeed * 6.2831;
        p += vec3(sin(uTime*0.5+s*2.0), cos(uTime*0.42+s*3.0), sin(uTime*0.36+s)) * (0.35 + uAmp * 0.9);
        p *= 1.0 + uAmp * 0.18 + uEnergy * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vI = (0.25 + 0.75 * aSeed) * (0.35 + uEnergy * 0.9 + uAmp * 0.8);
        gl_PointSize = (1.4 + aSeed * 2.6) * uDpr * (44.0 / max(0.001, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.42, 0.82, 1.0) * (0.5 + vI * 0.6), a * vI * 0.22);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    parallax: 0,
    setEnergy: (v) => {
      mat.uniforms["uEnergy"]!.value = v;
    },
    update: (t, _dt, _e, amp) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uAmp"]!.value = amp;
    },
  };
}

/* ------------------------------------------------------------------ */
/* ÓRBITA: paquetes de datos alrededor del núcleo                       */
/* ------------------------------------------------------------------ */
export function createOrbit(count: number): EnvLayer & { setActive: (v: number) => void } {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uActive: { value: 0 }, uDpr: { value: DPR() } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uActive; uniform float uDpr;
      varying float vI;
      void main(){
        float s = aSeed * 6.2831;
        float speed = 0.35 + aSeed * 0.9;
        float ang = uTime * speed + s * 3.0;
        float rad = 3.4 + sin(s * 2.0) * 1.1 + uActive * 0.9;
        float tilt = s * 0.9;
        vec3 p = vec3(cos(ang) * rad, sin(ang * 0.7 + s) * 1.5, sin(ang) * rad);
        p.yz = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * p.yz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vI = uActive * (0.4 + 0.6 * fract(aSeed * 7.0));
        gl_PointSize = (2.0 + aSeed * 2.6) * uDpr * (36.0 / max(0.001, -mv.z)) * step(0.01, uActive);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.60, 0.92, 1.0) * (0.6 + vI), a * vI);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    parallax: 0,
    setActive: (v: number) => {
      mat.uniforms["uActive"]!.value = v;
    },
    update: (t) => {
      mat.uniforms["uTime"]!.value = t;
    },
  };
}

/* ------------------------------------------------------------------ */
/* CUBOS DE DATOS: retícula de cubos luminosos sobre el suelo           */
/* ------------------------------------------------------------------ */
export function createCubeField(count: number): EnvLayer {
  const group = new THREE.Group();
  const FLOOR = -9.5;
  const verts: number[] = [];
  const cols: number[] = [];
  const seeds: number[] = [];

  const E: { a: [number, number, number]; b: [number, number, number] }[] = [];
  const c = [-0.5, 0.5];
  for (const sx of c)
    for (const sy of c)
      for (const sz of c) {
        if (sx < 0) E.push({ a: [sx, sy, sz], b: [0.5, sy, sz] });
        if (sy < 0) E.push({ a: [sx, sy, sz], b: [sx, 0.5, sz] });
        if (sz < 0) E.push({ a: [sx, sy, sz], b: [sx, sy, 0.5] });
      }

  type Cube = { x: number; y: number; z: number; s: number; r: number; g: number; b: number; seed: number };
  const cubes: Cube[] = [];
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 90;
    const z = -6 - Math.pow(Math.random(), 0.7) * 90;
    if (Math.abs(x) < 5 && z > -26) continue;
    const s = 1.1 + Math.random() * 3.4;
    const y = FLOOR + s / 2 + Math.random() * 1.2;
    const magenta = Math.random() < 0.18;
    cubes.push({
      x, y, z, s,
      r: magenta ? 0.82 : 0.14,
      g: magenta ? 0.2 : 0.72,
      b: 1.0,
      seed: Math.random(),
    });
  }

  for (const cu of cubes) {
    for (const { a, b: bb } of E) {
      verts.push(cu.x + a[0] * cu.s, cu.y + a[1] * cu.s, cu.z + a[2] * cu.s);
      verts.push(cu.x + bb[0] * cu.s, cu.y + bb[1] * cu.s, cu.z + bb[2] * cu.s);
      cols.push(cu.r, cu.g, cu.b, cu.r, cu.g, cu.b);
      seeds.push(cu.seed, cu.seed);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSeed;
      uniform float uTime; uniform float uEnergy;
      varying vec3 vC; varying float vI;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float pulse = 0.6 + 0.4 * sin(uTime * (0.5 + aSeed) + aSeed * 12.0);
        vC = aColor;
        vI = pulse * smoothstep(160.0, 8.0, dist) * (0.7 + uEnergy * 0.6);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec3 vC; varying float vI;
      void main(){ gl_FragColor = vec4(mix(vC, vec3(1.0), 0.25) * (0.9 + vI * 1.2), vI * 0.95); }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  group.add(lines);

  // caras internas translúcidas: los cubos se ven como volúmenes de luz
  const faceGeo = new THREE.BoxGeometry(1, 1, 1);
  const faceMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });
  const inst = new THREE.InstancedMesh(faceGeo, faceMat, cubes.length);
  const m4 = new THREE.Matrix4();
  const icol = new Float32Array(cubes.length * 3);
  cubes.forEach((cu, k) => {
    m4.makeScale(cu.s, cu.s, cu.s);
    m4.setPosition(cu.x, cu.y, cu.z);
    inst.setMatrixAt(k, m4);
    icol[k * 3] = cu.r * 0.6;
    icol[k * 3 + 1] = cu.g * 0.6;
    icol[k * 3 + 2] = cu.b * 0.6;
  });
  inst.instanceColor = new THREE.InstancedBufferAttribute(icol, 3);
  inst.frustumCulled = false;
  group.add(inst);

  return {
    object: group,
    parallax: 0.42,
    update: (t, _dt, energy) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uEnergy"]!.value = energy;
      faceMat.opacity = 0.12 + energy * 0.08;
    },
  };
}

/* ------------------------------------------------------------------ */
/* SUELO: base oscura con reflejos difusos bajo las dunas               */
/* ------------------------------------------------------------------ */
export function createMirrorFloor(): EnvLayer {
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vW;
      uniform float uTime; uniform float uEnergy;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main(){
        float dist = length(vW.xz);
        float fade = smoothstep(240.0, 10.0, dist);
        vec3 col = vec3(0.010, 0.045, 0.11) * fade;
        // reflejo derramado del núcleo
        float coreRef = exp(-pow(vW.x / 12.0, 2.0)) * exp(-pow((vW.z + 6.0) / 60.0, 2.0));
        col += vec3(0.08, 0.34, 0.85) * coreRef * (0.5 + uEnergy * 0.7);
        // reflejos verticales difusos de las torres
        float streak = smoothstep(0.6, 1.0, noise(vec2(vW.x * 0.22, vW.z * 0.02 + uTime * 0.03)));
        float side = smoothstep(14.0, 90.0, abs(vW.x)) * smoothstep(260.0, 40.0, dist);
        col += mix(vec3(0.05, 0.26, 0.60), vec3(0.32, 0.08, 0.66), step(0.86, noise(vec2(vW.x * 0.09, 7.3))))
             * streak * side * 0.5;
        gl_FragColor = vec4(col, clamp(fade * 0.75, 0.0, 1.0));
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -9.7;
  mesh.frustumCulled = false;
  return {
    object: mesh,
    parallax: 0,
    update: (t, _dt, energy) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uEnergy"]!.value = energy;
    },
  };
}
