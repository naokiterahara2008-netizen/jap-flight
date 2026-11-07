import { useEffect, useRef, useState } from 'react';
import { PLACES } from './sim/places';
import type { Telemetry } from './sim/Game';

interface Props {
  tele: Telemetry | null;
  large: boolean;
  onClose: () => void;
  onToggleSize: () => void;
}

const FIXED = new Set(['那覇市', '石垣島', '南鳥島', '沖ノ鳥島', '稚内市']);
const MAJOR = new Set(['札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '名古屋市', '京都市', '大阪市', '神戸市', '広島市', '福岡市', '北九州市', '熊本市']);
const JAPAN = { latMin: 19.6, latMax: 45.9, lonMin: 123.5, lonMax: 154.6 };
const R_MERC = 6378137;

type TileEntry = { state: 'loading' | 'ok' | 'err'; img: HTMLImageElement | null; stage: number; isGsi?: boolean };
const cache = new Map<string, TileEntry>();
const listeners = new Set<() => void>();
const keyed = new Set<string>();

function loadTile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  if (keyed.has(key)) return;
  keyed.add(key);
  const e: TileEntry = { state: 'loading', img: null, stage: 0 };
  cache.set(key, e);
  const tryLoad = () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    // 低ズームは全球をカバーする Esri、詳細は国土地理院の全国最新写真
    const gsi = z >= 7 && e.stage === 0;
    const url = gsi
      ? `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`
      : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    e.isGsi = gsi;
    img.onload = () => {
      e.state = 'ok';
      e.img = img;
      listeners.forEach((f) => f());
    };
    img.onerror = () => {
      if (e.stage === 0) {
        e.stage = 1;
        tryLoad();
      } else {
        e.state = 'err';
        listeners.forEach((f) => f());
      }
    };
    img.src = url;
  };
  tryLoad();
  if (cache.size > 260) {
    const k = cache.keys().next().value as string;
    if (k) {
      cache.delete(k);
      keyed.delete(k);
    }
  }
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
const worldSize = (z: number) => 256 * Math.pow(2, z);
const worldX = (lon: number, z: number) => ((lon + 180) / 360) * worldSize(z);
const worldY = (lat: number, z: number) => ((1 - mercY(lat) / Math.PI) / 2) * worldSize(z);

function fitJapan(w: number, h: number) {
  const sx = (JAPAN.lonMax - JAPAN.lonMin) / 360;
  const sy = (mercY(JAPAN.latMax) - mercY(JAPAN.latMin)) / (2 * Math.PI);
  const z = Math.min(Math.log2(Math.max(1, w - 26) / (256 * sx)), Math.log2(Math.max(1, h - 20) / (256 * sy)));
  return { z: Math.max(2, Math.min(7, z)), center: { lat: invMercY((mercY(JAPAN.latMax) + mercY(JAPAN.latMin)) / 2), lon: (JAPAN.lonMin + JAPAN.lonMax) / 2 } };
}

export default function MiniMap({ tele, large, onClose, onToggleSize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trail = useRef<{ lat: number; lon: number }[]>([]);
  const lastTrail = useRef(0);
  const [mode, setMode] = useState<'follow' | 'japan'>('follow');
  const [zoom, setZoom] = useState(8);
  const [, setTick] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  // 航跡 (実座標)
  useEffect(() => {
    if (!tele) return;
    const t = trail.current;
    const now = performance.now();
    const last = t[t.length - 1];
    if (last) {
      const dy = (tele.lat - last.lat) * 111320;
      const dx = (tele.lon - last.lon) * 111320 * Math.cos((tele.lat * Math.PI) / 180);
      const d = Math.hypot(dx, dy);
      if (d > 150000) t.length = 0;
      else if (d > 120 && now - lastTrail.current > 450) {
        t.push({ lat: tele.lat, lon: tele.lon });
        lastTrail.current = now;
        if (t.length > 600) t.shift();
      }
    } else {
      t.push({ lat: tele.lat, lon: tele.lon });
      lastTrail.current = now;
    }
  }, [tele]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !tele) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    const fit = fitJapan(w, h);
    const z = mode === 'japan' ? fit.z : zoom;
    const center = mode === 'japan' ? fit.center : { lat: tele.lat, lon: tele.lon };
    const cx = worldX(center.lon, z), cy = worldY(center.lat, z);
    const toSX = (_lat: number, lon: number) => w / 2 + worldX(lon, z) - cx;
    const toSY = (lat: number, _lon: number) => h / 2 + worldY(lat, z) - cy;

    // 海
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b2133');
    grad.addColorStop(1, '#071724');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);

    // 実地図タイル (国土地理院 写真 → Esri フォールバック)
    const z0 = Math.max(2, Math.min(12, Math.round(z)));
    const scale = Math.pow(2, z - z0);
    const ts = 256 * scale;
    const n = Math.pow(2, z0);
    const x0 = Math.floor((cx - w / 2) / ts), x1 = Math.floor((cx + w / 2) / ts);
    const y0 = Math.floor((cy - h / 2) / ts), y1 = Math.floor((cy + h / 2) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        loadTile(z0, ((tx % n) + n) % n, ty);
        const e = cache.get(`${z0}/${((tx % n) + n) % n}/${ty}`);
        const sx = tx * ts - (cx - w / 2), sy = ty * ts - (cy - h / 2);
        if (e?.state === 'ok' && e.img) {
          try {
            c.drawImage(e.img, sx, sy, ts + 0.6, ts + 0.6);
          } catch {
            /* noop */
          }
        } else if (e?.state !== 'ok') {
          c.fillStyle = '#123a2c';
          c.fillRect(sx, sy, ts, ts);
        }
      }
    }
    // 地図のトーン補正
    c.fillStyle = 'rgba(4,16,26,0.30)';
    c.fillRect(0, 0, w, h);

    // 緯度経度グリッド
    c.strokeStyle = 'rgba(150,200,230,0.13)';
    c.lineWidth = 1;
    const step = mode === 'japan' ? 5 : z >= 9 ? 0.25 : z >= 7 ? 1 : 5;
    const lat0 = Math.floor((tele.lat - (h / 2 / worldSize(z)) * 360 * 0.5) / step) * step;
    for (let la = lat0 - step * 4; la < tele.lat + 20; la += step) {
      const y = toSY(la, center.lon);
      if (y < 0 || y > h) continue;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
      if (mode === 'japan' && la > JAPAN.latMin && la < JAPAN.latMax) {
        c.fillStyle = 'rgba(170,210,235,0.4)';
        c.font = '9px monospace';
        c.textAlign = 'left';
        c.fillText(`${la}°N`, 3, y - 2);
      }
    }
    for (let lo = Math.floor((JAPAN.lonMin - 5) / step) * step; lo < JAPAN.lonMax + 5; lo += step) {
      const x = toSX(center.lat, lo);
      if (x < 0 || x > w) continue;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
      if (mode === 'japan') {
        c.fillStyle = 'rgba(170,210,235,0.4)';
        c.font = '9px monospace';
        c.textAlign = 'left';
        c.fillText(`${lo}°E`, x + 2, h - 4);
      }
    }

    // 100km サークル (政令指定都市の表示範囲)
    if (mode === 'follow') {
      const mpp = (Math.cos((tele.lat * Math.PI) / 180) * 2 * Math.PI * R_MERC) / worldSize(z);
      const r = 100000 / mpp;
      if (r < w * 1.3) {
        c.strokeStyle = 'rgba(255,209,102,0.5)';
        c.setLineDash([5, 5]);
        c.lineWidth = 1;
        c.beginPath();
        c.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = 'rgba(255,209,102,0.7)';
        c.font = '9px sans-serif';
        c.textAlign = 'center';
        c.fillText('100 km', w / 2, h / 2 - r - 4);
      }
    }

    // 航跡
    const tr = trail.current;
    if (tr.length > 1) {
      c.strokeStyle = 'rgba(120,255,215,0.85)';
      c.lineWidth = 1.6;
      c.beginPath();
      tr.forEach((p, i) => {
        const x = toSX(p.lat, p.lon), y = toSY(p.lat, p.lon);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.stroke();
    }

    // 地点
    for (const p of PLACES) {
      const fixed = FIXED.has(p.name);
      const x = toSX(p.lat, p.lon), y = toSY(p.lat, p.lon);
      if (x < -30 || x > w + 30 || y < -20 || y > h + 20) continue;
      const near = tele.nav.find((nn) => nn.name === p.name);
      const shown = fixed || !!near;
      const color = fixed ? '#6fe3ff' : shown ? '#ffd166' : 'rgba(255,209,102,0.55)';
      const isMajor = MAJOR.has(p.name);
      const r = shown ? 3.6 : isMajor ? 2.6 : 1.8;
      c.fillStyle = color;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      if (shown && (fixed || isMajor || near)) {
        const idx = PLACES.indexOf(p);
        const dy = fixed ? (idx % 2 === 0 ? -7 : 11) : 3;
        c.font = `${fixed || near ? '700 ' : ''}10px "Hiragino Sans","Noto Sans JP",sans-serif`;
        c.textAlign = fixed && p.lon > 141 ? 'right' : 'left';
        const dx = fixed && p.lon > 141 ? -6 : 5;
        c.shadowColor = 'rgba(0,0,0,0.98)';
        c.shadowBlur = 4;
        c.fillStyle = fixed ? '#c9f2ff' : '#ffe6a8';
        c.fillText(p.name, x + dx, y + dy);
        if (near && !fixed && mode === 'follow') c.fillText(`${(near.dist / 1000).toFixed(0)}km`, x + 5, y + 14);
        c.shadowBlur = 0;
      }
    }

    // 自機 (常に中央 / 広域では位置をクランプ)
    let ax = w / 2, ay = h / 2, off = false;
    if (mode === 'japan') {
      ax = Math.max(14, Math.min(w - 14, toSX(tele.lat, tele.lon)));
      ay = Math.max(14, Math.min(h - 14, toSY(tele.lat, tele.lon)));
      off = ax !== toSX(tele.lat, tele.lon) || ay !== toSY(tele.lat, tele.lon);
      // 航跡の現在位置までを強調
    }
    const hd = (tele.heading * Math.PI) / 180;
    c.save();
    c.translate(ax, ay);
    c.rotate(hd);
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-7, 7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    if (!off) {
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.setLineDash([4, 3]);
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(ax + Math.sin(hd) * 13, ay - Math.cos(hd) * 13);
      c.lineTo(ax + Math.sin(hd) * 42, ay - Math.cos(hd) * 42);
      c.stroke();
      c.setLineDash([]);
    }

    // 方位 N
    c.fillStyle = 'rgba(220,240,255,0.85)';
    c.font = '700 11px sans-serif';
    c.textAlign = 'center';
    c.beginPath();
    c.moveTo(w - 14, 16);
    c.lineTo(w - 18, 26);
    c.lineTo(w - 10, 26);
    c.closePath();
    c.fill();
    c.fillText('N', w - 14, 12);

    // スケールバー
    const mpp = (Math.cos((tele.lat * Math.PI) / 180) * 2 * Math.PI * R_MERC) / worldSize(z);
    let nice = 1;
    for (const cand of [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000]) {
      if (cand / mpp <= 96) nice = cand;
    }
    const px = nice / mpp;
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(10, h - 12);
    c.lineTo(10 + px, h - 12);
    c.moveTo(10, h - 16);
    c.lineTo(10, h - 8);
    c.moveTo(10 + px, h - 16);
    c.lineTo(10 + px, h - 8);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = '10px monospace';
    c.textAlign = 'center';
    c.fillText(`${nice >= 1000 ? nice / 1000 + ' km' : nice + ' m'}`, 10 + px / 2, h - 17);
  }, [tele, mode, zoom, large]);

  if (!tele) return null;
  const nearest = tele.nav[0];
  return (
    <div className={`absolute right-3 bottom-3 z-20 ${large ? 'w-[min(94vw,560px)]' : 'w-[286px]'}`}>
      <div className="overflow-hidden rounded-xl border border-white/15 bg-slate-950/85 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
          <span className="mr-1 text-[10px] font-bold tracking-widest text-sky-200">FLIGHT MAP</span>
          <button
            onClick={() => setMode('follow')}
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${mode === 'follow' ? 'bg-emerald-400 text-black' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}
          >周辺</button>
          <button
            onClick={() => setMode('japan')}
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${mode === 'japan' ? 'bg-emerald-400 text-black' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}
          >日本全体</button>
          <span className="flex-1" />
          {mode === 'follow' && (
            <>
              <button onClick={() => setZoom((v) => Math.max(5, v - 1))} className="h-5 w-5 rounded bg-white/10 text-xs leading-none text-white hover:bg-white/25" title="縮小">−</button>
              <span className="w-8 text-center font-mono text-[10px] text-slate-400">z{zoom}</span>
              <button onClick={() => setZoom((v) => Math.min(12, v + 1))} className="h-5 w-5 rounded bg-white/10 text-xs leading-none text-white hover:bg-white/25" title="拡大">＋</button>
            </>
          )}
          <button onClick={onToggleSize} className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white hover:bg-white/25" title="大きさ切替">{large ? '縮小' : '拡大'}</button>
          <button onClick={onClose} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500/70" title="閉じる (O)">×</button>
        </div>
        <canvas ref={canvasRef} className={`block w-full ${large ? 'h-[min(52vh,380px)]' : 'h-[172px]'}`} />
        <div className="flex items-center justify-between gap-2 px-2 py-1 font-mono text-[9.5px] text-slate-300">
          <span>{Math.abs(tele.lat).toFixed(3)}°{tele.lat >= 0 ? 'N' : 'S'} {Math.abs(tele.lon).toFixed(3)}°{tele.lon >= 0 ? 'E' : 'W'}</span>
          <span className="text-emerald-300">{Math.round(tele.alt).toLocaleString()} m</span>
          <span className="max-w-[45%] truncate text-slate-400">{nearest ? `最寄り ${nearest.name} ${(nearest.dist / 1000).toFixed(0)}km` : ''}</span>
        </div>
      </div>
    </div>
  );
}
