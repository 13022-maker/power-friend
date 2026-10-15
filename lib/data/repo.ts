import type { Block, Conversation, Listing, Message, Offer, Profile, Report } from "../types";

/** 資料存取介面：demo（記憶體）與 Supabase 兩種實作共用，商業邏輯只依賴這層 */
export interface Repo {
  mode: "demo" | "supabase";
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | null>;
  updateProfile(p: Profile): Promise<void>;

  /** 預設不含已售出（兩種實作一致）；includeSold: true 時全部回傳 */
  listListings(opts?: { includeSold?: boolean }): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | null>;
  createListing(l: Listing): Promise<void>;
  updateListing(l: Listing): Promise<void>;
  /** 瀏覽數原子 +1，不改寫其他欄位 */
  incrementViews(listingId: string): Promise<void>;

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
  /** 有效檢舉數原子 +1 */
  incrementValidReports(targetId: string): Promise<void>;
  listReports(filter: { reporterId?: string; targetId?: string }): Promise<Report[]>;

  /**
   * 刪除帳號（個資法）：profile、其上架、出價（發出與收到）、所屬對話與訊息、封鎖、檢舉。
   * 「把對方保留中的物品改回上架」由 services.deleteAccount 先處理，這裡只負責刪資料。
   */
  deleteAccount(userId: string): Promise<void>;

  /**
   * 原子操作：出價須為 pending 且屬於 sellerId、物品須為 active →
   * 物品改 reserved、出價改 accepted、建立對話與第一則訊息。
   * 任一前提不成立回傳 false，且不做任何變更（兩個並行的接受不可能同時成功）。
   */
  acceptOffer(offerId: string, sellerId: string, conv: Conversation, firstMessage: Message): Promise<boolean>;

  /**
   * 原子操作：conv.sellerId 須等於 sellerId 且物品為 reserved → 物品改 sold；
   * 只有這對買賣雙方「先前沒有任何已成交紀錄」時，雙方 deals 才各 +1（防洗成交數）；
   * 買家 taste_vec = buyerTaste；寫入系統訊息。前提不成立回傳 false。
   */
  completeDeal(conversationId: string, sellerId: string, buyerTaste: number[], systemMessage: Message): Promise<boolean>;
}

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
