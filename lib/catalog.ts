import type { Category, Condition } from "./types";

export const CATEGORIES: Record<Category, { label: string; glyph: string; hue: number }> = {
  camera: { label: "相機攝影", glyph: "鏡", hue: 28 },
  camping: { label: "露營戶外", glyph: "營", hue: 140 },
  figure: { label: "公仔收藏", glyph: "玩", hue: 330 },
  electronics: { label: "3C 電子", glyph: "電", hue: 210 },
  books: { label: "書籍", glyph: "書", hue: 45 },
  fashion: { label: "服飾配件", glyph: "衣", hue: 280 },
  furniture: { label: "家具生活", glyph: "家", hue: 18 },
  other: { label: "其他", glyph: "物", hue: 0 },
};

export const CONDITIONS: Record<Condition, { label: string; factor: number }> = {
  new: { label: "全新", factor: 1 },
  like_new: { label: "近全新", factor: 0.85 },
  good: { label: "良好", factor: 0.7 },
  fair: { label: "有使用痕跡", factor: 0.55 },
  worn: { label: "明顯磨損", factor: 0.35 },
};

/** 位置只存到捷運站／行政區粒度（隱私設計），對外只顯示距離區間 */
export const AREAS: Record<string, { label: string; lat: number; lng: number }> = {
  zhongli: { label: "桃園・中壢", lat: 24.9537, lng: 121.2257 },
  taoyuan: { label: "桃園・桃園站", lat: 24.9894, lng: 121.3143 },
  qingpu: { label: "桃園・青埔", lat: 25.0129, lng: 121.2149 },
  taipei_main: { label: "台北・台北車站", lat: 25.0478, lng: 121.517 },
  gongguan: { label: "台北・公館", lat: 25.0146, lng: 121.5341 },
  xinyi: { label: "台北・信義", lat: 25.0336, lng: 121.5646 },
  hsinchu: { label: "新竹・新竹站", lat: 24.8016, lng: 120.9716 },
};

export function distanceKm(a: string, b: string): number {
  const A = AREAS[a];
  const B = AREAS[b];
  if (!A || !B) return 999;
  const R = 6371;
  const dLat = ((B.lat - A.lat) * Math.PI) / 180;
  const dLng = ((B.lng - A.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((A.lat * Math.PI) / 180) * Math.cos((B.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceBand(km: number): string {
  if (km < 3) return "3 公里內";
  if (km < 10) return "10 公里內";
  if (km < 30) return "30 公里內";
  return "可寄送";
}

export const formatNTD = (n: number) => `NT$${Math.round(n).toLocaleString("zh-TW")}`;
