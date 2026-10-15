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
  status: ListingStatus;
  createdAt: string;
  views: number;
  embedding: number[];
}

export type OfferStatus = "pending" | "accepted" | "declined";

export interface Offer {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  message: string;
  messageHash: string;
  aiDrafted: boolean;
  status: OfferStatus;
  createdAt: string;
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
