import type { Block, Conversation, Listing, Message, Offer, Profile, Report } from "../types";

/** 資料存取介面：demo（記憶體）與 Supabase 兩種實作共用，商業邏輯只依賴這層 */
export interface Repo {
  mode: "demo" | "supabase";
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | null>;
  updateProfile(p: Profile): Promise<void>;

  listListings(): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | null>;
  createListing(l: Listing): Promise<void>;
  updateListing(l: Listing): Promise<void>;

  listOffers(filter: { buyerId?: string; sellerId?: string; listingId?: string }): Promise<Offer[]>;
  getOffer(id: string): Promise<Offer | null>;
  createOffer(o: Offer): Promise<void>;
  updateOffer(o: Offer): Promise<void>;

  listConversations(userId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(c: Conversation): Promise<void>;

  listMessages(conversationId: string): Promise<Message[]>;
  createMessage(m: Message): Promise<void>;

  listBlocks(userId: string): Promise<Block[]>;
  createBlock(b: Block): Promise<void>;
  deleteBlock(b: Block): Promise<void>;

  createReport(r: Report): Promise<void>;
  listReports(filter: { reporterId?: string; targetId?: string }): Promise<Report[]>;
}

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
