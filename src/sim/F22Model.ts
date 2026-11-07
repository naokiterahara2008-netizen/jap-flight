import * as THREE from 'three';

/** F-22A 外観モデル (実寸: 全長18.92m, 全幅13.56m, 前縁後退角42°, 垂直尾翼外傾28°) */
type Station = [number, number, number, number, number]; // z, halfWidth, top, bottom, yCenter

function loft(stations: Station[]) {
  const ring = (s: Station) => {
    const [z, w, t, b, yc] = s;
    return [
      [0, yc + t], [w * 0.55, yc + t * 0.82], [w * 0.92, yc + t * 0.18], [w, yc], [w * 0.9, yc - b * 0.3],
      [w * 0.62, yc - b * 0.85], [0, yc - b], [-w * 0.62, yc - b * 0.85], [-w * 0.9, yc - b * 0.3], [-w, yc],
      [-w * 0.92, yc + t * 0.18], [-w * 0.55, yc + t * 0.82],
    ].map(([x, y]) => new THREE.Vector3(x, y, z));
  };
  const rings = stations.map(ring);
  const P = rings[0].length;
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < P; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % P], c = rings[i + 1][j], d = rings[i + 1][(j + 1) % P];
      tri(a, c, b);
      tri(b, c, d);
    }
  const last = rings[rings.length - 1];
  const cen = new THREE.Vector3(0, stations[stations.length - 1][4], stations[stations.length - 1][0]);
  for (let j = 0; j < P; j++) tri(last[j], cen, last[(j + 1) % P]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function planform(pts: [number, number][], thick: number) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: thick * 0.4, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

export interface F22Parts {
  root: THREE.Group;
  stabL: THREE.Group;
  stabR: THREE.Group;
  abFlames: THREE.Mesh[];
  diamonds: THREE.Mesh[];
  nozzleGlow: THREE.Mesh[];
  vapor: THREE.Mesh;
}

export function createF22(): F22Parts {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x6c7279, metalness: 0.25, roughness: 0.6, flatShading: true, envMapIntensity: 0.45 });
  const skinDark = new THREE.MeshStandardMaterial({ color: 0x585e65, metalness: 0.25, roughness: 0.65, flatShading: true, envMapIntensity: 0.45 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.2, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4b4e, metalness: 0.8, roughness: 0.35 });

  const fus = loft([
    [-9.46, 0.03, 0.03, 0.03, 0.0],
    [-8.7, 0.28, 0.26, 0.2, 0.02],
    [-7.6, 0.5, 0.42, 0.36, 0.05],
    [-6.4, 0.66, 0.52, 0.48, 0.07],
    [-5.3, 0.78, 0.58, 0.56, 0.07],
    [-4.3, 1.22, 0.6, 0.6, 0.04],
    [-3.0, 1.72, 0.62, 0.64, 0.0],
    [-1.0, 1.95, 0.6, 0.66, 0.0],
    [2.0, 1.95, 0.58, 0.62, 0.0],
    [4.6, 1.85, 0.52, 0.55, 0.0],
    [6.8, 1.55, 0.44, 0.45, 0.0],
    [8.4, 1.25, 0.37, 0.37, 0.0],
    [9.1, 1.15, 0.32, 0.32, 0.0],
  ]);
  root.add(new THREE.Mesh(fus, skin));

  // キャノピー (金色コーティング)
  const canGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopy = new THREE.Mesh(
    canGeo,
    new THREE.MeshPhysicalMaterial({ color: 0x9a7a3a, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.6, clearcoat: 1, transparent: true, opacity: 0.88 }),
  );
  canopy.scale.set(0.56, 0.52, 2.1);
  canopy.position.set(0, 0.6, -5.5);
  root.add(canopy);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3c4046 }));
  helmet.position.set(0, 0.95, -5.0);
  root.add(helmet);

  // 主翼 (前縁後退角42° / 後縁前進角17°)
  const wingR = planform([[1.6, -2.9], [6.78, 1.58], [6.78, 2.78], [1.6, 4.35]], 0.16);
  const wingL = planform([[-1.6, -2.9], [-1.6, 4.35], [-6.78, 2.78], [-6.78, 1.58]], 0.16);
  for (const g of [wingR, wingL]) {
    const m = new THREE.Mesh(g, skin);
    m.position.y = -0.08;
    root.add(m);
  }
  // 水平尾翼 (全遊動スタビレーター)
  const mkStab = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, -0.08, 7.5);
    const pts: [number, number][] = side > 0
      ? [[1.2, -1.85], [4.42, 0.65], [4.42, 1.5], [1.2, 2.1]]
      : [[-1.2, -1.85], [-1.2, 2.1], [-4.42, 1.5], [-4.42, 0.65]];
    pivot.add(new THREE.Mesh(planform(pts, 0.1), skinDark));
    root.add(pivot);
    return pivot;
  };
  const stabR = mkStab(1), stabL = mkStab(-1);

  // 垂直尾翼 (外傾28°)
  const finShape = new THREE.Shape();
  finShape.moveTo(4.0, 0);
  finShape.lineTo(5.35, 2.75);
  finShape.lineTo(6.95, 2.75);
  finShape.lineTo(8.7, 0);
  finShape.closePath();
  for (const side of [1, -1]) {
    const g = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.05, 0, 0);
    const fin = new THREE.Mesh(g, skinDark);
    fin.position.set(side * 1.42, 0.42, 0);
    fin.rotation.z = -side * THREE.MathUtils.degToRad(28);
    root.add(fin);
  }

  // カレット型インテーク
  for (const side of [1, -1]) {
    const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.05), black);
    inlet.position.set(side * 1.25, -0.05, -4.05);
    inlet.rotation.y = side * 0.35;
    root.add(inlet);
  }

  // 2次元推力偏向ノズル + A/B 炎
  const abFlames: THREE.Mesh[] = [];
  const diamonds: THREE.Mesh[] = [];
  const nozzleGlow: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xb8c8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const side of [1, -1]) {
    const noz = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 1.0), metal);
    noz.position.set(side * 0.62, 0, 9.35);
    root.add(noz);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.38), new THREE.MeshBasicMaterial({ color: 0xff6a20, toneMapped: false }));
    glow.position.set(side * 0.62, 0, 9.86);
    root.add(glow);
    nozzleGlow.push(glow);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.32, 5, 16, 1, true), flameMat.clone());
    fl.rotation.x = Math.PI / 2;
    fl.position.set(side * 0.62, 0, 9.9 + 2.5);
    root.add(fl);
    abFlames.push(fl);
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.16 - i * 0.025, 10, 8), coreMat.clone());
      d.scale.z = 1.8;
      d.position.set(side * 0.62, 0, 10.6 + i * 1.05);
      root.add(d);
      diamonds.push(d);
    }
  }

  // ベイパーコーン (遷音速)
  const vapor = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 5.5, 32, 4, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  vapor.rotation.x = -Math.PI / 2;
  vapor.position.set(0, 0.1, 1.2);
  root.add(vapor);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
  });
  return { root, stabL, stabR, abFlames, diamonds, nozzleGlow, vapor };
}

