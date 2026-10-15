import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeItemSmart, riskCheckSmart, suggestRepliesSmart } from "../lib/ai/smart";
import { extractJSON } from "../lib/ai/muse";

/** 模擬 Muse Spark 的 OpenAI 相容回應 */
function mockMuse(reply: unknown, status = 200) {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    void init;
    return new Response(
      status === 200 ? JSON.stringify({ choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] }) : "error",
      { status },
    );
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const sentBody = (fn: ReturnType<typeof mockMuse>) => JSON.parse(String(fn.mock.calls[0][1].body));

beforeEach(() => {
  process.env.MODEL_API_KEY = "test-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.MODEL_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Muse Spark 串接", () => {
  it("上架：採用 Muse 的辨識，價格仍由本地公式計算，照片以 image_url 送出", async () => {
    const fn = mockMuse({ title: "Nikon FM2 銀", category: "camera", condition: "good", description: "快門正常", defects: ["底蓋小刮痕"], original_price: 15000, confidence: 0.9 });
    const a = await analyzeItemSmart("舊相機", "", "data:image/jpeg;base64,AAAA");
    expect(a.source).toBe("muse");
    expect(a.category).toBe("camera");
    expect(a.description).toContain("底蓋小刮痕");
    expect(a.price.mid).toBe(Math.round((15000 * 0.75 * 0.7) / 100) * 100);
    const body = sentBody(fn);
    expect(body.model).toBe("muse-spark-1.1");
    expect(JSON.stringify(body.messages)).toContain("image_url");
    expect(fn.mock.calls[0][0]).toBe("https://api.meta.ai/v1/chat/completions");
  });

  it("上架：Muse 回傳不合法分類時保留本地判斷", async () => {
    mockMuse({ title: "帳篷", category: "spaceship", condition: "??" });
    const a = await analyzeItemSmart("Snow Peak 帳篷 近全新");
    expect(a.category).toBe("camping");
    expect(a.condition).toBe("like_new");
  });

  it("Muse 失敗（HTTP 500）自動退回本地規則", async () => {
    mockMuse(null, 500);
    const a = await analyzeItemSmart("Nikon FM2 底片相機");
    expect(a.source).toBe("rules");
    const r = await riskCheckSmart("請問週六可以面交嗎？");
    expect(r.source).toBe("rules");
    expect(r.level).toBe("none");
  });

  it("防詐：Muse 可升級風險，且送出前已遮蔽電話", async () => {
    const fn = mockMuse({ level: "high", reasons: ["要求提供簡訊驗證碼"] });
    const r = await riskCheckSmart("把手機收到的六位數驗證碼給我，打 0912-345-678 也行");
    expect(r.level).toBe("high");
    expect(r.reasons.some((x) => x.startsWith("AI："))).toBe(true);
    expect(JSON.stringify(sentBody(fn))).not.toContain("0912-345-678");
  });

  it("防詐：規則已判高風險不呼叫 Muse，Muse 也不能降級", async () => {
    const fn = mockMuse({ level: "none" });
    const high = await riskCheckSmart("請先到賣貨便點連結完成認證");
    expect(high.level).toBe("high");
    expect(fn).not.toHaveBeenCalled();
    const low = await riskCheckSmart("方便的話加賴 abc123 聊細節");
    expect(low.level).toBe("low");
  });

  it("議價：金額超出合理範圍會被丟掉，AI 寫出的聯絡方式會被遮蔽", async () => {
    mockMuse({
      suggestions: [
        { label: "合理出價", text: "6500 可以嗎？", amount: 6500 },
        { label: "亂出價", text: "100 元賣我", amount: 100 },
        { label: "私聊", text: "加賴 seller99 聊", amount: null },
      ],
    });
    const s = await suggestRepliesSmart({ role: "buyer", listingTitle: "FM2", listPrice: 7000, aiLow: 6000, aiHigh: 8000 });
    expect(s[0].amount).toBe(6500);
    expect(s[1].amount).toBeUndefined();
    expect(s[2].text).not.toContain("seller99");
  });

  it("未設定金鑰時完全不呼叫網路", async () => {
    delete process.env.MODEL_API_KEY;
    const fn = mockMuse({});
    await analyzeItemSmart("Nikon FM2");
    await riskCheckSmart("請問還在嗎？可以面交嗎");
    expect(fn).not.toHaveBeenCalled();
  });

  it("extractJSON 容忍 ```json 包裹與前後文字", () => {
    expect(extractJSON<{ a: number }>('好的：\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
