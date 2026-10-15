import { beforeEach, describe, expect, it } from "vitest";
import { riskCheck, messageHash } from "../lib/ai/scam";
import { embed, tasteFit, cosine } from "../lib/ai/embedding";
import { analyzeItem } from "../lib/ai/vision";
import { estimatePrice } from "../lib/ai/pricing";
import { computeTrust } from "../lib/trust";
import type { Profile } from "../lib/types";
import { resetDemoStore, demoRepo } from "../lib/data/demo";
import * as svc from "../lib/services";

describe("防詐規則層", () => {
  it("一般訊息不標記", () => {
    expect(riskCheck("您好，請問週六下午可以在中壢站面交嗎？").level).toBe("none");
  });
  it("LINE 與手機號碼遮蔽為低風險", () => {
    const r = riskCheck("方便的話加賴 abc_123，或打 0912-345-678");
    expect(r.level).toBe("low");
    expect(r.masked).not.toContain("0912-345-678");
    expect(r.reasons).toContain("手機號碼");
  });
  it("全形數字繞過也能抓到", () => {
    expect(riskCheck("電話 ０９１２３４５６７８").reasons).toContain("手機號碼");
  });
  it("假物流認證、銀行帳號為高風險", () => {
    expect(riskCheck("請先到賣貨便點連結完成認證才能下單").level).toBe("high");
    expect(riskCheck("匯到 (822) 12345678901234 就好").level).toBe("high");
  });
  it("零寬字元墊在電話前面，遮蔽位置不會錯開（電話完整遮蔽）", () => {
    const zw = "\u200B\u200B\u200B";
    const r = riskCheck(`${zw}打給我 0912345678 謝謝`);
    expect(r.reasons).toContain("手機號碼");
    expect(r.masked).not.toMatch(/\d{3,}/);
    expect(r.masked).toContain("打給我 ▇");
    expect(r.masked.endsWith(" 謝謝")).toBe(true);
    // 零寬字元夾在數字中間也一樣
    const r2 = riskCheck("電話 0\u200B9\u200C1\u200D2\uFEFF345678");
    expect(r2.masked).not.toMatch(/\d{3,}/);
  });
  it("全形電話遮蔽後不留尾碼，英文保留原大小寫", () => {
    const r = riskCheck("Hello 電話 ０９１２３４５６７８");
    expect(r.masked).not.toMatch(/[0-9０-９]{3,}/);
    expect(r.masked.startsWith("Hello")).toBe(true);
  });
  it("Email 遮蔽為低風險", () => {
    const r = riskCheck("有問題寄信到 Seller.Bob+tw@Example.com 喔");
    expect(r.level).toBe("low");
    expect(r.reasons).toContain("Email");
    expect(r.masked).not.toContain("@");
    expect(r.masked).not.toContain("Seller.Bob");
    expect(r.masked).toContain("有問題寄信到 ▇");
  });
  it("首訊雜湊忽略標點與數字差異", () => {
    expect(messageHash("請問還在嗎？？ 2000 可以嗎")).toBe(messageHash("請問還在嗎 1500可以嗎！"));
  });
});

describe("信任分數", () => {
  const base: Omit<Profile, "positiveRate"> = { id: "x", displayName: "x", areaId: "zhongli", bio: "", interests: [], verificationLevel: 0, joinedAt: new Date().toISOString(), deals: 5, validReports: 0, tasteVec: [] };
  it("尚無評價（positiveRate 0）不扣分", () => {
    const t = computeTrust({ ...base, positiveRate: 0 });
    const item = t.items.find((i) => i.label === "好評率")!;
    expect(item.points).toBe(0);
    expect(item.hint).toBe("尚無評價");
  });
  it("有評價時依好評率加減分", () => {
    expect(computeTrust({ ...base, positiveRate: 1 }).items.find((i) => i.label === "好評率")!.points).toBe(5);
    expect(computeTrust({ ...base, positiveRate: 0.4 }).items.find((i) => i.label === "好評率")!.points).toBe(-10);
  });
});

describe("AI 上架與估價", () => {
  it("從一句描述辨識分類與成色，並依原價估價", () => {
    const a = analyzeItem("Nikon FM2 底片相機，快門正常，原價 15000");
    expect(a.category).toBe("camera");
    expect(a.price.low).toBeLessThan(a.price.high);
    expect(a.price.mid).toBeLessThan(15000);
  });
  it("「近全新」不會被誤判成「全新」", () => {
    expect(analyzeItem("Snow Peak 天幕 近全新").condition).toBe("like_new");
  });
  it("成色越差估價越低", () => {
    expect(estimatePrice("camping", "worn").mid).toBeLessThan(estimatePrice("camping", "like_new").mid);
  });
});

describe("品味向量", () => {
  it("相似描述的契合度較高", () => {
    const user = embed("底片相機 露營 旅行");
    expect(tasteFit(user, embed("Nikon 底片相機 銀色"))).toBeGreaterThan(tasteFit(user, embed("鋼彈 模型 素組")));
    expect(cosine(user, user)).toBeCloseTo(1, 5);
  });
});

