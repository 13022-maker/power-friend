import { beforeEach, describe, expect, it } from "vitest";
import { demoRepo, resetDemoStore } from "../lib/data/demo";
import type { Conversation, Message, Offer } from "../lib/types";

const now = () => new Date().toISOString();

function offer(id: string, listingId: string, buyerId: string, sellerId: string): Offer {
  return { id, listingId, buyerId, sellerId, amount: 1000, message: "還在嗎？", messageHash: id, aiDrafted: false, status: "pending", createdAt: now() };
}
function conv(id: string, o: Offer): Conversation {
  return { id, offerId: o.id, listingId: o.listingId, buyerId: o.buyerId, sellerId: o.sellerId, createdAt: now() };
}
function msg(id: string, conversationId: string, senderId: string, body = "hi"): Message {
  return { id, conversationId, senderId, body, aiDrafted: false, risk: "none", riskReasons: [], createdAt: now() };
}

/** 建立出價 → 接受 → 回傳對話 id */
async function acceptNew(n: string, listingId: string, buyerId: string, sellerId: string) {
  const o = offer(`o_${n}`, listingId, buyerId, sellerId);
  await demoRepo.createOffer(o);
  const ok = await demoRepo.acceptOffer(o.id, sellerId, conv(`c_${n}`, o), msg(`m_${n}`, `c_${n}`, buyerId));
  return { ok, convId: `c_${n}` };
}

describe("demo repo 原子操作", () => {
  beforeEach(() => resetDemoStore());

  it("acceptOffer：同一物品第二次接受回傳 false，且不做任何變更", async () => {
    // l_fm2 屬於 u_zhe
    const a = offer("o_a", "l_fm2", "u_an", "u_zhe");
    const b = offer("o_b", "l_fm2", "u_mia", "u_zhe");
    await demoRepo.createOffer(a);
    await demoRepo.createOffer(b);

    expect(await demoRepo.acceptOffer(a.id, "u_zhe", conv("c_a", a), msg("m_a", "c_a", "u_an"))).toBe(true);
    expect(await demoRepo.acceptOffer(b.id, "u_zhe", conv("c_b", b), msg("m_b", "c_b", "u_mia"))).toBe(false);

    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("reserved");
    expect((await demoRepo.getOffer(a.id))!.status).toBe("accepted");
    expect((await demoRepo.getOffer(b.id))!.status).toBe("pending");
    expect(await demoRepo.getConversation("c_a")).not.toBeNull();
    expect(await demoRepo.getConversation("c_b")).toBeNull();
    expect(await demoRepo.listMessages("c_a")).toHaveLength(1);
    expect(await demoRepo.listMessages("c_b")).toHaveLength(0);

    // 同一筆出價重複接受也失敗
    expect(await demoRepo.acceptOffer(a.id, "u_zhe", conv("c_a2", a), msg("m_a2", "c_a2", "u_an"))).toBe(false);
  });

  it("acceptOffer：非該出價的賣家不能接受", async () => {
    const a = offer("o_a", "l_fm2", "u_an", "u_zhe");
    await demoRepo.createOffer(a);
    expect(await demoRepo.acceptOffer(a.id, "u_mia", conv("c_a", a), msg("m_a", "c_a", "u_an"))).toBe(false);
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("active");
  });

  it("completeDeal：成交數只加一次；同一對帳號的第二筆成交不再加", async () => {
    const zhe0 = (await demoRepo.getProfile("u_zhe"))!.deals;
    const an0 = (await demoRepo.getProfile("u_an"))!.deals;
    const taste = new Array(256).fill(0).map((_, i) => (i === 0 ? 1 : 0));

    const first = await acceptNew("1", "l_fm2", "u_an", "u_zhe");
    expect(first.ok).toBe(true);
    // 買家以外的人、或非賣家不能標記成交
    expect(await demoRepo.completeDeal(first.convId, "u_an", taste, msg("s_x", first.convId, "system"))).toBe(false);
    expect(await demoRepo.completeDeal(first.convId, "u_zhe", taste, msg("s_1", first.convId, "system"))).toBe(true);
    expect((await demoRepo.getListing("l_fm2"))!.status).toBe("sold");
    expect((await demoRepo.getProfile("u_zhe"))!.deals).toBe(zhe0 + 1);
    expect((await demoRepo.getProfile("u_an"))!.deals).toBe(an0 + 1);
    expect((await demoRepo.getProfile("u_an"))!.tasteVec).toEqual(taste);

    // 重複標記同一筆：listing 已 sold → false，不再加分
    expect(await demoRepo.completeDeal(first.convId, "u_zhe", taste, msg("s_1b", first.convId, "system"))).toBe(false);
    expect((await demoRepo.getProfile("u_zhe"))!.deals).toBe(zhe0 + 1);

    // 同一對帳號的第二筆成交（l_books 也屬於 u_zhe）：成交本身成功，但不再加成交數
    const second = await acceptNew("2", "l_books", "u_an", "u_zhe");
    expect(second.ok).toBe(true);
    expect(await demoRepo.completeDeal(second.convId, "u_zhe", taste, msg("s_2", second.convId, "system"))).toBe(true);
    expect((await demoRepo.getListing("l_books"))!.status).toBe("sold");
    expect((await demoRepo.getProfile("u_zhe"))!.deals).toBe(zhe0 + 1);
    expect((await demoRepo.getProfile("u_an"))!.deals).toBe(an0 + 1);

    // 反方向（u_zhe 買 u_an 的東西）也視為同一對
    const third = await acceptNew("3", "l_gundam", "u_zhe", "u_an");
    expect(await demoRepo.completeDeal(third.convId, "u_an", taste, msg("s_3", third.convId, "system"))).toBe(true);
    expect((await demoRepo.getProfile("u_zhe"))!.deals).toBe(zhe0 + 1);
    expect((await demoRepo.getProfile("u_an"))!.deals).toBe(an0 + 1);
  });

  it("incrementViews／incrementValidReports：+1", async () => {
    const v0 = (await demoRepo.getListing("l_fm2"))!.views;
    await demoRepo.incrementViews("l_fm2");
    await demoRepo.incrementViews("l_fm2");
    expect((await demoRepo.getListing("l_fm2"))!.views).toBe(v0 + 2);
    await demoRepo.incrementViews("l_nope"); // 不存在：no-op

    const r0 = (await demoRepo.getProfile("u_new"))!.validReports;
    await demoRepo.incrementValidReports("u_new");
    expect((await demoRepo.getProfile("u_new"))!.validReports).toBe(r0 + 1);
  });

  it("listListings：預設不含已售出，includeSold 時包含", async () => {
    const l = (await demoRepo.getListing("l_fm2"))!;
    await demoRepo.updateListing({ ...l, status: "sold" });
    expect((await demoRepo.listListings()).some((x) => x.id === "l_fm2")).toBe(false);
    expect((await demoRepo.listListings({ includeSold: true })).some((x) => x.id === "l_fm2")).toBe(true);
  });

  it("deleteAccount：保留檢舉本人的紀錄，刪除本人提出的檢舉", async () => {
    await demoRepo.createReport({ id: "r_1", reporterId: "u_an", targetId: "u_new", reason: "x", counted: true, createdAt: now() });
    await demoRepo.createReport({ id: "r_2", reporterId: "u_mia", targetId: "u_an", reason: "y", counted: true, createdAt: now() });
    await demoRepo.deleteAccount("u_an");
    expect(await demoRepo.listReports({ reporterId: "u_an" })).toHaveLength(0);
    expect(await demoRepo.listReports({ targetId: "u_an" })).toHaveLength(1);
  });
});
