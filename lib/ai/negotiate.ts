import { formatNTD } from "../catalog";

export interface NegotiationContext {
  role: "buyer" | "seller";
  listingTitle: string;
  listPrice: number;
  aiLow: number;
  aiHigh: number;
  lastOffer?: number;
}

export interface Suggestion {
  label: string;
  text: string;
  amount?: number;
}

const r100 = (n: number) => (n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);

/**
 * 議價助手：依 AI 估價區間給 2～3 個回覆草稿。
 * 送出時訊息會標記 aiDrafted，對方看得到「AI 代擬」（AI 透明原則）。
 */
export function suggestReplies(ctx: NegotiationContext): Suggestion[] {
  const mid = (ctx.aiLow + ctx.aiHigh) / 2;
  const offer = ctx.lastOffer ?? ctx.listPrice;

  if (ctx.role === "buyer") {
    const fair = r100(Math.min(ctx.listPrice, Math.max(ctx.aiLow, mid * 0.95)));
    const firm = r100(Math.max(ctx.aiLow * 0.95, fair * 0.92));
    return [
      { label: "合理出價", amount: fair, text: `您好，${ctx.listingTitle} 我很有興趣，參考近期行情，${formatNTD(fair)} 可以嗎？可以配合您的面交時間。` },
      { label: "爽快成交", amount: ctx.listPrice, text: `不議價沒問題，${formatNTD(ctx.listPrice)} 成交！請問這週哪天方便面交？` },
      { label: "試探底價", amount: firm, text: `請問 ${formatNTD(firm)} 有機會嗎？如果可以我今天就能取貨。` },
    ];
  }

  // 賣家
  const counter = r100(Math.max(offer, (offer + ctx.listPrice) / 2));
  const tooLow = offer < ctx.aiLow * 0.9;
  return [
    tooLow
      ? { label: "婉拒低價", text: `謝謝詢問！這個價格比行情（約 ${formatNTD(ctx.aiLow)}–${formatNTD(ctx.aiHigh)}）低不少，${formatNTD(counter)} 的話我可以接受。`, amount: counter }
      : { label: "接受出價", text: `可以，${formatNTD(offer)} 成交！請問您方便在哪個捷運站面交？`, amount: offer },
    { label: "折衷還價", amount: counter, text: `各退一步，${formatNTD(counter)} 如何？配件都會一起附上。` },
    { label: "約面交", text: "我平日晚上 7 點後、週末下午都可以，地點建議選捷運站內或超商，雙方都安心。" },
  ];
}