export function updateF22(p: F22Parts, ab: number, rpm: number, pitch: number, roll: number, mach: number, time: number) {
  p.stabL.rotation.x = THREE.MathUtils.degToRad(-pitch * 18 + roll * 10);
  p.stabR.rotation.x = THREE.MathUtils.degToRad(-pitch * 18 - roll * 10);
  const flick = 0.85 + Math.sin(time * 47) * 0.08 + Math.sin(time * 31) * 0.07;
  p.abFlames.forEach((f) => {
    (f.material as THREE.MeshBasicMaterial).opacity = ab * 0.55 * flick;
    f.scale.set(1, 0.6 + ab * 0.6 * flick, 1);
  });
  p.diamonds.forEach((d) => ((d.material as THREE.MeshBasicMaterial).opacity = ab * 0.7 * flick));
  const heat = THREE.MathUtils.clamp((rpm - 65) / 35, 0, 1);
  p.nozzleGlow.forEach((g) => (g.material as THREE.MeshBasicMaterial).color.setRGB(0.25 + heat * 0.5 + ab, 0.08 + heat * 0.15 + ab * 0.5, 0.03 + ab * 0.2));
  const v = Math.max(0, 1 - Math.abs(mach - 1.0) / 0.035);
  (p.vapor.material as THREE.MeshBasicMaterial).opacity = v * 0.35;
}
