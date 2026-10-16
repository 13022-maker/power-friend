/**
 * 數量、付款方式、貨到付款的共用常數與純函式（server／client 都可 import，不含 server-only 相依）。
 * 平台不經手金流：付款方式只是買賣雙方約定的方式，平台記錄並提示風險，不收款、不代收。
 */
import type { Listing, ListingStatus, Offer, OfferStatus, PaymentMethod, ShippingInfo, ShippingMethod, VerificationLevel } from "./types";

export const PAYMENT_METHODS = ["meetup_cash", "cod", "bank_transfer", "mobile_pay"] as const satisfies readonly PaymentMethod[];

/** UI 共用的中文標籤 */
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  meetup_cash: "面交付款",
  cod: "貨到付款",
  bank_transfer: "匯款轉帳",
  mobile_pay: "行動支付轉帳",
};

/** 付款方式的補充說明（UI 可顯示在選項下方） */
export const PAYMENT_HINTS: Record<PaymentMethod, string> = {
  meetup_cash: "當面驗貨、當面付款，最安全",
  cod: "超商取貨付款／宅配代收，買家取貨時付款",
  bank_transfer: "買家先匯款，賣家再出貨",
  mobile_pay: "買家先以行動支付轉帳，賣家再出貨",
};

/** 先付款類：買家要先把錢給賣家（詐騙最常見手法），只有完成驗證（verificationLevel ≥ 1）的賣家能開啟 */
export const PREPAY_METHODS: readonly PaymentMethod[] = ["bank_transfer", "mobile_pay"];
export const PREPAY_MIN_VERIFICATION: VerificationLevel = 1;
export const isPrepay = (m: PaymentMethod) => PREPAY_METHODS.includes(m);

/** 先付款類出價成功時附上的固定提醒 */
export const PREPAY_WARNING = "先付款是詐騙最常見的手法，請確認賣家身分與成交紀錄，切勿點擊對方給的付款連結";

/** 出價／訂單狀態的中文標籤（UI 共用） */
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  pending: "等待回覆",
  accepted: "保留中",
  declined: "已婉拒",
  completed: "已成交",
  cancelled: "已取消",
};

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ["meetup_cash"];

export const QTY_LIMITS = { min: 1, max: 999 } as const;
export const SHIPPING_FEE_MAX = 1000;
export const TRACKING_NO_MAX = 40;

export const SHIPPING_METHODS = ["cvs_pickup", "home_delivery"] as const satisfies readonly ShippingMethod[];
export const SHIPPING_METHOD_LABELS: Record<ShippingMethod, string> = {
  cvs_pickup: "超商取貨付款",
  home_delivery: "宅配代收",
};
export const SHIPPING_LIMITS = { nameMax: 20, storeOrAddressMin: 2, storeOrAddressMax: 100 } as const;

export const isPaymentMethod = (x: unknown): x is PaymentMethod =>
  typeof x === "string" && (PAYMENT_METHODS as readonly string[]).includes(x);
export const isShippingMethod = (x: unknown): x is ShippingMethod =>
  typeof x === "string" && (SHIPPING_METHODS as readonly string[]).includes(x);

/* ───────────── 數量與狀態 ───────────── */

type Qty = Pick<Listing, "quantity" | "reservedQty" | "soldQty">;

/** 可售數量 = 總數 − 已保留 − 已成交（不小於 0） */
export const listingAvailable = (l: Qty) => Math.max(0, l.quantity - l.reservedQty - l.soldQty);

/** 由數量推導狀態：還有可售 → active；全被保留／部分成交 → reserved；全部成交 → sold */
export function deriveStatus(l: Qty): ListingStatus {
  if (listingAvailable(l) > 0) return "active";
  if (l.soldQty >= l.quantity) return "sold";
  return "reserved";
}

/** 運費只在貨到付款時加收 */
/** 出價當下要快照到 offer 上的運費（貨到付款才收，其他付款方式為 0） */
export const offerShippingFee = (o: Pick<Offer, "paymentMethod">, l: Pick<Listing, "shippingFee">) =>
  o.paymentMethod === "cod" ? l.shippingFee : 0;

/** 已成立出價的總額 = 單價 × 數量 ＋ 出價當下快照的運費（不讀物品現值） */
export const offerTotal = (o: Pick<Offer, "amount" | "quantity" | "shippingFee">) => o.amount * o.quantity + o.shippingFee;

/** 出價前的試算（出價表單用）：運費取物品目前設定 */
export const quoteTotal = (o: Pick<Offer, "amount" | "quantity" | "paymentMethod">, l: Pick<Listing, "shippingFee">) =>
  o.amount * o.quantity + offerShippingFee(o, l);

/* ───────────── 驗證 ───────────── */

export const isValidQuantity = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= QTY_LIMITS.min && n <= QTY_LIMITS.max;

export const isValidShippingFee = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= SHIPPING_FEE_MAX;

/** 物流單號：英數與 -，1..40 字 */
export const isValidTrackingNo = (s: unknown): s is string =>
  typeof s === "string" && new RegExp(`^[A-Za-z0-9-]{1,${TRACKING_NO_MAX}}$`).test(s);

/** 上架的付款方式驗證；通過回傳 null。sellerLevel 未提供時不檢查先付款類資格（action 層預檢用） */
export function validatePaymentMethods(methods: unknown, sellerLevel?: VerificationLevel): string | null {
  if (!Array.isArray(methods) || methods.length === 0) return "請至少選擇一種付款方式";
  if (!methods.every(isPaymentMethod)) return "付款方式無效";
  if (new Set(methods).size !== methods.length) return "付款方式重複";
  if (sellerLevel !== undefined && sellerLevel < PREPAY_MIN_VERIFICATION && methods.some(isPrepay))
    return "匯款轉帳、行動支付（先付款）僅限完成手機驗證的賣家開啟";
  return null;
}

const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
const clean = (s: unknown) => String(s ?? "").replace(CONTROL, "").trim();

/** 收件資訊驗證與正規化（去除控制字元／零寬字元、手機去掉空白與 -）。回傳錯誤訊息或正規化後的資料 */
export function normalizeShippingInfo(
  input: Partial<Omit<ShippingInfo, "offerId">>,
): { ok: true; data: Omit<ShippingInfo, "offerId"> } | { ok: false; error: string } {
  if (!isShippingMethod(input.method)) return { ok: false, error: "請選擇取貨方式" };
  const recipientName = clean(input.recipientName);
  if (recipientName.length < 1 || [...recipientName].length > SHIPPING_LIMITS.nameMax)
    return { ok: false, error: `收件人姓名請填 1 到 ${SHIPPING_LIMITS.nameMax} 字` };
  const phone = clean(input.phone).replace(/[\s-]/g, "");
  if (!/^09\d{8}$/.test(phone)) return { ok: false, error: "手機號碼格式應為 09 開頭共 10 碼" };
  const storeOrAddress = clean(input.storeOrAddress);
  const len = [...storeOrAddress].length;
  if (len < SHIPPING_LIMITS.storeOrAddressMin || len > SHIPPING_LIMITS.storeOrAddressMax)
    return {
      ok: false,
      error: `${input.method === "cvs_pickup" ? "取貨門市" : "收件地址"}請填 ${SHIPPING_LIMITS.storeOrAddressMin} 到 ${SHIPPING_LIMITS.storeOrAddressMax} 字`,
    };
  return { ok: true, data: { method: input.method, recipientName, phone, storeOrAddress } };
}
