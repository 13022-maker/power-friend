/**
 * AI 能力的統一入口：有 Muse Spark 金鑰就用 Muse，失敗或未設定一律退回本地規則。
 * 原則：
 *  - 規則層永遠先跑：聯絡方式先遮蔽再送 Muse，降低個資外流。
 *  - Muse 只能「升級」風險，不能把規則判定的高風險降級。
 *  - 價格以本地估價公式為準，Muse 只負責辨識品名／分類／成色／原價與撰寫文字。
 */
import type { Category, Condition, RiskLevel } from "../types";
import { CATEGORIES, CONDITIONS } from "../catalog";
import { analyzeItem, type ItemAnalysis } from "./vision";
import { estimatePrice } from "./pricing";
import { riskCheck, type RiskResult } from "./scam";
import { suggestReplies, type NegotiationContext, type Suggestion } from "./negotiate";
import { isMuseEnabled, museJSON, MuseError, type ChatMessage } from "./muse";

const log = (where: string, e: unknown) => console.warn(`[muse:${where}] 退回本地規則：`, e instanceof Error ? e.message : e);

const CAT_KEYS = Object.keys(CATEGORIES) as Category[];
const COND_KEYS = Object.keys(CONDITIONS) as Condition[];

/* ───────── 1. 拍照即上架 ───────── */

interface MuseItem {
  title?: string;
  category?: string;
  condition?: string;
  description?: string;
  defects?: string[];
  original_price?: number | null;
  confidence?: number;
}

export async function analyzeItemSmart(hint: string, fileName = "", photo?: string): Promise<ItemAnalysis> {
  const base = analyzeItem(hint, fileName);
  if (!isMuseEnabled() || (!photo && !hint.trim())) return base;

  const content: ChatMessage["content"] = [
    {
      type: "text",
      text:
        `賣家描述：「${riskCheck(hint).masked || "（無）"}」\n` +
        `請辨識這件二手物品，只回傳 JSON：{"title":品名(30字內,繁中),"category":${JSON.stringify(CAT_KEYS)}之一,` +
        `"condition":${JSON.stringify(COND_KEYS)}之一,"description":給買家的說明(80字內,繁中,只寫看得到或賣家說的事),` +
        `"defects":[看得到的瑕疵],"original_price":台幣原價數字或null,"confidence":0到1}`,
    },
  ];
  if (photo?.startsWith("data:image/")) content.push({ type: "image_url", image_url: { url: photo } });

  try {
    const r = await museJSON<MuseItem>(
      [
        { role: "system", content: "你是台灣二手市集的上架助手。不確定就降低 confidence，不要編造型號或規格。" },
        { role: "user", content },
      ],
      { maxTokens: 600 },
    );
    const category = CAT_KEYS.includes(r.category as Category) ? (r.category as Category) : base.category;
    const condition = COND_KEYS.includes(r.condition as Condition) ? (r.condition as Condition) : base.condition;
    const originalPrice =
      typeof r.original_price === "number" && r.original_price > 0 && r.original_price < 5_000_000
        ? Math.round(r.original_price)
        : base.originalPrice;
    const defects = (r.defects ?? []).filter((d) => typeof d === "string" && d.trim()).slice(0, 5);
    const desc = (r.description || base.description).slice(0, 300);
    const notes = [
      "由 Muse Spark 辨識照片與描述",
      ...(originalPrice ? [`估價基準：原價 NT$${originalPrice.toLocaleString("zh-TW")}`] : []),
      ...(defects.length ? [`AI 看到的瑕疵：${defects.join("、")}（已寫進說明）`] : []),
      "請確認成色與配件，避免交易糾紛",
    ];
    return {
      title: (r.title || base.title).slice(0, 30),
      category,
      condition,
      description: defects.length ? `${desc}\n瑕疵：${defects.join("、")}` : desc,
      tags: base.tags,
      confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0.7))),
      originalPrice,
      price: estimatePrice(category, condition, originalPrice),
      notes,
      source: "muse",
    };
  } catch (e) {
    log("analyze", e);
    return base;
  }
}

