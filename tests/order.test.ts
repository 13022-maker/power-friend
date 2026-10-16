import { beforeEach, describe, expect, it } from "vitest";
import { demoRepo, resetDemoStore } from "../lib/data/demo";
import * as svc from "../lib/services";
import {
  PREPAY_WARNING,
  deriveStatus,
  isValidTrackingNo,
  listingAvailable,
  normalizeShippingInfo,
  offerTotal,
  quoteTotal,
  validatePaymentMethods,
} from "../lib/payment";
import type { Conversation, Message, Offer, Profile } from "../lib/types";
import { POST as mcp } from "../app/api/mcp/route";

const P = (id: string) => demoRepo.getProfile(id) as Promise<Profile>;
const SHIP = { method: "cvs_pickup", recipientName: "王小明", phone: "0912-345-678", storeOrAddress: "7-11 中壢站前門市" } as const;

/** 出價 → 接受，回傳 offerId 與 conversationId */
async function order(buyerId: string, listingId: string, opts: svc.OfferOptions = {}, amount = 1000, text?: string) {
  const buyer = await P(buyerId);
  const l = (await demoRepo.getListing(listingId))!;
  const o = await svc.createOffer(buyer, listingId, amount, text ?? `想買 ${l.title}，${buyerId} 誠意收`, false, opts);
  if (!o.ok) throw new Error(o.error);
  const acc = await svc.respondOffer(await P(l.sellerId), o.data!.id, true);
  if (!acc.ok) throw new Error(acc.error);
  return { offerId: o.data!.id, convId: acc.data!.conversationId!, sellerId: l.sellerId };
}

describe("數量推導（純函式）", () => {
  const L = (quantity: number, reservedQty: number, soldQty: number) => ({ quantity, reservedQty, soldQty });
  it("listingAvailable", () => {
    expect(listingAvailable(L(5, 0, 0))).toBe(5);
    expect(listingAvailable(L(5, 2, 1))).toBe(2);
    expect(listingAvailable(L(1, 1, 0))).toBe(0);
    expect(listingAvailable(L(1, 1, 1))).toBe(0); // 不會是負數
  });
  it("deriveStatus", () => {
    expect(deriveStatus(L(1, 0, 0))).toBe("active");
    expect(deriveStatus(L(3, 2, 0))).toBe("active");
    expect(deriveStatus(L(3, 1, 2))).toBe("reserved");
    expect(deriveStatus(L(3, 3, 0))).toBe("reserved");
    expect(deriveStatus(L(3, 0, 3))).toBe("sold");
    expect(deriveStatus(L(1, 1, 0))).toBe("reserved");
  });
  it("quoteTotal（試算）：貨到付款才加運費；offerTotal 讀出價上的運費快照", () => {
    expect(quoteTotal({ amount: 300, quantity: 3, paymentMethod: "cod" }, { shippingFee: 60 })).toBe(960);
    expect(quoteTotal({ amount: 300, quantity: 3, paymentMethod: "meetup_cash" }, { shippingFee: 60 })).toBe(900);
    expect(quoteTotal({ amount: 300, quantity: 1, paymentMethod: "cod" }, { shippingFee: 0 })).toBe(300);
    expect(offerTotal({ amount: 300, quantity: 3, shippingFee: 60 })).toBe(960);
  });
  it("收件資訊與物流單號驗證", () => {
    const ok = normalizeShippingInfo(SHIP);
    expect(ok.ok && ok.data.phone).toBe("0912345678");
    expect(normalizeShippingInfo({ ...SHIP, phone: "0212345678" }).ok).toBe(false);
    expect(normalizeShippingInfo({ ...SHIP, recipientName: "" }).ok).toBe(false);
    expect(normalizeShippingInfo({ ...SHIP, recipientName: "王".repeat(21) }).ok).toBe(false);
    expect(normalizeShippingInfo({ ...SHIP, storeOrAddress: "x" }).ok).toBe(false);
    expect(normalizeShippingInfo({ ...SHIP, storeOrAddress: "x".repeat(101) }).ok).toBe(false);
    expect(normalizeShippingInfo({ ...SHIP, method: "drone" as never }).ok).toBe(false);
    expect(isValidTrackingNo("TW-12345678")).toBe(true);
    expect(isValidTrackingNo("A".repeat(41))).toBe(false);
    expect(isValidTrackingNo("12 34")).toBe(false);
    expect(isValidTrackingNo("<x>")).toBe(false);
  });
});

