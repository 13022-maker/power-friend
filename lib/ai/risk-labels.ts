/**
 * 風險理由的固定標籤（client／server 共用，不含網路相依）。
 * 原則：受害者看到的紅色警告只能出現平台自己寫的固定文字，絕不顯示模型自由文字。
 */
import { RULE_REASON_NAMES } from "./scam";

export const MUSE_REASON_LABELS = {
  fake_logistics: "假物流／賣貨便認證",
  fake_support: "假客服話術",
  prepay: "要求先匯款",
  deposit: "要求保證金／訂金",
  off_platform: "引導站外交易",
  credential_request: "索取驗證碼或帳戶資料",
  impersonation: "冒充官方或他人",
  other: "其他可疑話術",
} as const;
export type MuseReasonCode = keyof typeof MUSE_REASON_LABELS;
export const MUSE_REASON_CODES = Object.keys(MUSE_REASON_LABELS) as MuseReasonCode[];

/** 把模型回傳的代碼陣列轉成固定標籤；未知代碼一律忽略 */
export function museReasonLabels(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const out = new Set<string>();
  for (const c of codes) if (typeof c === "string" && Object.hasOwn(MUSE_REASON_LABELS, c)) out.add(MUSE_REASON_LABELS[c as MuseReasonCode]);
  return [...out].slice(0, 3);
}

const ALLOWED = new Set<string>([...RULE_REASON_NAMES, ...Object.values(MUSE_REASON_LABELS).map((l) => `AI：${l}`)]);

/** 顯示前白名單過濾（防舊資料或被竄改的 risk_reasons）；全被濾掉時給通用文字 */
export function displayRiskReasons(reasons: readonly string[] | null | undefined): string[] {
  const ok = (reasons ?? []).filter((r) => ALLOWED.has(r));
  return ok.length ? ok : ["可疑內容"];
}
