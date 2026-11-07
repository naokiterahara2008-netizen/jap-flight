import * as THREE from 'three';
import { drawADI, drawEngine, drawHud, drawSD, drawUFD, HUD_FOV, HUD_PX, type HudState } from './Hud';

function canvasTex(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, ctx: c.getContext('2d')!, t };
}

export class Cockpit {
  group = new THREE.Group(); // 原点 = パイロットの目
  hud = canvasTex(HUD_PX, HUD_PX);
  sd = canvasTex(512, 512);
  eng = canvasTex(512, 512);
  adi = canvasTex(512, 512);
  ufdL = canvasTex(320, 128);
  ufdR = canvasTex(320, 128);
  stick = new THREE.Group();
  throttles: THREE.Mesh[] = [];
  hudMesh: THREE.Mesh;
  hudVisible = true;
  private mfdTick = 0;

  constructor() {
    const g = this.group;
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.2 });
    const greyMat = new THREE.MeshStandardMaterial({ color: 0x262a2f, roughness: 0.75, metalness: 0.15, envMapIntensity: 0.3 });
    const scr = (t: THREE.Texture) => new THREE.MeshBasicMaterial({ map: t, toneMapped: false });

    // グレアシールド
    const glare = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.45), darkMat);
    glare.position.set(0, -0.215, -0.85);
    g.add(glare);
    const glareLip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 10), darkMat);
    glareLip.rotation.z = Math.PI / 2;
    glareLip.position.set(0, -0.215, -0.63);
    g.add(glareLip);

    // 計器盤 (目に向けて傾斜)
    const panel = new THREE.Group();
    panel.position.set(0, -0.38, -0.7);
    panel.rotation.x = THREE.MathUtils.degToRad(-27);
    g.add(panel);
    const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.38, 0.08), panelMat);
    pBody.position.z = -0.045;
    panel.add(pBody);
    const addScreen = (tex: THREE.Texture, w: number, h: number, x: number, y: number) => {
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), greyMat);
      bezel.position.set(x, y, 0.0);
      panel.add(bezel);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), scr(tex));
      m.position.set(x, y, 0.0075);
      panel.add(m);
      // ベゼルボタン
      for (let i = 0; i < 5; i++)
        for (const side of [-1, 1]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.008), darkMat);
          b.position.set(x + side * (w / 2 + 0.008), y - h / 2 + 0.02 + (i * (h - 0.04)) / 4, 0.008);
          panel.add(b);
        }
    };
    addScreen(this.sd.t, 0.205, 0.205, 0, -0.04);
    addScreen(this.eng.t, 0.16, 0.16, -0.3, -0.06);
    addScreen(this.adi.t, 0.16, 0.16, 0.3, -0.06);
    addScreen(this.ufdL.t, 0.14, 0.056, -0.155, 0.135);
    addScreen(this.ufdR.t, 0.14, 0.056, 0.155, 0.135);
    // ICP キーパッド
    const icp = new THREE.Group();
    icp.position.set(0, 0.135, 0.01);
    panel.add(icp);
    for (let r = 0; r < 3; r++)
      for (let cI = 0; cI < 4; cI++) {
        const k = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.01), greyMat);
        k.position.set(-0.03 + cI * 0.02, -0.018 + r * 0.018, 0);
        icp.add(k);
      }

    // HUD コンバイナー
    const combMat = new THREE.MeshPhysicalMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.0, depthWrite: false });
    const comb = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), combMat);
    comb.position.set(0, -0.07, -0.6);
    comb.rotation.x = THREE.MathUtils.degToRad(-18);
    g.add(comb);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.17, 0.006), darkMat);
    for (const side of [] as number[]) {
      const f = frame.clone();
      f.position.set(side * 0.105, -0.075, -0.605);
      f.rotation.x = THREE.MathUtils.degToRad(-18);
      g.add(f);
    }
    const hudBase = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.12), darkMat);
    hudBase.position.set(0, -0.18, -0.64);
    g.add(hudBase);

    // HUD シンボル (無限遠コリメート: 目の回転に対し正しい角度)
    const d = 1.0;
    const half = Math.tan(THREE.MathUtils.degToRad(HUD_FOV / 2)) * d;
    this.hud.t.colorSpace = THREE.SRGBColorSpace;
    this.hudMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.MeshBasicMaterial({ map: this.hud.t, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.hudMesh.position.set(0, 0, -d);
    this.hudMesh.renderOrder = 100;
    g.add(this.hudMesh);

    // キャノピーレール
    for (const side of [-1, 1]) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 1.7), greyMat);
      sill.position.set(side * 0.43, -0.27, -0.15);
      sill.rotation.z = side * 0.15;
      g.add(sill);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 1.5), panelMat);
      wall.position.set(side * 0.45, -0.47, -0.1);
      g.add(wall);
    }
    // サイドコンソール
    const consL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.7), panelMat);
    consL.position.set(-0.34, -0.5, -0.05);
    g.add(consL);
    const consR = consL.clone();
    consR.position.x = 0.34;
    g.add(consR);
    // スロットル (左)
    for (let i = 0; i < 2; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.05), greyMat);
      t.position.set(-0.36 + i * 0.04, -0.42, -0.05);
      g.add(t);
      this.throttles.push(t);
    }
    // サイドスティック (右)
    this.stick.position.set(0.34, -0.46, -0.12);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.06, 8), greyMat);
    shaft.position.y = 0.03;
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 4, 10), darkMat);
    grip.position.y = 0.1;
    grip.rotation.x = 0.25;
    this.stick.add(shaft, grip);
    g.add(this.stick);

    // キャノピー (一体型・枠なし・金色ITOコーティング)
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1.0, roughness: 0.05, transparent: true, opacity: 0.06, side: THREE.BackSide, depthWrite: false, envMapIntensity: 0.6 }),
    );
    canopy.scale.set(0.56, 0.52, 2.0);
    canopy.position.set(0, -0.26, -0.45);
    canopy.renderOrder = 50;
    g.add(canopy);
    // 後方アーチ
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 30, Math.PI), greyMat);
    arch.position.set(0, -0.26, 0.55);
    g.add(arch);
    // ヘッドレスト
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.12), darkMat);
    seat.position.set(0, -0.1, 0.32);
    g.add(seat);

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
    });
  }

  update(s: HudState, pitchIn: number, rollIn: number, throttle: number) {
    this.hudMesh.visible = this.hudVisible;
    if (this.hudVisible) {
      drawHud(this.hud.ctx, s);
      this.hud.t.needsUpdate = true;
    }
    this.stick.rotation.x = -pitchIn * 0.25;
    this.stick.rotation.z = -rollIn * 0.25;
    for (const t of this.throttles) t.position.z = 0.06 - Math.min(1.2, throttle) * 0.13;
    if (this.mfdTick-- <= 0) {
      this.mfdTick = 5;
      drawSD(this.sd.ctx, s);
      drawEngine(this.eng.ctx, s);
      drawADI(this.adi.ctx, s);
      drawUFD(this.ufdL.ctx, s, 'L');
      drawUFD(this.ufdR.ctx, s, 'R');
      for (const x of [this.sd, this.eng, this.adi, this.ufdL, this.ufdR]) x.t.needsUpdate = true;
    }
  }
}