describe("上架：數量與付款方式", () => {
  beforeEach(() => resetDemoStore());
  const base = { title: "露營椅 兩張", description: "九成新", category: "camping", condition: "good", price: 800 } as const;

  it("預設數量 1、面交付款；含 cod 時保存運費，不含時運費為 0", async () => {
    const an = await P("u_an");
    const a = await svc.createListing(an, { ...base });
    const la = (await demoRepo.getListing(a.ok ? a.data!.id : ""))!;
    expect([la.quantity, la.reservedQty, la.soldQty, la.status]).toEqual([1, 0, 0, "active"]);
    expect(la.paymentMethods).toEqual(["meetup_cash"]);

    const b = await svc.createListing(an, { ...base, quantity: 2, paymentMethods: ["meetup_cash", "cod"], shippingFee: 65 });
    expect((await demoRepo.getListing(b.ok ? b.data!.id : ""))!.shippingFee).toBe(65);
    const c = await svc.createListing(an, { ...base, paymentMethods: ["meetup_cash"], shippingFee: 65 });
    expect((await demoRepo.getListing(c.ok ? c.data!.id : ""))!.shippingFee).toBe(0);
  });

  it("數量、付款方式、運費的輸入驗證", async () => {
    const an = await P("u_an");
    const bad = [
      { quantity: 0 },
      { quantity: 1000 },
      { quantity: 1.5 },
      { paymentMethods: [] },
      { paymentMethods: ["cash"] },
      { paymentMethods: ["cod", "cod"] },
      { paymentMethods: "cod" },
      { paymentMethods: ["cod"], shippingFee: -1 },
      { paymentMethods: ["cod"], shippingFee: 1001 },
      { paymentMethods: ["cod"], shippingFee: 10.5 },
    ];
    for (const b of bad) expect((await svc.createListing(an, { ...base, ...b } as never)).ok, JSON.stringify(b)).toBe(false);
    expect((await svc.createListing(an, { ...base, quantity: 999, paymentMethods: ["cod"], shippingFee: 1000 })).ok).toBe(true);
  });

  it("先付款類（匯款／行動支付）僅限已驗證賣家", async () => {
    const newbie = await P("u_new"); // verificationLevel 0
    const ken = await P("u_ken"); // verificationLevel 1
    for (const m of ["bank_transfer", "mobile_pay"] as const) {
      const r = await svc.createListing(newbie, { ...base, paymentMethods: ["meetup_cash", m] });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("先付款");
      expect((await svc.createListing(ken, { ...base, paymentMethods: [m] })).ok).toBe(true);
    }
    expect((await svc.createListing(newbie, { ...base, paymentMethods: ["meetup_cash", "cod"] })).ok).toBe(true);
    // 不給賣家時只檢查格式（action 層預檢用）
    expect(validatePaymentMethods(["bank_transfer"])).toBeNull();
    expect(validatePaymentMethods(["bank_transfer"], 0)).not.toBeNull();
  });
});