/* ───────── 2. 防詐第三層：AI 分類器 ───────── */

interface MuseRisk {
  level?: string;
  reasons?: string[];
}

export interface SmartRisk extends RiskResult {
  source: "rules" | "muse";
}

export async function riskCheckSmart(text: string): Promise<SmartRisk> {
  const rules = riskCheck(text);
  // 規則已判高風險就不必再花 token；太短的訊息（嗯、好、謝謝）也略過
  if (!isMuseEnabled() || rules.level === "high" || text.trim().length < 6) return { ...rules, source: "rules" };
  try {
    const r = await museJSON<MuseRisk>(
      [
        {
          role: "system",
          content:
            "你是台灣二手交易平台的防詐審查員。判斷這則買賣雙方的聊天訊息是否為詐騙話術" +
            "（假物流/假客服/要求先匯款/保證金/引導點連結/冒充官方/索取驗證碼或帳戶資料）。" +
            '只回傳 JSON：{"level":"none"|"low"|"high","reasons":[簡短中文理由]}。一般議價、約面交一律 none。',
        },
        { role: "user", content: rules.masked }, // 已遮蔽聯絡方式
      ],
      { maxTokens: 200 },
    );
    const level = (["none", "low", "high"] as RiskLevel[]).includes(r.level as RiskLevel) ? (r.level as RiskLevel) : "none";
    const rank = { none: 0, low: 1, high: 2 };
    const final = rank[level] > rank[rules.level] ? level : rules.level; // 只升不降
    const extra = final !== rules.level ? (r.reasons ?? []).slice(0, 3).map((x) => `AI：${x}`) : [];
    return { level: final, reasons: [...rules.reasons, ...extra], masked: rules.masked, source: "muse" };
  } catch (e) {
    log("risk", e);
    return { ...rules, source: "rules" };
  }
}

/* ───────── 3. 議價助手 ───────── */

interface MuseSuggestions {
  suggestions?: { label?: string; text?: string; amount?: number | null }[];
}

export async function suggestRepliesSmart(ctx: NegotiationContext, recent: string[] = []): Promise<Suggestion[]> {
  const base = suggestReplies(ctx);
  if (!isMuseEnabled()) return base;
  const floor = Math.round(ctx.aiLow * 0.7);
  const ceil = Math.round(Math.max(ctx.listPrice, ctx.aiHigh) * 1.1);
  try {
    const r = await museJSON<MuseSuggestions>(
      [
        {
          role: "system",
          content:
            "你是台灣二手市集的議價助手，用自然、有禮貌的台灣繁體中文口語寫 3 個回覆草稿。" +
            "不要建議私下加 LINE、先匯款或任何站外交易；面交建議捷運站或超商。" +
            '只回傳 JSON：{"suggestions":[{"label":4字內,"text":60字內,"amount":數字或null}]}',
        },
        {
          role: "user",
          content: JSON.stringify({
            我的角色: ctx.role === "buyer" ? "買家" : "賣家",
            物品: ctx.listingTitle,
            標價: ctx.listPrice,
            AI行情: [ctx.aiLow, ctx.aiHigh],
            目前出價: ctx.lastOffer ?? null,
            最近對話: recent.slice(-6).map((m) => riskCheck(m).masked),
          }),
        },
      ],
      { maxTokens: 500 },
    );
    const out = (r.suggestions ?? [])
      .filter((s) => s.text && s.label)
      .slice(0, 3)
      .map<Suggestion>((s) => ({
        label: String(s.label).slice(0, 6),
        // AI 寫的草稿也要過規則層，避免模型自己寫出聯絡方式
        text: riskCheck(String(s.text)).masked.slice(0, 120),
        amount: typeof s.amount === "number" && s.amount >= floor && s.amount <= ceil ? Math.round(s.amount) : undefined,
      }));
    if (out.length === 0) throw new MuseError("沒有可用的建議");
    return out;
  } catch (e) {
    log("negotiate", e);
    return base;
  }
}
