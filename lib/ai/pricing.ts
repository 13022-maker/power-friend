import type { Category, Condition } from "../types";
import { CONDITIONS } from "../catalog";

export interface PriceEstimate {
  low: number;
  mid: number;
  high: number;
  basis: string;
}

/** 各分類二手殘值率（原型假設值；正式版以平台歷史成交價迴歸） */
const RESIDUAL: Record<Category, number> = {
  camera: 0.75,
  camping: 0.6,
  figure: 0.7,
  electronics: 0.55,
  books: 0.4,
  fashion: 0.35,
  furniture: 0.4,
  other: 0.5,
};

const DEFAULT_BASE: Record<Category, number> = {
  camera: 18000,
  camping: 4500,
  figure: 1800,
  electronics: 15000,
  books: 250,
  fashion: 1200,
  furniture: 2200,
  other: 800,
};

const round = (n: number) => (n >= 1000 ? Math.round(n / 100) * 100 : Math.max(10, Math.round(n / 10) * 10));

export function estimatePrice(category: Category, condition: Condition, base?: number): PriceEstimate {
  const b = base ?? DEFAULT_BASE[category];
  const mid = b * RESIDUAL[category] * CONDITIONS[condition].factor;
  return {
    low: round(mid * 0.85),
    mid: round(mid),
    high: round(mid * 1.15),
    basis: base ? "依原價 × 分類殘值率 × 成色" : "依分類行情 × 成色",
  };
}

/** 價格合理度 0..1：低於估價中位數越多越高（用於「最可能成交」排序） */
export function priceFairness(price: number, low: number, high: number): number {
  const mid = (low + high) / 2;
  if (mid <= 0) return 0.5;
  const ratio = price / mid;
  return Math.max(0, Math.min(1, 1.5 - ratio));
}
