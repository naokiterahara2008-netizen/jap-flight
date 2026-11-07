import * as THREE from 'three';
import { bearing, haversine, latToMy, lonToMx, Origin } from './geo';
import { PLACES, type Spawn } from './places';
import { Terrain } from './Terrain';
import { Environment, type TimeOfDay } from './Environment';
import { Clouds } from './Clouds';
import { FlightModel } from './FlightModel';
import { createF22, updateF22, type F22Parts } from './F22Model';
import { Cockpit } from './Cockpit';
import { Input } from './Input';
import { FlightAudio } from './Audio';
import { Landmarks } from './Landmarks';
import type { HudState, NavItem } from './Hud';
import { fetchRealWeather, presetWeather, type WeatherMode } from './Weather';

export type ViewMode = 'cockpit' | 'chase' | 'flyby';
export interface GameSettings {
  timeOfDay: TimeOfDay;
  weather: WeatherMode;
  autoLevel: boolean;
  autoGcas: boolean;
  beginner: boolean;
  invertPitch: boolean;
  mouseFlight: boolean;
  volume: number;
  muted: boolean;
  quality: 'low' | 'mid' | 'high';
}

export interface Telemetry extends HudState {
  view: ViewMode;
  loading: number;
  weatherSource: string;
  crashed: boolean;
  paused: boolean;
  message: string;
  hudOn: boolean;
}

export interface OverlayEls {
  markers: HTMLCanvasElement;
  whiteout: HTMLDivElement;
}

