/**
 * 共用輸入驗證（server action／service／client 元件都可 import，不含 server-only 相依）。
 */
import type { Category, Condition } from "./types";
import { AREAS, CATEGORIES, CONDITIONS } from "./catalog";

export const LIMITS = {
  titleMax: 60,
  descriptionMax: 2000,
  priceMax: 10_000_000,
  offerMessageMax: 500,
  chatBodyMax: 1000,
  nicknameMax: 24,
  bioMax: 200,
  interestsMax: 10,
  interestLenMax: 20,
} as const;

/** 檢舉理由：固定選項（components/SafetyActions.tsx 顯示同一份清單） */
export const REPORT_REASONS = ["疑似詐騙", "要求私下交易／先匯款", "騷擾或不當言語", "商品與描述不符"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const isCategory = (x: unknown): x is Category => typeof x === "string" && Object.hasOwn(CATEGORIES, x);
export const isCondition = (x: unknown): x is Condition => typeof x === "string" && Object.hasOwn(CONDITIONS, x);
export const isArea = (x: unknown): x is string => typeof x === "string" && Object.hasOwn(AREAS, x);
export const isReportReason = (x: unknown): x is ReportReason =>
  typeof x === "string" && (REPORT_REASONS as readonly string[]).includes(x);

/** 價格／出價金額：整數 1..10,000,000 */
export const isValidAmount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= LIMITS.priceMax;
