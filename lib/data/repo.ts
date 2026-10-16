import type { Block, Conversation, Listing, Message, Offer, Profile, Report, ShippingInfo } from "../types";

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
   * 刪除帳號（個資法）：profile、其上架、出價（發出與收到）、所屬對話與訊息、封鎖、檢舉、收件資訊。
   * 「釋出本人 accepted 訂單的保留數量」由 services.deleteAccount 先以 cancelOrder 處理，這裡只負責刪資料。
   */
  deleteAccount(userId: string): Promise<void>;

  /** 原子：出價須為 pending 且屬於 sellerId → declined。前提不成立回傳 false */
  declineOffer(offerId: string, sellerId: string): Promise<boolean>;

  /**
   * 原子操作：出價須為 pending 且屬於 sellerId、物品可售數量 ≥ offer.quantity →
   * reservedQty += quantity、狀態重算、出價改 accepted、建立對話與第一則訊息。
   * 任一前提不成立回傳 false，且不做任何變更（並行的接受不可能超賣）。
   */
  acceptOffer(offerId: string, sellerId: string, conv: Conversation, firstMessage: Message): Promise<boolean>;

  /**
   * 原子操作（以對話對應的 offer 為單位）：conv.sellerId 須等於 sellerId、offer 須 accepted；
   * 貨到付款須已寄出 → reservedQty -= q、soldQty += q、狀態重算、offer completed；
   * 只有這對帳號（不分買賣方向）「先前沒有任何已成交出價」時，雙方 deals 才各 +1（防洗成交數）；
   * 買家 taste_vec = buyerTaste；寫入系統訊息；清除收件資訊。前提不成立回傳 false。
   */
  completeDeal(conversationId: string, sellerId: string, buyerTaste: number[], systemMessage: Message): Promise<boolean>;

  /**
   * 原子操作：actorId 須為對話的買方或賣方、offer 須 accepted；
   * 已寄出的貨到付款只有賣家可取消（allowShipped 為 true 時不限，僅供刪除帳號使用）→
   * offer cancelled、reservedQty -= q、狀態重算、寫入系統訊息、清除收件資訊。前提不成立回傳 false。
   */
  cancelOrder(conversationId: string, actorId: string, systemMessage: Message, opts?: { allowShipped?: boolean }): Promise<boolean>;

  /**
   * 原子操作：buyerId 須為對話的買方、offer 須為 accepted 的貨到付款且尚未寄出 → 寫入（覆蓋）收件資訊。
   * 前提不成立回傳 false。info 須先經 normalizeShippingInfo 驗證。
   */
  setShippingInfo(conversationId: string, buyerId: string, info: Omit<ShippingInfo, "offerId">): Promise<boolean>;

  /** userId 須為對話的買方或賣方，否則回傳 null（與「尚未填寫」不可區分，由 service 先檢查權限） */
  getShippingInfo(conversationId: string, userId: string): Promise<ShippingInfo | null>;

  /**
   * 原子操作：sellerId 須為對話的賣方、offer 須為 accepted 的貨到付款、已有收件資訊、尚未寄出 →
   * shippedAt = now、trackingNo、寫入系統訊息。前提不成立回傳 false。
   */
  markShipped(conversationId: string, sellerId: string, trackingNo: string | undefined, systemMessage: Message): Promise<boolean>;
}

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
