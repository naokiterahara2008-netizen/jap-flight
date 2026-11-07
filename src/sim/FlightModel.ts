import * as THREE from 'three';
import { isa } from './geo';

/**
 * F-22A Raptor 飛行モデル (公開データに基づく)
 *  - 全長 18.92m / 全幅 13.56m / 全高 5.08m / 翼面積 78.04m²
 *  - 空虚重量 19,700kg / 機内燃料 8,200kg / 最大離陸重量 38,000kg
 *  - P&W F119-PW-100 ×2 : ドライ 116kN, A/B 156kN (各)
 *  - 最大速度 M2.25 (高高度) / M1.21 (海面) / スーパークルーズ M1.82
 *  - 実用上昇限度 19,812m (65,000ft) / 制限荷重 +9G / -3G
 */
export const F22 = {
  S: 78.04,
  span: 13.56,
  emptyMass: 19700,
  storesMass: 1150, // パイロット + AIM-120C×6 + AIM-9X×2 + 20mm弾
  fuelMax: 8200,
  dryThrust: 116000,
  abThrust: 156000,
  gMax: 9,
  gMin: -3,
  alphaMax: 26 * THREE.MathUtils.DEG2RAD,
};

export interface ControlInput {
  pitch: number; // -1..1 (+ = 機首上げ)
  roll: number; // -1..1 (+ = 右ロール)
  yaw: number; // -1..1 (+ = 右)
  throttle: number; // 0..1.2 (1.0 = MIL, >1.0 = アフターバーナー)
  speedBrake: boolean;
}

export interface FlightOptions {
  autoLevel: boolean;
  autoGcas: boolean;
  beginner: boolean;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

function lerpTable(t: number[][], x: number) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const a = t[i - 1], b = t[i];
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return t[t.length - 1][1];
}

// ゼロ揚力抗力係数 (遷音速で造波抵抗が急増)
const CD0_TABLE = [
  [0, 0.0185], [0.8, 0.0190], [0.92, 0.0240], [1.0, 0.0420], [1.08, 0.0510], [1.2, 0.0525],
  [1.5, 0.0480], [1.8, 0.0440], [2.1, 0.0420], [2.25, 0.0440], [2.35, 0.0620], [2.5, 0.1100], [3.0, 0.2000],
];

export class FlightModel {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** 風軸 (−Z = 速度方向) */
  qWind = new THREE.Quaternion();
  /** 機体姿勢 */
  qBody = new THREE.Quaternion();
  alpha = 0;
  rollRate = 0;
  rpm = [70, 70]; // N2 %
  ab = 0; // 0..1
  fuel = 7000;
  throttle = 0.8;
  // 出力
  speed = 0;
  mach = 0;
  ias = 0;
  gLoad = 1;
  thrust = 0;
  drag = 0;
  fuelFlow = 0; // kg/h
  bank = 0;
  gamma = 0;
  heading = 0;
  pitchAngle = 0;
  vs = 0;
  buffet = 0;
  gcasActive = false;
  agl = 1000;
  q = 0;
  sonicCrossed = 0;

  get mass() {
    return F22.emptyMass + F22.storesMass + this.fuel;
  }

  reset(x: number, y: number, z: number, headingDeg: number, speedKmh: number) {
    this.pos.set(x, y, z);
    const h = -headingDeg * THREE.MathUtils.DEG2RAD;
    this.qWind.setFromAxisAngle(AY, h);
    const v = speedKmh / 3.6;
    this.vel.set(0, 0, -v).applyQuaternion(this.qWind);
    this.alpha = 0.04;
    this.rollRate = 0;
    this.fuel = F22.fuelMax;
    const ratio = Math.min(1, speedKmh / 1000);
    this.throttle = 0.7 + ratio * 0.25;
    this.rpm = [65 + 35 * this.throttle, 65 + 35 * this.throttle];
    this.ab = 0;
    this.qBody.copy(this.qWind).multiply(tmpQ.setFromAxisAngle(AX, this.alpha));
    this.updateDerived();
  }

  /** 推力 (N) 1基あたり */
  engineThrust(rpm: number, ab: number, rho: number, mach: number, alt: number) {
    const sigma = rho / 1.225;
    let lapse: number;
    if (alt < 11000) lapse = Math.pow(sigma, 0.72);
    else {
      const s11 = 0.2971;
      lapse = Math.pow(s11, 0.72) * (sigma / s11);
    }
    const dryFrac = Math.max(0.04, Math.pow(Math.max(0, (rpm - 60) / 40), 2.2));
    const ramDry = 1 + 0.32 * mach + 0.08 * mach * mach;
    const ramAb = 1 + 0.42 * mach + 0.14 * mach * mach;
    const dry = F22.dryThrust * dryFrac * lapse * ramDry;
    const abT = F22.abThrust * lapse * ramAb;
    // 動圧制限 (インテーク/構造限界 ~ 海面 M1.2 付近)
    const q = 0.5 * rho * (mach * 340) ** 2;
    const over = Math.max(0, (q - 80000) / 22000);
    return (dry + (abT - dry) * ab) / (1 + over * over);
  }

