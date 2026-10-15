import type { Profile } from "./types";

export interface TrustBreakdown {
  total: number;
  items: { label: string; points: number; hint: string }[];
  tier: "新手" | "可信" | "高信任";
  dailyChatLimit: number;
}

const DAY = 86_400_000;

export function accountAgeDays(p: Profile, now = Date.now()): number {
  return Math.floor((now - Date.parse(p.joinedAt)) / DAY);
}

/** 只採計「可信帳戶」的檢舉（Duolicious 做法），防同業惡意檢舉 */
export function isTrustworthyReporter(p: Profile, now = Date.now()): boolean {
  return accountAgeDays(p, now) >= 30 && p.deals >= 1;
}

export function computeTrust(p: Profile, now = Date.now()): TrustBreakdown {
  const items = [
    { label: "基本分", points: 20, hint: "每個帳號起始" },
    { label: "手機驗證", points: p.verificationLevel >= 1 ? 15 : 0, hint: "完成簡訊驗證 +15" },
    { label: "自拍驗證碼", points: p.verificationLevel >= 2 ? 20 : 0, hint: "手持驗證碼自拍（AI 活體檢查）+20" },
    { label: "成交紀錄", points: Math.min(30, p.deals * 2), hint: "每筆雙方確認成交 +2，上限 30" },
    { label: "好評率", points: p.deals > 0 ? Math.round((p.positiveRate - 0.8) * 25) : 0, hint: "好評率 80% 以上加分、以下扣分" },
    { label: "帳齡", points: accountAgeDays(p, now) >= 30 ? 10 : 0, hint: "滿 30 天 +10" },
    { label: "有效檢舉", points: -15 * p.validReports, hint: "每筆有效檢舉 −15" },
  ];
  const total = Math.max(0, Math.min(100, items.reduce((s, i) => s + i.points, 0)));
  const tier = total >= 70 ? "高信任" : total >= 45 ? "可信" : "新手";
  return { total, items, tier, dailyChatLimit: tier === "高信任" ? 80 : tier === "可信" ? 30 : 10 };
}