describe("出價：數量與付款方式", () => {
  beforeEach(() => resetDemoStore());

  it("數量須在 1..可售數量；付款方式須在物品允許清單；預設為第一種", async () => {
    const zhe = await P("u_zhe");
    // l_film：u_an、5 件、meetup_cash/cod/bank_transfer
    expect((await svc.createOffer(zhe, "l_film", 250, "想買底片", false, { quantity: 6 })).ok).toBe(false);
    expect((await svc.createOffer(zhe, "l_film", 250, "想買底片", false, { quantity: 0 })).ok).toBe(false);
    expect((await svc.createOffer(zhe, "l_film", 250, "想買底片", false, { paymentMethod: "mobile_pay" })).ok).toBe(false);
    expect((await svc.createOffer(zhe, "l_film", 250, "想買底片", false, { paymentMethod: "bogus" as never })).ok).toBe(false);
    const ok = await svc.createOffer(zhe, "l_film", 250, "想買底片", false, { quantity: 5 });
    expect(ok.ok).toBe(true);
    const o = (await demoRepo.getOffer(ok.ok ? ok.data!.id : ""))!;
    expect([o.quantity, o.paymentMethod]).toEqual([5, "meetup_cash"]);
    expect(ok.ok && ok.data!.total).toBe(1250);
  });

  it("先付款類出價附上固定提醒；貨到付款總額含運費", async () => {
    const zhe = await P("u_zhe");
    const r = await svc.createOffer(zhe, "l_film", 250, "想買底片兩捲", false, { quantity: 2, paymentMethod: "bank_transfer" });
    expect(r.ok && r.notice).toContain(PREPAY_WARNING);
    const an = await P("u_an");
    const c = await svc.createOffer(an, "l_figure", 2400, "公仔想收兩盒", false, { quantity: 2, paymentMethod: "cod" });
    expect(c.ok && c.data!.total).toBe(2400 * 2 + 60);
    expect(c.ok && (c.notice ?? "")).not.toContain(PREPAY_WARNING);
  });

  it("可售數量為 0 時不能出價", async () => {
    await order("u_zhe", "l_film", { quantity: 5 });
    const r = await svc.createOffer(await P("u_mia"), "l_film", 250, "還有底片嗎");
    expect(r.ok).toBe(false);
  });
});

