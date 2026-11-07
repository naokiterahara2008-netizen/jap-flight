import type { CloudWeather } from './Clouds';

export type WeatherMode = 'real' | 'clear' | 'scattered' | 'broken' | 'overcast';
export const WEATHER_LABEL: Record<WeatherMode, string> = {
  real: 'リアルタイム実況',
  clear: '快晴',
  scattered: '晴れ (積雲)',
  broken: '曇りがち',
  overcast: '曇天',
};

export function presetWeather(m: WeatherMode): CloudWeather {
  switch (m) {
    case 'clear':
      return { low: 0.02, mid: 0.0, high: 0.1, base: 1500, visibility: 80000, source: '快晴' };
    case 'broken':
      return { low: 0.65, mid: 0.4, high: 0.4, base: 1100, visibility: 30000, source: '曇りがち' };
    case 'overcast':
      return { low: 0.95, mid: 0.7, high: 0.6, base: 800, visibility: 18000, source: '曇天' };
    default:
      return { low: 0.32, mid: 0.12, high: 0.3, base: 1350, visibility: 50000, source: '晴れ (積雲)' };
  }
}

/** Open-Meteo 現在値から雲量・雲底高度 (125m × (気温−露点)) ・視程を取得 */
export async function fetchRealWeather(lat: number, lon: number): Promise<CloudWeather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,dew_point_2m,visibility,weather_code`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const c = j.current;
    const spread = Math.max(0.5, (c.temperature_2m ?? 15) - (c.dew_point_2m ?? 10));
    const base = Math.min(3500, Math.max(300, 125 * spread));
    return {
      low: Math.min(1, (c.cloud_cover_low ?? 30) / 100),
      mid: Math.min(1, (c.cloud_cover_mid ?? 10) / 100),
      high: Math.min(1, (c.cloud_cover_high ?? 20) / 100),
      base,
      visibility: Math.min(90000, Math.max(5000, c.visibility ?? 40000)),
      source: `実況 下層${c.cloud_cover_low}% 中層${c.cloud_cover_mid}% 上層${c.cloud_cover_high}% 雲底${Math.round(base)}m`,
    };
  } catch {
    return null;
  }
}
