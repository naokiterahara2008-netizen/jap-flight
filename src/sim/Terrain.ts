import * as THREE from 'three';
import { HALF_CIRC, Origin, tileSizeMerc } from './geo';
import { applyCurvature } from './curvature';

/**
 * 実地形 LOD システム
 *  標高: 国土地理院 標高タイル (dem_png, 基盤地図情報 DEM10B/5A) — 国外/欠損は AWS Terrain Tiles (SRTM 等)
 *  画像: 国土地理院 全国最新写真 (シームレス) — 欠損時は Esri World Imagery
 */
const GSI_DEM = (z: number, x: number, y: number) => `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`;
const AWS_DEM = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const GSI_IMG = (z: number, x: number, y: number) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`;
const ESRI_IMG = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const DEM_MAX_Z = 14;
const MAX_Z = 16;
const ROOT_Z = 6;
const N = 32; // グリッド分割数
const NA = -32768;
const SEA_DEPTH = -30;
const DEM_SCALE = 8; // Int16 に 1/8m 単位で格納

type Dem = Int16Array; // 256x256

// ---- 取得キュー ----
type Job = { prio: () => number; run: () => Promise<void>; alive: () => boolean };
class FetchQueue {
  jobs: Job[] = [];
  active = 0;
  max = 14;
  push(j: Job) {
    this.jobs.push(j);
  }
  pump() {
    if (this.active >= this.max || !this.jobs.length) return;
    this.jobs = this.jobs.filter((j) => j.alive());
    this.jobs.sort((a, b) => a.prio() - b.prio());
    while (this.active < this.max && this.jobs.length) {
      const j = this.jobs.shift()!;
      this.active++;
      j.run().finally(() => {
        this.active--;
      });
    }
  }
}

const decodeCanvas = document.createElement('canvas');
decodeCanvas.width = decodeCanvas.height = 256;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true })!;

async function fetchBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const b = await r.blob();
    return await createImageBitmap(b);
  } catch {
    return null;
  }
}

function readPixels(bmp: ImageBitmap) {
  decodeCtx.clearRect(0, 0, 256, 256);
  decodeCtx.drawImage(bmp, 0, 0, 256, 256);
  return decodeCtx.getImageData(0, 0, 256, 256).data;
}

async function loadDem(z: number, x: number, y: number): Promise<Dem> {
  const out = new Int16Array(256 * 256).fill(NA);
  let naCount = 256 * 256;
  const g = await fetchBitmap(GSI_DEM(z, x, y));
  if (g) {
    const px = readPixels(g);
    g.close();
    naCount = 0;
    for (let i = 0; i < 65536; i++) {
      const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
      const v = r * 65536 + gg * 256 + b;
      if (v === 8388608) {
        naCount++;
        continue;
      }
      const h = v > 8388608 ? (v - 16777216) * 0.01 : v * 0.01;
      out[i] = Math.max(-4000, Math.min(4000, Math.round(h * DEM_SCALE)));
    }
  }
  // 国外 (朝鮮半島・サハリン等) や欠損域は AWS Terrain で補完
  if (naCount === 65536 || (naCount > 0 && z <= 10)) {
    const a = await fetchBitmap(AWS_DEM(Math.min(z, 15), x, y));
    if (a) {
      const px = readPixels(a);
      a.close();
      for (let i = 0; i < 65536; i++) {
        if (out[i] !== NA) continue;
        const h = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        if (h > 2) out[i] = Math.min(4000, Math.round(h * DEM_SCALE));
      }
    }
  }
  return out;
}

function sampleDem(d: Dem, u: number, v: number) {
  const fx = Math.min(255, Math.max(0, u * 256 - 0.5));
  const fy = Math.min(255, Math.max(0, v * 256 - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const g = (x: number, y: number) => {
    const s = d[y * 256 + x];
    return s === NA ? SEA_DEPTH : s / DEM_SCALE;
  };
  const a = g(x0, y0) + (g(x1, y0) - g(x0, y0)) * tx;
  const b = g(x0, y1) + (g(x1, y1) - g(x0, y1)) * tx;
  return a + (b - a) * ty;
}

// 共有インデックス/UV
const VERTS = (N + 1) * (N + 1);
const SKIRT = 4 * (N + 1);
let sharedIndex: THREE.BufferAttribute;
let sharedUv: THREE.BufferAttribute;
function buildShared() {
  const idx: number[] = [];
  const id = (i: number, j: number) => j * (N + 1) + i;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  // スカート (LOD境界の隙間対策)
  const border: number[] = [];
  for (let i = 0; i <= N; i++) border.push(id(i, 0));
  for (let j = 0; j <= N; j++) border.push(id(N, j));
  for (let i = N; i >= 0; i--) border.push(id(i, N));
  for (let j = N; j >= 0; j--) border.push(id(0, j));
  for (let k = 0; k < border.length - 1; k++) {
    const a = border[k], b = border[k + 1], sa = VERTS + k, sb = VERTS + k + 1;
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
  }
  sharedIndex = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  const uv = new Float32Array((VERTS + SKIRT) * 2);
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      uv[(j * (N + 1) + i) * 2] = i / N;
      uv[(j * (N + 1) + i) * 2 + 1] = j / N;
    }
  for (let k = 0; k < border.length; k++) {
    uv[(VERTS + k) * 2] = uv[border[k] * 2];
    uv[(VERTS + k) * 2 + 1] = uv[border[k] * 2 + 1];
  }
  sharedUv = new THREE.BufferAttribute(uv, 2);
  return border;
}
let BORDER: number[] = [];

class Tile {
  key: string;
  state: 'idle' | 'queued' | 'loading' | 'ready' = 'idle';
  mesh: THREE.Mesh | null = null;
  children: Tile[] | null = null;
  mx0: number; // 左端 merc
  my0: number; // 上端 merc
  size: number;
  minH = 0;
  maxH = 0;
  lastWanted = 0;
  splitIdle = 0;
  builtK = 1;
  disposed = false;
  constructor(public z: number, public x: number, public y: number) {
    this.key = `${z}/${x}/${y}`;
    this.size = tileSizeMerc(z);
    this.mx0 = -HALF_CIRC + x * this.size;
    this.my0 = HALF_CIRC - y * this.size;
  }
}

export class Terrain {
  group = new THREE.Group();
  queue = new FetchQueue();
  demCache = new Map<string, Promise<Dem>>();
  demReady = new Map<string, Dem>();
  roots = new Map<string, Tile>();
  camMx = 0;
  camMy = 0;
  camAlt = 0;
  k = 1;
  frame = 0;
  now = 0;
  detail = 1.9;
  anisotropy = 8;
  pending = 0;
  material: THREE.MeshLambertMaterial;

  constructor(public origin: Origin) {
    BORDER = buildShared();
    this.material = applyCurvature(new THREE.MeshLambertMaterial({ color: 0xb0b0b0 }), 'terrain');
  }

  private getDem(z: number, x: number, y: number): Promise<Dem> {
    const key = `${z}/${x}/${y}`;
    let p = this.demCache.get(key);
    if (!p) {
      p = loadDem(z, x, y).then((d) => {
        this.demReady.set(key, d);
        return d;
      });
      this.demCache.set(key, p);
      if (this.demCache.size > 700) {
        // 古いものから削除
        const first = this.demCache.keys().next().value as string;
        this.demCache.delete(first);
        this.demReady.delete(first);
      }
    }
    return p;
  }

  private async loadImagery(t: Tile): Promise<THREE.Texture> {
    let bmp = await fetchBitmap(GSI_IMG(t.z, t.x, t.y));
    if (!bmp) bmp = await fetchBitmap(ESRI_IMG(t.z, t.x, t.y));
    let tex: THREE.Texture;
    if (bmp) {
      tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
      tex.flipY = false;
    } else {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const g = c.getContext('2d')!;
      g.fillStyle = '#1b3550';
      g.fillRect(0, 0, 4, 4);
      tex = new THREE.CanvasTexture(c);
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  private async loadTile(t: Tile) {
    t.state = 'loading';
    this.pending++;
    try {
      const dz = Math.max(0, t.z - DEM_MAX_Z);
      const [dem, tex] = await Promise.all([this.getDem(t.z - dz, t.x >> dz, t.y >> dz), this.loadImagery(t)]);
      if (t.disposed) {
        tex.dispose();
        return;
      }
      const scale = 1 / (1 << dz);
      const u0 = (t.x - ((t.x >> dz) << dz)) * scale;
      const v0 = (t.y - ((t.y >> dz) << dz)) * scale;
      this.buildMesh(t, dem, u0, v0, scale, tex);
      t.state = 'ready';
    } catch (e) {
      console.warn('tile fail', t.key, e);
      t.state = 'idle';
    } finally {
      this.pending--;
    }
  }

  private buildMesh(t: Tile, dem: Dem, u0: number, v0: number, sc: number, tex: THREE.Texture) {
    const k = this.origin.k;
    const s = t.size * k;
    const pos = new Float32Array((VERTS + SKIRT) * 3);
    let minH = 1e9, maxH = -1e9;
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const h = sampleDem(dem, u0 + (i / N) * sc, v0 + (j / N) * sc);
        const o = (j * (N + 1) + i) * 3;
        pos[o] = (i / N - 0.5) * s;
        pos[o + 1] = h;
        pos[o + 2] = (j / N - 0.5) * s;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    const drop = Math.min(400, s * 0.02 + 20);
    for (let kk = 0; kk < BORDER.length; kk++) {
      const src = BORDER[kk] * 3, o = (VERTS + kk) * 3;
      pos[o] = pos[src];
      pos[o + 1] = pos[src + 1] - drop;
      pos[o + 2] = pos[src + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(sharedIndex);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', sharedUv);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = this.material.clone();
    mat.map = tex;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = t.z >= 11;
    mesh.visible = false;
    t.minH = minH;
    t.maxH = maxH;
    t.builtK = k;
    t.mesh = mesh;
    this.placeMesh(t);
    this.group.add(mesh);
  }

  private placeMesh(t: Tile) {
    if (!t.mesh) return;
    const cx = t.mx0 + t.size / 2, cy = t.my0 - t.size / 2;
    t.mesh.position.set(this.origin.toLocalX(cx), 0, this.origin.toLocalZ(cy));
    const r = this.origin.k / t.builtK;
    t.mesh.scale.set(r, 1, r);
    t.mesh.updateMatrix();
  }

  /** 原点移動時 */
  rebase() {
    const walk = (t: Tile) => {
      this.placeMesh(t);
      t.children?.forEach(walk);
    };
    this.roots.forEach(walk);
  }

  private disposeTile(t: Tile) {
    t.disposed = true;
    t.children?.forEach((c) => this.disposeTile(c));
    t.children = null;
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      const m = t.mesh.material as THREE.MeshLambertMaterial;
      m.map?.dispose();
      m.dispose();
      t.mesh = null;
    }
    t.state = 'idle';
  }

  private tileDist(t: Tile) {
    const k = this.k;
    const dx = Math.max(t.mx0 - this.camMx, 0, this.camMx - (t.mx0 + t.size)) * k;
    const dy = Math.max(this.camMy - t.my0, 0, t.my0 - t.size - this.camMy) * k;
    const dz = Math.max(0, this.camAlt - t.maxH, t.minH - this.camAlt);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private horizDist(t: Tile) {
    const k = this.k;
    const dx = Math.max(t.mx0 - this.camMx, 0, this.camMx - (t.mx0 + t.size)) * k;
    const dy = Math.max(this.camMy - t.my0, 0, t.my0 - t.size - this.camMy) * k;
    return Math.hypot(dx, dy);
  }

  private request(t: Tile) {
    if (t.state !== 'idle') return;
    t.state = 'queued';
    this.queue.push({
      prio: () => this.tileDist(t) / (t.size * this.k) + (t.z - ROOT_Z) * 0.05,
      alive: () => {
        const ok = this.now - t.lastWanted < 1500;
        if (!ok) t.state = 'idle';
        return ok;
      },
      run: () => this.loadTile(t),
    });
  }

  private shouldSplit(t: Tile) {
    if (t.z >= MAX_Z) return false;
    const s = t.size * this.k;
    return this.tileDist(t) < s * this.detail;
  }

  private select(t: Tile) {
    t.lastWanted = this.now;
    if (t.state !== 'ready') {
      this.request(t);
      return;
    }
    if (this.shouldSplit(t)) {
      const ps = t.size * this.k;
      t.splitIdle = 0;
      if (!t.children) {
        const z = t.z + 1;
        t.children = [
          new Tile(z, t.x * 2, t.y * 2),
          new Tile(z, t.x * 2 + 1, t.y * 2),
          new Tile(z, t.x * 2, t.y * 2 + 1),
          new Tile(z, t.x * 2 + 1, t.y * 2 + 1),
        ];
      }
      const allReady = t.children.every((c) => c.state === 'ready');
      if (allReady) {
        for (const c of t.children) this.select(c);
        return;
      }
      for (const c of t.children) {
        c.lastWanted = this.now;
        // 近傍の子タイルのみ要求 (遠方は親タイルで表示)
        if (this.horizDist(c) < ps * this.detail * 2.4) this.request(c);
      }
    } else if (t.children) {
      if (!t.splitIdle) t.splitIdle = this.now;
      else if (this.now - t.splitIdle > 8000) {
        t.children.forEach((c) => this.disposeTile(c));
        t.children = null;
      }
    }
    if (t.mesh) t.mesh.visible = true;
  }

  update(lat: number, lon: number, mx: number, my: number, alt: number) {
    this.frame++;
    this.now = performance.now();
    this.camMx = mx;
    this.camMy = my;
    this.camAlt = alt;
    this.k = Math.cos((lat * Math.PI) / 180);
    void lon;
    for (const c of this.group.children) c.visible = false;
    const size = tileSizeMerc(ROOT_Z);
    const cx = Math.floor((mx + HALF_CIRC) / size);
    const cy = Math.floor((HALF_CIRC - my) / size);
    const want = new Set<string>();
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (y < 0 || y >= 1 << ROOT_Z) continue;
        const key = `${ROOT_Z}/${x}/${y}`;
        want.add(key);
        let t = this.roots.get(key);
        if (!t) {
          t = new Tile(ROOT_Z, x, y);
          this.roots.set(key, t);
        }
        this.select(t);
      }
    for (const [key, t] of this.roots) {
      if (!want.has(key)) {
        this.disposeTile(t);
        this.roots.delete(key);
      }
    }
    this.queue.pump();
  }

  /** 指定メルカトル座標の標高 (読み込み済み最高解像度) */
  heightAtMerc(mx: number, my: number): number | null {
    for (let z = DEM_MAX_Z; z >= ROOT_Z; z--) {
      const size = tileSizeMerc(z);
      const fx = (mx + HALF_CIRC) / size, fy = (HALF_CIRC - my) / size;
      const x = Math.floor(fx), y = Math.floor(fy);
      const d = this.demReady.get(`${z}/${x}/${y}`);
      if (d) return sampleDem(d, fx - x, fy - y);
    }
    return null;
  }
}