describe("交易流程（demo repo）", () => {
  beforeEach(() => resetDemoStore());

  it("出價 → 接受 → 聊天 → 成交，並更新成交數與保留狀態", async () => {
    const buyer = (await demoRepo.getProfile("u_an"))!;
    const seller = (await demoRepo.getProfile("u_zhe"))!;
    const offer = await svc.createOffer(buyer, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    expect(offer.ok).toBe(true);
    const offerId = offer.ok ? offer.data!.id : "";

    const accepted = await svc.respondOffer(seller, offerId, true);
    expect(accepted.ok).toBe(true);
    const convId = accepted.ok ? accepted.data!.conversationId! : "";
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("reserved");

    const msg = await svc.sendMessage(buyer, convId, "加賴 scamking88 比較快");
    expect(msg.ok && msg.data!.risk).toBe("high"); // 命中黑名單

    expect((await svc.completeDeal(seller, convId)).ok).toBe(true);
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("sold");
    expect((await demoRepo.getProfile("u_zhe"))!.deals).toBe(seller.deals + 1);
  });

  it("同一句開場白群發多位賣家會被擋", async () => {
    const buyer = (await demoRepo.getProfile("u_an"))!;
    const text = "您好請問這個還有嗎？可以算便宜一點嗎？";
    expect((await svc.createOffer(buyer, "l_tent", 100, text)).ok).toBe(true);
    expect((await svc.createOffer(buyer, "l_airpods", 100, text)).ok).toBe(true);
    const third = await svc.createOffer(buyer, "l_books", 100, text);
    expect(third.ok).toBe(false);
  });

  it("封鎖後看不到對方物品、也不能出價", async () => {
    const me = (await demoRepo.getProfile("u_an"))!;
    await svc.toggleBlock(me, "u_mia");
    const items = await svc.explore(me, { mode: "likely" });
    expect(items.some((l) => l.sellerId === "u_mia")).toBe(false);
    expect((await svc.createOffer(me, "l_tent", 10000, "想買")).ok).toBe(false);
  });

  it("上架與出價的輸入驗證", async () => {
    const me = (await demoRepo.getProfile("u_an"))!;
    const ok = { title: "Nikon FM2", description: "快門正常", category: "camera", condition: "good", price: 5000 } as const;
    expect((await svc.createListing(me, { ...ok })).ok).toBe(true);
    const bad = [
      { ...ok, category: "__proto__" },
      { ...ok, category: "toString" },
      { ...ok, condition: "constructor" },
      { ...ok, title: "x".repeat(61) },
      { ...ok, description: "y".repeat(2001) },
      { ...ok, price: 0 },
      { ...ok, price: 1.5 },
      { ...ok, price: 10_000_001 },
      { ...ok, price: Number.NaN },
    ];
    for (const b of bad) expect((await svc.createListing(me, b as never)).ok).toBe(false);

    expect((await svc.createOffer(me, "l_tent", 1.5, "想買")).ok).toBe(false);
    expect((await svc.createOffer(me, "l_tent", 20_000_000, "想買")).ok).toBe(false);
    expect((await svc.createOffer(me, "l_tent", 100, "x".repeat(501))).ok).toBe(false);
  });

  it("檢舉理由必須是固定選項；聊天訊息長度上限", async () => {
    const an = (await demoRepo.getProfile("u_an"))!;
    expect((await svc.report(an, "u_ken", "<script>自訂理由</script>")).ok).toBe(false);
    expect((await svc.report(an, "u_ken", "疑似詐騙")).ok).toBe(true);

    const zhe = (await demoRepo.getProfile("u_zhe"))!;
    const o = await svc.createOffer(an, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    const acc = await svc.respondOffer(zhe, o.ok ? o.data!.id : "", true);
    const convId = acc.ok ? acc.data!.conversationId! : "";
    expect((await svc.sendMessage(an, convId, "z".repeat(1001))).ok).toBe(false);
    expect((await svc.sendMessage(an, convId, "z".repeat(1000))).ok).toBe(true);
  });

  it("同一件物品的第二筆出價在第一筆被接受後無法再接受", async () => {
    const an = (await demoRepo.getProfile("u_an"))!;
    const mia = (await demoRepo.getProfile("u_mia"))!;
    const zhe = (await demoRepo.getProfile("u_zhe"))!;
    const o1 = await svc.createOffer(an, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    const o2 = await svc.createOffer(mia, "l_fm2", 9500, "FM2 我也想要，9500 可以嗎");
    expect((await svc.respondOffer(zhe, o1.ok ? o1.data!.id : "", true)).ok).toBe(true);
    const second = await svc.respondOffer(zhe, o2.ok ? o2.data!.id : "", true);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toBe("物品已保留或售出");
  });

  it("瀏覽數原子 +1；個資匯出含已售出物品", async () => {
    const before = (await demoRepo.getListing("l_fm2"))!.views;
    await svc.viewListing("l_fm2");
    expect((await demoRepo.getListing("l_fm2"))!.views).toBe(before + 1);

    const an = (await demoRepo.getProfile("u_an"))!;
    const zhe = (await demoRepo.getProfile("u_zhe"))!;
    const o = await svc.createOffer(an, "l_fm2", 9000, "FM2 想收來拍底片，9000 可以嗎？");
    const acc = await svc.respondOffer(zhe, o.ok ? o.data!.id : "", true);
    expect((await svc.completeDeal(zhe, acc.ok ? acc.data!.conversationId! : "")).ok).toBe(true);
    const exp = await svc.exportUserData("u_zhe");
    expect(exp.listings.some((l) => l.id === "l_fm2" && l.status === "sold")).toBe(true);
  });

  it("新帳號的檢舉不直接扣分", async () => {
    const newbie = (await demoRepo.getProfile("u_new"))!;
    const before = computeTrust((await demoRepo.getProfile("u_ken"))!).total;
    await svc.report(newbie, "u_ken", "疑似詐騙");
    expect(computeTrust((await demoRepo.getProfile("u_ken"))!).total).toBe(before);
  });
});
