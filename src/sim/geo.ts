// 地理計算ユーティリティ (WGS84 / Web Mercator)
export const R_MERC = 6378137;
export const R_EARTH = 6371008.8;
export const HALF_CIRC = Math.PI * R_MERC;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function lonToMx(lon: number) {
  return R_MERC * lon * D2R;
}
export function latToMy(lat: number) {
  return R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
}
export function mxToLon(mx: number) {
  return (mx / R_MERC) * R2D;
}
export function myToLat(my: number) {
  return (2 * Math.atan(Math.exp(my / R_MERC)) - Math.PI / 2) * R2D;
}
export function tileSizeMerc(z: number) {
  return (2 * HALF_CIRC) / Math.pow(2, z);
}

/** 大圏距離 (m) */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R;
  const dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 初期方位角 (真方位, 度) */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

const DIRS16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
export function dir16(deg: number) {
  return DIRS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** 浮動原点: ローカル座標 (x=東, y=上, z=南) とメルカトルの相互変換 */
export class Origin {
  mx = 0;
  my = 0;
  k = 1; // メルカトル→実距離スケール (cos lat)
  set(lat: number, lon: number) {
    this.mx = lonToMx(lon);
    this.my = latToMy(lat);
    this.k = Math.cos(lat * D2R);
  }
  toLocalX(mx: number) {
    return (mx - this.mx) * this.k;
  }
  toLocalZ(my: number) {
    return (this.my - my) * this.k;
  }
  latLonToLocal(lat: number, lon: number) {
    return { x: this.toLocalX(lonToMx(lon)), z: this.toLocalZ(latToMy(lat)) };
  }
  localToLatLon(x: number, z: number) {
    const mx = this.mx + x / this.k;
    const my = this.my - z / this.k;
    return { lat: myToLat(my), lon: mxToLon(mx), mx, my };
  }
}

// ISA 標準大気
export function isa(h: number) {
  const T0 = 288.15, P0 = 101325, Rg = 287.053, g = 9.80665;
  let T: number, P: number;
  if (h < 11000) {
    T = T0 - 0.0065 * h;
    P = P0 * Math.pow(T / T0, g / (0.0065 * Rg));
  } else if (h < 20000) {
    T = 216.65;
    P = 22632.06 * Math.exp((-g * (h - 11000)) / (Rg * T));
  } else {
    T = 216.65 + 0.001 * (h - 20000);
    P = 5474.89 * Math.pow(216.65 / T, g / (0.001 * Rg));
  }
  const rho = P / (Rg * T);
  const a = Math.sqrt(1.4 * Rg * T);
  return { T, P, rho, a };
}
