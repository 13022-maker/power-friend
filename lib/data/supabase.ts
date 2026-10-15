import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Block, Conversation, Listing, Message, Offer, Profile, Report } from "../types";
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
});
const listingTo = (l: Listing): Row => ({
  id: l.id,
  seller_id: l.sellerId,
  title: l.title,
  description: l.description,
  category: l.category,
  condition: l.condition,
  price: l.price,
  ai_price_low: l.aiPriceLow,
  ai_price_high: l.aiPriceHigh,
  area_id: l.areaId,
  photo_url: l.photo ?? null,
  status: l.status,
  created_at: l.createdAt,
  views: l.views,
  embedding: toVec(l.embedding),
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

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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

  async listListings() {
    return (await rows(db().from("listings").select("*").neq("status", "sold"))).map(listingFrom);
  },
  async getListing(id) {
    const r = await must(db().from("listings").select("*").eq("id", id).maybeSingle());
    return r ? listingFrom(r) : null;
  },
  async createListing(l) {
    await must(db().from("listings").insert(listingTo(l)));
  },
  async updateListing(l) {
    await must(db().from("listings").update(listingTo(l)).eq("id", l.id));
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

  async listConversations(userId) {
    return (await rows(db().from("conversations").select("*").or(`buyer_id.eq.${userId},seller_id.eq.${userId}`))).map(convFrom);
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
    await must(
      db().from("messages").insert({
        id: m.id,
        conversation_id: m.conversationId,
        sender_id: m.senderId,
        body: m.body,
        ai_drafted: m.aiDrafted,
        risk: m.risk,
        risk_reasons: m.riskReasons,
        created_at: m.createdAt,
      }),
    );
  },

  async listBlocks(userId) {
    const list = await rows(db().from("blocks").select("*").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`));
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
      db().from("reports").insert({ id: r.id, reporter_id: r.reporterId, target_id: r.targetId, reason: r.reason, counted: r.counted, created_at: r.createdAt }),
    );
  },
  async listReports(f) {
    let q = db().from("reports").select("*");
    if (f.reporterId) q = q.eq("reporter_id", f.reporterId);
    if (f.targetId) q = q.eq("target_id", f.targetId);
    return (await rows(q)).map(
      (r: Row): Report => ({
        id: r.id as string,
        reporterId: r.reporter_id as string,
        targetId: r.target_id as string,
        reason: r.reason as string,
        counted: !!r.counted,
        createdAt: r.created_at as string,
      }),
    );
  },
};