describe("接受：以數量保留、不超賣", () => {
  beforeEach(() => resetDemoStore());

  it("多件物品可分批接受，數量用完後狀態 reserved，第三筆回「剩餘數量不足」", async () => {
    // l_figure：u_zhe、3 件
    const a = await order("u_an", "l_figure", { quantity: 2 });
    let l = (await demoRepo.getListing("l_figure"))!;
    expect([l.reservedQty, listingAvailable(l), l.status]).toEqual([2, 1, "active"]);

    const mia = await P("u_mia");
    const ken = await P("u_ken");
    const o1 = await svc.createOffer(mia, "l_figure", 2500, "一盒公仔，謝謝", false, { quantity: 1 });
    const o2 = await svc.createOffer(ken, "l_figure", 2500, "我也要一盒公仔", false, { quantity: 1 });
    const zhe = await P("u_zhe");
    expect((await svc.respondOffer(zhe, o1.ok ? o1.data!.id : "", true)).ok).toBe(true);
    l = (await demoRepo.getListing("l_figure"))!;
    expect([l.reservedQty, l.status]).toEqual([3, "reserved"]);
    const third = await svc.respondOffer(zhe, o2.ok ? o2.data!.id : "", true);
    expect(third.ok).toBe(false);
    expect(!third.ok && third.error).toBe("剩餘數量不足");
    expect((await demoRepo.getOffer(o2.ok ? o2.data!.id : ""))!.status).toBe("pending");
    void a;
  });

  it("demo repo 並行接受：可售 3 件，同時接受 2+2 只有一筆成功", async () => {
    const mk = (id: string, buyerId: string, q: number): Offer => ({
      id, listingId: "l_figure", buyerId, sellerId: "u_zhe", amount: 2500, message: "hi", messageHash: id, aiDrafted: false,
      status: "pending", createdAt: new Date().toISOString(), quantity: q, paymentMethod: "meetup_cash", shippingFee: 0,
    });
    const conv = (id: string, o: Offer): Conversation => ({ id, offerId: o.id, listingId: o.listingId, buyerId: o.buyerId, sellerId: o.sellerId, createdAt: o.createdAt });
    const msg = (id: string, c: string): Message => ({ id, conversationId: c, senderId: "u_an", body: "hi", aiDrafted: false, risk: "none", riskReasons: [], createdAt: new Date().toISOString() });
    const offers = [mk("o_p1", "u_an", 2), mk("o_p2", "u_mia", 2), mk("o_p3", "u_ken", 2)];
    for (const o of offers) await demoRepo.createOffer(o);
    const results = await Promise.all(offers.map((o, i) => demoRepo.acceptOffer(o.id, "u_zhe", conv(`c_p${i}`, o), msg(`m_p${i}`, `c_p${i}`))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const l = (await demoRepo.getListing("l_figure"))!;
    expect(l.reservedQty).toBe(2);
    expect(l.reservedQty + l.soldQty).toBeLessThanOrEqual(l.quantity);
  });

  it("婉拒只能處理 pending，且只限賣家", async () => {
    const o = await svc.createOffer(await P("u_an"), "l_fm2", 9000, "FM2 想收，9000 可以嗎");
    const id = o.ok ? o.data!.id : "";
    expect((await svc.respondOffer(await P("u_mia"), id, false)).ok).toBe(false);
    expect((await svc.respondOffer(await P("u_zhe"), id, false)).ok).toBe(true);
    expect((await svc.respondOffer(await P("u_zhe"), id, true)).ok).toBe(false);
    expect((await demoRepo.getOffer(id))!.status).toBe("declined");
  });
});

describe("成交與取消", () => {
  beforeEach(() => resetDemoStore());

  it("部分成交：保留轉為成交，其餘仍可售；全部成交後 sold", async () => {
    const a = await order("u_zhe", "l_film", { quantity: 3 });
    const an = await P("u_an");
    expect((await svc.completeDeal(an, a.convId)).ok).toBe(true);
    let l = (await demoRepo.getListing("l_film"))!;
    expect([l.reservedQty, l.soldQty, l.status]).toEqual([0, 3, "active"]);
    expect((await demoRepo.getOffer(a.offerId))!.status).toBe("completed");
    // 重複標記失敗
    const again = await svc.completeDeal(an, a.convId);
    expect(!again.ok && again.error).toBe("已標記成交");

    const b = await order("u_mia", "l_film", { quantity: 2 });
    expect((await svc.completeDeal(an, b.convId)).ok).toBe(true);
    l = (await demoRepo.getListing("l_film"))!;
    expect([l.reservedQty, l.soldQty, l.status]).toEqual([0, 5, "sold"]);
    expect((await demoRepo.listListings()).some((x) => x.id === "l_film")).toBe(false);
  });

  it("同一對買賣雙方在同一物品成交兩次，成交數只加一次", async () => {
    const an0 = (await P("u_an")).deals;
    const zhe0 = (await P("u_zhe")).deals;
    const a = await order("u_zhe", "l_film", { quantity: 1 }, 250, "底片一捲");
    await svc.completeDeal(await P("u_an"), a.convId);
    const b = await order("u_zhe", "l_film", { quantity: 1 }, 250, "再一捲底片");
    await svc.completeDeal(await P("u_an"), b.convId);
    expect((await P("u_an")).deals).toBe(an0 + 1);
    expect((await P("u_zhe")).deals).toBe(zhe0 + 1);
  });

  it("買賣雙方都能取消已接受的訂單，數量釋出、寫系統訊息；第三人不行；已成交不能取消", async () => {
    const a = await order("u_an", "l_figure", { quantity: 3 });
    expect((await demoRepo.getListing("l_figure"))!.status).toBe("reserved");
    expect((await svc.cancelOrder(await P("u_mia"), a.convId)).ok).toBe(false);
    expect((await svc.cancelOrder(await P("u_an"), a.convId)).ok).toBe(true);
    const l = (await demoRepo.getListing("l_figure"))!;
    expect([l.reservedQty, l.status]).toEqual([0, "active"]);
    expect((await demoRepo.getOffer(a.offerId))!.status).toBe("cancelled");
    expect((await demoRepo.listMessages(a.convId)).some((m) => m.senderId === "system" && m.body === "買方已取消訂單，數量已釋出")).toBe(true);
    expect((await svc.cancelOrder(await P("u_zhe"), a.convId)).ok).toBe(false); // 已取消
    expect((await svc.completeDeal(await P("u_zhe"), a.convId)).ok).toBe(false);

    const b = await order("u_mia", "l_figure", { quantity: 1 });
    expect((await svc.cancelOrder(await P("u_zhe"), b.convId)).ok).toBe(true);
    expect((await demoRepo.listMessages(b.convId)).some((m) => m.body === "賣方已取消訂單，數量已釋出")).toBe(true);

    const c = await order("u_ken", "l_figure", { quantity: 1 });
    await svc.completeDeal(await P("u_zhe"), c.convId);
    expect((await svc.cancelOrder(await P("u_ken"), c.convId)).ok).toBe(false);
  });
});

describe("貨到付款流程", () => {
  beforeEach(() => resetDemoStore());

  it("填收件資訊 → 寄出 → 成交；成交後收件資訊清除", async () => {
    // l_jacket：u_mia、1 件、meetup_cash/cod、運費 60
    const a = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "古著外套想收，貨到付款可以嗎");
    const an = await P("u_an");
    const mia = await P("u_mia");

    // 未填資訊不能寄出；未寄出不能成交
    expect((await svc.markShipped(mia, a.convId)).ok).toBe(false);
    const early = await svc.completeDeal(mia, a.convId);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.error).toContain("寄出");

    let sum = await svc.getOrderSummary(an, a.convId);
    expect(sum.ok && sum.data!.myActions).toEqual(["set_shipping_info", "cancel_order"]);
    expect(sum.ok && sum.data!.total).toBe(3560);
    expect(sum.ok && sum.data!.cod).toEqual({ hasShippingInfo: false, shipped: false, shippedAt: undefined, trackingNo: undefined });

    expect((await svc.setShippingInfo(an, a.convId, SHIP)).ok).toBe(true);
    expect((await svc.setShippingInfo(an, a.convId, { ...SHIP, storeOrAddress: "全家 中壢新興門市" })).ok).toBe(true); // 可重填
    const seen = await svc.getShippingInfo(mia, a.convId);
    expect(seen.ok && seen.data).toEqual({ offerId: a.offerId, method: "cvs_pickup", recipientName: "王小明", phone: "0912345678", storeOrAddress: "全家 中壢新興門市" });
    // 系統訊息不含個資
    const msgs = await demoRepo.listMessages(a.convId);
    expect(msgs.some((m) => m.body.includes("0912345678") || m.body.includes("王小明"))).toBe(false);

    sum = await svc.getOrderSummary(mia, a.convId);
    expect(sum.ok && sum.data!.myActions).toEqual(["mark_shipped", "cancel_order"]);

    expect((await svc.markShipped(mia, a.convId, "bad no!")).ok).toBe(false);
    expect((await svc.markShipped(mia, a.convId, "TW-123456")).ok).toBe(true);
    expect((await svc.markShipped(mia, a.convId)).ok).toBe(false); // 已寄出
    const o = (await demoRepo.getOffer(a.offerId))!;
    expect(o.shippedAt).toBeTruthy();
    expect(o.trackingNo).toBe("TW-123456");
    // 寄出後買家不能改資訊、不能取消
    expect((await svc.setShippingInfo(an, a.convId, SHIP)).ok).toBe(false);
    expect((await svc.cancelOrder(an, a.convId)).ok).toBe(false);

    sum = await svc.getOrderSummary(an, a.convId);
    expect(sum.ok && sum.data!.actions).toEqual({ buyer: [], seller: ["complete_deal", "cancel_order"] });

    expect((await svc.completeDeal(mia, a.convId)).ok).toBe(true);
    expect((await demoRepo.getListing("l_jacket"))!.status).toBe("sold");
    const after = await svc.getShippingInfo(an, a.convId);
    expect(after.ok && after.data).toBeNull();
    sum = await svc.getOrderSummary(an, a.convId);
    expect(sum.ok && [sum.data!.status, sum.data!.myActions.length]).toEqual(["completed", 0]);
  });

  it("收件資訊權限：賣家與第三人不能寫；第三人不能讀；非 cod 訂單不能填", async () => {
    const a = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "古著外套想收，貨到付款");
    const mia = await P("u_mia");
    const ken = await P("u_ken");
    const sw = await svc.setShippingInfo(mia, a.convId, SHIP);
    expect(!sw.ok && sw.error).toBe("只有買家可以填寫收件資訊");
    expect((await svc.setShippingInfo(ken, a.convId, SHIP)).ok).toBe(false);
    expect((await svc.setShippingInfo(await P("u_an"), a.convId, SHIP)).ok).toBe(true);
    expect((await svc.getShippingInfo(ken, a.convId)).ok).toBe(false);
    expect(await demoRepo.getShippingInfo(a.convId, "u_ken")).toBeNull();
    expect((await svc.getOrderSummary(ken, a.convId)).ok).toBe(false);
    // repo 層也擋：賣家直接呼叫 setShippingInfo
    const { offerId: _o, ...raw } = { offerId: "", ...SHIP, phone: "0912345678" };
    void _o;
    expect(await demoRepo.setShippingInfo(a.convId, "u_mia", raw)).toBe(false);
    // 驗證錯誤
    expect((await svc.setShippingInfo(await P("u_an"), a.convId, { ...SHIP, phone: "12345" })).ok).toBe(false);

    const b = await order("u_zhe", "l_film", { quantity: 1 }, 250, "底片一捲面交");
    expect((await svc.setShippingInfo(await P("u_zhe"), b.convId, SHIP)).ok).toBe(false);
  });

  it("取消訂單會清除收件資訊；已寄出只有賣家可取消", async () => {
    const a = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "外套貨到付款");
    const an = await P("u_an");
    const mia = await P("u_mia");
    await svc.setShippingInfo(an, a.convId, SHIP);
    await svc.markShipped(mia, a.convId);
    expect((await svc.cancelOrder(an, a.convId)).ok).toBe(false);
    expect((await svc.cancelOrder(mia, a.convId)).ok).toBe(true); // 買家拒收由賣家處理
    expect(await demoRepo.getShippingInfo(a.convId, "u_an")).toBeNull();
    expect((await demoRepo.getListing("l_jacket"))!.status).toBe("active");
  });

  it("個資匯出：含本人作為買家的收件資訊，不含別人的", async () => {
    const a = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "外套貨到付款");
    await svc.setShippingInfo(await P("u_an"), a.convId, SHIP);
    const mine = await svc.exportUserData("u_an");
    expect(mine.shippingInfo).toHaveLength(1);
    expect(mine.shippingInfo[0].phone).toBe("0912345678");
    const seller = await svc.exportUserData("u_mia");
    expect(seller.shippingInfo).toHaveLength(0);
  });
});

