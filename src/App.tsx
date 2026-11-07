import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, type GameSettings, type Telemetry } from './sim/Game';
import { SPAWNS } from './sim/places';
import { dir16 } from './sim/geo';
import { TIME_PRESETS, type TimeOfDay } from './sim/Environment';
import { WEATHER_LABEL, type WeatherMode } from './sim/Weather';
import MiniMap from './MiniMap';

const DEFAULT_SETTINGS: GameSettings = {
  timeOfDay: 'afternoon',
  weather: 'real',
  autoLevel: true,
  autoGcas: true,
  beginner: true,
  invertPitch: false,
  mouseFlight: false,
  volume: 0.8,
  muted: false,
  quality: 'mid',
};

const fmt = (n: number, d = 0) => n.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d });

function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${value ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
    >
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        {desc && <span className="block text-[11px] text-slate-400">{desc}</span>}
      </span>
      <span className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${value ? 'bg-emerald-400' : 'bg-slate-600'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${value ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

function SettingsPanel({ s, set }: { s: GameSettings; set: (s: GameSettings) => void }) {
  const u = (p: Partial<GameSettings>) => set({ ...s, ...p });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-300">
          時間帯
          <select className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-white" value={s.timeOfDay} onChange={(e) => u({ timeOfDay: e.target.value as TimeOfDay })}>
            {Object.entries(TIME_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-300">
          天候
          <select className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-white" value={s.weather} onChange={(e) => u({ weather: e.target.value as WeatherMode })}>
            {Object.entries(WEATHER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-300">
          画質 (地形詳細度)
          <select className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-white" value={s.quality} onChange={(e) => u({ quality: e.target.value as GameSettings['quality'] })}>
            <option value="low">低 (軽量)</option>
            <option value="mid">中 (推奨)</option>
            <option value="high">高 (高性能PC)</option>
          </select>
        </label>
        <label className="text-xs text-slate-300">
          音量 {Math.round(s.volume * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => u({ volume: +e.target.value })} className="mt-2 w-full accent-emerald-400" />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Toggle label="初心者モード" desc="ロール速度・最大Gを抑えて扱いやすく" value={s.beginner} onChange={(v) => u({ beginner: v })} />
        <Toggle label="自動水平復帰" desc="操作を離すと翼を水平に戻す" value={s.autoLevel} onChange={(v) => u({ autoLevel: v })} />
        <Toggle label="Auto-GCAS" desc="地面衝突を自動回避 (G)" value={s.autoGcas} onChange={(v) => u({ autoGcas: v })} />
        <Toggle label="マウス操縦" desc="マウス位置で機体を操作" value={s.mouseFlight} onChange={(v) => u({ mouseFlight: v })} />
        <Toggle label="ピッチ反転" desc="↑で機首下げ (フライトシム式)" value={s.invertPitch} onChange={(v) => u({ invertPitch: v })} />
        <Toggle label="ミュート (M)" value={s.muted} onChange={(v) => u({ muted: v })} />
      </div>
    </div>
  );
}

function Controls() {
  const rows: [string, string][] = [
    ['↑ ↓ / W S', 'ピッチ (機首上げ・下げ)'],
    ['← → / A D', 'ロール (左右に傾ける)'],
    ['Q / E', 'ヨー (ラダー)'],
    ['Shift・R / F', 'スロットル 増 / 減'],
    ['1〜9 / 0', 'スロットル段階 (9=MIL, 0=A/B最大)'],
    ['Space / B', 'スピードブレーキ'],
    ['マウスドラッグ', '見回す (ダブルクリックで正面)'],
    ['ホイール', 'ズーム'],
    ['V', '視点切替 (コックピット/追尾/フライバイ)'],
    ['H / G', 'HUD 表示 / Auto-GCAS 切替'],
    ['I / N / O', '速度詳細 / 地点リスト / 地図の開閉'],
    ['P / Esc / F1', '一時停止 / メニュー / 操作説明'],
    ['ゲームパッド', '左スティック操縦・トリガーで推力'],
  ];
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b border-white/5 py-1 text-xs">
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">{k}</kbd>
          <span className="text-right text-slate-300">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Arrow({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M12 2 L19 20 L12 15 L5 20 Z" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLCanvasElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [started, setStarted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [spawnIdx, setSpawnIdx] = useState(0);
  const [statusDetail, setStatusDetail] = useState(true);
  const [showNav, setShowNav] = useState(true);
  const [mapOpen, setMapOpen] = useState(true);
  const [mapLarge, setMapLarge] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef(false);
  menuRef.current = menu;

  useEffect(() => {
    if (!hostRef.current) return;
    let g: Game;
    try {
      g = new Game(
        hostRef.current,
        { markers: markersRef.current!, whiteout: whiteRef.current! },
        DEFAULT_SETTINGS,
        (t) => setTele(t),
        () => setMenu((m) => !m),
      );
    } catch (e) {
      setError('WebGL を初期化できませんでした。対応ブラウザでお試しください。' + String(e));
      return;
    }
    gameRef.current = g;
    g.spawn(SPAWNS[0]);
    g.paused = true;
    g.start();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F1') setHelp((h) => !h);
      if (e.code === 'KeyI') setStatusDetail((d) => !d);
      if (e.code === 'KeyN') setShowNav((n) => !n);
      if (e.code === 'KeyO') setMapOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      g.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    const g = gameRef.current;
    if (!g || !started) return;
    g.paused = menu;
  }, [menu, started]);

  const launch = useCallback(
    (idx: number) => {
      const g = gameRef.current;
      if (!g) return;
      g.startAudio();
      g.spawn(SPAWNS[idx]);
      g.paused = false;
      setStarted(true);
      setMenu(false);
    },
    [],
  );

  const t = tele;
  const nav = t?.nav ?? [];
  const designatedCount = nav.filter((n) => n.designated).length;
  const thrLabel = t ? (t.ab > 0.05 ? `A/B ${Math.round(t.ab * 100)}%` : t.throttle >= 0.995 ? 'MIL 100%' : `${Math.round(t.throttle * 100)}%`) : '';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black font-sans text-white select-none">
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={whiteRef} className="pointer-events-none absolute inset-0 bg-slate-100" style={{ opacity: 0 }} />
      <canvas ref={markersRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {/* キャノピーの金色ティント */}
      {t?.view === 'cockpit' && <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(255,214,140,0.0) 40%, rgba(170,130,60,0.10) 100%)' }} />}

      {error && <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-red-300">{error}</div>}

      {/* ===== ステータス ===== */}
      {started && t && (
        <>
          <div className="pointer-events-auto absolute top-3 left-3 w-[254px] rounded-xl border border-white/10 bg-black/50 p-3 font-mono shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-widest text-slate-400">対気速度 TAS</span>
              <button
                type="button"
                onClick={() => setStatusDetail((d) => !d)}
                className="rounded border border-white/15 bg-white/10 px-2 py-0.5 font-sans text-[10px] font-bold text-slate-200 transition hover:bg-white/20"
                title="詳細表示の開閉 (I)"
              >
                {statusDetail ? '詳細を閉じる ▲' : '詳細を開く ▼'}
              </button>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-emerald-300 tabular-nums">{fmt(t.speedKmh)}</span>
                <span className="text-sm text-emerald-200">km/h</span>
              </div>
              {statusDetail && <span className="text-[10px] text-slate-400">IAS {fmt(t.iasKmh)}</span>}
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tabular-nums ${t.mach >= 1 ? 'text-amber-300' : 'text-sky-300'}`}>M {t.mach.toFixed(2)}</span>
              {t.mach >= 1 && <span className="rounded bg-amber-400/20 px-1.5 text-[10px] text-amber-200">超音速</span>}
              {t.mach >= 1 && t.ab < 0.05 && <span className="rounded bg-sky-400/20 px-1.5 text-[10px] text-sky-200">SUPERCRUISE</span>}
            </div>
            {!statusDetail ? (
              <div className="mt-1.5 flex items-center justify-between border-t border-white/10 pt-1.5 text-[11px] text-slate-300 tabular-nums">
                <span>高度 {fmt(t.alt)} m</span>
                <span>{fmt(t.heading)}° {dir16(t.heading)}</span>
              </div>
            ) : (
              <>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-white/10 pt-2 text-[12px] tabular-nums">
                  <span className="text-slate-400">高度</span><span className="text-right">{fmt(t.alt)} m</span>
                  <span className="text-slate-400"></span><span className="text-right text-slate-400">{fmt(t.alt * 3.28084)} ft</span>
                  <span className="text-slate-400">対地高度</span><span className={`text-right ${t.agl < 300 ? 'text-red-300' : ''}`}>{fmt(t.agl)} m</span>
                  <span className="text-slate-400">昇降率</span><span className="text-right">{t.vs >= 0 ? '+' : ''}{fmt(t.vs * 60)} m/min</span>
                  <span className="text-slate-400">方位</span><span className="text-right">{fmt(t.heading)}° {dir16(t.heading)}</span>
                  <span className="text-slate-400">荷重</span><span className={`text-right ${t.g > 8 ? 'text-red-300' : ''}`}>{t.g.toFixed(1)} G</span>
                  <span className="text-slate-400">迎角 α</span><span className="text-right">{t.alpha.toFixed(1)}°</span>
                  <span className="text-slate-400">推力</span><span className="text-right">{fmt(t.thrust / 1000)} kN</span>
                  <span className="text-slate-400">N2</span><span className="text-right">{Math.round((t.rpm[0] + t.rpm[1]) / 2)}%</span>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-slate-400"><span>スロットル</span><span className={t.ab > 0.05 ? 'text-orange-300' : ''}>{thrLabel}</span></div>
                  <div className="relative mt-0.5 h-2 overflow-hidden rounded bg-white/10">
                    <div className="absolute inset-y-0 left-0 bg-emerald-400" style={{ width: `${Math.min(1, t.throttle) * 83.3}%` }} />
                    <div className="absolute inset-y-0 bg-orange-400" style={{ left: '83.3%', width: `${t.ab * 16.7}%` }} />
                    <div className="absolute inset-y-0 w-px bg-white/60" style={{ left: '83.3%' }} />
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-slate-400">{t.lat.toFixed(4)}°N {t.lon.toFixed(4)}°E</div>
              </>
            )}
          </div>

          {/* ナビゲーション */}
          {!showNav ? (
            <button
              type="button"
              onClick={() => setShowNav(true)}
              className="absolute top-3 right-3 z-20 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-1.5 text-xs font-bold text-sky-200 shadow-lg backdrop-blur hover:bg-slate-900"
            >
              主要地点を表示 (N) ▼
            </button>
          ) : (
            <div className="pointer-events-auto absolute top-3 right-3 max-h-[calc(100vh-24px)] w-[318px] overflow-hidden rounded-xl border border-white/10 bg-black/50 p-3 shadow-xl backdrop-blur-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-bold tracking-wider text-sky-200">主要地点 方位・距離</span>
                <button
                  type="button"
                  onClick={() => setShowNav(false)}
                  className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-200 transition hover:bg-white/20"
                  title="地点リストを閉じる (N)"
                >
                  閉じる ▲
                </button>
              </div>
              <div className="mb-1.5 text-[10px] text-amber-200/80">政令指定都市 (半径100km以内): {designatedCount} 件</div>
              <div className="space-y-0.5">
                {nav.map((n) => (
                  <div key={n.name} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12px] odd:bg-white/5">
                    <span className={n.designated ? 'text-amber-300' : 'text-cyan-300'}>
                      <Arrow deg={n.rel} />
                    </span>
                    <span className={`flex-1 truncate font-semibold ${n.designated ? 'text-amber-100' : 'text-cyan-100'}`}>{n.name}</span>
                    <span className="w-[66px] text-right font-mono tabular-nums">{n.dist < 10000 ? (n.dist / 1000).toFixed(1) : fmt(n.dist / 1000)} km</span>
                    <span className="w-[86px] whitespace-nowrap text-right font-mono text-[11px] text-slate-300 tabular-nums">{String(Math.round(n.brg) % 360).padStart(3, '0')}° {dir16(n.brg)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 下部 */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-black/50 px-2 py-1 text-slate-300">視点: {t.view === 'cockpit' ? 'コックピット' : t.view === 'chase' ? '追尾' : 'フライバイ'} (V)</span>
            <span className="rounded bg-black/50 px-2 py-1 text-emerald-200">燃料無制限</span>
            <span className="rounded bg-black/50 px-2 py-1 text-slate-300">I: 詳細 / O: 地図 / F1: 操作説明 / Esc: メニュー</span>
            {settings.autoGcas && <span className="rounded bg-emerald-900/60 px-2 py-1 text-emerald-200">Auto-GCAS</span>}
            {t.loading > 0 && <span className="rounded bg-sky-900/60 px-2 py-1 text-sky-200">地形データ読込中… {t.loading}</span>}
            {t.weatherSource && <span className="rounded bg-black/50 px-2 py-1 text-slate-400">☁ {t.weatherSource}</span>}
          </div>

          {!mapOpen ? (
            <button onClick={() => setMapOpen(true)} className="absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-xs font-bold text-sky-200 shadow-lg backdrop-blur hover:bg-slate-900">
              🗺 地図を表示 (O)
            </button>
          ) : (
            <MiniMap tele={t} large={mapLarge} onClose={() => setMapOpen(false)} onToggleSize={() => setMapLarge((v) => !v)} />
          )}

          {t.message && (
            <div className="pointer-events-none absolute top-[18%] left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-5 py-2 text-lg font-bold text-amber-200 shadow-lg">{t.message}</div>
          )}
          {t.paused && !menu && <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-bold tracking-widest text-white/80">PAUSE</div>}
          {t.crashed && !menu && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="rounded-2xl border border-red-400/30 bg-slate-950/90 p-6 text-center">
                <div className="text-2xl font-bold text-red-300">墜落</div>
                <p className="mt-2 text-sm text-slate-300">地表または海面に衝突しました。</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => launch(spawnIdx)} className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-black hover:bg-emerald-400">同じ地点から再出撃</button>
                  <button onClick={() => setMenu(true)} className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20">メニュー</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== スタート画面 ===== */}
      {!started && !error && (
        <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-black/70 via-black/55 to-black/80">
          <div className="mx-auto max-w-5xl px-5 py-8">
            <div className="text-center">
              <div className="text-xs tracking-[0.4em] text-emerald-300">LOCKHEED MARTIN F-22A RAPTOR</div>
              <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">日本列島 フリーフライト</h1>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300">
                国土地理院の標高データ (DEM) と航空写真をもとに、日本の山・都市・海岸線を実際の位置と標高で再現。
                F119 エンジン2基・最大 M2.25 の F-22 のコックピットから、日本の空を自由に飛べます。
              </p>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <h2 className="mb-2 text-sm font-bold text-sky-200">出撃地点</h2>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {SPAWNS.map((s, i) => (
                    <button
                      key={s.name}
                      onClick={() => setSpawnIdx(i)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${spawnIdx === i ? 'border-emerald-400 bg-emerald-400/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                    >
                      <div className="font-semibold">{s.name}</div>
                      <div className="text-[11px] text-slate-400">高度 {fmt(s.alt)}m ・ {fmt(s.speedKmh)} km/h</div>
                    </button>
                  ))}
                </div>
                <button onClick={() => launch(spawnIdx)} className="mt-4 w-full rounded-xl bg-emerald-500 py-3 text-lg font-black tracking-widest text-black shadow-lg shadow-emerald-500/30 hover:bg-emerald-400">
                  出撃する ▶
                </button>
                <p className="mt-2 text-center text-[11px] text-slate-500">※ 地形・写真タイルを読み込むため、通信環境により表示まで数秒かかります</p>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <h2 className="mb-2 text-sm font-bold text-sky-200">設定 (初心者向けアシスト)</h2>
                  <SettingsPanel s={settings} set={setSettings} />
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <h2 className="mb-2 text-sm font-bold text-sky-200">操作方法</h2>
                  <Controls />
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-[11px] leading-relaxed text-slate-400">
              <b className="text-slate-200">F-22A 諸元 (飛行モデルに使用)</b>: 全長 18.92m / 全幅 13.56m / 翼面積 78.04m² / 空虚重量 19,700kg / 機内燃料 8,200kg /
              F119-PW-100 ×2 (ドライ 116kN・A/B 156kN 各) / 最大速度 M2.25 (高高度)・約1,500km/h (海面) / スーパークルーズ M1.7〜1.8 / 実用上昇限度 19,812m / +9G〜−3G。
              大気は ISA 標準大気でマッハ数・密度を算出。<br />
              <b className="text-slate-200">データ出典</b>: 地理院タイル (標高タイル・全国最新写真), AWS Terrain Tiles (国外地形), Esri World Imagery (補完), Open-Meteo (リアルタイム雲量・露点から雲底高度算出)。<br />
              <b className="text-slate-200">アシスト</b>: 燃料は無制限 (燃料制限・給油の必要なし) / Gによる暗転・赤視・操縦士のG制限エフェクトはありません。機体の構造荷重 (+9G/−3G) のみ再現しています。地図は O キーで表示切替、右上の「拡大」で詳細表示できます。
            </div>
          </div>
        </div>
      )}

      {/* ===== メニュー ===== */}
      {started && menu && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold">メニュー</h2>
              <button onClick={() => setMenu(false)} className="rounded-lg bg-emerald-500 px-4 py-1.5 font-bold text-black hover:bg-emerald-400">再開 (Esc)</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-bold text-sky-200">ワープ / 再出撃</h3>
                <div className="space-y-1">
                  {SPAWNS.map((s, i) => (
                    <button key={s.name} onClick={() => { setSpawnIdx(i); launch(i); }} className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left text-sm hover:bg-white/10">
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-bold text-sky-200">設定</h3>
                <SettingsPanel s={settings} set={setSettings} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 操作説明 ===== */}
      {help && started && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950/95 p-5">
            <h2 className="mb-3 text-lg font-bold">操作方法 (F1で閉じる)</h2>
            <Controls />
            <p className="mt-3 text-xs text-slate-400">ヒント: キーを離すと機体は自動的に水平へ戻り、現在の上昇・降下角を保持します。低空で危険になると Auto-GCAS が自動で引き起こします。</p>
          </div>
        </div>
      )}
    </div>
  );
}
