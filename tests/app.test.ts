import { describe, expect, it } from "vitest";
import { safeNextPath } from "../lib/safe-redirect";
import { rateLimit, checkLimit, resetRateLimits, LIMITS } from "../lib/ratelimit";
import { REPORT_REASONS, isArea, isCategory, isCondition, isReportReason, isValidAmount } from "../lib/validation";
import { displayRiskReasons } from "../lib/ai/risk-labels";

const ORIGIN = "https://power-friend.example";

describe("登入回呼 next 白名單（H1）", () => {
  it("接受白名單站內路徑", () => {
    for (const p of ["/", "/onboarding", "/sell", "/inbox", "/me", "/listing/l_fm2", "/chat/c_abc-123"]) expect(safeNextPath(p, ORIGIN)).toBe(p);
  });
  it("拒絕 open redirect 變形，退回 /onboarding", () => {
    const evil = [
      "//evil.com",
      "/\\evil.com",
      "/\\t/evil.com",
      "/\t/evil.com",
      "/%2F%2Fevil.com",
      "/%5Cevil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/listing/../../evil",
      "/listing/a/b",
      "/chat/<script>",
      "/me?x=//evil.com",
      "/admin",
      "",
      null,
      undefined,
      "/listing/" + "a".repeat(300),
    ];
    for (const e of evil) expect(safeNextPath(e as string, ORIGIN)).toBe("/onboarding");
  });
});

describe("限流（L8）", () => {
  it("sliding window：上限內允許、超過拒絕、視窗過後恢復", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("u1", "x", 3, 1000, t0 + i)).toBe(true);
    expect(rateLimit("u1", "x", 3, 1000, t0 + 10)).toBe(false);
    expect(rateLimit("u2", "x", 3, 1000, t0 + 10)).toBe(true); // 不同使用者分開計
    expect(rateLimit("u1", "y", 3, 1000, t0 + 10)).toBe(true); // 不同動作分開計
    expect(rateLimit("u1", "x", 3, 1000, t0 + 1001)).toBe(true); // 第一筆滑出視窗
  });
  it("analyze 每小時 20 次", () => {
    resetRateLimits();
    const now = Date.now();
    for (let i = 0; i < LIMITS.analyze.limit; i++) expect(checkLimit("u1", "analyze", now)).toBe(true);
    expect(checkLimit("u1", "analyze", now)).toBe(false);
    expect(LIMITS.suggest.limit).toBe(60);
    expect(LIMITS.museRisk.limit).toBe(200);
  });
});

describe("輸入驗證（L4）", () => {
  it("用 Object.hasOwn，不吃原型鏈上的 key", () => {
    for (const k of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      expect(isCategory(k)).toBe(false);
      expect(isCondition(k)).toBe(false);
      expect(isArea(k)).toBe(false);
    }
    expect(isCategory("camera")).toBe(true);
    expect(isCondition("like_new")).toBe(true);
    expect(isArea("zhongli")).toBe(true);
  });
  it("金額必須是 1..10,000,000 的整數", () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(10_000_000)).toBe(true);
    for (const n of [0, -1, 1.5, 10_000_001, Number.NaN, Infinity, "100"]) expect(isValidAmount(n)).toBe(false);
  });
  it("檢舉理由固定清單", () => {
    expect(REPORT_REASONS.every(isReportReason)).toBe(true);
    expect(isReportReason("自訂理由")).toBe(false);
  });
});

describe("風險理由顯示白名單（M1 縱深防禦）", () => {
  it("只顯示固定標籤，其他文字一律濾掉", () => {
    expect(displayRiskReasons(["手機號碼", "AI：要求先匯款"])).toEqual(["手機號碼", "AI：要求先匯款"]);
    expect(displayRiskReasons(["AI：請到 evil.example 解除分期"])).toEqual(["可疑內容"]);
    expect(displayRiskReasons(undefined)).toEqual(["可疑內容"]);
  });
});