describe("刪除帳號釋出數量", () => {
  beforeEach(() => resetDemoStore());

  it("買家刪帳號：其已接受訂單（含已寄出的 cod）釋出數量，收件資訊刪除", async () => {
    const a = await order("u_an", "l_figure", { quantity: 2, paymentMethod: "cod" }, 2500, "公仔兩盒貨到付款");
    const b = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "外套貨到付款");
    const c = await order("u_ken", "l_figure", { quantity: 1 }, 2500, "公仔一盒面交");
    const an = await P("u_an");
    await svc.setShippingInfo(an, a.convId, SHIP);
    await svc.setShippingInfo(an, b.convId, SHIP);
    await svc.markShipped(await P("u_mia"), b.convId);

    const res = await svc.deleteAccount(an);
    expect(res.ok && res.data!.released).toBe(2);
    const fig = (await demoRepo.getListing("l_figure"))!;
    expect([fig.reservedQty, fig.status]).toEqual([1, "active"]); // 只剩 u_ken 的 1 件保留
    expect((await demoRepo.getListing("l_jacket"))!.status).toBe("active");
    expect(await demoRepo.getShippingInfo(a.convId, "u_zhe")).toBeNull();
    expect((await demoRepo.getOffer(c.offerId))!.status).toBe("accepted");
  });
});

