import { repo, newId } from "./data";
import type { Category, Condition, Conversation, Listing, Message, Offer, Profile, RankedListing, SortMode } from "./types";
import { cosine, embed, blendTaste, tasteFit } from "./ai/embedding";
import { estimatePrice, priceFairness } from "./ai/pricing";
import { messageHash, riskCheck } from "./ai/scam";
import { riskCheckSmart } from "./ai/smart";
import { computeTrust, isTrustworthyReporter } from "./trust";
import { distanceKm } from "./catalog";
import { LIMITS, isCategory, isCondition, isReportReason, isValidAmount } from "./validation";
import { checkLimit } from "./ratelimit";

const DAY = 86_400_000;

export type Result<T = undefined> = { ok: true; data?: T; notice?: string } | { ok: false; error: string };

async function blockedSet(userId: string): Promise<Set<string>> {
  const blocks = await repo().listBlocks(userId);
  return new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
}

export async function isBlockedBetween(a: string, b: string) {
  return (await blockedSet(a)).has(b);
}

/* ───────────────────────── 探索與排序 ───────────────────────── */

export async function explore(
  viewer: Profile,
  opts: { mode: SortMode; category?: Category | ""; q?: string },
): Promise<RankedListing[]> {
  const r = repo();
  const [listings, profiles, blocked] = await Promise.all([r.listListings(), r.listProfiles(), blockedSet(viewer.id)]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const qVec = opts.q?.trim() ? embed(opts.q) : null;

  const ranked: RankedListing[] = [];
  for (const l of listings) {
    if (l.status === "sold" || l.sellerId === viewer.id || blocked.has(l.sellerId)) continue;
    if (opts.category && l.category !== opts.category) continue;
    const seller = byId.get(l.sellerId);
    if (!seller) continue;
    const relevance = qVec ? cosine(qVec, l.embedding) : 1;
    if (qVec && relevance < 0.08) continue; // 語意搜尋門檻

    const dist = distanceKm(viewer.areaId, l.areaId);
    const fit = tasteFit(viewer.tasteVec, l.embedding);
    const trust = computeTrust(seller).total;
    const fair = priceFairness(l.price, l.aiPriceLow, l.aiPriceHigh);

    let score: number;
    if (opts.mode === "nearby") score = -dist;
    else if (opts.mode === "taste") score = fit;
    else score = 0.35 * fit + 0.35 * trust + 30 * fair - 0.5 * Math.min(dist, 30) + (l.status === "reserved" ? -40 : 0);
    if (qVec) score += relevance * 100;

    ranked.push({ ...l, seller, distanceKm: dist, tasteFit: fit, trust, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/* ───────────────────────── 上架 ───────────────────────── */

export interface NewListingInput {
  title: string;
  description: string;
  category: Category;
  condition: Condition;
  price: number;
  originalPrice?: number; // 賣家自填或 AI 從描述偵測，作為估價基準
  photo?: string;
}

/** 上架欄位驗證（action 層在上傳照片前也先呼叫，避免產生孤兒照片）；通過回傳 null */
export function validateListingInput(input: Pick<NewListingInput, "title" | "description" | "category" | "condition" | "price">): string | null {
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (title.length < 2) return "請填寫品名";
  if (title.length > LIMITS.titleMax) return `品名請在 ${LIMITS.titleMax} 字以內`;
  if (description.length > LIMITS.descriptionMax) return `說明請在 ${LIMITS.descriptionMax} 字以內`;
  if (!isCategory(input.category)) return "請選擇有效的分類";
  if (!isCondition(input.condition)) return "請選擇有效的成色";
  if (!isValidAmount(input.price)) return "價格請填 1 到 10,000,000 之間的整數";
  return null;
}

export async function createListing(seller: Profile, input: NewListingInput): Promise<Result<{ id: string }>> {
  const invalid = validateListingInput(input);
  if (invalid) return { ok: false, error: invalid };
  const title = String(input.title).trim();
  const description = String(input.description ?? "").trim();
  const originalPrice = isValidAmount(input.originalPrice) ? input.originalPrice : undefined;

  const risk = await riskCheckSmart(`${title} ${description}`);
  if (risk.level === "high") return { ok: false, error: `上架內容疑似詐騙：${risk.reasons.join("、")}` };

  const est = estimatePrice(input.category, input.condition, originalPrice);
  const listing: Listing = {
    id: newId("l"),
    sellerId: seller.id,
    title: riskCheck(title).masked,
    description: riskCheck(description).masked,
    category: input.category,
    condition: input.condition,
    price: input.price,
    aiPriceLow: est.low,
    aiPriceHigh: est.high,
    areaId: seller.areaId,
    photo: input.photo,
    status: "active",
    createdAt: new Date().toISOString(),
    views: 0,
    embedding: embed(`${title} ${description}`),
  };
  await repo().createListing(listing);
  return {
    ok: true,
    data: { id: listing.id },
    notice: risk.level === "low" ? `已自動遮蔽：${risk.reasons.join("、")}（平台內聊天即可，保障雙方）` : undefined,
  };
}

export async function viewListing(id: string) {
  const r = repo();
  const l = await r.getListing(id);
  if (l) {
    await r.incrementViews(id); // 原子 +1，不做 read-modify-write
    l.views += 1;
  }
  return l;
}

/* ───────────────────────── 出價（開聊閘門） ───────────────────────── */

export async function createOffer(
  buyer: Profile,
  listingId: string,
  amount: number,
  message: string,
  aiDrafted = false,
): Promise<Result<{ id: string }>> {
  const r = repo();
  const listing = await r.getListing(listingId);
  if (!listing || listing.status !== "active") return { ok: false, error: "這件物品已保留或售出" };
  if (listing.sellerId === buyer.id) return { ok: false, error: "不能對自己的物品出價" };
  if (await isBlockedBetween(buyer.id, listing.sellerId)) return { ok: false, error: "你與賣家之間有封鎖紀錄" };
  if (!isValidAmount(amount)) return { ok: false, error: "出價請填 1 到 10,000,000 之間的整數" };
  if (String(message ?? "").length > LIMITS.offerMessageMax) return { ok: false, error: `訊息請在 ${LIMITS.offerMessageMax} 字以內` };

  const mine = await r.listOffers({ buyerId: buyer.id });
  if (mine.some((o) => o.listingId === listingId && o.status === "pending")) return { ok: false, error: "你已對這件物品出價，請等賣家回覆" };

  const since = Date.now() - DAY;
  const today = mine.filter((o) => Date.parse(o.createdAt) > since);
  const trust = computeTrust(buyer);
  if (today.length >= trust.dailyChatLimit)
    return { ok: false, error: `今日出價已達上限 ${trust.dailyChatLimit} 次（${trust.tier}）。完成驗證可提高上限。` };

  const text = message.trim() || "您好，請問還在嗎？";
  const hash = messageHash(text);
  const sameHashSellers = new Set(today.filter((o) => o.messageHash === hash).map((o) => o.sellerId));
  sameHashSellers.delete(listing.sellerId);
  if (sameHashSellers.size >= 2 && text.length > 12)
    return { ok: false, error: "相同的開場訊息已發給多位賣家，請針對這件物品寫一句話" };

  const risk = await riskCheckSmart(text);
  if (risk.level === "high") return { ok: false, error: `訊息疑似詐騙話術，已攔截：${risk.reasons.join("、")}` };

  const offer: Offer = {
    id: newId("o"),
    listingId,
    buyerId: buyer.id,
    sellerId: listing.sellerId,
    amount,
    message: risk.masked,
    messageHash: hash,
    aiDrafted,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await r.createOffer(offer);
  const tooLow = amount < listing.aiPriceLow * 0.7;
  return {
    ok: true,
    data: { id: offer.id },
    notice: [
      risk.level === "low" ? `已遮蔽：${risk.reasons.join("、")}` : "",
      tooLow ? "出價明顯低於行情，賣家接受機率較低" : "",
    ]
      .filter(Boolean)
      .join("；") || undefined,
  };
}

export async function respondOffer(seller: Profile, offerId: string, accept: boolean): Promise<Result<{ conversationId?: string }>> {
  const r = repo();
  const offer = await r.getOffer(offerId);
  if (!offer || offer.sellerId !== seller.id) return { ok: false, error: "找不到這筆出價" };
  if (offer.status !== "pending") return { ok: false, error: "這筆出價已處理" };

  if (!accept) {
    await r.updateOffer({ ...offer, status: "declined" });
    return { ok: true };
  }
  const conv: Conversation = {
    id: newId("c"),
    offerId: offer.id,
    listingId: offer.listingId,
    buyerId: offer.buyerId,
    sellerId: seller.id,
    createdAt: new Date().toISOString(),
  };
  const first: Message = {
    id: newId("m"),
    conversationId: conv.id,
    senderId: offer.buyerId,
    body: offer.message,
    aiDrafted: offer.aiDrafted,
    risk: "none",
    riskReasons: [],
    createdAt: offer.createdAt,
  };
  // 原子：出價 pending → accepted、物品 active → reserved、建立對話與首訊；並行的兩個接受只會有一個成功
  if (!(await r.acceptOffer(offer.id, seller.id, conv, first))) return { ok: false, error: "物品已保留或售出" };
  return { ok: true, data: { conversationId: conv.id } };
}

/* ───────────────────────── 聊天 ───────────────────────── */

export async function sendMessage(user: Profile, conversationId: string, body: string, aiDrafted = false): Promise<Result<Message>> {
  const r = repo();
  const conv = await r.getConversation(conversationId);
  if (!conv || (conv.buyerId !== user.id && conv.sellerId !== user.id)) return { ok: false, error: "無權限" };
  const other = conv.buyerId === user.id ? conv.sellerId : conv.buyerId;
  if (await isBlockedBetween(user.id, other)) return { ok: false, error: "此對話已封鎖" };
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "訊息是空的" };
  if (text.length > LIMITS.chatBodyMax) return { ok: false, error: `訊息請在 ${LIMITS.chatBodyMax} 字以內` };

  // 每人每小時 Muse 風險檢查上限；超過只跑規則層（仍會遮蔽與攔截）
  const risk = await riskCheckSmart(text, { skipMuse: !checkLimit(user.id, "museRisk") });
  const msg: Message = {
    id: newId("m"),
    conversationId,
    senderId: user.id,
    body: risk.level === "none" ? text : risk.masked,
    aiDrafted,
    risk: risk.level,
    riskReasons: risk.reasons,
    createdAt: new Date().toISOString(),
  };
  await r.createMessage(msg);
  return { ok: true, data: msg };
}

export async function completeDeal(user: Profile, conversationId: string): Promise<Result> {
  const r = repo();
  const conv = await r.getConversation(conversationId);
  if (!conv || conv.sellerId !== user.id) return { ok: false, error: "只有賣家可以標記成交" };
  const listing = await r.getListing(conv.listingId);
  if (!listing) return { ok: false, error: "找不到物品" };
  if (listing.status === "sold") return { ok: false, error: "已標記成交" };
  const buyer = await r.getProfile(conv.buyerId);
  const buyerTaste = buyer ? blendTaste(buyer.tasteVec, listing.embedding) : [];
  // 原子：物品 reserved → sold、雙方成交數（同一對買賣雙方只計一次）、買家品味向量、系統訊息
  const done = await r.completeDeal(conversationId, user.id, buyerTaste, {
    id: newId("m"),
    conversationId,
    senderId: "system",
    body: "賣家已標記成交，雙方信任分數已更新。",
    aiDrafted: false,
    risk: "none",
    riskReasons: [],
    createdAt: new Date().toISOString(),
  });
  if (!done) return { ok: false, error: "無法標記成交（物品未保留或已成交）" };
  return { ok: true };
}

/* ───────────────────────── 封鎖・檢舉・個資 ───────────────────────── */

export async function toggleBlock(user: Profile, targetId: string): Promise<Result<{ blocked: boolean }>> {
  if (targetId === user.id) return { ok: false, error: "不能封鎖自己" };
  const r = repo();
  const mine = (await r.listBlocks(user.id)).some((b) => b.blockerId === user.id && b.blockedId === targetId);
  if (mine) await r.deleteBlock({ blockerId: user.id, blockedId: targetId });
  else await r.createBlock({ blockerId: user.id, blockedId: targetId });
  return { ok: true, data: { blocked: !mine } };
}

export async function report(user: Profile, targetId: string, reason: string): Promise<Result> {
  if (targetId === user.id) return { ok: false, error: "不能檢舉自己" };
  if (!isReportReason(reason)) return { ok: false, error: "請選擇檢舉理由" };
  const r = repo();
  const dup = (await r.listReports({ reporterId: user.id })).some((x) => x.targetId === targetId);
  if (dup) return { ok: false, error: "你已檢舉過此帳號，審核中" };
  const counted = isTrustworthyReporter(user);
  await r.createReport({ id: newId("r"), reporterId: user.id, targetId, reason, counted, createdAt: new Date().toISOString() });
  if (counted) await r.incrementValidReports(targetId); // 原子 +1
  return {
    ok: true,
    notice: counted ? "檢舉已送出並計入對方信任分數，同時進入人工審核" : "檢舉已送出，將由人工審核（新帳號的檢舉不直接扣分）",
  };
}

export async function exportUserData(userId: string) {
  const r = repo();
  const [profile, listings, offersOut, offersIn, convs, blocks, reports] = await Promise.all([
    r.getProfile(userId),
    r.listListings({ includeSold: true }), // 個資匯出要含已售出
    r.listOffers({ buyerId: userId }),
    r.listOffers({ sellerId: userId }),
    r.listConversations(userId),
    r.listBlocks(userId),
    r.listReports({ reporterId: userId }),
  ]);
  const messages = (await Promise.all(convs.map((c) => r.listMessages(c.id)))).flat().filter((m) => m.senderId === userId);
  const strip = <T extends object>(x: T): Omit<T, "embedding" | "tasteVec"> => {
    const { embedding: _e, tasteVec: _t, ...rest } = x as T & { embedding?: unknown; tasteVec?: unknown };
    void _e;
    void _t;
    return rest as Omit<T, "embedding" | "tasteVec">;
  };
  return {
    exportedAt: new Date().toISOString(),
    notice: "依個人資料保護法提供之個人資料副本",
    profile: profile ? strip(profile) : null,
    listings: listings.filter((l) => l.sellerId === userId).map(strip),
    offersMade: offersOut,
    offersReceived: offersIn,
    conversations: convs,
    messagesSent: messages,
    blocks: blocks.filter((b) => b.blockerId === userId),
    reportsFiled: reports,
  };
}

/**
 * 刪除帳號（個資法；Alovoa 式：需輸入顯示名稱確認，在 action 層檢查）。
 * 先把「因本人被接受的出價而保留中」的他人物品改回上架，再刪除本人所有資料。
 */
export async function deleteAccount(user: Profile): Promise<Result<{ reactivated: number }>> {
  const r = repo();
  const accepted = (await r.listOffers({ buyerId: user.id })).filter((o) => o.status === "accepted" && o.sellerId !== user.id);
  let reactivated = 0;
  for (const o of accepted) {
    const l = await r.getListing(o.listingId);
    if (l && l.status === "reserved") {
      await r.updateListing({ ...l, status: "active" });
      reactivated++;
    }
  }
  await r.deleteAccount(user.id);
  return { ok: true, data: { reactivated } };
}
