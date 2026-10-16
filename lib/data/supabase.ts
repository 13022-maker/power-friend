import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Block, Conversation, Listing, Message, Offer, PaymentMethod, Profile, Report, ShippingInfo } from "../types";
import type { Repo } from "./repo";

/**
 * Supabase 實作（伺服器端，用 service role key）。
 * 欄位對應 supabase/schema.sql；向量欄位以 pgvector 文字格式 "[0.1,0.2,…]" 往返。
 * 注意：原型的登入仍用 demo 帳號切換；第一階段改接 Supabase Auth 後，前端可改用 anon key + RLS 直連。
 */

type Row = Record<string, unknown>;

const toVec = (v: number[]) => `[${v.map((x) => +x.toFixed(6)).join(",")}]`;
const fromVec = (v: unknown): number[] =>
  Array.isArray(v) ? (v as number[]) : typeof v === "string" ? (JSON.parse(v) as number[]) : [];

const profileFrom = (r: Row): Profile => ({
  id: r.id as string,
  displayName: r.display_name as string,
  areaId: r.area_id as string,
  bio: (r.bio as string) ?? "",
  interests: (r.interests as string[]) ?? [],
  verificationLevel: (r.verification_level as 0 | 1 | 2) ?? 0,
  joinedAt: r.joined_at as string,
  deals: (r.deals as number) ?? 0,
  positiveRate: (r.positive_rate as number) ?? 0,
  validReports: (r.valid_reports as number) ?? 0,
  tasteVec: fromVec(r.taste_vec),
});
const profileTo = (p: Profile): Row => ({
  id: p.id,
  display_name: p.displayName,
  area_id: p.areaId,
  bio: p.bio,
  interests: p.interests,
  verification_level: p.verificationLevel,
  joined_at: p.joinedAt,
  deals: p.deals,
  positive_rate: p.positiveRate,
  valid_reports: p.validReports,
  taste_vec: toVec(p.tasteVec),
});

const listingFrom = (r: Row): Listing => ({
  id: r.id as string,
  sellerId: r.seller_id as string,
  title: r.title as string,
  description: (r.description as string) ?? "",
  category: r.category as Listing["category"],
  condition: r.condition as Listing["condition"],
  price: r.price as number,
  aiPriceLow: r.ai_price_low as number,
  aiPriceHigh: r.ai_price_high as number,
  areaId: r.area_id as string,
  photo: (r.photo_url as string) ?? undefined,
  status: r.status as Listing["status"],
  createdAt: r.created_at as string,
  views: (r.views as number) ?? 0,
  embedding: fromVec(r.embedding),
  quantity: (r.quantity as number) ?? 1,
  reservedQty: (r.reserved_qty as number) ?? 0,
  soldQty: (r.sold_qty as number) ?? 0,
  paymentMethods: (r.payment_methods as PaymentMethod[] | null) ?? ["meetup_cash"],
  shippingFee: (r.shipping_fee as number) ?? 0,
});
/** insert 用（含數量；status 由 005 的 trigger 依數量推導） */
const listingTo = (l: Listing): Row => ({
  ...listingEditable(l),
  id: l.id,
  seller_id: l.sellerId,
  status: l.status,
  quantity: l.quantity,
  reserved_qty: l.reservedQty,
  sold_qty: l.soldQty,
});
/** update 用：只含可編輯欄位；數量計數與狀態只能經原子 RPC 改變（避免 read-modify-write 蓋掉並行的保留） */
const listingEditable = (l: Listing): Row => ({
  title: l.title,
  description: l.description,
  category: l.category,
  condition: l.condition,
  price: l.price,
  ai_price_low: l.aiPriceLow,
  ai_price_high: l.aiPriceHigh,
  area_id: l.areaId,
  photo_url: l.photo ?? null,
  created_at: l.createdAt,
  views: l.views,
  embedding: toVec(l.embedding),
  payment_methods: l.paymentMethods,
  shipping_fee: l.shippingFee,
});

const offerFrom = (r: Row): Offer => ({
  id: r.id as string,
  listingId: r.listing_id as string,
  buyerId: r.buyer_id as string,
  sellerId: r.seller_id as string,
  amount: r.amount as number,
  message: r.message as string,
  messageHash: r.message_hash as string,
  aiDrafted: !!r.ai_drafted,
  status: r.status as Offer["status"],
  createdAt: r.created_at as string,
  quantity: (r.quantity as number) ?? 1,
  paymentMethod: ((r.payment_method as PaymentMethod | null) ?? "meetup_cash"),
  shippedAt: (r.shipped_at as string | null) ?? undefined,
  trackingNo: (r.tracking_no as string | null) ?? undefined,
});
const offerTo = (o: Offer): Row => ({
  id: o.id,
  listing_id: o.listingId,
  buyer_id: o.buyerId,
  seller_id: o.sellerId,
  amount: o.amount,
  message: o.message,
  message_hash: o.messageHash,
  ai_drafted: o.aiDrafted,
  status: o.status,
  created_at: o.createdAt,
  quantity: o.quantity,
  payment_method: o.paymentMethod,
  shipped_at: o.shippedAt ?? null,
  tracking_no: o.trackingNo ?? null,
});

