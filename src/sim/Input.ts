export interface InputSettings {
  invertPitch: boolean;
  mouseFlight: boolean;
}

export class Input {
  keys = new Set<string>();
  pitch = 0;
  roll = 0;
  yaw = 0;
  throttle = 0.85;
  speedBrake = false;
  headYaw = 0;
  headPitch = -0.08;
  zoom = 0; // FOV 調整
  mouseX = 0; // -1..1
  mouseY = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  onAction: (a: string) => void = () => {};
  settings: InputSettings = { invertPitch: false, mouseFlight: false };
  private gpPrev: boolean[] = [];

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('blur', this.blur);
    el.addEventListener('mousedown', this.md);
    window.addEventListener('mouseup', this.mu);
    window.addEventListener('mousemove', this.mm);
    el.addEventListener('wheel', this.wh, { passive: false });
    el.addEventListener('dblclick', this.dbl);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private blur = () => this.keys.clear();
  private kd = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'PageUp', 'PageDown'].includes(k)) e.preventDefault();
    if (!this.keys.has(k)) {
      const map: Record<string, string> = {
        KeyV: 'view', KeyH: 'hud', KeyM: 'mute', KeyP: 'pause', Escape: 'menu', KeyG: 'gcas', KeyC: 'center',
        KeyL: 'level', F1: 'help', KeyN: 'nav',
      };
      if (map[k]) {
        if (k === 'F1') e.preventDefault();
        this.onAction(map[k]);
      }
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
      const di = digits.indexOf(k);
      if (di >= 0) this.throttle = di === 9 ? 1.2 : di === 8 ? 1.0 : di / 8;
    }
    this.keys.add(k);
  };
  private ku = (e: KeyboardEvent) => this.keys.delete(e.code);
  private md = (e: MouseEvent) => {
    if (this.settings.mouseFlight && e.button === 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private mu = () => (this.dragging = false);
  private mm = (e: MouseEvent) => {
    const r = this.el.getBoundingClientRect();
    this.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.headYaw -= dx * 0.004;
    this.headPitch -= dy * 0.004;
    this.headYaw = Math.max(-2.7, Math.min(2.7, this.headYaw));
    this.headPitch = Math.max(-1.0, Math.min(1.4, this.headPitch));
  };
  private wh = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = Math.max(-1, Math.min(1, this.zoom + Math.sign(e.deltaY) * 0.1));
  };
  private dbl = () => this.center();

  center() {
    this.headYaw = 0;
    this.headPitch = -0.08;
    this.zoom = 0;
  }

  update(dt: number) {
    const k = this.keys;
    const has = (...c: string[]) => c.some((x) => k.has(x));
    let tp = (has('ArrowUp', 'KeyW') ? 1 : 0) - (has('ArrowDown', 'KeyS') ? 1 : 0);
    if (this.settings.invertPitch) tp = -tp;
    let tr = (has('ArrowRight', 'KeyD') ? 1 : 0) - (has('ArrowLeft', 'KeyA') ? 1 : 0);
    let ty = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    if (has('KeyR', 'ShiftLeft', 'ShiftRight', 'PageUp')) this.throttle = Math.min(1.2, this.throttle + dt * 0.35);
    if (has('KeyF', 'PageDown')) this.throttle = Math.max(0, this.throttle - dt * 0.35);
    this.speedBrake = has('KeyB', 'Space');

    // マウス操縦
    if (this.settings.mouseFlight) {
      const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      if (!tp) tp = THREE_clamp(-dz(this.mouseY) * 2.2) * (this.settings.invertPitch ? -1 : 1);
      if (!tr) tr = THREE_clamp(dz(this.mouseX) * 2.2);
    }

    // ゲームパッド
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      if (dz(gp.axes[0])) tr = gp.axes[0];
      if (dz(gp.axes[1])) tp = (this.settings.invertPitch ? 1 : -1) * gp.axes[1];
      if (gp.axes.length > 3) {
        if (dz(gp.axes[2])) this.headYaw = Math.max(-2.7, Math.min(2.7, this.headYaw - gp.axes[2] * dt * 2));
        if (dz(gp.axes[3])) this.headPitch = Math.max(-1, Math.min(1.4, this.headPitch - gp.axes[3] * dt * 2));
      }
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const bv = (i: number) => gp.buttons[i]?.value ?? 0;
      if (bv(7) > 0.1) this.throttle = Math.min(1.2, this.throttle + dt * 0.5 * bv(7));
      if (bv(6) > 0.1) this.throttle = Math.max(0, this.throttle - dt * 0.5 * bv(6));
      if (b(4)) ty = -1;
      if (b(5)) ty = 1;
      if (b(1)) this.speedBrake = true;
      const edge = (i: number, a: string) => {
        if (b(i) && !this.gpPrev[i]) this.onAction(a);
        this.gpPrev[i] = b(i);
      };
      edge(3, 'view');
      edge(2, 'hud');
      edge(9, 'menu');
      edge(10, 'center');
    }

    // 初心者向けスムージング
    const sm = (cur: number, target: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
    this.pitch = sm(this.pitch, tp, tp === 0 ? 5 : 2.6);
    this.roll = sm(this.roll, tr, tr === 0 ? 6 : 3.5);
    this.yaw = sm(this.yaw, ty, 4);
  }

  dispose() {
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('mouseup', this.mu);
    window.removeEventListener('mousemove', this.mm);
  }
}

function THREE_clamp(v: number) {
  return Math.max(-1, Math.min(1, v));
}
