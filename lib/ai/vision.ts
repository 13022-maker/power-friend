import type { Category, Condition } from "../types";
import { estimatePrice, type PriceEstimate } from "./pricing";

/**
 * 「拍照即上架」辨識。
 * 原型以關鍵字規則模擬視覺模型：讀使用者的一句描述＋照片檔名。
 * 正式版：把照片送多模態模型，要求回傳相同的 JSON 結構（ItemAnalysis），其餘流程不變。
 */
export interface ItemAnalysis {
  title: string;
  category: Category;
  condition: Condition;
  description: string;
  tags: string[];
  confidence: number; // 0..1
  originalPrice?: number;
  price: PriceEstimate;
  notes: string[];
  source: "rules" | "muse";
}

const RULES: { re: RegExp; category: Category; title?: string; base: number; tags: string[] }[] = [
  { re: /底片|膠卷|film|fm2|ae-?1|pentax|leica|徠卡/i, category: "camera", title: "底片相機", base: 9000, tags: ["底片", "相機"] },
  { re: /相機|鏡頭|camera|sony|canon|nikon|fuji|富士|微單|單眼/i, category: "camera", base: 18000, tags: ["相機"] },
  { re: /帳篷|天幕|睡袋|露營|營燈|snow ?peak|coleman|爐|蛋捲桌|折疊椅/i, category: "camping", base: 4500, tags: ["露營"] },
  { re: /公仔|模型|鋼彈|gunpla|盒玩|扭蛋|figure|樂高|lego|景品/i, category: "figure", base: 1800, tags: ["收藏"] },
  { re: /iphone|ipad|macbook|switch|ps5|耳機|airpods|筆電|螢幕|手機|鍵盤|滑鼠/i, category: "electronics", base: 15000, tags: ["3C"] },
  { re: /書|小說|漫畫|教科書|參考書|繪本|book/i, category: "books", base: 250, tags: ["書"] },
  { re: /外套|襯衫|洋裝|鞋|包|帽|牛仔|jacket|nike|adidas|uniqlo|古著/i, category: "fashion", base: 1200, tags: ["服飾"] },
  { re: /椅|桌|櫃|燈|沙發|床|收納|ikea|無印|muji/i, category: "furniture", base: 2200, tags: ["家具"] },
];

const COND_RULES: { re: RegExp; condition: Condition }[] = [
  { re: /近全新|九成五|95新|極新|只用過/i, condition: "like_new" },
  { re: /全新|未拆|未使用|\bnew\b/i, condition: "new" },
  { re: /明顯|破損|磨損|故障|零件|壞/i, condition: "worn" },
  { re: /使用痕跡|小刮|刮傷|泛黃|七成/i, condition: "fair" },
];

const PRICE_RE = /(?:原價|買)\s*(?:nt\$?|\$)?\s*(\d[\d,]{2,})/i;

export function analyzeItem(hint: string, fileName = ""): ItemAnalysis {
  const text = `${hint} ${fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")}`.trim();
  const rule = RULES.find((r) => r.re.test(text));
  const cond = COND_RULES.find((r) => r.re.test(text))?.condition ?? "good";
  const notes: string[] = [];

  const original = text.match(PRICE_RE)?.[1];
  const originalPrice = original ? Number(original.replace(/,/g, "")) : undefined;
  if (originalPrice) notes.push(`偵測到原價 NT$${originalPrice.toLocaleString("zh-TW")}，以此為估價基準`);

  const category: Category = rule?.category ?? "other";
  const cleaned = hint.replace(PRICE_RE, "").replace(/[，,。！!]+$/g, "").trim();
  const title = (cleaned.split(/[，,。\n]/)[0] || rule?.title || "二手好物").slice(0, 30);

  if (!rule) notes.push("無法確定分類，請手動選擇");
  if (cond === "good") notes.push("成色預設為「良好」，請依實況調整");
  notes.push("瑕疵請補拍特寫：AI 會在說明中標註，減少糾紛");

  const price = estimatePrice(category, cond, originalPrice ?? rule?.base);
  return {
    title,
    category,
    condition: cond,
    description: cleaned
      ? `${cleaned}。\n（AI 草稿，請確認後再上架）`
      : "（AI 草稿）請補充購買時間、使用狀況、配件是否齊全。",
    tags: rule?.tags ?? [],
    confidence: rule ? (originalPrice ? 0.86 : 0.72) : 0.35,
    originalPrice,
    price,
    notes,
    source: "rules",
  };
}
