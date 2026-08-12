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
        // azul petróleo abajo -> azul profundo arriba
        vec3 deep   = vec3(0.002, 0.008, 0.020);
        vec3 teal   = vec3(0.004, 0.024, 0.048);
        vec3 upper  = vec3(0.002, 0.010, 0.030);
        vec3 c = mix(deep, teal, smoothstep(0.18, 0.52, h));
        c = mix(c, upper, smoothstep(0.52, 0.95, h));
        // resplandor de horizonte cian
        float hor = exp(-pow((h - 0.47) * 7.5, 2.0));
        c += vec3(0.008, 0.036, 0.072) * hor * (0.7 + uEnergy * 0.4);
        // nubes de energía muy sutiles
        float n = noise(d.xz * 3.2 + uTime * 0.012) * noise(d.xy * 2.1 - uTime * 0.008);
        c += vec3(0.005, 0.018, 0.036) * smoothstep(0.5, 0.95, n);
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
  const spread = 620;
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  let i = 0;
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      const jx = (Math.random() - 0.5) * (spread / N) * 0.9;
      const jz = (Math.random() - 0.5) * (spread / N) * 0.9;
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
      varying float vI; varying float vH; varying float vNear;
      void main(){
        vec3 p = position;
        float d = length(p.xz);
        // montañas, valles y crestas: varias octavas
        float w  = sin(p.x * 0.0125 + uTime * 0.22) * 15.0;
        w += cos(p.z * 0.0098 - uTime * 0.17) * 13.0;
        w += sin((p.x + p.z) * 0.026 + uTime * 0.34) * 6.0;
        w += cos(p.x * 0.052 - uTime * 0.5) * 2.4;
        w += sin(d * 0.030 - uTime * 0.75) * (4.0 + uEnergy * 7.0 + uAmp * 14.0);
        // cráter suave alrededor del núcleo
        w *= smoothstep(20.0, 130.0, d);
        p.y += w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float fade = smoothstep(640.0, 70.0, d);
        vH = smoothstep(-20.0, 24.0, w);
        vNear = smoothstep(420.0, 40.0, dist);
        vI = fade * (0.30 + 0.70 * vH) * (0.55 + aSeed * 0.75);
        gl_PointSize = (1.5 + aSeed * 2.0 + vH * 1.2) * uDpr * (80.0 / max(0.001, dist));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vI; varying float vH; varying float vNear;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.06, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 low  = vec3(0.04, 0.22, 0.55);
        vec3 mid  = vec3(0.16, 0.62, 1.00);
        vec3 hi   = vec3(0.62, 0.92, 1.00);
        vec3 c = mix(low, mid, vH);
        c = mix(c, hi, smoothstep(0.72, 1.0, vH) * 0.8);
        float a = (halo * 0.16 + core * 0.34) * (0.25 + vI * 0.8) * (0.35 + vNear * 0.5);
        gl_FragColor = vec4(c * (0.5 + vI * 0.7), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = -46;
  points.frustumCulled = false;

  return {
    object: points,
    parallax: 0.55,
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

  type Box = { x: number; z: number; w: number; d: number; h: number; i: number };
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 95 + Math.pow(Math.random(), 0.55) * 400;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad - 40;
    if (Math.abs(x) < 58 && Math.abs(z) < 58) continue;
    const w = 8 + Math.random() * 26;
    const d = 8 + Math.random() * 26;
    const h = 14 + Math.pow(Math.random(), 1.8) * 150;
    boxes.push({ x, z, w, d, h, i: 1 - Math.min(1, rad / 520) });
  }

  /* volúmenes semitransparentes con instancing */
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const volMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });
  const inst = new THREE.InstancedMesh(boxGeo, volMat, boxes.length);
  const m4 = new THREE.Matrix4();
  const colAttr = new Float32Array(boxes.length * 3);
  boxes.forEach((b, k) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, -46 + b.h / 2, b.z);
    inst.setMatrixAt(k, m4);
    const t = b.i;
    colAttr[k * 3] = 0.03 + t * 0.09;
    colAttr[k * 3 + 1] = 0.16 + t * 0.34;
    colAttr[k * 3 + 2] = 0.34 + t * 0.5;
  });
  inst.instanceColor = new THREE.InstancedBufferAttribute(colAttr, 3);
  inst.frustumCulled = false;
  group.add(inst);

  /* nube de partículas que da volumen a cada estructura */
  const per = 46;
  const total = boxes.length * per;
  const ppos = new Float32Array(total * 3);
  const pseed = new Float32Array(total);
  const pint = new Float32Array(total);
  let p = 0;
  for (const b of boxes) {
    for (let k = 0; k < per; k++) {
      const face = Math.random();
      let px = b.x + (Math.random() - 0.5) * b.w;
      let pz = b.z + (Math.random() - 0.5) * b.d;
      const py = -46 + Math.random() * b.h;
      if (face < 0.5) px = b.x + (Math.random() < 0.5 ? -0.5 : 0.5) * b.w;
      else pz = b.z + (Math.random() < 0.5 ? -0.5 : 0.5) * b.d;
      ppos[p * 3] = px;
      ppos[p * 3 + 1] = py;
      ppos[p * 3 + 2] = pz;
      pseed[p] = Math.random();
      pint[p] = b.i;
      p++;
    }
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  pgeo.setAttribute("aSeed", new THREE.BufferAttribute(pseed, 1));
  pgeo.setAttribute("aI", new THREE.BufferAttribute(pint, 1));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: DPR() }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute float aI;
      uniform float uTime; uniform float uDpr; uniform float uEnergy;
      varying float vI; varying float vP;
      void main(){
        vec3 pos = position;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float scan = 0.45 + 0.55 * sin(pos.y * 0.22 - uTime * 1.1 + aSeed * 6.0);
        vP = scan;
        vI = (0.3 + aI) * (0.5 + aSeed * 0.8) * smoothstep(700.0, 90.0, dist) * (0.8 + uEnergy * 0.5);
        gl_PointSize = (1.3 + aSeed * 1.9) * uDpr * (75.0 / max(0.001, dist));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI; varying float vP;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        vec3 c = mix(vec3(0.10,0.42,0.86), vec3(0.55,0.90,1.0), vP);
        gl_FragColor = vec4(c * (0.5 + vI * 0.6), a * vI * (0.22 + vP * 0.45));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(pgeo, pmat);
  pts.frustumCulled = false;
  group.add(pts);

  /* capa secundaria muy tenue de aristas verticales */
  const edges: number[] = [];
  for (const b of boxes) {
    if (Math.random() > 0.45) continue;
    edges.push(b.x - b.w / 2, -46, b.z - b.d / 2, b.x - b.w / 2, -46 + b.h, b.z - b.d / 2);
    edges.push(b.x + b.w / 2, -46, b.z + b.d / 2, b.x + b.w / 2, -46 + b.h, b.z + b.d / 2);
  }
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  const emat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0x2a86d8),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(egeo, emat);
  lines.frustumCulled = false;
  group.add(lines);

  return {
    object: group,
    parallax: 0.22,
    update: (t, _dt, energy) => {
      pmat.uniforms["uTime"]!.value = t;
      pmat.uniforms["uEnergy"]!.value = energy;
      volMat.opacity = 0.10 + energy * 0.06 + 0.015 * Math.sin(t * 0.8);
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
