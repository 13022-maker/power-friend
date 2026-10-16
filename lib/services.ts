import { repo, newId } from "./data";
import type {
  Category,
  Condition,
  Conversation,
  Listing,
  ListingStatus,
  Message,
  Offer,
  OfferStatus,
  PaymentMethod,
  Profile,
  RankedListing,
  ShippingInfo,
  SortMode,
} from "./types";
import { cosine, embed, blendTaste, tasteFit } from "./ai/embedding";
import { estimatePrice, priceFairness } from "./ai/pricing";
import { messageHash, riskCheck } from "./ai/scam";
import { riskCheckSmart } from "./ai/smart";
import { computeTrust, isTrustworthyReporter } from "./trust";
import { distanceKm } from "./catalog";
import { LIMITS, isCategory, isCondition, isReportReason, isValidAmount } from "./validation";
import { checkLimit } from "./ratelimit";
import {
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_LABELS,
  PREPAY_WARNING,
  QTY_LIMITS,
  SHIPPING_FEE_MAX,
  TRACKING_NO_MAX,
  isPaymentMethod,
  isPrepay,
  isValidQuantity,
  isValidShippingFee,
  isValidTrackingNo,
  listingAvailable,
  normalizeShippingInfo,
  offerShippingFee,
  offerTotal,
  validatePaymentMethods,
} from "./payment";

const DAY = 86_400_000;

export type Result<T = undefined> = { ok: true; data?: T; notice?: string } | { ok: false; error: string };

/**
 * 經網址（?error=）傳遞的錯誤一律只帶代碼，頁面以這份白名單對照中文；查無代碼就不顯示。
 * 絕不把錯誤字串本身放進網址（否則可被拿來在平台網域上顯示任意釣魚文字）。
 */
export const RESPOND_ERROR_CODES = {
  insufficient: "剩餘數量不足",
  handled: "這筆出價已處理",
  not_found: "找不到這筆出價",
  listing_gone: "找不到物品",
} as const;
export type RespondErrorCode = keyof typeof RESPOND_ERROR_CODES;
/** 錯誤訊息 → 代碼（不在白名單的訊息回傳 "unknown"，頁面顯示通用訊息） */
export const respondErrorCode = (error: string): RespondErrorCode | "unknown" =>
  (Object.entries(RESPOND_ERROR_CODES).find(([, v]) => v === error)?.[0] as RespondErrorCode | undefined) ?? "unknown";
export const respondErrorText = (code: unknown): string | null =>
  code === "unknown"
    ? "操作失敗，請重新整理後再試"
    : typeof code === "string" && Object.hasOwn(RESPOND_ERROR_CODES, code)
      ? RESPOND_ERROR_CODES[code as RespondErrorCode]
      : null;

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
    if (l.status === "sold" || l.sellerId === viewer.id || blocked.has(l.sellerId)) continue; // 狀態由數量推導（lib/payment.ts#deriveStatus）
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
    else score = 0.35 * fit + 0.35 * trust + 30 * fair - 0.5 * Math.min(dist, 30) + (listingAvailable(l) === 0 ? -40 : 0);
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
  /** 總數量 1..999，預設 1 */
  quantity?: number;
  /** 至少一種、不重複，預設 ["meetup_cash"]；bank_transfer／mobile_pay 僅限 verificationLevel ≥ 1 */
  paymentMethods?: PaymentMethod[];
  /** 貨到付款運費 0..1000（0 表示含運），預設 0；不含 cod 時忽略並存 0 */
  shippingFee?: number;
}

/**
 * 上架欄位驗證（action 層在上傳照片前也先呼叫，避免產生孤兒照片）；通過回傳 null。
 * 傳入 seller 時一併檢查先付款類付款方式的賣家驗證資格。
 */
export function validateListingInput(
  input: Pick<NewListingInput, "title" | "description" | "category" | "condition" | "price" | "quantity" | "paymentMethods" | "shippingFee">,
  seller?: Pick<Profile, "verificationLevel">,
): string | null {
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (title.length < 2) return "請填寫品名";
  if (title.length > LIMITS.titleMax) return `品名請在 ${LIMITS.titleMax} 字以內`;
  if (description.length > LIMITS.descriptionMax) return `說明請在 ${LIMITS.descriptionMax} 字以內`;
  if (!isCategory(input.category)) return "請選擇有效的分類";
  if (!isCondition(input.condition)) return "請選擇有效的成色";
  if (!isValidAmount(input.price)) return "價格請填 1 到 10,000,000 之間的整數";
  if (input.quantity !== undefined && !isValidQuantity(input.quantity)) return `數量請填 ${QTY_LIMITS.min} 到 ${QTY_LIMITS.max} 之間的整數`;
  if (input.paymentMethods !== undefined) {
    const bad = validatePaymentMethods(input.paymentMethods, seller?.verificationLevel);
    if (bad) return bad;
  }
  const methods = input.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
  if (methods.includes("cod") && input.shippingFee !== undefined && !isValidShippingFee(input.shippingFee))
    return `運費請填 0 到 ${SHIPPING_FEE_MAX} 之間的整數（0 表示含運）`;
  return null;
}

