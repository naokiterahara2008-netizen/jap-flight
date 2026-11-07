// 主要地点 (市役所所在地等の緯度経度 / 世界測地系)
export interface Place {
  name: string;
  lat: number;
  lon: number;
  designated?: boolean; // 政令指定都市
}

export const PLACES: Place[] = [
  { name: '札幌市', lat: 43.06197, lon: 141.35437, designated: true },
  { name: '仙台市', lat: 38.26822, lon: 140.86940, designated: true },
  { name: 'さいたま市', lat: 35.86140, lon: 139.64555, designated: true },
  { name: '千葉市', lat: 35.60729, lon: 140.10633, designated: true },
  { name: '川崎市', lat: 35.53090, lon: 139.70296, designated: true },
  { name: '横浜市', lat: 35.44439, lon: 139.63800, designated: true },
  { name: '相模原市', lat: 35.57143, lon: 139.37336, designated: true },
  { name: '新潟市', lat: 37.91618, lon: 139.03643, designated: true },
  { name: '静岡市', lat: 34.97556, lon: 138.38278, designated: true },
  { name: '浜松市', lat: 34.71083, lon: 137.72611, designated: true },
  { name: '名古屋市', lat: 35.18147, lon: 136.90654, designated: true },
  { name: '京都市', lat: 35.01164, lon: 135.76803, designated: true },
  { name: '大阪市', lat: 34.69374, lon: 135.50218, designated: true },
  { name: '堺市', lat: 34.57334, lon: 135.48301, designated: true },
  { name: '神戸市', lat: 34.69008, lon: 135.19554, designated: true },
  { name: '岡山市', lat: 34.65511, lon: 133.91952, designated: true },
  { name: '広島市', lat: 34.38527, lon: 132.45530, designated: true },
  { name: '北九州市', lat: 33.88346, lon: 130.87520, designated: true },
  { name: '福岡市', lat: 33.59018, lon: 130.40172, designated: true },
  { name: '熊本市', lat: 32.80310, lon: 130.70779, designated: true },
  { name: '那覇市', lat: 26.21240, lon: 127.68093 },
  { name: '石垣島', lat: 24.34059, lon: 124.15561 },
  { name: '南鳥島', lat: 24.28667, lon: 153.98083 },
  { name: '沖ノ鳥島', lat: 20.42528, lon: 136.08111 },
  { name: '稚内市', lat: 45.41567, lon: 141.67308 },
];

// 実在ランドマーク (高さ m)
export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  height: number;
  type: 'skytree' | 'tower' | 'building';
  w?: number;
}
export const LANDMARKS: Landmark[] = [
  { name: '東京スカイツリー', lat: 35.71006, lon: 139.81070, height: 634, type: 'skytree' },
  { name: '東京タワー', lat: 35.65858, lon: 139.74543, height: 333, type: 'tower' },
  { name: '麻布台ヒルズ森JPタワー', lat: 35.66056, lon: 139.74000, height: 325, type: 'building', w: 60 },
  { name: '横浜ランドマークタワー', lat: 35.45469, lon: 139.63143, height: 296, type: 'building', w: 70 },
  { name: 'あべのハルカス', lat: 34.64594, lon: 135.51335, height: 300, type: 'building', w: 75 },
  { name: 'JRセントラルタワーズ', lat: 35.17060, lon: 136.88260, height: 245, type: 'building', w: 60 },
  { name: 'ミッドランドスクエア', lat: 35.17040, lon: 136.88520, height: 247, type: 'building', w: 55 },
  { name: '虎ノ門ヒルズ', lat: 35.66680, lon: 139.74950, height: 266, type: 'building', w: 55 },
  { name: 'JRタワー (札幌)', lat: 43.06800, lon: 141.35100, height: 173, type: 'building', w: 45 },
];

export interface Spawn {
  name: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  speedKmh: number;
}
export const SPAWNS: Spawn[] = [
  { name: '東京湾上空 → 東京都心', lat: 35.45, lon: 139.86, alt: 1500, heading: 330, speedKmh: 750 },
  { name: '富士山 南方 (標高3,776m)', lat: 35.12, lon: 138.70, alt: 4500, heading: 10, speedKmh: 800 },
  { name: '大阪湾上空 → 大阪', lat: 34.50, lon: 135.25, alt: 1500, heading: 40, speedKmh: 750 },
  { name: '北アルプス (槍・穂高)', lat: 36.10, lon: 137.45, alt: 4200, heading: 10, speedKmh: 800 },
  { name: '札幌 / 石狩湾', lat: 43.25, lon: 141.20, alt: 1500, heading: 160, speedKmh: 750 },
  { name: '那覇 / 慶良間諸島', lat: 26.20, lon: 127.40, alt: 1200, heading: 90, speedKmh: 700 },
  { name: '石垣島 / 川平湾', lat: 24.30, lon: 124.05, alt: 900, heading: 30, speedKmh: 650 },
  { name: '瀬戸内海 / しまなみ', lat: 34.20, lon: 133.00, alt: 1500, heading: 60, speedKmh: 750 },
  { name: '成層圏 (高度15,000m 富士山上空)', lat: 35.36, lon: 138.73, alt: 15000, heading: 60, speedKmh: 1900 },
];
