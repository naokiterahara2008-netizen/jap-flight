import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { applyCurvature } from './curvature';

export type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening';
export const TIME_PRESETS: Record<TimeOfDay, { elev: number; az: number; label: string }> = {
  morning: { elev: 9, az: 100, label: '朝' },
  noon: { elev: 58, az: 180, label: '正午' },
  afternoon: { elev: 32, az: 230, label: '午後' },
  evening: { elev: 4, az: 255, label: '夕暮れ' },
};

function makeWaterNormals() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 48; i++) {
    const f = 1 + Math.floor(rnd() * (i < 8 ? 4 : i < 24 ? 12 : 40));
    const ang = rnd() * Math.PI * 2;
    waves.push({ kx: Math.round(Math.cos(ang) * f), ky: Math.round(Math.sin(ang) * f), a: 1 / (f + 1.5), p: rnd() * 6.28 });
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = (2 * Math.PI * (w.kx * x + w.ky * y)) / S + w.p;
        const c2 = Math.cos(ph) * w.a;
        dx += c2 * w.kx;
        dy += c2 * w.ky;
      }
      const n = new THREE.Vector3(-dx * 0.12, -dy * 0.12, 1).normalize();
      const o = (y * S + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** 中心ほど密な極座標メッシュ (曲率表現のため) */
function polarGeometry(uvScale: number) {
  const rings: number[] = [0];
  let r = 30;
  while (r < 950000) {
    rings.push(r);
    r *= 1.11;
  }
  const seg = 128;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pos.push(0, 0, 0);
  uv.push(0, 0);
  for (let i = 1; i < rings.length; i++)
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const x = Math.cos(a) * rings[i], z = Math.sin(a) * rings[i];
      pos.push(x, 0, z);
      uv.push(x / uvScale, z / uvScale);
    }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
  for (let i = 1; i < rings.length - 1; i++) {
    const b0 = 1 + (i - 1) * seg, b1 = 1 + i * seg;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      idx.push(b0 + s, b0 + s1, b1 + s, b0 + s1, b1 + s1, b1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Environment {
  skyScene = new THREE.Scene();
  skyCam = new THREE.PerspectiveCamera(70, 1, 1, 30000);
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4436, 1.1);
  sunDir = new THREE.Vector3();
  fogColor = new THREE.Color(0xb9c9dc);
  fog = new THREE.FogExp2(0xb9c9dc, 2e-5);
  water: THREE.Mesh;
  deep: THREE.Mesh;
  waterNormals: THREE.Texture;
  envMap: THREE.Texture | null = null;
  uvScale = 600;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.sky.scale.setScalar(20000);
    this.skyScene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;

    this.waterNormals = makeWaterNormals();
    const wm = applyCurvature(
      new THREE.MeshStandardMaterial({
        color: 0x04182a,
        roughness: 0.42,
        metalness: 0.0,
        normalMap: this.waterNormals,
        normalScale: new THREE.Vector2(0.13, 0.13),
        transparent: true,
        opacity: 0.975,
        envMapIntensity: 0.3,
        depthWrite: false,
      }),
      'water',
    );
    this.water = new THREE.Mesh(polarGeometry(this.uvScale), wm);
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
    scene.add(this.water);
    const dm = applyCurvature(new THREE.MeshLambertMaterial({ color: 0x0a2233 }), 'deep');
    this.deep = new THREE.Mesh(polarGeometry(1000), dm);
    this.deep.position.y = -45;
    this.deep.frustumCulled = false;
    scene.add(this.deep);
  }

  setTime(t: TimeOfDay) {
    const p = TIME_PRESETS[t];
    const phi = THREE.MathUtils.degToRad(90 - p.elev);
    const theta = THREE.MathUtils.degToRad(p.az);
    // 方位: 0=北(−Z), 90=東(+X)
    this.sunDir.setFromSphericalCoords(1, phi, 0).set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const low = THREE.MathUtils.clamp(1 - p.elev / 25, 0, 1);
    this.sun.color.setRGB(1, 1 - 0.28 * low, 1 - 0.55 * low);
    this.sun.intensity = 0.7 + 1.1 * Math.min(1, p.elev / 30);
    this.hemi.intensity = 0.35 + 0.4 * Math.min(1, p.elev / 30);
    this.hemi.color.setRGB(0.72 - 0.1 * low, 0.82 - 0.15 * low, 1 - 0.3 * low);

    // 環境マップ (反射) とヘイズ色を空から生成
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap?.dispose();
    this.envMap = pmrem.fromScene(this.skyScene as unknown as THREE.Scene, 0, 1, 40000).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.sampleHorizon();
  }

  private sampleHorizon() {
    const W = 32, H = 32;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
    const cam = new THREE.PerspectiveCamera(20, 1, 1, 30000);
    const acc = new THREE.Color(0, 0, 0);
    const buf = new Float32Array(W * H * 4);
    const prevTM = this.renderer.toneMapping;
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      cam.position.set(0, 0, 0);
      cam.lookAt(Math.sin(a), Math.tan(THREE.MathUtils.degToRad(4)), -Math.cos(a));
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.skyScene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      for (let y = 6; y < 14; y++)
        for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 4;
          acc.r += buf[o];
          acc.g += buf[o + 1];
          acc.b += buf[o + 2];
          n++;
        }
    }
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = prevTM;
    rt.dispose();
    if (n > 0 && acc.r + acc.g + acc.b > 0) {
      acc.multiplyScalar(1 / n);
      // 0..∞ のリニア値をそのまま利用
      this.fogColor.copy(acc).multiplyScalar(0.7);
    }
    this.fog.color.copy(this.fogColor);
  }

  update(camera: THREE.Camera, camPos: THREE.Vector3, time: number, alt: number) {
    this.water.position.set(camPos.x, 0, camPos.z);
    this.deep.position.set(camPos.x, -45, camPos.z);
    const drift = time * 0.004;
    this.waterNormals.offset.set(camPos.x / this.uvScale + drift, camPos.z / this.uvScale + drift * 0.6);
    this.sun.position.copy(camPos).addScaledVector(this.sunDir, 1000);
    this.sun.target.position.copy(camPos);
    // 高度依存の大気ヘイズ (高高度ほど視程拡大)
    const vis = 45000 + Math.max(0, alt) * 14;
    this.fog.density = 1 / vis;
    // 高高度では空を濃紺に
    const u = this.sky.material.uniforms;
    const hk = THREE.MathUtils.clamp(alt / 18000, 0, 1);
    u.rayleigh.value = 1.4 + hk * 1.2;
    u.turbidity.value = 2.2 - hk * 1.6;
    this.skyCam.quaternion.copy(camera.quaternion);
    const pc = camera as THREE.PerspectiveCamera;
    this.skyCam.fov = pc.fov;
    this.skyCam.aspect = pc.aspect;
    this.skyCam.updateProjectionMatrix();
  }
}