const EYE = new THREE.Vector3(0, 0.98, -5.0);

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 1, 0.05, 2.5e6);
  origin = new Origin();
  terrain: Terrain;
  env: Environment;
  clouds: Clouds;
  fm = new FlightModel();
  aircraft = new THREE.Group();
  f22: F22Parts;
  cockpit = new Cockpit();
  head = new THREE.Group();
  input: Input;
  audio: FlightAudio | null = null;
  landmarks: Landmarks;
  view: ViewMode = 'cockpit';
  paused = false;
  crashed = false;
  message = '';
  messageUntil = 0;
  gMax = 1;
  time = 0;
  private raf = 0;
  private clock = new THREE.Clock();
  private teleTick = 0;
  private lmTick = 0;
  private weatherPos = { lat: 999, lon: 999 };
  private weatherSource = '';
  private chasePos = new THREE.Vector3();
  private flybyPos = new THREE.Vector3();
  private mctx: CanvasRenderingContext2D;
  private nav: NavItem[] = [];
  private lat = 0;
  private lon = 0;
  private mx = 0;
  private my = 0;

  constructor(
    private container: HTMLElement,
    private els: OverlayEls,
    public settings: GameSettings,
    private onTelemetry: (t: Telemetry) => void,
    private onMenu: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.terrain = new Terrain(this.origin);
    this.terrain.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.terrain.group);
    this.env = new Environment(this.renderer, this.scene);
    this.clouds = new Clouds(this.origin);
    this.scene.add(this.clouds.mesh);
    this.landmarks = new Landmarks(this.origin);
    this.scene.add(this.landmarks.group);

    this.f22 = createF22();
    this.aircraft.add(this.f22.root);
    this.head.position.copy(EYE);
    this.aircraft.add(this.head);
    this.head.add(this.cockpit.group);
    this.scene.add(this.aircraft);
    this.scene.add(this.camera);

    this.input = new Input(this.renderer.domElement);
    this.input.onAction = (a) => this.action(a);
    this.mctx = els.markers.getContext('2d')!;

    window.addEventListener('resize', this.resize);
    this.applySettings(settings, true);
    this.resize();
  }

  private resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const pr = Math.min(window.devicePixelRatio, this.settings.quality === 'high' ? 2 : this.settings.quality === 'mid' ? 1.5 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.els.markers.width = w * Math.min(2, window.devicePixelRatio);
    this.els.markers.height = h * Math.min(2, window.devicePixelRatio);
  };

  applySettings(s: GameSettings, first = false) {
    const prev = this.settings;
    this.settings = s;
    this.input.settings = { invertPitch: s.invertPitch, mouseFlight: s.mouseFlight };
    this.terrain.detail = s.quality === 'high' ? 2.0 : s.quality === 'mid' ? 1.5 : 1.2;
    this.clouds.radius = s.quality === 'low' ? 45000 : s.quality === 'mid' ? 65000 : 80000;
    if (first || prev.timeOfDay !== s.timeOfDay) this.env.setTime(s.timeOfDay);
    if (first || prev.weather !== s.weather) this.updateWeather(true);
    if (this.audio) {
      this.audio.volume = s.volume;
      this.audio.muted = s.muted;
    }
    if (!first && prev.quality !== s.quality) this.resize();
  }

  private async updateWeather(force = false) {
    if (this.settings.weather !== 'real') {
      const w = presetWeather(this.settings.weather);
      this.clouds.setWeather(w);
      this.weatherSource = w.source;
      return;
    }
    if (!force && haversine(this.lat, this.lon, this.weatherPos.lat, this.weatherPos.lon) < 60000) return;
    this.weatherPos = { lat: this.lat, lon: this.lon };
    if (!this.lat && !this.lon) return;
    const w = await fetchRealWeather(this.lat, this.lon);
    if (this.settings.weather !== 'real') return;
    const ww = w ?? presetWeather('scattered');
    this.clouds.setWeather(ww);
    this.weatherSource = w ? ww.source : '実況取得失敗 → 晴れ(積雲)';
  }

  startAudio() {
    if (!this.audio) {
      this.audio = new FlightAudio();
      this.audio.volume = this.settings.volume;
      this.audio.muted = this.settings.muted;
    }
    this.audio.resume();
  }

  spawn(s: Spawn) {
    this.origin.set(s.lat, s.lon);
    this.fm.reset(0, s.alt, 0, s.heading, s.speedKmh);
    this.input.throttle = this.fm.throttle;
    this.input.center();
    this.crashed = false;
    this.gMax = 1;
    this.terrain.rebase();
    this.lat = s.lat;
    this.lon = s.lon;
    this.weatherPos = { lat: 999, lon: 999 };
    this.updateWeather(true);
    this.clouds.lastCell = '';
    this.chasePos.set(0, 0, 0);
    this.flash(`${s.name} へ移動`);
  }

  flash(m: string, ms = 3000) {
    this.message = m;
    this.messageUntil = performance.now() + ms;
  }

  private action(a: string) {
    switch (a) {
      case 'view':
        this.view = this.view === 'cockpit' ? 'chase' : this.view === 'chase' ? 'flyby' : 'cockpit';
        if (this.view === 'flyby') this.flybyPos.set(-1, -1, -1);
        this.flash({ cockpit: 'コックピット視点', chase: '追尾視点', flyby: 'フライバイ視点' }[this.view], 1500);
        break;
      case 'hud':
        this.cockpit.hudVisible = !this.cockpit.hudVisible;
        break;
      case 'mute':
        this.settings = { ...this.settings, muted: !this.settings.muted };
        if (this.audio) this.audio.muted = this.settings.muted;
        break;
      case 'pause':
        this.paused = !this.paused;
        break;
      case 'menu':
        this.onMenu();
        break;
      case 'gcas':
        this.settings = { ...this.settings, autoGcas: !this.settings.autoGcas };
        this.flash(`Auto-GCAS ${this.settings.autoGcas ? 'ON' : 'OFF'}`, 1500);
        break;
      case 'center':
        this.input.center();
        break;
    }
  }

  start() {
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  private groundAt = (x: number, z: number) => {
    const ll = this.origin.localToLatLon(x, z);
    const h = this.terrain.heightAtMerc(ll.mx, ll.my);
    return Math.max(h ?? 0, 0, this.landmarks.obstacleAt(x, z));
  };

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const fm = this.fm;
    this.input.update(dt);
    if (!this.paused && !this.crashed) {
      this.time += dt;
      fm.step(
        dt,
        { pitch: this.input.pitch, roll: this.input.roll, yaw: this.input.yaw, throttle: this.input.throttle, speedBrake: this.input.speedBrake },
        { autoLevel: this.settings.autoLevel, autoGcas: this.settings.autoGcas, beginner: this.settings.beginner },
        this.groundAt,
      );
      const ground = this.groundAt(fm.pos.x, fm.pos.z);
      if (fm.pos.y < ground + 1.5) {
        this.crashed = true;
        fm.pos.y = ground + 1.5;
        this.flash('墜落しました — メニューから再出撃してください', 999999);
        this.audio?.boom();
      }
      if (fm.sonicCrossed && performance.now() - fm.sonicCrossed < 50) {
        if (this.view !== 'cockpit') this.audio?.boom();
        this.flash('音速突破 — MACH 1.0', 1800);
        fm.sonicCrossed = 0;
      }
      this.gMax = Math.max(this.gMax, fm.gLoad);
    }

    // 浮動原点の更新
    if (Math.abs(fm.pos.x) > 8000 || Math.abs(fm.pos.z) > 8000) {
      const ll = this.origin.localToLatLon(fm.pos.x, fm.pos.z);
      this.origin.set(ll.lat, ll.lon);
      fm.pos.x = 0;
      fm.pos.z = 0;
      this.terrain.rebase();
      this.clouds.lastCell = '';
      this.chasePos.set(0, 0, 0);
      this.flybyPos.set(-1, -1, -1);
    }
    const ll = this.origin.localToLatLon(fm.pos.x, fm.pos.z);
    this.lat = ll.lat;
    this.lon = ll.lon;
    this.mx = ll.mx;
    this.my = ll.my;

    // 機体
    this.aircraft.position.copy(fm.pos);
    this.aircraft.quaternion.copy(fm.qBody);
    updateF22(this.f22, fm.ab, fm.rpm[0], this.input.pitch, this.input.roll, fm.mach, this.time);

    this.updateCamera(dt);
    this.aircraft.updateMatrixWorld(true);

    this.terrain.update(this.lat, this.lon, this.mx, this.my, this.cameraAlt());
    const camW = new THREE.Vector3();
    this.camera.getWorldPosition(camW);
    this.env.update(this.camera, camW, this.time, camW.y);
    this.env.fog.density = 1 / (Math.min(this.clouds.weather.visibility, 60000) * 0.9 + Math.max(0, camW.y) * 14);
    this.camera.updateMatrixWorld(true);
    const cll = this.origin.localToLatLon(camW.x, camW.z);
    this.clouds.update(this.camera, cll.mx, cll.my, this.env.sunDir, this.env.fogColor, this.env.fog.density);
    if (this.lmTick-- <= 0) {
      this.lmTick = 30;
      this.landmarks.update((mx, my) => this.terrain.heightAtMerc(mx, my));
      this.updateWeather();
    }

    // HUD / ナビ
    const hs = this.hudState();
    this.cockpit.update(hs, this.input.pitch, this.input.roll, this.input.throttle);

    // 描画
    this.renderer.clear();
    this.renderer.render(this.env.skyScene, this.env.skyCam);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);

    this.drawMarkers();
    this.updateOverlay();

    // サウンド
    if (this.audio) {
      const warn = fm.gcasActive ? 'gcas' : hs.pullUp ? 'pullup' : hs.stall ? 'stall' : 'none';
      this.audio.update({
        rpm: fm.rpm[0], ab: fm.ab, speed: fm.speed, q: fm.q, buffet: fm.buffet + (this.view === 'cockpit' ? 0 : 0),
        cockpit: this.view === 'cockpit', warn: this.crashed || this.paused ? 'none' : warn,
      });
    }

    if (this.teleTick-- <= 0) {
      this.teleTick = 6;
      this.onTelemetry({
        ...hs,
        view: this.view,
        loading: this.terrain.pending + this.terrain.queue.jobs.length,
        weatherSource: this.weatherSource,
        crashed: this.crashed,
        paused: this.paused,
        message: performance.now() < this.messageUntil ? this.message : '',
        hudOn: this.cockpit.hudVisible,
      });
    }
  }

  private cameraAlt() {
    const p = new THREE.Vector3();
    this.camera.getWorldPosition(p);
    return p.y;
  }

  private updateCamera(dt: number) {
    const fm = this.fm;
    const zoomFov = 72 - this.input.zoom * 32;
    if (this.view === 'cockpit') {
      if (this.camera.parent !== this.head) this.head.add(this.camera);
      this.cockpit.group.visible = true;
      this.f22.root.children[0].visible = false; // 胴体 (機内から見えないため)
      this.f22.root.children[1].visible = false; // キャノピー
      this.f22.root.children[2].visible = false; // ヘルメット
      const shake = Math.min(1, fm.buffet) * 0.006;
      this.camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0);
      this.camera.rotation.set(this.input.headPitch, this.input.headYaw, 0, 'YXZ');
      this.camera.fov = zoomFov;
      this.camera.near = 0.05;
    } else {
      if (this.camera.parent !== this.scene) this.scene.add(this.camera);
      this.cockpit.group.visible = false;
      this.f22.root.children[0].visible = true;
      this.f22.root.children[1].visible = true;
      this.f22.root.children[2].visible = true;
      this.camera.near = 0.5;
      this.camera.fov = 60 - this.input.zoom * 25;
      if (this.view === 'chase') {
        const dist = 30;
        const off = new THREE.Vector3(0, 0, dist).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.12 + this.input.headPitch * 0.8);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.input.headYaw);
        const target = off.applyQuaternion(fm.qWind).add(fm.pos);
        if (this.chasePos.lengthSq() === 0) this.chasePos.copy(target);
        this.chasePos.lerp(target, 1 - Math.exp(-dt * 6));
        this.camera.position.copy(this.chasePos);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(fm.qWind);
        this.camera.up.lerp(up, 0.15);
        this.camera.lookAt(fm.pos.clone().add(up.multiplyScalar(2)));
      } else {
        // フライバイ: 進路前方に固定カメラ
        const rel = this.flybyPos.clone().sub(fm.pos);
        if (this.flybyPos.x === -1 || rel.length() > 1200) {
          const fwd = fm.vel.clone().normalize();
          const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
          this.flybyPos.copy(fm.pos).addScaledVector(fwd, Math.min(900, fm.speed * 3)).addScaledVector(side, 40).add(new THREE.Vector3(0, 12, 0));
          const g = this.groundAt(this.flybyPos.x, this.flybyPos.z);
          this.flybyPos.y = Math.max(this.flybyPos.y, g + 5);
        }
        this.camera.position.copy(this.flybyPos);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(fm.pos);
      }
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  private hudState(): HudState {
    const fm = this.fm;
    const heading = fm.heading;
    const nav: NavItem[] = [];
    for (const p of PLACES) {
      const d = haversine(this.lat, this.lon, p.lat, p.lon);
      if (p.designated && d > 100000) continue;
      const b = bearing(this.lat, this.lon, p.lat, p.lon);
      let rel = b - heading;
      rel = ((rel + 540) % 360) - 180;
      nav.push({ name: p.name, dist: d, brg: b, rel, designated: !!p.designated });
    }
    nav.sort((a, b) => a.dist - b.dist);
    this.nav = nav;
    const vb = fm.vel.clone().applyQuaternion(fm.qBody.clone().invert());
    const az = Math.atan2(vb.x, -vb.z) * THREE.MathUtils.RAD2DEG;
    const el = Math.atan2(vb.y, Math.hypot(vb.x, vb.z)) * THREE.MathUtils.RAD2DEG;
    const ttImpact = fm.vel.y < -1 ? fm.agl / -fm.vel.y : 999;
    return {
      speedKmh: fm.speed * 3.6,
      iasKmh: fm.ias * 3.6,
      mach: fm.mach,
      alt: fm.pos.y,
      agl: fm.agl,
      vs: fm.vs,
      g: fm.gLoad,
      gMax: this.gMax,
      heading,
      pitch: fm.pitchAngle * THREE.MathUtils.RAD2DEG,
      bank: fm.bank * THREE.MathUtils.RAD2DEG,
      alpha: fm.alpha * THREE.MathUtils.RAD2DEG,
      fpmAz: az,
      fpmEl: el,
      throttle: Math.min(1, fm.throttle),
      ab: fm.ab,
      rpm: fm.rpm,
      fuel: fm.fuel,
      fuelFlow: fm.fuelFlow,
      thrust: fm.thrust,
      gcas: fm.gcasActive,
      stall: fm.speed < 60 || (fm.alpha > 0.4 && fm.speed < 110),
      pullUp: !fm.gcasActive && ttImpact < 8 && fm.agl < 1500,
      lat: this.lat,
      lon: this.lon,
      time: this.time,
      nav,
      speedBrake: this.input.speedBrake,
    };
  }

  private drawMarkers() {
    const c = this.mctx;
    const W = c.canvas.width, H = c.canvas.height;
    const sc = W / this.container.clientWidth;
    c.clearRect(0, 0, W, H);
    const camW = new THREE.Vector3();
    this.camera.getWorldPosition(camW);
    const v = new THREE.Vector3();
    for (const n of this.nav) {
      const p = PLACES.find((pp) => pp.name === n.name)!;
      const x = this.origin.toLocalX(lonToMx(p.lon)), z = this.origin.toLocalZ(latToMy(p.lat));
      const d = n.dist;
      // 曲率を考慮した見かけの高さ (遠方は水平線付近)
      const y = d < 400000 ? -(d * d) / (2 * 6371000) + 50 : camW.y - d * 0.0005;
      v.set(x, y, z);
      if (d > 300000) {
        // 遠方: 方向のみ (水平線上)
        const dir = v.clone().sub(camW).setY(0).normalize();
        v.copy(camW).addScaledVector(dir, 50000).setY(camW.y - 300);
      }
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
      const col = n.designated ? '#ffd166' : '#6fe3ff';
      c.strokeStyle = col;
      c.fillStyle = col;
      c.lineWidth = 2 * sc;
      const r = 8 * sc;
      c.beginPath();
      c.moveTo(sx, sy - r);
      c.lineTo(sx + r, sy);
      c.lineTo(sx, sy + r);
      c.lineTo(sx - r, sy);
      c.closePath();
      c.stroke();
      c.font = `600 ${13 * sc}px "Hiragino Sans","Noto Sans JP",sans-serif`;
      c.textAlign = 'center';
      c.shadowColor = 'rgba(0,0,0,0.9)';
      c.shadowBlur = 4 * sc;
      c.fillText(n.name, sx, sy - r - 16 * sc);
      c.fillText(d < 10000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 1000).toLocaleString()} km`, sx, sy - r - 2 * sc);
      c.shadowBlur = 0;
    }
  }

  private updateOverlay() {
    this.els.whiteout.style.opacity = String(this.clouds.inCloud * 0.85);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.audio?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
