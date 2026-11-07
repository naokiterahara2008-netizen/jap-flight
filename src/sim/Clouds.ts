import * as THREE from 'three';
import { Origin } from './geo';

export interface CloudWeather {
  low: number; // 0..1 被覆率
  mid: number;
  high: number;
  base: number; // 雲底高度 m
  visibility: number; // m
  source: string;
}

// --- 雲パフ用テクスチャアトラス (2x2) ---
function hash(x: number, y: number, s: number) {
  let h = x * 374761393 + y * 668265263 + s * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function makeAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S * 2, S * 2);
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * S, oy = Math.floor(k / 2) * S;
    const streak = k === 3;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const nx = x / S - 0.5, ny = y / S - 0.5;
        let n = 0, amp = 0.5, f = 3;
        for (let o = 0; o < 6; o++) {
          n += amp * vnoise(streak ? nx * f * 0.35 + 50 : nx * f + k * 17, streak ? ny * f * 2.5 : ny * f + k * 31, k * 7 + o);
          amp *= 0.5;
          f *= 2.1;
        }
        let r = Math.sqrt(nx * nx + ny * ny) * 2;
        if (streak) r = Math.sqrt(nx * nx * 1.2 + ny * ny * 3.5) * 2;
        const fall = Math.max(0, 1 - r);
        let a = fall * fall * (3 - 2 * fall);
        a = Math.max(0, Math.min(1, (a * (0.55 + n) - 0.18) * 1.7));
        const o = ((oy + y) * S * 2 + ox + x) * 4;
        img.data[o] = 255 * Math.min(1, 0.5 + n * 0.6);
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = 255 * a;
      }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const VS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iPos;