const convFrom = (r: Row): Conversation => ({
  id: r.id as string,
  offerId: r.offer_id as string,
  listingId: r.listing_id as string,
  buyerId: r.buyer_id as string,
  sellerId: r.seller_id as string,
  createdAt: r.created_at as string,
});

const msgFrom = (r: Row): Message => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  senderId: r.sender_id as string,
  body: r.body as string,
  aiDrafted: !!r.ai_drafted,
  risk: r.risk as Message["risk"],
  riskReasons: (r.risk_reasons as string[]) ?? [],
  createdAt: r.created_at as string,
});

const msgTo = (m: Message): Row => ({
  id: m.id,
  conversation_id: m.conversationId,
  sender_id: m.senderId,
  body: m.body,
  ai_drafted: m.aiDrafted,
  risk: m.risk,
  risk_reasons: m.riskReasons,
  created_at: m.createdAt,
});

/** 檢舉對象的雜湊參照：帳號刪除後 target_id 變 null，仍可用原 id 的 sha256 對回證據（與 004_hardening.sql 回填一致） */
export const reportTargetRef = (targetId: string) => createHash("sha256").update(targetId, "utf8").digest("hex");

/** 插進 PostgREST `.or()` 篩選字串前必須驗證，避免注入額外條件（逗號、括號、點號） */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("無效的 id");
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let client: SupabaseClient | null = null;
/** service-role client（僅限伺服器端；lib/storage.ts 也共用這個）。不再退回 anon key：權限不足時寧可明確失敗。 */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase 模式需要 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（伺服器端專用，勿加 NEXT_PUBLIC_ 前綴）");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data;
}

async function rows(p: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  return (await must(p)) ?? [];
}