describe("MCP make_offer／get_listing", () => {
  beforeEach(() => resetDemoStore());
  const call = (name: string, args: Record<string, unknown>, who = "u_zhe") =>
    mcp(
      new Request("http://x/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-for": who },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
    ).then((r) => r.json());
  const payload = (j: { result?: { content: { text: string }[] } }) => JSON.parse(j.result!.content[0].text);

  it("get_listing 回傳 available、paymentMethods、shippingFee", async () => {
    const j = await call("get_listing", { id: "l_figure" });
    const p = payload(j);
    expect(p.available).toBe(3);
    expect(p.payment_methods).toEqual(["meetup_cash", "cod", "mobile_pay"]);
    expect(p.shipping_fee).toBe(60);
    expect(JSON.stringify(p)).not.toMatch(/recipient|phone|storeOrAddress/);
  });

  it("make_offer：quantity 預設 1、payment_method 預設物品第一種；可指定；無效值被拒", async () => {
    const d = payload(await call("make_offer", { listing_id: "l_film", amount: 250, message: "agent 幫我問底片" }));
    const od = (await demoRepo.getOffer(d.offer_id))!;
    expect([od.quantity, od.paymentMethod, od.aiDrafted]).toEqual([1, "meetup_cash", true]);

    const e = await call("make_offer", { listing_id: "l_figure", amount: 2400, message: "agent 代問公仔兩盒", quantity: 2, payment_method: "cod" }, "u_an");
    const pe = payload(e);
    expect(pe.total).toBe(2400 * 2 + 60);
    const oe = (await demoRepo.getOffer(pe.offer_id))!;
    expect([oe.quantity, oe.paymentMethod]).toEqual([2, "cod"]);

    expect((await call("make_offer", { listing_id: "l_figure", amount: 2400, message: "x", payment_method: "bitcoin" }, "u_ken")).error).toBeTruthy();
    expect((await call("make_offer", { listing_id: "l_figure", amount: 2400, message: "公仔四盒", quantity: 4 }, "u_ken")).error).toBeTruthy();
    expect((await call("make_offer", { listing_id: "l_figure", amount: 2400, message: "公仔匯款", payment_method: "bank_transfer" }, "u_ken")).error).toBeTruthy();
  });
});

