import * as THREE from "three";

export interface EnvLayer {
  object: THREE.Object3D;
  update: (t: number, dt: number, energy: number, amp: number) => void;
}

/** Superficie tridimensional de datos: miles de partículas en onda. */
export function createWaveField(density: number): EnvLayer {
  const N = density; // por eje
  const spread = 420;
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  let i = 0;
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      const px = (x / (N - 1) - 0.5) * spread;
      const pz = (z / (N - 1) - 0.5) * spread;
      pos[i * 3] = px;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = pz;
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
      uDpr: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime; uniform float uEnergy; uniform float uAmp; uniform float uDpr;
      varying float vI;
      void main(){
        vec3 p = position;
        float d = length(p.xz);
        float w = sin(p.x * 0.021 + uTime * 0.35) * 6.0
                + cos(p.z * 0.017 - uTime * 0.28) * 5.0
                + sin(d * 0.035 - uTime * 0.9) * (3.0 + uEnergy * 5.0 + uAmp * 9.0);
        p.y += w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fade = smoothstep(430.0, 90.0, d);
        vI = fade * (0.25 + 0.75 * smoothstep(-6.0, 9.0, w)) * (0.5 + aSeed * 0.7);
        gl_PointSize = (1.1 + aSeed * 1.2) * uDpr * (60.0 / max(0.001, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vI;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vI;
        vec3 c = mix(vec3(0.03,0.16,0.42), vec3(0.30,0.78,1.0), vI);
        gl_FragColor = vec4(c * (0.6 + vI), a * 0.75);
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
    update: (t, _dt, energy, amp) => {
      mat.uniforms["uTime"]!.value = t;
      mat.uniforms["uEnergy"]!.value = energy;
      mat.uniforms["uAmp"]!.value = amp;
    },
  };
}

/** Ciudad digital abstracta: estructuras de datos en perspectiva. */
export function createCity(count: number): EnvLayer {
  const verts: number[] = [];
  const intens: number[] = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 90 + Math.pow(Math.random(), 0.6) * 260;
    const cx = Math.cos(ang) * rad;
    const cz = Math.sin(ang) * rad - 40;
    if (Math.abs(cx) < 55 && Math.abs(cz) < 55) continue;
    const w = 4 + Math.random() * 12;
    const d = 4 + Math.random() * 12;
    const h = 8 + Math.pow(Math.random(), 2) * 90;
    const y0 = -46;
    const y1 = y0 + h;
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const corners: [number, number][] = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    const ii = 1 - Math.min(1, rad / 380);
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c]!;
      const [bx, bz] = corners[(c + 1) % 4]!;
      // base + techo + columna
      verts.push(ax, y0, az, bx, y0, bz);
      verts.push(ax, y1, az, bx, y1, bz);
      verts.push(ax, y0, az, ax, y1, az);
      for (let k = 0; k < 6; k++) intens.push(ii);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("aI", new THREE.Float32BufferAttribute(intens, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aI; uniform float uTime; varying float vI; varying float vY;
      void main(){
        vI = aI; vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI; varying float vY; uniform float uTime;
      void main(){
        float scan = 0.55 + 0.45 * sin(vY * 0.35 - uTime * 1.2);
        vec3 c = mix(vec3(0.05,0.20,0.48), vec3(0.22,0.66,0.98), vI);
        gl_FragColor = vec4(c * (0.35 + vI * 0.9) * scan, (0.10 + vI * 0.42));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return {
    object: lines,
    update: (t) => {
      mat.uniforms["uTime"]!.value = t;
    },
  };
}

/** Circuitos tridimensionales con paquetes de datos viajando. */
export function createCircuits(paths: number): EnvLayer {
  const group = new THREE.Group();
  const lineVerts: number[] = [];
  const routes: THREE.Vector3[][] = [];

  for (let p = 0; p < paths; p++) {
    const pts: THREE.Vector3[] = [];
    let x = (Math.random() - 0.5) * 380;
    let y = -44 + Math.random() * 70;
    let z = -260 + Math.random() * 320;
    const segs = 5 + Math.floor(Math.random() * 5);
    pts.push(new THREE.Vector3(x, y, z));
    for (let s = 0; s < segs; s++) {
      const axis = Math.floor(Math.random() * 3);
      const len = 18 + Math.random() * 60;
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
    color: new THREE.Color(0x0b3f7a),
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.LineSegments(lgeo, lmat));

  const N = paths * 2;
  const ppos = new Float32Array(N * 3);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  const pmat = new THREE.PointsMaterial({
    size: 2.4,
    color: new THREE.Color(0x7fe3ff),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const packets = new THREE.Points(pgeo, pmat);
  packets.frustumCulled = false;
  group.add(packets);

  const progress = Array.from({ length: N }, () => Math.random());
  const speeds = Array.from({ length: N }, () => 0.04 + Math.random() * 0.09);
  const v = new THREE.Vector3();

  return {
    object: group,
    update: (_t, dt, energy) => {
      for (let i = 0; i < N; i++) {
        progress[i] = (progress[i]! + speeds[i]! * dt * (0.6 + energy * 1.8)) % 1;
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

/** Polvo espacial disperso: densidad irregular para crear profundidad. */
export function createDust(count: number): EnvLayer {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const cluster = Math.random() < 0.45;
    const r = cluster ? 30 + Math.random() * 60 : 90 + Math.random() * 260;
    const a = Math.random() * Math.PI * 2;
    const b = (Math.random() - 0.5) * Math.PI * 0.6;
    pos[i * 3] = Math.cos(a) * Math.cos(b) * r;
    pos[i * 3 + 1] = Math.sin(b) * r * 0.6 + 6;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uDpr; varying float vI;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * 0.25 + aSeed * 30.0) * 2.4;
        p.x += cos(uTime * 0.18 + aSeed * 20.0) * 1.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vI = 0.25 + 0.75 * aSeed;
        gl_PointSize = (0.9 + aSeed * 1.6) * uDpr * (50.0 / max(0.001, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.45, 0.78, 1.0) * vI, a * 0.5 * vI);
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
    update: (t) => {
      mat.uniforms["uTime"]!.value = t;
    },
  };
}

/** Paquetes de datos orbitando el núcleo (estados thinking/processing). */
export function createOrbit(count: number): EnvLayer & { setActive: (v: number) => void } {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: 0 },
      uDpr: { value: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uActive; uniform float uDpr;
      varying float vI;
      void main(){
        float s = aSeed * 6.2831;
        float speed = 0.35 + aSeed * 0.9;
        float ang = uTime * speed + s * 3.0;
        float rad = 3.2 + sin(s * 2.0) * 0.9 + uActive * 0.8;
        float tilt = s * 0.9;
        vec3 p = vec3(cos(ang) * rad, sin(ang * 0.7 + s) * 1.5, sin(ang) * rad);
        p.yz = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * p.yz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vI = uActive * (0.4 + 0.6 * fract(aSeed * 7.0));
        gl_PointSize = (1.6 + aSeed * 2.2) * uDpr * (34.0 / max(0.001, -mv.z)) * step(0.01, uActive);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying float vI;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * (0.6 + vI), a * vI);
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
    setActive: (v: number) => {
      mat.uniforms["uActive"]!.value = v;
    },
    update: (t) => {
      mat.uniforms["uTime"]!.value = t;
    },
  };
}