export const supabaseRepo: Repo = {
  mode: "supabase",
  async listProfiles() {
    return (await rows(db().from("profiles").select("*"))).map(profileFrom);
  },
  async getProfile(id) {
    const r = await must(db().from("profiles").select("*").eq("id", id).maybeSingle());
    return r ? profileFrom(r) : null;
  },
  async updateProfile(p) {
    await must(db().from("profiles").upsert(profileTo(p)));
  },

  async listListings(opts) {
    let q = db().from("listings").select("*");
    if (!opts?.includeSold) q = q.neq("status", "sold");
    return (await rows(q)).map(listingFrom);
  },
  async getListing(id) {
    const r = await must(db().from("listings").select("*").eq("id", id).maybeSingle());
    return r ? listingFrom(r) : null;
  },
  async createListing(l) {
    await must(db().from("listings").insert(listingTo(l)));
  },
  async updateListing(l) {
    await must(db().from("listings").update(listingEditable(l)).eq("id", l.id));
  },
  async incrementViews(listingId) {
    await must(db().rpc("increment_views", { p_listing: listingId }));
  },

  async listOffers(f) {
    let q = db().from("offers").select("*");
    if (f.buyerId) q = q.eq("buyer_id", f.buyerId);
    if (f.sellerId) q = q.eq("seller_id", f.sellerId);
    if (f.listingId) q = q.eq("listing_id", f.listingId);
    return (await rows(q)).map(offerFrom);
  },
  async getOffer(id) {
    const r = await must(db().from("offers").select("*").eq("id", id).maybeSingle());
    return r ? offerFrom(r) : null;
  },
  async createOffer(o) {
    await must(db().from("offers").insert(offerTo(o)));
  },
  async updateOffer(o) {
    await must(db().from("offers").update(offerTo(o)).eq("id", o.id));
  },
  async declineOffer(offerId, sellerId) {
    return (await must(db().rpc("decline_offer", { p_offer: offerId, p_seller: sellerId }))) === true;
  },

  async listConversations(userId) {
    return (await rows(db().from("conversations").select("*").or(`buyer_id.eq.${safeId(userId)},seller_id.eq.${safeId(userId)}`))).map(convFrom);
  },
  async getConversation(id) {
    const r = await must(db().from("conversations").select("*").eq("id", id).maybeSingle());
    return r ? convFrom(r) : null;
  },
  async createConversation(c) {
    await must(
      db().from("conversations").insert({ id: c.id, offer_id: c.offerId, listing_id: c.listingId, buyer_id: c.buyerId, seller_id: c.sellerId, created_at: c.createdAt }),
    );
  },

  async listMessages(conversationId) {
    return (await rows(db().from("messages").select("*").eq("conversation_id", conversationId).order("created_at"))).map(msgFrom);
  },
  async createMessage(m) {
    await must(db().from("messages").insert(msgTo(m)));
  },

  async listBlocks(userId) {
    const list = await rows(db().from("blocks").select("*").or(`blocker_id.eq.${safeId(userId)},blocked_id.eq.${safeId(userId)}`));
    return list.map((r: Row): Block => ({ blockerId: r.blocker_id as string, blockedId: r.blocked_id as string }));
  },
  async createBlock(b) {
    await must(db().from("blocks").upsert({ blocker_id: b.blockerId, blocked_id: b.blockedId }));
  },
  async deleteBlock(b) {
    await must(db().from("blocks").delete().eq("blocker_id", b.blockerId).eq("blocked_id", b.blockedId));
  },

  async createReport(r) {
    await must(
      db().from("reports").insert({
        id: r.id,
        reporter_id: r.reporterId,
        target_id: r.targetId,
        target_ref: reportTargetRef(r.targetId),
        reason: r.reason,
        counted: r.counted,
        created_at: r.createdAt,
      }),
    );
  },
  async incrementValidReports(targetId) {
    await must(db().rpc("add_valid_report", { p_target: targetId }));
  },
  async listReports(f) {
    let q = db().from("reports").select("*");
    if (f.reporterId) q = q.eq("reporter_id", f.reporterId);
    if (f.targetId) q = q.eq("target_id", f.targetId);
    return (await rows(q)).map(
      (r: Row): Report => ({
        id: r.id as string,
        reporterId: r.reporter_id as string,
        targetId: (r.target_id as string | null) ?? "", // 被檢舉者已刪除帳號時為 null（證據以 target_ref 保留）
        reason: r.reason as string,
        counted: !!r.counted,
        createdAt: r.created_at as string,
      }),
    );
  },

  async deleteAccount(userId) {
    // 1) 先刪 Supabase Auth 使用者：失敗就中止（throw），避免留下「資料已刪、帳號還能登入」的半刪狀態。
    //    001 的 trigger on_auth_user_deleted 會連帶刪除 profile（及所有 cascade）。
    //    demo seed 帳號（u_xxx）不是 auth user，略過。
    if (UUID_RE.test(userId)) {
      const { error } = await db().auth.admin.deleteUser(userId);
      if (error && !/not.?found/i.test(error.message)) throw new Error(`刪除登入帳號失敗：${error.message}`);
    }
    // 2) profiles：listings／offers／conversations（→ messages）／blocks／本人提出的 reports／profiles_private 皆 on delete cascade；
    //    「檢舉本人」的 reports 為 on delete set null（保留證據）。trigger 已刪時這裡是 no-op（冪等）。
    //    messages.sender_id 不是 FK：對話已整串刪除，這裡再保險清一次
    await must(db().from("messages").delete().eq("sender_id", userId));
    await must(db().from("profiles").delete().eq("id", userId));
    // 3) Storage 照片資料夾
    const { removeOwnerPhotos } = await import("../storage");
    await removeOwnerPhotos(userId);
  },

  async acceptOffer(offerId, sellerId, conv, firstMessage) {
    const ok = await must(
      db().rpc("accept_offer", {
        p_offer: offerId,
        p_seller: sellerId,
        p_conv: { id: conv.id, created_at: conv.createdAt },
        p_msg: msgTo(firstMessage),
      }),
    );
    return ok === true;
  },

  async completeDeal(conversationId, sellerId, buyerTaste, systemMessage) {
    const ok = await must(
      db().rpc("complete_deal", {
        p_conv: conversationId,
        p_seller: sellerId,
        p_buyer_taste: toVec(buyerTaste),
        p_msg: msgTo(systemMessage),
      }),
    );
    return ok === true;
  },

  async cancelOrder(conversationId, actorId, systemMessage, opts) {
    const ok = await must(
      db().rpc("cancel_order", {
        p_conv: conversationId,
        p_actor: actorId,
        p_msg: msgTo(systemMessage),
        p_allow_shipped: !!opts?.allowShipped,
      }),
    );
    return ok === true;
  },

  async setShippingInfo(conversationId, buyerId, info) {
    const ok = await must(
      db().rpc("set_shipping_info", {
        p_conv: conversationId,
        p_buyer: buyerId,
        p_info: { method: info.method, recipientName: info.recipientName, phone: info.phone, storeOrAddress: info.storeOrAddress },
      }),
    );
    return ok === true;
  },

  async getShippingInfo(conversationId, userId) {
    const r = (await must(db().rpc("get_shipping_info", { p_conv: conversationId, p_user: userId }))) as Row | null;
    if (!r || typeof r !== "object") return null;
    return {
      offerId: r.offerId as string,
      method: r.method as ShippingInfo["method"],
      recipientName: r.recipientName as string,
      phone: r.phone as string,
      storeOrAddress: r.storeOrAddress as string,
    };
  },

  async markShipped(conversationId, sellerId, trackingNo, systemMessage) {
    const ok = await must(
      db().rpc("mark_shipped", {
        p_conv: conversationId,
        p_seller: sellerId,
        p_tracking: trackingNo ?? null,
        p_msg: msgTo(systemMessage),
      }),
    );
    return ok === true;
  },
};
