import type { Block, Conversation, Listing, Message, Offer, Profile, Report } from "../types";
import type { Repo } from "./repo";
import { seedListings, seedProfiles } from "./seed";

interface Store {
  profiles: Map<string, Profile>;
  listings: Map<string, Listing>;
  offers: Map<string, Offer>;
  conversations: Map<string, Conversation>;
  messages: Message[];
  blocks: Block[];
  reports: Report[];
}

const g = globalThis as unknown as { __pfStore?: Store };

function store(): Store {
  if (!g.__pfStore) {
    g.__pfStore = {
      profiles: new Map(seedProfiles().map((p) => [p.id, p])),
      listings: new Map(seedListings().map((l) => [l.id, l])),
      offers: new Map(),
      conversations: new Map(),
      messages: [],
      blocks: [],
      reports: [],
    };
  }
  return g.__pfStore;
}

export function resetDemoStore() {
  g.__pfStore = undefined;
}

const clone = <T>(x: T): T => structuredClone(x);

export const demoRepo: Repo = {
  mode: "demo",
  async listProfiles() {
    return [...store().profiles.values()].map(clone);
  },
  async getProfile(id) {
    const p = store().profiles.get(id);
    return p ? clone(p) : null;
  },
  async updateProfile(p) {
    store().profiles.set(p.id, clone(p));
  },

  async listListings(opts) {
    return [...store().listings.values()].filter((l) => opts?.includeSold || l.status !== "sold").map(clone);
  },
  async getListing(id) {
    const l = store().listings.get(id);
    return l ? clone(l) : null;
  },
  async createListing(l) {
    store().listings.set(l.id, clone(l));
  },
  async updateListing(l) {
    store().listings.set(l.id, clone(l));
  },
  async incrementViews(listingId) {
    const l = store().listings.get(listingId);
    if (l) l.views += 1;
  },

  async listOffers(f) {
    return [...store().offers.values()]
      .filter((o) => (!f.buyerId || o.buyerId === f.buyerId) && (!f.sellerId || o.sellerId === f.sellerId) && (!f.listingId || o.listingId === f.listingId))
      .map(clone);
  },
  async getOffer(id) {
    const o = store().offers.get(id);
    return o ? clone(o) : null;
  },
  async createOffer(o) {
    store().offers.set(o.id, clone(o));
  },
  async updateOffer(o) {
    store().offers.set(o.id, clone(o));
  },

  async listConversations(userId) {
    return [...store().conversations.values()].filter((c) => c.buyerId === userId || c.sellerId === userId).map(clone);
  },
  async getConversation(id) {
    const c = store().conversations.get(id);
    return c ? clone(c) : null;
  },
  async createConversation(c) {
    store().conversations.set(c.id, clone(c));
  },

  async listMessages(conversationId) {
    return store().messages.filter((m) => m.conversationId === conversationId).map(clone);
  },
  async createMessage(m) {
    store().messages.push(clone(m));
  },

  async listBlocks(userId) {
    return store().blocks.filter((b) => b.blockerId === userId || b.blockedId === userId).map(clone);
  },
  async createBlock(b) {
    const s = store();
    if (!s.blocks.some((x) => x.blockerId === b.blockerId && x.blockedId === b.blockedId)) s.blocks.push(clone(b));
  },
  async deleteBlock(b) {
    const s = store();
    s.blocks = s.blocks.filter((x) => !(x.blockerId === b.blockerId && x.blockedId === b.blockedId));
  },

  async createReport(r) {
    store().reports.push(clone(r));
  },
  async incrementValidReports(targetId) {
    const p = store().profiles.get(targetId);
    if (p) p.validReports += 1;
  },
  async listReports(f) {
    return store()
      .reports.filter((r) => (!f.reporterId || r.reporterId === f.reporterId) && (!f.targetId || r.targetId === f.targetId))
      .map(clone);
  },

  async deleteAccount(userId) {
    const s = store();
    s.profiles.delete(userId);
    const ownListings = new Set<string>();
    for (const l of s.listings.values()) if (l.sellerId === userId) ownListings.add(l.id);
    for (const id of ownListings) s.listings.delete(id);
    // 對應 FK cascade：自己的出價、別人對自己物品的出價
    for (const o of [...s.offers.values()])
      if (o.buyerId === userId || o.sellerId === userId || ownListings.has(o.listingId)) s.offers.delete(o.id);
    const convIds = new Set<string>();
    for (const c of [...s.conversations.values()])
      if (c.buyerId === userId || c.sellerId === userId || ownListings.has(c.listingId)) {
        convIds.add(c.id);
        s.conversations.delete(c.id);
      }
    s.messages = s.messages.filter((m) => !convIds.has(m.conversationId) && m.senderId !== userId);
    s.blocks = s.blocks.filter((b) => b.blockerId !== userId && b.blockedId !== userId);
    // 本人提出的檢舉隨帳號刪除（reporter_id on delete cascade）；
    // 「檢舉本人」的紀錄保留作為證據（SQL 為 target_id on delete set null，demo 原樣保留）
    s.reports = s.reports.filter((r) => r.reporterId !== userId);
  },

  // 單執行緒：以下檢查與寫入之間沒有 await，等同原子操作
  async acceptOffer(offerId, sellerId, conv, firstMessage) {
    const s = store();
    const offer = s.offers.get(offerId);
    if (!offer || offer.status !== "pending" || offer.sellerId !== sellerId) return false;
    const listing = s.listings.get(offer.listingId);
    if (!listing || listing.status !== "active" || listing.sellerId !== sellerId) return false;
    if (s.conversations.has(conv.id)) return false;
    listing.status = "reserved";
    offer.status = "accepted";
    // 對話的雙方與物品一律以出價紀錄為準，不信任呼叫端傳入的值
    const c: Conversation = { ...clone(conv), offerId: offer.id, listingId: offer.listingId, buyerId: offer.buyerId, sellerId: offer.sellerId };
    s.conversations.set(c.id, c);
    s.messages.push({ ...clone(firstMessage), conversationId: c.id });
    return true;
  },

  async completeDeal(conversationId, sellerId, buyerTaste, systemMessage) {
    const s = store();
    const conv = s.conversations.get(conversationId);
    if (!conv || conv.sellerId !== sellerId) return false;
    const listing = s.listings.get(conv.listingId);
    if (!listing || listing.status !== "reserved") return false;
    // 防洗成交：同一對帳號（不分買賣方向）若已有成交紀錄，這次不再加成交數
    const pairDealtBefore = [...s.conversations.values()].some(
      (c) =>
        c.id !== conv.id &&
        ((c.buyerId === conv.buyerId && c.sellerId === conv.sellerId) || (c.buyerId === conv.sellerId && c.sellerId === conv.buyerId)) &&
        s.listings.get(c.listingId)?.status === "sold",
    );
    listing.status = "sold";
    const seller = s.profiles.get(conv.sellerId);
    const buyer = s.profiles.get(conv.buyerId);
    if (!pairDealtBefore) {
      if (seller) seller.deals += 1;
      if (buyer) buyer.deals += 1;
    }
    if (buyer) buyer.tasteVec = [...buyerTaste];
    s.messages.push({ ...clone(systemMessage), conversationId });
    return true;
  },
};
