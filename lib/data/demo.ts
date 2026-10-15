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

  async listListings() {
    return [...store().listings.values()].map(clone);
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
  async listReports(f) {
    return store()
      .reports.filter((r) => (!f.reporterId || r.reporterId === f.reporterId) && (!f.targetId || r.targetId === f.targetId))
      .map(clone);
  },
};
