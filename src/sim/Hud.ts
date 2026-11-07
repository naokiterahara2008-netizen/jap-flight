import { dir16 } from './geo';

export interface NavItem {
  name: string;
  dist: number; // m
  brg: number; // 真方位
  rel: number; // 機首方位からの相対角
  designated: boolean;
}

export interface HudState {
  speedKmh: number;
  iasKmh: number;
  mach: number;
  alt: number;
  agl: number;
  vs: number;
  g: number;
  gMax: number;
  heading: number;
  pitch: number;
  bank: number;
  alpha: number;
  fpmAz: number;
  fpmEl: number;
  throttle: number;
  ab: number;
  rpm: number[];
  fuel: number;
  fuelFlow: number;
  thrust: number;
  gcas: boolean;
  stall: boolean;
  pullUp: boolean;
  lat: number;
  lon: number;
  time: number;
  nav: NavItem[];
  speedBrake: boolean;
}

export const HUD_FOV = 30; // deg (F-22 広角HUD)
export const HUD_PX = 1024;
const PPD = (HUD_PX / 2) / Math.tan((HUD_FOV / 2) * Math.PI / 180) * Math.tan(Math.PI / 180);

const G = '#5dff8a';

function txt(c: CanvasRenderingContext2D, s: string, x: number, y: number, size = 26, align: CanvasTextAlign = 'center') {
  c.font = `600 ${size}px "Consolas","Menlo",monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillText(s, x, y);
}

export function drawHud(c: CanvasRenderingContext2D, s: HudState) {
  const W = HUD_PX, H = HUD_PX, cx = W / 2, cy = H / 2;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = G;
  c.fillStyle = G;
  c.lineWidth = 3;
  c.shadowColor = 'rgba(80,255,130,0.85)';
  c.shadowBlur = 6;

  // ボアサイト (ガンクロス)
  c.beginPath();
  c.moveTo(cx - 34, cy);
  c.lineTo(cx - 14, cy);
  c.lineTo(cx - 7, cy + 12);
  c.lineTo(cx, cy);
  c.lineTo(cx + 7, cy + 12);
  c.lineTo(cx + 14, cy);
  c.lineTo(cx + 34, cy);
  c.stroke();

  // 速度ベクトル (FPM)
  const fx = cx + s.fpmAz * PPD, fy = cy - s.fpmEl * PPD;
  c.beginPath();
  c.arc(fx, fy, 13, 0, Math.PI * 2);
  c.moveTo(fx - 13, fy);
  c.lineTo(fx - 36, fy);
  c.moveTo(fx + 13, fy);
  c.lineTo(fx + 36, fy);
  c.moveTo(fx, fy - 13);
  c.lineTo(fx, fy - 28);
  c.stroke();

  // ピッチラダー (FPM中心, バンク回転)
  c.save();
  c.beginPath();
  c.rect(150, 120, W - 300, H - 260);
  c.clip();
  c.translate(fx, fy);
  c.rotate(-s.bank * Math.PI / 180);
  const fpa = s.pitch - (s.alpha); // 近似経路角
  for (let p = -90; p <= 90; p += 5) {
    const y = -(p - fpa) * PPD;
    if (Math.abs(y) > 520) continue;
    if (p === 0) {
      c.beginPath();
      c.moveTo(-420, y);
      c.lineTo(-60, y);
      c.moveTo(60, y);
      c.lineTo(420, y);
      c.stroke();
      continue;
    }
    c.setLineDash(p < 0 ? [14, 10] : []);
    const w1 = 70, w2 = 190;
    const tick = p > 0 ? 16 : -16;
    c.beginPath();
    c.moveTo(-w2, y + tick);
    c.lineTo(-w2, y);
    c.lineTo(-w1, y);
    c.moveTo(w1, y);
    c.lineTo(w2, y);
    c.lineTo(w2, y + tick);
    c.stroke();
    c.setLineDash([]);
    txt(c, String(Math.abs(p)), -w2 - 30, y, 22);
    txt(c, String(Math.abs(p)), w2 + 30, y, 22);
  }
  c.restore();

  // 方位テープ
  const hy = 90;
  c.save();
  c.beginPath();
  c.rect(cx - 260, hy - 50, 520, 100);
  c.clip();
  for (let d = Math.floor(s.heading) - 40; d <= s.heading + 40; d++) {
    if (d % 5) continue;
    const x = cx + (d - s.heading) * 12;
    const dd = ((d % 360) + 360) % 360;
    c.beginPath();
    c.moveTo(x, hy + 22);
    c.lineTo(x, hy + (dd % 10 === 0 ? 4 : 13));
    c.stroke();
    if (dd % 10 === 0) txt(c, String(dd / 10).padStart(2, '0'), x, hy - 10, 24);
  }
  c.restore();
  c.beginPath();
  c.moveTo(cx, hy + 26);
  c.lineTo(cx - 10, hy + 42);
  c.lineTo(cx + 10, hy + 42);
  c.closePath();
  c.stroke();
  txt(c, String(Math.round(s.heading) % 360).padStart(3, '0'), cx, hy + 66, 26);

  // 速度ボックス (左)
  const bx = 190, by = cy;
  c.strokeRect(bx - 80, by - 26, 160, 52);
  txt(c, Math.round(s.speedKmh).toString(), bx, by, 34);
  txt(c, 'KM/H', bx, by - 46, 20);
  txt(c, `M ${s.mach.toFixed(2)}`, bx, by + 50, 28);
  txt(c, `IAS ${Math.round(s.iasKmh)}`, bx, by + 84, 22);
  txt(c, `G ${s.g.toFixed(1)}`, bx, by + 126, 28);
  txt(c, `${s.gMax.toFixed(1)}`, bx, by + 156, 20);
  txt(c, `α ${s.alpha.toFixed(1)}`, bx, by + 192, 24);

  // 高度ボックス (右)
  const ax = W - 190;
  c.strokeRect(ax - 90, by - 26, 180, 52);
  txt(c, Math.round(s.alt).toLocaleString('en-US'), ax, by, 34);
  txt(c, 'M  ALT', ax, by - 46, 20);
  txt(c, `${Math.round(s.alt * 3.28084).toLocaleString('en-US')} FT`, ax, by + 50, 22);
  txt(c, `VS ${s.vs >= 0 ? '+' : ''}${Math.round(s.vs * 60)}`, ax, by + 84, 22);
  if (s.agl < 1500) txt(c, `R ${Math.round(s.agl)}`, ax, by + 120, 26);

  // 下部情報
  const thrTxt = s.ab > 0.05 ? 'AB' : s.throttle >= 0.995 ? 'MIL' : `${Math.round(s.throttle * 100)}%`;
  txt(c, `THR ${thrTxt}`, 190, H - 150, 24);
  if (s.speedBrake) txt(c, 'SPD BRK', 190, H - 118, 22);
  const nav0 = s.nav[0];
  if (nav0) {
    txt(c, `${nav0.name}`, W - 190, H - 182, 22);
    txt(c, `${(nav0.dist / 1000).toFixed(1)}KM ${Math.round(nav0.brg).toString().padStart(3, '0')}°`, W - 190, H - 150, 22);
  }
  // 警報
  const blink = Math.floor(s.time * 3) % 2 === 0;
  if (s.gcas && blink) txt(c, 'AUTO GCAS', cx, cy + 150, 40);
  else if (s.pullUp && blink) txt(c, 'PULL UP', cx, cy + 150, 44);
  if (s.stall && blink) txt(c, 'STALL', cx, cy - 150, 40);
}

// ===== MFD =====
const MG = '#9effc0';
function screenBase(c: CanvasRenderingContext2D, title: string) {
  const S = c.canvas.width;
  c.fillStyle = '#020604';
  c.fillRect(0, 0, S, S);
  c.strokeStyle = '#1d3a2a';
  c.lineWidth = 2;
  c.strokeRect(4, 4, S - 8, S - 8);
  c.fillStyle = '#e8f4ff';
  c.font = '600 20px Consolas,monospace';
  c.textAlign = 'center';
  c.fillText(title, S / 2, 28);
}

export function drawSD(c: CanvasRenderingContext2D, s: HudState) {
  screenBase(c, 'SD  HDG UP');
  const S = c.canvas.width, cx = S / 2, cy = S * 0.62;
  const range = 160000; // m
  const pxr = (S * 0.5) / range;
  c.strokeStyle = '#2f6b48';
  c.lineWidth = 2;
  for (const r of [40000, 80000, 160000]) {
    c.beginPath();
    c.arc(cx, cy, r * pxr, Math.PI, 2 * Math.PI);
    c.stroke();
    c.fillStyle = '#4c9a6c';
    c.font = '16px Consolas,monospace';
    c.fillText(`${r / 1000}`, cx + r * pxr - 14, cy - 6);
  }
  // 方位ラベル
  c.fillStyle = '#9fd4ff';
  c.font = '600 18px Consolas,monospace';
  for (const [lab, d] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]) {
    const a = ((d - s.heading) * Math.PI) / 180;
    const r = S * 0.44;
    c.fillText(lab, cx + Math.sin(a) * r, cy - Math.cos(a) * r);
  }
  for (const n of s.nav) {
    const a = (n.rel * Math.PI) / 180;
    let r = n.dist * pxr;
    const clipped = r > S * 0.5;
    if (clipped) r = S * 0.47;
    const x = cx + Math.sin(a) * r, y = cy - Math.cos(a) * r;
    if (y > S - 10 || y < 40 || x < 8 || x > S - 8) continue;
    c.fillStyle = n.designated ? '#ffd166' : '#5ad1ff';
    c.beginPath();
    c.moveTo(x, y - 7);
    c.lineTo(x + 7, y);
    c.lineTo(x, y + 7);
    c.lineTo(x - 7, y);
    c.closePath();
    clipped ? (c.strokeStyle = c.fillStyle as string, c.stroke()) : c.fill();
    c.font = '15px sans-serif';
    c.fillText(n.name.replace('市', ''), x, y - 12);
  }
  // 自機
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(cx, cy - 14);
  c.lineTo(cx + 9, cy + 10);
  c.lineTo(cx, cy + 5);
  c.lineTo(cx - 9, cy + 10);
  c.closePath();
  c.fill();
  c.fillStyle = MG;
  c.font = '600 18px Consolas,monospace';
  c.textAlign = 'left';
  c.fillText(`${s.lat.toFixed(4)}N ${s.lon.toFixed(4)}E`, 14, S - 16);
  c.textAlign = 'center';
}

export function drawEngine(c: CanvasRenderingContext2D, s: HudState) {
  screenBase(c, 'ENG');
  const S = c.canvas.width;
  const gauge = (x: number, y: number, val: number, label: string) => {
    const r = 62;
    c.strokeStyle = '#2b4f3b';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25);
    c.stroke();
    c.strokeStyle = val > 0.985 ? '#ffd166' : MG;
    c.beginPath();
    c.arc(x, y, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.min(1, val)));
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '600 28px Consolas,monospace';
    c.fillText(`${Math.round(val * 100)}`, x, y + 10);
    c.font = '16px Consolas,monospace';
    c.fillStyle = MG;
    c.fillText(label, x, y + 48);
  };
  gauge(S * 0.28, 140, s.rpm[0] / 100, 'N2 L %');
  gauge(S * 0.72, 140, s.rpm[1] / 100, 'N2 R %');
  c.font = '600 22px Consolas,monospace';
  c.textAlign = 'left';
  c.fillStyle = MG;
  const lines = [
    `THRUST  ${(s.thrust / 1000).toFixed(0).padStart(4)} kN`,
    `A/B     ${s.ab > 0.05 ? 'ON  ' + Math.round(s.ab * 100) + '%' : 'OFF'}`,
    `FUEL    UNLIMITED`,
    `NOZ     ${Math.round(30 + s.ab * 60 + (s.rpm[0] < 80 ? 20 : 0))}%`,
    `FTIT    ${Math.round(600 + (s.rpm[0] - 65) * 9 + s.ab * 120)}°C`,
  ];
  lines.forEach((l, i) => c.fillText(l, 30, 260 + i * 34));
  // A/B 推力バー
  c.fillStyle = MG;
  c.font = '16px Consolas,monospace';
  c.fillText('AUG', S - 66, 240);
  c.strokeStyle = MG;
  c.strokeRect(S - 70, 250, 34, 200);
  c.fillStyle = s.ab > 0.05 ? '#ffa14a' : '#3f6b52';
  c.fillRect(S - 68, 446 - Math.max(4, s.ab * 192), 30, Math.max(4, s.ab * 192));
  c.textAlign = 'center';
}

export function drawADI(c: CanvasRenderingContext2D, s: HudState) {
  screenBase(c, 'ADI');
  const S = c.canvas.width, cx = S / 2, cy = S / 2 + 10, r = 170;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.clip();
  c.translate(cx, cy);
  c.rotate((-s.bank * Math.PI) / 180);
  const off = s.pitch * 4;
  c.fillStyle = '#2a6fb5';
  c.fillRect(-400, -800 + off, 800, 800);
  c.fillStyle = '#6b4a2b';
  c.fillRect(-400, off, 800, 800);
  c.strokeStyle = '#fff';
  c.lineWidth = 2;
  for (let p = -60; p <= 60; p += 10) {
    if (!p) continue;
    const y = off - p * 4;
    c.beginPath();
    c.moveTo(-40, y);
    c.lineTo(40, y);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(-300, off);
  c.lineTo(300, off);
  c.stroke();
  c.restore();
  c.strokeStyle = '#ffd166';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(cx - 80, cy);
  c.lineTo(cx - 25, cy);
  c.lineTo(cx, cy + 18);
  c.lineTo(cx + 25, cy);
  c.lineTo(cx + 80, cy);
  c.stroke();
  c.fillStyle = '#fff';
  c.font = '600 22px Consolas,monospace';
  c.textAlign = 'left';
  c.fillText(`${Math.round(s.speedKmh)} km/h`, 14, S - 44);
  c.fillText(`M${s.mach.toFixed(2)}`, 14, S - 16);
  c.textAlign = 'right';
  c.fillText(`${Math.round(s.alt)} m`, S - 14, S - 44);
  c.fillText(`HDG ${Math.round(s.heading).toString().padStart(3, '0')}`, S - 14, S - 16);
  c.textAlign = 'center';
}

export function drawUFD(c: CanvasRenderingContext2D, s: HudState, side: 'L' | 'R') {
  const W = c.canvas.width, H = c.canvas.height;
  c.fillStyle = '#030805';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#ffcf6a';
  c.font = '600 24px Consolas,monospace';
  c.textAlign = 'left';
  if (side === 'L') {
    c.fillText('FBW NORMAL', 12, 34);
    c.fillText('FUEL UNLIMITED', 12, 70);
    c.fillText(s.gcas ? 'GCAS ACTIVE' : 'GCAS ARMED', 12, 106);
  } else {
    const d = new Date();
    c.fillText(`JST ${d.toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' })}`, 12, 34);
    const n = s.nav[0];
    if (n) c.fillText(`${dir16(n.brg)} ${(n.dist / 1000).toFixed(0)}KM`, 12, 70);
    c.fillText(`G ${s.g.toFixed(1)} MAX ${s.gMax.toFixed(1)}`, 12, 106);
  }
}
