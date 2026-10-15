import type { RiskLevel } from "../types";

/**
 * 四層防詐的前兩層（規則＋黑名單）與第三層的介面。
 * 借鏡：pH7Builder Security/Spam + Ban（含 bank_account 黑名單）、Duolicious antiabuse 正規化。
 * 第三層 AI 分類器：正式版把 riskCheck 的結果與訊息一併送 LLM 判斷，回傳同樣結構。
 */

export interface RiskResult {
  level: RiskLevel;
  reasons: string[];
  masked: string;
}

/** 全形→半形、去除零寬字元，擋「０９１２」「ｌｉｎｅ」這類繞過 */
export function normalizeText(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase();
}

/** 首訊去重用：去掉空白、標點、數字差異後的雜湊（Duolicious robot9000 概念） */
export function messageHash(s: string): string {
  const core = normalizeText(s).replace(/[\s\p{P}\p{S}\d]+/gu, "");
  let h = 5381;
  for (let i = 0; i < core.length; i++) h = ((h << 5) + h + core.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const RULES: { name: string; re: RegExp; level: RiskLevel; mask: boolean }[] = [
  { name: "外部連結", re: /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|tw|cc|xyz|top|me|ly|io)(?:\/\S*)?)/gi, level: "low", mask: true },
  { name: "引導加 LINE 私下交易", re: /((加|私)\s*(賴|line)|賴\s*我|\bline\b)\s*(id)?\s*[:：]?\s*@?[a-z0-9._-]*/gi, level: "low", mask: true },
  { name: "手機號碼", re: /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, level: "low", mask: true },
  { name: "銀行帳號", re: /(?<!\d)(?!09\d{8}(?!\d))(?:\(?\d{3}\)?[-\s]?)?\d{10,16}(?!\d)/g, level: "high", mask: true },
  { name: "假客服／帳戶異常話術", re: /(客服|專員).{0,8}(認證|驗證|解除|設定)|帳戶.{0,4}(凍結|異常|鎖定)|解除分期/g, level: "high", mask: false },
  { name: "要求操作 ATM／網銀", re: /(atm|網銀|網路銀行).{0,8}(操作|轉帳|認證)/gi, level: "high", mask: false },
  { name: "保證金／先匯款", re: /(保證金|先匯|先轉帳|訂金.{0,4}匯|簽署.{0,4}金流)/g, level: "high", mask: false },
  { name: "假物流認證連結", re: /(賣貨便|交貨便|物流).{0,10}(認證|簽署|連結|開通)/g, level: "high", mask: false },
];

/** 詐騙帳戶黑名單（雜湊後比對；正式版匯入 165 公開資料到 scam_blocklist 表） */
export function blocklistKey(value: string): string {
  const v = normalizeText(value).replace(/[\s()-]/g, "");
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ":" + v.length;
}

const BLOCKLIST = new Set<string>(["12345678901234", "scamking88", "0911222333"].map(blocklistKey));

/** 掃全文中所有像帳號／ID／電話的片段，不只規則命中的部分 */
function blocklistHits(text: string): string[] {
  const candidates = text.match(/[a-z0-9][a-z0-9._-]{3,}|(?:\d[\s-]?){8,16}/gi) ?? [];
  return candidates.filter((c) => BLOCKLIST.has(blocklistKey(c)));
}

export function riskCheck(input: string): RiskResult {
  const text = normalizeText(input);
  const reasons: string[] = [];
  let level: RiskLevel = "none";
  let masked = input;

  const bump = (l: RiskLevel) => {
    if (l === "high" || (l === "low" && level === "none")) level = l;
  };

  for (const rule of RULES) {
    const hits = text.match(rule.re);
    if (!hits) continue;
    reasons.push(rule.name);
    bump(rule.level);
    if (rule.mask) for (const hit of hits) masked = maskLoose(masked, hit);
  }
  const listed = blocklistHits(text);
  if (listed.length) {
    reasons.push("命中詐騙帳戶黑名單");
    bump("high");
    for (const hit of listed) masked = maskLoose(masked, hit);
  }
  return { level, reasons: Array.from(new Set(reasons)), masked };
}

/** 在原文（可能是全形）中遮蔽對應片段 */
function maskLoose(original: string, normalizedHit: string): string {
  const norm = normalizeText(original);
  const idx = norm.indexOf(normalizedHit);
  if (idx < 0) return original;
  return original.slice(0, idx) + "▇".repeat(Math.min(8, normalizedHit.length)) + original.slice(idx + normalizedHit.length);
}