describe("審查修正", () => {
  beforeEach(() => resetDemoStore());

  it("封鎖後仍可取消訂單釋出數量（買賣雙方皆可）", async () => {
    const a = await order("u_an", "l_figure", { quantity: 2 });
    await svc.toggleBlock(await P("u_zhe"), "u_an");
    expect(await svc.isBlockedBetween("u_an", "u_zhe")).toBe(true);
    const sum = await svc.getOrderSummary(await P("u_an"), a.convId);
    expect(sum.ok && sum.data!.myActions).toContain("cancel_order");
    expect((await svc.cancelOrder(await P("u_an"), a.convId)).ok).toBe(true);
    expect((await demoRepo.getListing("l_figure"))!.reservedQty).toBe(0);

    const b = await order("u_mia", "l_figure", { quantity: 1 });
    await svc.toggleBlock(await P("u_mia"), "u_zhe");
    expect((await svc.cancelOrder(await P("u_zhe"), b.convId)).ok).toBe(true);
    expect((await demoRepo.getListing("l_figure"))!.status).toBe("active");
  });

  it("運費快照：出價後物品改運費，訂單總額不變；非 cod 運費為 0", async () => {
    const a = await order("u_an", "l_jacket", { paymentMethod: "cod" }, 3500, "外套貨到付款");
    expect((await demoRepo.getOffer(a.offerId))!.shippingFee).toBe(60);
    // 直接改 store（模擬日後的運費編輯）；updateListing 不會改付款方式與運費
    const l = (await demoRepo.getListing("l_jacket"))!;
    await demoRepo.updateListing({ ...l, shippingFee: 999, paymentMethods: ["bank_transfer"], title: "新標題" });
    const after = (await demoRepo.getListing("l_jacket"))!;
    expect([after.shippingFee, after.paymentMethods, after.title]).toEqual([60, ["meetup_cash", "cod"], "新標題"]);
    (globalThis as unknown as { __pfStore: { listings: Map<string, { shippingFee: number }> } }).__pfStore.listings.get("l_jacket")!.shippingFee = 200;
    const sum = await svc.getOrderSummary(await P("u_an"), a.convId);
    expect(sum.ok && [sum.data!.shippingFee, sum.data!.total]).toEqual([60, 3560]);
    expect(offerTotal((await demoRepo.getOffer(a.offerId))!)).toBe(3560);

    const b = await order("u_ken", "l_figure", { quantity: 1 }, 2500, "公仔面交");
    expect((await demoRepo.getOffer(b.offerId))!.shippingFee).toBe(0);
  });

  it("inbox 錯誤只用白名單代碼", () => {
    expect(svc.respondErrorCode("剩餘數量不足")).toBe("insufficient");
    expect(svc.respondErrorCode("任意文字 請點 http://evil")).toBe("unknown");
    expect(svc.respondErrorText("insufficient")).toBe("剩餘數量不足");
    expect(svc.respondErrorText("請加 LINE 客服 scam88")).toBeNull();
    expect(svc.respondErrorText("__proto__")).toBeNull();
    expect(svc.respondErrorText(undefined)).toBeNull();
  });
});