  step(dtTotal: number, input: ControlInput, opt: FlightOptions, groundAt: (x: number, z: number) => number) {
    const sub = Math.max(1, Math.ceil(dtTotal / (1 / 120)));
    const dt = dtTotal / sub;
    for (let i = 0; i < sub; i++) this.substep(dt, input, opt, groundAt);
  }

  private substep(dt: number, input: ControlInput, opt: FlightOptions, groundAt: (x: number, z: number) => number) {
    const alt = this.pos.y;
    const atm = isa(Math.max(-500, alt));
    const V = Math.max(1, this.vel.length());
    const M = V / atm.a;
    const q = 0.5 * atm.rho * V * V;
    const m = this.mass;
    const W = m * 9.80665;

    // ---- エンジン (スプールアップ ~4秒) ----
    this.throttle = THREE.MathUtils.clamp(input.throttle, 0, 1.2);
    const tDry = Math.min(1, this.throttle);
    const targetRpm = 65 + 35 * tDry;
    for (let e = 0; e < 2; e++) {
      const diff = targetRpm - this.rpm[e];
      const rate = diff > 0 ? 9 + Math.abs(diff) * 0.6 : 14 + Math.abs(diff) * 0.8;
      this.rpm[e] += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
    }
    const abTarget = this.throttle > 1.0 && this.rpm[0] > 96 ? (this.throttle - 1.0) / 0.2 : 0;
    this.ab += THREE.MathUtils.clamp(abTarget - this.ab, -dt * 2.5, dt * 1.4);
    let T = 0;
    for (let e = 0; e < 2; e++) T += this.engineThrust(this.rpm[e], this.ab, atm.rho, M, alt);
    this.thrust = T;
    // 燃料は無制限 (燃料制限なし設定) — 参考値として瞬時流量のみ算出
    const tsfc = (0.61 + (2.2 - 0.61) * this.ab) * 2.832e-5;
    this.fuelFlow = T * tsfc * 3600;
    this.fuel = F22.fuelMax;

    // ---- 空力係数 ----
    const clAlpha = M < 0.85 ? 3.3 : M < 1.15 ? 3.3 + (M - 0.85) * 1.2 : Math.min(3.66, 2.7 / Math.sqrt(M * M - 1));
    const clMax = lerpTable([[0, 1.8], [0.6, 1.75], [0.9, 1.45], [1.2, 1.1], [2.0, 0.85], [2.5, 0.7]], M);

    // ---- 姿勢 (風軸) ----
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(this.qWind);
    const right = tmpV2.set(1, 0, 0).applyQuaternion(this.qWind);
    const upW = new THREE.Vector3(0, 1, 0).applyQuaternion(this.qWind);
    const bank = Math.atan2(-right.y, upW.y);
    const gamma = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));

    // ---- Auto-GCAS (自動地表衝突回避) ----
    const ground = Math.max(0, groundAt(this.pos.x, this.pos.z));
    this.agl = alt - ground;
    const sink = -this.vel.y;
    let gcas = false;
    if (opt.autoGcas) {
      const tReact = 2.5 + V / 120;
      const predicted = this.agl - Math.max(0, sink) * tReact;
      if ((predicted < 120 && sink > 2) || this.agl < 40) gcas = true;
      if (this.gcasActive && gamma < 0.08 && this.agl < 400) gcas = true;
    }
    this.gcasActive = gcas;

    // ---- ロール (安定軸ロール, FBW) ----
    const qFactor = THREE.MathUtils.clamp(q / 12000, 0.2, 1);
    const maxRoll = (opt.beginner ? 150 : 220) * THREE.MathUtils.DEG2RAD * qFactor;
    let rollCmd = input.roll * maxRoll;
    if (gcas) rollCmd = THREE.MathUtils.clamp(-bank * 3, -maxRoll, maxRoll);
    else if (opt.autoLevel && Math.abs(input.roll) < 0.05 && Math.abs(fwd.y) < 0.9) {
      rollCmd = THREE.MathUtils.clamp(-bank * 1.2, -1.2, 1.2);
    }
    this.rollRate += (rollCmd - this.rollRate) * Math.min(1, dt * 8);
    tmpQ.setFromAxisAngle(AZ, -this.rollRate * dt);
    this.qWind.multiply(tmpQ);

    // ---- ピッチ (G指令 FBW) ----
    const cosB = Math.cos(bank);
    let nNeutral = (Math.cos(gamma) * cosB) / Math.max(cosB * cosB, 0.12);
    nNeutral = THREE.MathUtils.clamp(nNeutral, -1.5, 2.8);
    const gUp = opt.beginner ? 7.5 : F22.gMax;
    const st = input.pitch;
    let nCmd = st >= 0 ? nNeutral + st * (gUp - nNeutral) : nNeutral + st * (nNeutral - F22.gMin);
    if (gcas) nCmd = 5;
    nCmd = THREE.MathUtils.clamp(nCmd, F22.gMin, F22.gMax);
    const clReq = (nCmd * W - T * Math.sin(this.alpha)) / Math.max(1, q * F22.S);
    const alphaMaxNow = Math.min(F22.alphaMax, clMax / clAlpha + 0.06);
    let alphaT = THREE.MathUtils.clamp(clReq / clAlpha, -0.17, alphaMaxNow);
    this.alpha += (alphaT - this.alpha) * Math.min(1, dt * 5);

    let CL = clAlpha * this.alpha;
    if (CL > clMax) CL = clMax - (CL - clMax) * 0.5;
    const k = M < 1 ? 0.17 : 0.17 + 0.13 * (M - 1);
    const sa = Math.sin(this.alpha);
    let CD = lerpTable(CD0_TABLE, M) + k * CL * CL + 0.25 * sa * sa;
    if (input.speedBrake) CD += 0.045;

    const L = CL * q * F22.S;
    const D = CD * q * F22.S;
    this.drag = D;

    // ---- 力の合成 (世界座標) ----
    const acc = new THREE.Vector3();
    acc.addScaledVector(fwd, (T * Math.cos(this.alpha) - D) / m);
    acc.addScaledVector(upW, (L + T * Math.sin(this.alpha)) / m);
    // 荷重倍数 (機体上方向)
    this.gLoad = (L + T * Math.sin(this.alpha)) / W;
    acc.y -= 9.80665;

    // ラダー: 横滑りを伴う小さなヨー
    const yawRate = -input.yaw * 0.07 * qFactor;
    const latAcc = new THREE.Vector3().copy(right).multiplyScalar(-yawRate * V);
    acc.add(latAcc);

    // 速度ベクトル更新 → 風軸を最小回転で追従
    const vOldDir = this.vel.clone().normalize();
    this.vel.addScaledVector(acc, dt);
    if (this.vel.length() < 25) this.vel.setLength(25);
    const vNewDir = this.vel.clone().normalize();
    tmpQ.setFromUnitVectors(vOldDir, vNewDir);
    this.qWind.premultiply(tmpQ).normalize();

    this.pos.addScaledVector(this.vel, dt);

    // 機体姿勢 = 風軸を迎角分回転
    this.qBody.copy(this.qWind).multiply(tmpQ.setFromAxisAngle(AX, this.alpha));
    // ヨー入力時のわずかな機首振り
    this.qBody.multiply(tmpQ.setFromAxisAngle(AY, -input.yaw * 0.03));

    // バフェット (高迎角・遷音速)
    const aDeg = this.alpha * THREE.MathUtils.RAD2DEG;
    this.buffet = Math.max(0, (aDeg - 15) / 12) * Math.min(1, q / 8000) + (M > 0.93 && M < 1.07 ? 0.25 : 0);

    // 音速突破検出
    if (this.mach < 1 && M >= 1) this.sonicCrossed = performance.now();
    this.q = q;
    this.updateDerived(atm.a, atm.rho);
  }

  updateDerived(a = 340.3, rho = 1.225) {
    const V = this.vel.length();
    this.speed = V;
    this.mach = V / a;
    this.ias = V * Math.sqrt(rho / 1.225);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.qBody);
    const fwdW = new THREE.Vector3(0, 0, -1).applyQuaternion(this.qWind);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.qBody);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.qBody);
    this.bank = Math.atan2(-right.y, up.y);
    this.pitchAngle = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    this.gamma = Math.asin(THREE.MathUtils.clamp(fwdW.y, -1, 1));
    this.heading = (Math.atan2(fwd.x, -fwd.z) * THREE.MathUtils.RAD2DEG + 360) % 360;
    this.vs = this.vel.y;
    if (!this.qBody.lengthSq()) this.qBody.copy(this.qWind);
  }
}

export { UP };
