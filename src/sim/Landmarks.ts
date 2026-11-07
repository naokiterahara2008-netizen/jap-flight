import * as THREE from 'three';
import { LANDMARKS, type Landmark } from './places';
import { latToMy, lonToMx, type Origin } from './geo';
import { applyCurvature } from './curvature';

function skytree(h: number) {
  const g = new THREE.Group();
  const steel = applyCurvature(new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.5, roughness: 0.35 }), 'lm');
  const glass = applyCurvature(new THREE.MeshStandardMaterial({ color: 0x5b6f86, metalness: 0.8, roughness: 0.15 }), 'lm');
  // 基部: 正三角形 (一辺68m) → 上部で円形
  const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 39, 350, 12, 1), steel);
  body.position.y = 175;
  g.add(body);
  const deck1 = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 28, 24), glass);
  deck1.position.y = 350;
  g.add(deck1);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 95, 12), steel);
  mid.position.y = 410;
  g.add(mid);
  const deck2 = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 9, 14, 24), glass);
  deck2.position.y = 450;
  g.add(deck2);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 5, h - 457, 8), steel);
  ant.position.y = 457 + (h - 457) / 2;
  g.add(ant);
  return g;
}

function tokyoTower(h: number) {
  const g = new THREE.Group();
  const orange = applyCurvature(new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.6 }), 'lm');
  const white = applyCurvature(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }), 'lm');
  const bands = 11;
  for (let i = 0; i < bands; i++) {
    const y0 = (i / bands) * (h * 0.78), y1 = ((i + 1) / bands) * (h * 0.78);
    const w = (y: number) => 40 * Math.pow(1 - y / (h * 0.82), 1.6) + 1.5;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w(y1), w(y0), y1 - y0, 4, 1, true), i % 2 ? white : orange);
    m.material.side = THREE.DoubleSide;
    m.rotation.y = Math.PI / 4;
    m.position.y = (y0 + y1) / 2;
    g.add(m);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 22), white);
  deck.position.y = 150;
  g.add(deck);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.5, h * 0.22, 6), orange);
  top.position.y = h * 0.78 + h * 0.11;
  g.add(top);
  return g;
}

function building(h: number, w: number) {
  const g = new THREE.Group();
  const glass = applyCurvature(new THREE.MeshStandardMaterial({ color: 0x7d8fa3, metalness: 0.7, roughness: 0.18 }), 'lm');
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), glass);
  m.position.y = h / 2;
  g.add(m);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 8, w * 0.7), glass);
  crown.position.y = h + 4;
  g.add(crown);
  return g;
}

export class Landmarks {
  group = new THREE.Group();
  items: { lm: Landmark; obj: THREE.Group; mx: number; my: number; ground: number | null }[] = [];
  constructor(private origin: Origin) {
    for (const lm of LANDMARKS) {
      const obj = lm.type === 'skytree' ? skytree(lm.height) : lm.type === 'tower' ? tokyoTower(lm.height) : building(lm.height, lm.w ?? 50);
      obj.traverse((o) => (o.frustumCulled = false));
      this.group.add(obj);
      this.items.push({ lm, obj, mx: lonToMx(lm.lon), my: latToMy(lm.lat), ground: null });
    }
  }
  update(heightAt: (mx: number, my: number) => number | null) {
    for (const it of this.items) {
      const h = heightAt(it.mx, it.my);
      if (h !== null) it.ground = h;
      const x = this.origin.toLocalX(it.mx), z = this.origin.toLocalZ(it.my);
      it.obj.position.set(x, Math.max(0, it.ground ?? 0) - 2, z);
      it.obj.visible = Math.hypot(x, z) < 120000;
    }
  }
  /** 衝突判定用: 指定ローカル座標の構造物高さ */
  obstacleAt(x: number, z: number) {
    for (const it of this.items) {
      const p = it.obj.position;
      const r = it.lm.type === 'building' ? (it.lm.w ?? 50) * 0.6 : it.lm.type === 'skytree' ? 30 : 35;
      if (Math.abs(x - p.x) < r && Math.abs(z - p.z) < r) return p.y + it.lm.height;
    }
    return 0;
  }
}