export async function createListing(seller: Profile, input: NewListingInput): Promise<Result<{ id: string }>> {
  const invalid = validateListingInput(input, seller);
  if (invalid) return { ok: false, error: invalid };
  const title = String(input.title).trim();
  const description = String(input.description ?? "").trim();
  const originalPrice = isValidAmount(input.originalPrice) ? input.originalPrice : undefined;

  const risk = await riskCheckSmart(`${title} ${description}`);
  if (risk.level === "high") return { ok: false, error: `上架內容疑似詐騙：${risk.reasons.join("、")}` };

  const est = estimatePrice(input.category, input.condition, originalPrice);
  const paymentMethods = input.paymentMethods ?? DEFAULT_PAYMENT_METHODS;
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
    quantity: input.quantity ?? 1,
    reservedQty: 0,
    soldQty: 0,
    paymentMethods: [...paymentMethods],
    shippingFee: paymentMethods.includes("cod") ? (input.shippingFee ?? 0) : 0,
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

export interface OfferOptions {
  /** 1..可售數量，預設 1 */
  quantity?: number;
  /** 須在 listing.paymentMethods 內，預設物品的第一種 */
  paymentMethod?: PaymentMethod;
}

/** amount 為「單價」；總額見 lib/payment.ts#offerTotal */
export async function createOffer(
  buyer: Profile,
  listingId: string,
  amount: number,
  message: string,
  aiDrafted = false,
  opts: OfferOptions = {},
): Promise<Result<{ id: string; total: number }>> {
  const r = repo();
  const listing = await r.getListing(listingId);
  const available = listing ? listingAvailable(listing) : 0;
  if (!listing || available <= 0) return { ok: false, error: "這件物品已保留或售出" };
  if (listing.sellerId === buyer.id) return { ok: false, error: "不能對自己的物品出價" };
  if (await isBlockedBetween(buyer.id, listing.sellerId)) return { ok: false, error: "你與賣家之間有封鎖紀錄" };
  if (!isValidAmount(amount)) return { ok: false, error: "出價請填 1 到 10,000,000 之間的整數" };
  const quantity = opts.quantity ?? 1;
  if (!isValidQuantity(quantity) || quantity > available)
    return { ok: false, error: available === 1 ? "這件物品只剩 1 件" : `數量請填 1 到 ${available} 之間的整數（目前剩 ${available} 件）` };
  const paymentMethod = opts.paymentMethod ?? listing.paymentMethods[0];
  if (!isPaymentMethod(paymentMethod) || !listing.paymentMethods.includes(paymentMethod))
    return { ok: false, error: `賣家不接受這種付款方式（可選：${listing.paymentMethods.map((m) => PAYMENT_LABELS[m]).join("、")}）` };
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
    quantity,
    paymentMethod,
    shippingFee: offerShippingFee({ paymentMethod }, listing), // 快照：之後物品改運費不影響這筆
  };
  await r.createOffer(offer);
  const tooLow = amount < listing.aiPriceLow * 0.7;
  return {
    ok: true,
    data: { id: offer.id, total: offerTotal(offer) },
    notice: [
      risk.level === "low" ? `已遮蔽：${risk.reasons.join("、")}` : "",
      tooLow ? "出價明顯低於行情，賣家接受機率較低" : "",
      isPrepay(paymentMethod) ? PREPAY_WARNING : "",
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
    if (!(await r.declineOffer(offer.id, seller.id))) return { ok: false, error: "這筆出價已處理" };
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
  // 原子：出價 pending → accepted、可售數量足夠才保留（reservedQty += q）、建立對話與首訊；並行的接受不會超賣
  if (!(await r.acceptOffer(offer.id, seller.id, conv, first))) {
    const [now, l] = await Promise.all([r.getOffer(offer.id), r.getListing(offer.listingId)]);
    if (now && now.status !== "pending") return { ok: false, error: "這筆出價已處理" };
    if (!l) return { ok: false, error: "找不到物品" };
    return { ok: false, error: "剩餘數量不足" };
  }
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

const systemMessage = (conversationId: string, body: string): Message => ({
  id: newId("m"),
  conversationId,
  senderId: "system",
  body,
  aiDrafted: false,
  risk: "none",
  riskReasons: [],
  createdAt: new Date().toISOString(),
});

/** 讀取對話與其 offer，並確認 user 是買賣雙方之一 */
async function loadOrder(user: Profile, conversationId: string) {
  const r = repo();
  const conv = await r.getConversation(conversationId);
  if (!conv || (conv.buyerId !== user.id && conv.sellerId !== user.id)) return null;
  const offer = await r.getOffer(conv.offerId);
  if (!offer) return null;
  return { conv, offer, role: conv.sellerId === user.id ? ("seller" as const) : ("buyer" as const) };
}

const ORDER_CLOSED: Partial<Record<OfferStatus, string>> = { completed: "這筆訂單已成交", cancelled: "這筆訂單已取消" };

export async function completeDeal(user: Profile, conversationId: string): Promise<Result> {
  const r = repo();
  const conv = await r.getConversation(conversationId);
  if (!conv || conv.sellerId !== user.id) return { ok: false, error: "只有賣家可以標記成交" };
  const offer = await r.getOffer(conv.offerId);
  if (!offer) return { ok: false, error: "找不到這筆訂單" };
  if (offer.status === "completed") return { ok: false, error: "已標記成交" };
  if (offer.status !== "accepted") return { ok: false, error: ORDER_CLOSED[offer.status] ?? "這筆訂單尚未成立" };
  if (offer.paymentMethod === "cod" && !offer.shippedAt) return { ok: false, error: "貨到付款需先標記已寄出，買家取貨付款後再標記成交" };
  const [listing, buyer] = await Promise.all([r.getListing(conv.listingId), r.getProfile(conv.buyerId)]);
  if (!listing) return { ok: false, error: "找不到物品" };
  const buyerTaste = buyer ? blendTaste(buyer.tasteVec, listing.embedding) : [];
  // 原子：reservedQty -= q、soldQty += q、offer completed、雙方成交數（同一對只計一次）、買家品味向量、系統訊息、清除收件資訊
  const done = await r.completeDeal(conversationId, user.id, buyerTaste, systemMessage(conversationId, "賣家已標記成交，雙方信任分數已更新。"));
  if (!done) return { ok: false, error: "無法標記成交（訂單狀態已變更，請重新整理）" };
  return { ok: true };
}

/**
 * 取消訂單：買賣雙方皆可取消已接受、未成交的訂單，保留數量釋出。
 * 已寄出的貨到付款只有賣家可取消（買家拒收由賣家處理）。
 */
export async function cancelOrder(user: Profile, conversationId: string): Promise<Result> {
  const o = await loadOrder(user, conversationId);
  if (!o) return { ok: false, error: "無權限" };
  if (o.offer.status !== "accepted") return { ok: false, error: ORDER_CLOSED[o.offer.status] ?? "這筆訂單尚未成立" };
  if (o.offer.shippedAt && o.role === "buyer") return { ok: false, error: "賣家已寄出，無法由買家取消；如要拒收請與賣家聯繫" };
  const who = o.role === "seller" ? "賣方" : "買方";
  const done = await repo().cancelOrder(conversationId, user.id, systemMessage(conversationId, `${who}已取消訂單，數量已釋出`));
  if (!done) return { ok: false, error: "無法取消（訂單狀態已變更，請重新整理）" };
  return { ok: true };
}

/* ───────────────────────── 貨到付款 ───────────────────────── */

/** 收件資訊輸入（offerId 由對話決定，不接受呼叫端傳入） */
export type ShippingInfoInput = Omit<ShippingInfo, "offerId">;

/** 買家填寫／重填收件資訊（貨到付款、已接受、未寄出）。只有該訂單的買家可寫 */
export async function setShippingInfo(user: Profile, conversationId: string, info: ShippingInfoInput): Promise<Result> {
  const o = await loadOrder(user, conversationId);
  if (!o) return { ok: false, error: "無權限" };
  if (o.role !== "buyer") return { ok: false, error: "只有買家可以填寫收件資訊" };
  if (o.offer.paymentMethod !== "cod") return { ok: false, error: "這筆訂單不是貨到付款" };
  if (o.offer.status !== "accepted") return { ok: false, error: ORDER_CLOSED[o.offer.status] ?? "這筆訂單尚未成立" };
  if (o.offer.shippedAt) return { ok: false, error: "賣家已寄出，無法修改收件資訊" };
  const v = normalizeShippingInfo(info ?? {});
  if (!v.ok) return v;
  const r = repo();
  const had = await r.getShippingInfo(conversationId, user.id);
  if (!(await r.setShippingInfo(conversationId, user.id, v.data))) return { ok: false, error: "無法儲存（訂單狀態已變更，請重新整理）" };
  // 系統訊息不含任何收件個資
  await r.createMessage(systemMessage(conversationId, had ? "買家已更新收件資訊。" : "買家已填寫收件資訊，賣家可以寄出了。"));
  return { ok: true };
}

/** 讀取收件資訊：只限該訂單的買賣雙方；尚未填寫（或已成交／取消而清除）時 data 為 null */
export async function getShippingInfo(user: Profile, conversationId: string): Promise<Result<ShippingInfo | null>> {
  const o = await loadOrder(user, conversationId);
  if (!o) return { ok: false, error: "無權限" };
  return { ok: true, data: await repo().getShippingInfo(conversationId, user.id) };
}

/** 賣家標記已寄出（貨到付款、已接受、已有收件資訊、未寄出）；trackingNo 選填（英數與 -，最多 40 字） */
export async function markShipped(user: Profile, conversationId: string, trackingNo?: string): Promise<Result> {
  const o = await loadOrder(user, conversationId);
  if (!o) return { ok: false, error: "無權限" };
  if (o.role !== "seller") return { ok: false, error: "只有賣家可以標記已寄出" };
  if (o.offer.paymentMethod !== "cod") return { ok: false, error: "這筆訂單不是貨到付款" };
  if (o.offer.status !== "accepted") return { ok: false, error: ORDER_CLOSED[o.offer.status] ?? "這筆訂單尚未成立" };
  if (o.offer.shippedAt) return { ok: false, error: "已標記寄出" };
  const tn = String(trackingNo ?? "").trim() || undefined;
  if (tn !== undefined && !isValidTrackingNo(tn)) return { ok: false, error: `物流單號只能是英數與 -，最多 ${TRACKING_NO_MAX} 字` };
  const r = repo();
  if (!(await r.getShippingInfo(conversationId, user.id))) return { ok: false, error: "買家尚未填寫收件資訊" };
  const body = tn ? `賣家已寄出（物流單號 ${tn}），買家取貨付款後賣家再標記成交。` : "賣家已寄出，買家取貨付款後賣家再標記成交。";
  if (!(await r.markShipped(conversationId, user.id, tn, systemMessage(conversationId, body))))
    return { ok: false, error: "無法標記寄出（訂單狀態已變更，請重新整理）" };
  return { ok: true };
}

/* ───────────────────────── 訂單摘要（聊天室用） ───────────────────────── */

export type OrderAction = "set_shipping_info" | "mark_shipped" | "complete_deal" | "cancel_order";

export interface OrderSummary {
  conversationId: string;
  offerId: string;
  listingId: string;
  listingTitle: string;
  /** 目前使用者在這筆訂單的角色 */
  role: "buyer" | "seller";
  status: OfferStatus;
  quantity: number;
  /** 單價（= offer.amount） */
  unitPrice: number;
  /** 單價 × 數量 */
  subtotal: number;
  /** 出價當下快照的運費（貨到付款才有；0 表示含運），其他付款方式為 0 */
  shippingFee: number;
  /** subtotal + shippingFee */
  total: number;
  paymentMethod: PaymentMethod;
  paymentLabel: string;
  /** 先付款類（匯款／行動支付）：UI 應顯示 prepayWarning */
  isPrepay: boolean;
  prepayWarning?: string;
  /** 只有貨到付款才有 */
  cod: null | {
    hasShippingInfo: boolean;
    shipped: boolean;
    shippedAt?: string;
    trackingNo?: string;
  };
  /** 物品目前的數量狀態 */
  listing: { quantity: number; available: number; reservedQty: number; soldQty: number; status: ListingStatus } | null;
  /** 雙方目前可執行的動作（伺服器端仍會再檢查） */
  actions: { buyer: OrderAction[]; seller: OrderAction[] };
  /** 目前使用者可執行的動作（= actions[role]） */
  myActions: OrderAction[];
  /** 給 UI 顯示的下一步提示 */
  nextStep: string;
}

/** 聊天室的訂單摘要：數量、單價、付款方式、總額、運費、貨到付款狀態、雙方可執行的動作。只限買賣雙方 */
export async function getOrderSummary(user: Profile, conversationId: string): Promise<Result<OrderSummary>> {
  const o = await loadOrder(user, conversationId);
  if (!o) return { ok: false, error: "無權限" };
  const r = repo();
  const { conv, offer, role } = o;
  const [listing, ship] = await Promise.all([
    r.getListing(conv.listingId),
    offer.paymentMethod === "cod" ? r.getShippingInfo(conversationId, user.id) : Promise.resolve(null),
  ]);
  const shippingFee = offer.shippingFee; // 出價當下的快照
  const subtotal = offer.amount * offer.quantity;
  const isCod = offer.paymentMethod === "cod";
  const open = offer.status === "accepted";
  const shipped = !!offer.shippedAt;
  const hasShippingInfo = !!ship;

  const buyer: OrderAction[] = [];
  const seller: OrderAction[] = [];
  if (open) {
    if (isCod && !shipped) buyer.push("set_shipping_info");
    if (isCod && !shipped && hasShippingInfo) seller.push("mark_shipped");
    if (!isCod || shipped) seller.push("complete_deal");
    if (!shipped) buyer.push("cancel_order");
    seller.push("cancel_order");
  }

  let nextStep: string;
  if (offer.status === "completed") nextStep = "已成交";
  else if (offer.status === "cancelled") nextStep = "訂單已取消";
  else if (!open) nextStep = "訂單尚未成立";
  else if (!isCod) nextStep = offer.paymentMethod === "meetup_cash" ? "約定面交時間地點，當面驗貨付款後由賣家標記成交" : "確認付款後由賣家標記成交";
  else if (!hasShippingInfo && !shipped) nextStep = role === "buyer" ? "請填寫收件資訊" : "等待買家填寫收件資訊";
  else if (!shipped) nextStep = role === "seller" ? "寄出後請標記已寄出" : "等待賣家寄出";
  else nextStep = role === "seller" ? "買家取貨付款後請標記成交" : "請留意取貨通知，取貨時付款";

  return {
    ok: true,
    data: {
      conversationId,
      offerId: offer.id,
      listingId: conv.listingId,
      listingTitle: listing?.title ?? "",
      role,
      status: offer.status,
      quantity: offer.quantity,
      unitPrice: offer.amount,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      paymentMethod: offer.paymentMethod,
      paymentLabel: PAYMENT_LABELS[offer.paymentMethod],
      isPrepay: isPrepay(offer.paymentMethod),
      prepayWarning: isPrepay(offer.paymentMethod) ? PREPAY_WARNING : undefined,
      cod: isCod ? { hasShippingInfo, shipped, shippedAt: offer.shippedAt, trackingNo: offer.trackingNo } : null,
      listing: listing
        ? { quantity: listing.quantity, available: listingAvailable(listing), reservedQty: listing.reservedQty, soldQty: listing.soldQty, status: listing.status }
        : null,
      actions: { buyer, seller },
      myActions: role === "buyer" ? buyer : seller,
      nextStep,
    },
  };
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
  // 本人作為買家填過、尚未清除的收件資訊（不含別人的）
  const shippingInfo = (
    await Promise.all(convs.filter((c) => c.buyerId === userId).map((c) => r.getShippingInfo(c.id, userId)))
  ).filter((x): x is ShippingInfo => !!x);
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
    shippingInfo,
  };
}

/**
 * 刪除帳號（個資法；Alovoa 式：需輸入顯示名稱確認，在 action 層檢查）。
 * 先釋出本人作為買家的已接受訂單（等同取消，含已寄出的貨到付款），再刪除本人所有資料（收件資訊一併刪除）。
 * 本人作為賣家的訂單隨本人物品一起刪除。
 */
export async function deleteAccount(user: Profile): Promise<Result<{ released: number }>> {
  const r = repo();
  const convs = (await r.listConversations(user.id)).filter((c) => c.buyerId === user.id && c.sellerId !== user.id);
  let released = 0;
  for (const c of convs) {
    const o = await r.getOffer(c.offerId);
    if (o?.status !== "accepted") continue;
    const ok = await r.cancelOrder(c.id, user.id, systemMessage(c.id, "買方已刪除帳號，訂單已取消，數量已釋出"), { allowShipped: true });
    if (ok) released++;
  }
  await r.deleteAccount(user.id);
  return { ok: true, data: { released } };
}