attribute vec4 iData; // size, rot, atlas, shade
attribute vec2 iExtra; // alpha, flat
uniform float fogDensity;
uniform vec3 sunView;
varying vec2 vUv;
varying vec2 vCorner;
varying float vShade;
varying float vAlpha;
varying float vFog;
varying float vAtlas;
varying float vPhase;
varying float vFlat;
uniform vec3 sunDirW;
void main() {
  vec3 wp = iPos;
  vec2 cdd = wp.xz - cameraPosition.xz;
  wp.y -= dot(cdd, cdd) * 7.848e-8;
  float s = iData.x;
  float c = cos(iData.y), sn = sin(iData.y);
  vec2 corner = vec2(c * position.x - sn * position.y, sn * position.x + c * position.y);
  vec4 mv;
  if (iExtra.y > 0.5) {
    mv = viewMatrix * vec4(wp + vec3(corner.x * s, 0.0, corner.y * s * 0.6), 1.0);
  } else {
    mv = viewMatrix * vec4(wp, 1.0);
    mv.xy += corner * s;
  }
  gl_Position = projectionMatrix * mv;
  float dist = length(mv.xyz);
  vAlpha = iExtra.x * smoothstep(s * 0.12, s * 0.7, dist);
  float fd = dist * fogDensity * 0.8;
  vFog = 1.0 - exp(-fd * fd);
  vUv = uv;
  vCorner = position.xy * 2.0;
  vShade = iData.w;
  vAtlas = iData.z;
  vFlat = iExtra.y;
  vec3 vdir = normalize(wp - cameraPosition);
  vPhase = max(0.0, dot(vdir, sunDirW));
  #include <logdepthbuf_vertex>
}
`;
const FS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D atlas;
uniform vec3 sunView;
uniform vec3 litColor;
uniform vec3 shadowColor;
uniform vec3 fogColor;
uniform float whiteout;
varying vec2 vUv;
varying vec2 vCorner;
varying float vShade;
varying float vAlpha;
varying float vFog;
varying float vAtlas;
varying float vPhase;
varying float vFlat;
void main() {
  #include <logdepthbuf_fragment>
  float ai = floor(vAtlas + 0.5);
  vec2 off = vec2(mod(ai, 2.0), floor(ai / 2.0)) * 0.5;
  vec4 t = texture2D(atlas, off + vUv * 0.5);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  float r2 = dot(vCorner, vCorner);
  vec3 n = normalize(vec3(vCorner, sqrt(max(0.0, 1.0 - r2)) + 0.25));
  float lamb = vFlat > 0.5 ? 0.8 : dot(n, sunView) * 0.5 + 0.5;
  float light = mix(0.28, 1.0, lamb) * mix(0.45, 1.0, vShade) * mix(0.75, 1.05, t.r);
  vec3 col = mix(shadowColor, litColor, light);
  // 前方散乱 (シルバーライニング)
  col += litColor * pow(vPhase, 10.0) * (1.0 - t.a) * 1.6;
  col = mix(col, fogColor, vFog);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MAX = 9000;
const CELL = 7000; // m

export class Clouds {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  mat: THREE.ShaderMaterial;
  pos = new Float32Array(MAX * 3);
  data = new Float32Array(MAX * 4);
  extra = new Float32Array(MAX * 2);
  // 未ソート
  src: { x: number; y: number; z: number; s: number; r: number; a: number; sh: number; al: number; fl: number; d: number }[] = [];
  count = 0;
  lastCell = '';
  weather: CloudWeather = { low: 0.35, mid: 0.15, high: 0.25, base: 1300, visibility: 40000, source: '既定' };
  radius = 72000;
  inCloud = 0;
  private sortTick = 0;
  private order: number[] = [];

  constructor(private origin: Origin) {
    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iExtra', new THREE.InstancedBufferAttribute(this.extra, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      uniforms: {
        atlas: { value: makeAtlas() },
        sunView: { value: new THREE.Vector3() },
        sunDirW: { value: new THREE.Vector3() },
        litColor: { value: new THREE.Color(3, 3, 3) },
        shadowColor: { value: new THREE.Color(1, 1.1, 1.3) },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 2e-5 },
        whiteout: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setWeather(w: CloudWeather) {
    this.weather = w;
    this.lastCell = '';
  }

  private generate(camMx: number, camMy: number) {
    const o = this.origin;
    const k = o.k;
    const cellM = CELL / k; // merc 単位
    const cx = Math.floor(camMx / cellM), cy = Math.floor(camMy / cellM);
    const n = Math.ceil(this.radius / CELL);
    const W = this.weather;
    this.src = [];
    const push = (mx: number, my: number, y: number, s: number, sh: number, al: number, atlas: number, fl = 0, rot = 0) => {
      if (this.src.length >= MAX) return;
      this.src.push({ x: o.toLocalX(mx), y, z: o.toLocalZ(my), s, r: rot, a: atlas, sh, al, fl, d: 0 });
    };
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const ix = cx + i, iy = cy + j;
        let seed = 0;
        const rnd = () => hash(ix, iy, 1000 + seed++);
        const bx = ix * cellM, by = iy * cellM;
        // ---- 積雲 / 層積雲 (下層) ----
        const nClusters = Math.floor(W.low * 4.2 + rnd());
        for (let c = 0; c < nClusters; c++) {
          const ccx = bx + rnd() * cellM, ccy = by + rnd() * cellM;
          const width = 700 + rnd() * 2200 * (0.6 + W.low);
          const depth = width * (0.35 + rnd() * 0.5) * (0.6 + W.low * 0.9);
          const base = W.base + (rnd() - 0.5) * 160;
          const puffs = Math.min(42, Math.floor(10 + width / 90));
          for (let p = 0; p < puffs; p++) {
            const ang = rnd() * Math.PI * 2;
            const rr = Math.sqrt(rnd());
            const dx = Math.cos(ang) * rr * width * 0.5, dz = Math.sin(ang) * rr * width * 0.42;
            const dome = Math.sqrt(Math.max(0, 1 - rr * rr));
            const s = (260 + rnd() * 380) * (0.55 + width / 3000) * (1.1 - rr * 0.4);
            const hy = dome * depth * (0.25 + 0.75 * Math.pow(rnd(), 0.6));
            const y = base + s * 0.28 + hy;
            const sh = Math.min(1, (y - base) / Math.max(200, depth));
            push(ccx + dx / k, ccy + dz / k, y, s, sh, 0.85, Math.floor(rnd() * 3), 0, rnd() * 6.28);
          }
          // 平らな雲底
          for (let p = 0; p < 5; p++) {
            const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.6;
            push(ccx + (Math.cos(ang) * rr * width * 0.5) / k, ccy + (Math.sin(ang) * rr * width * 0.4) / k, base + 40, width * 0.38, 0.05, 0.55, Math.floor(rnd() * 3), 1, rnd() * 6.28);
          }
        }
        // ---- 高積雲 (中層) ----
        if (rnd() < W.mid * 1.2) {
          const ccx = bx + rnd() * cellM, ccy = by + rnd() * cellM;
          const alt = 4300 + rnd() * 1500;
          const m = 6 + Math.floor(rnd() * 10);
          for (let p = 0; p < m; p++) {
            const dx = (rnd() - 0.5) * 4500, dz = (rnd() - 0.5) * 4500;
            push(ccx + dx / k, ccy + dz / k, alt + (rnd() - 0.5) * 200, 500 + rnd() * 700, 0.55 + rnd() * 0.4, 0.55, Math.floor(rnd() * 3), 0, rnd() * 6.28);
          }
        }
        // ---- 巻雲 (上層 ~9-11km) ----
        if (rnd() < W.high * 0.9) {
          const ccx = bx + rnd() * cellM, ccy = by + rnd() * cellM;
          const rot = 0.6 + (rnd() - 0.5) * 0.5;
          for (let p = 0; p < 3; p++) {
            push(ccx + ((rnd() - 0.5) * 4000) / k, ccy + ((rnd() - 0.5) * 4000) / k, 9800 + rnd() * 900, 6000 + rnd() * 5000, 1, 0.45, 3, 1, rot);
          }
        }
      }
    this.count = this.src.length;
    this.order = this.src.map((_, i) => i);
  }

  update(camera: THREE.Camera, camMx: number, camMy: number, sunDir: THREE.Vector3, fogColor: THREE.Color, fogDensity: number, force = false) {
    const cellM = CELL / this.origin.k;
    const key = `${Math.floor(camMx / cellM)},${Math.floor(camMy / cellM)}`;
    if (key !== this.lastCell || force) {
      this.lastCell = key;
      this.generate(camMx, camMy);
      this.sortTick = 0;
    }
    const cp = camera.position;
    const cw = new THREE.Vector3();
    camera.getWorldPosition(cw);
    void cp;
    // ソート (奥→手前)
    if (this.sortTick-- <= 0) {
      this.sortTick = 2;
      let inside = 0;
      for (const p of this.src) {
        const dx = p.x - cw.x, dy = p.y - cw.y, dz = p.z - cw.z;
        p.d = dx * dx + dy * dy + dz * dz;
        if (!p.fl && p.s > 0) {
          const d = Math.sqrt(p.d) / (p.s * 0.5);
          if (d < 1) inside = Math.max(inside, (1 - d) * 1.6);
        }
      }
      this.inCloud = Math.min(1, inside);
      this.order.sort((a, b) => this.src[b].d - this.src[a].d);
      for (let i = 0; i < this.count; i++) {
        const p = this.src[this.order[i]];
        this.pos[i * 3] = p.x;
        this.pos[i * 3 + 1] = p.y;
        this.pos[i * 3 + 2] = p.z;
        this.data[i * 4] = p.s;
        this.data[i * 4 + 1] = p.r;
        this.data[i * 4 + 2] = p.a;
        this.data[i * 4 + 3] = p.sh;
        this.extra[i * 2] = p.al;
        this.extra[i * 2 + 1] = p.fl;
      }
      this.geo.instanceCount = this.count;
      (this.geo.getAttribute('iPos') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('iData') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('iExtra') as THREE.BufferAttribute).needsUpdate = true;
    }
    const u = this.mat.uniforms;
    u.sunDirW.value.copy(sunDir);
    u.sunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    u.fogColor.value.copy(fogColor);
    u.fogDensity.value = fogDensity;
    const lum = fogColor.r * 0.3 + fogColor.g * 0.59 + fogColor.b * 0.11;
    const sunLow = THREE.MathUtils.clamp(sunDir.y * 3, 0, 1);
    u.litColor.value.setRGB(lum * 1.9, lum * (1.55 + 0.3 * sunLow), lum * (1.2 + 0.6 * sunLow));
    u.shadowColor.value.setRGB(fogColor.r * 0.62, fogColor.g * 0.66, fogColor.b * 0.74);
  }
}
