export type Category =
  | "camera"
  | "camping"
  | "figure"
  | "electronics"
  | "books"
  | "fashion"
  | "furniture"
  | "other";

export type Condition = "new" | "like_new" | "good" | "fair" | "worn";

export type VerificationLevel = 0 | 1 | 2; // 0 未驗證 · 1 手機 · 2 手機＋自拍驗證碼

export interface Profile {
  id: string;
  displayName: string;
  areaId: string;
  bio: string;
  interests: string[];
  verificationLevel: VerificationLevel;
  joinedAt: string; // ISO
  deals: number;
  positiveRate: number; // 0..1
  validReports: number;
  tasteVec: number[];
}

export type ListingStatus = "active" | "reserved" | "sold";

/**
 * 付款方式：只是買賣雙方約定的方式，平台不經手金流（不收款、不代收）。
 * meetup_cash 面交付款｜cod 貨到付款（超商取貨付款／宅配代收）｜bank_transfer 匯款轉帳｜mobile_pay 行動支付轉帳
 * 中文標籤見 lib/payment.ts 的 PAYMENT_LABELS。
 */
export type PaymentMethod = "meetup_cash" | "cod" | "bank_transfer" | "mobile_pay";

export interface Listing {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: Category;
  condition: Condition;
  price: number;
  aiPriceLow: number;
  aiPriceHigh: number;
  areaId: string;
  photo?: string; // data URL 或 Storage URL
  /** 由數量推導並寫回（lib/payment.ts#deriveStatus）；不要直接改，改數量走 Repo 的原子操作 */
  status: ListingStatus;
  createdAt: string;
  views: number;
  embedding: number[];
  /** 總數量 1..999（舊資料預設 1） */
  quantity: number;
  /** 已保留（已接受、未成交） */
  reservedQty: number;
  /** 已成交 */
  soldQty: number;
  /** 至少一種、不重複；預設 ["meetup_cash"] */
  paymentMethods: PaymentMethod[];
  /** 0..1000；只有含 cod 時有意義（0 表示含運），不含 cod 時一律存 0 */
  shippingFee: number;
}

export type OfferStatus = "pending" | "accepted" | "declined" | "completed" | "cancelled";

export interface Offer {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  /** 單價（總額見 lib/payment.ts#offerTotal） */
  amount: number;
  message: string;
  messageHash: string;
  aiDrafted: boolean;
  status: OfferStatus;
  createdAt: string;
  /** 1..(下單當下可售數量) */
  quantity: number;
  /** 必須在 listing.paymentMethods 內 */
  paymentMethod: PaymentMethod;
  /** 運費快照：出價當下物品的運費（只有 cod 才有，其餘為 0）；之後物品改運費不影響這筆訂單 */
  shippingFee: number;
  /** 貨到付款：賣家標記已寄出的時間 */
  shippedAt?: string;
  /** 選填物流單號：英數與 -，最多 40 字 */
  trackingNo?: string;
}

export type ShippingMethod = "cvs_pickup" | "home_delivery";

/**
 * 貨到付款收件資訊（個資）：獨立儲存（Supabase 為 offer_shipping，加密），不放在 Offer 上。
 * 只有該筆訂單的買家可寫、買賣雙方可讀；成交或取消後清除。
 */
export interface ShippingInfo {
  offerId: string;
  method: ShippingMethod;
  recipientName: string;
  phone: string;
  storeOrAddress: string;
}

export type RiskLevel = "none" | "low" | "high";

export interface Conversation {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  aiDrafted: boolean;
  risk: RiskLevel;
  riskReasons: string[];
  createdAt: string;
}

export interface Block {
  blockerId: string;
  blockedId: string;
}

export interface Report {
  id: string;
  reporterId: string;
  targetId: string;
  reason: string;
  counted: boolean; // 只採計可信帳戶的檢舉
  createdAt: string;
}

export type SortMode = "nearby" | "taste" | "likely";

export interface RankedListing extends Listing {
  seller: Profile;
  distanceKm: number;
  tasteFit: number; // 0..100
  trust: number; // 0..100
  score: number;
}
