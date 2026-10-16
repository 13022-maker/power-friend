import { NextResponse } from "next/server";
import { repo } from "@/lib/data";
import { createOffer, explore } from "@/lib/services";
import { CATEGORIES, formatNTD } from "@/lib/catalog";
import { PAYMENT_LABELS, PAYMENT_METHODS, isPaymentMethod, listingAvailable } from "@/lib/payment";
import type { Category, Listing } from "@/lib/types";

/**
 * 給外部 AI agent 的工具端點（JSON-RPC 2.0，對齊 MCP 的 initialize / tools/list / tools/call）。
 * 身分：Demo 模式用 header `x-agent-for`；Supabase 模式用 `Authorization: Bearer <access token>`（見 resolveAgentUser）。
 * 正式版再加上 OAuth 授權範圍＋使用者設定的底價與次數上限，且每筆 agent 出價都標記 aiDrafted、可由本人撤回。
 */

const TOOLS = [
  {
    name: "search_listings",
    description: "以自然語言搜尋二手物品，依『最可能成交』排序。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "例如：適合新手的底片相機" },
        category: { type: "string", enum: Object.keys(CATEGORIES) },
        max_price: { type: "number" },
        limit: { type: "number", default: 5 },
      },
    },
  },
  {
    name: "get_listing",
    description: "取得物品細節與 AI 行情區間。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "make_offer",
    description:
      "代表使用者出價。amount 為單價；總額 = 單價 × 數量 ＋（貨到付款時）運費。訊息會標記為 AI 代擬，賣家可見。平台不經手金流；agent 無法讀寫收件資訊。",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: { type: "string" },
        amount: { type: "number", description: "單價（整數）" },
        message: { type: "string" },
        quantity: { type: "number", default: 1, description: "1..可售數量（available）" },
        payment_method: { type: "string", enum: [...PAYMENT_METHODS], description: "須在物品的 payment_methods 內；預設物品的第一種" },
      },
      required: ["listing_id", "amount", "message"],
    },
  },
];

/**
 * 決定 agent 代表哪位使用者：
 * - Demo 模式：header `x-agent-for: <user id>`（方便本機測試）。
 * - Supabase 模式：只接受 `Authorization: Bearer <access token>`，由 Supabase Auth 驗證；忽略 x-agent-for。
 */
async function resolveAgentUser(req: Request) {
  const r = repo();
  if (r.mode === "demo") {
    const agentFor = req.headers.get("x-agent-for");
    return agentFor ? r.getProfile(agentFor) : null;
  }
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const { userIdFromAccessToken } = await import("@/lib/supabase/server");
  const uid = await userIdFromAccessToken(m[1]);
  return uid ? r.getProfile(uid) : null;
}

/** 交易相關欄位（不含任何收件資訊） */
const tradeInfo = (l: Listing) => ({
  available: listingAvailable(l),
  payment_methods: l.paymentMethods,
  payment_labels: l.paymentMethods.map((m) => PAYMENT_LABELS[m]),
  shipping_fee: l.paymentMethods.includes("cod") ? l.shippingFee : null,
});

type RpcReq = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const ok = (id: RpcReq["id"], result: unknown) => NextResponse.json({ jsonrpc: "2.0", id, result });
const fail = (id: RpcReq["id"], code: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
const text = (id: RpcReq["id"], payload: unknown) => ok(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });

export async function POST(req: Request) {
  let body: RpcReq;
  try {
    body = await req.json();
  } catch {
    return fail(null as unknown as undefined, -32700, "Parse error");
  }
  const { id, method, params = {} } = body;

  if (method === "initialize")
    return ok(id, { protocolVersion: "2025-06-18", serverInfo: { name: "power-friend", version: "0.1.0" }, capabilities: { tools: {} } });
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method !== "tools/call") return fail(id, -32601, `Unknown method ${method}`);

  const user = await resolveAgentUser(req);
  if (!user)
    return fail(
      id,
      -32001,
      repo().mode === "demo"
        ? "缺少 x-agent-for 或使用者不存在（Demo 模式）"
        : "需要 Authorization: Bearer <Supabase access token>，且帳號已建立個人檔案",
    );

  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (name === "search_listings") {
    const cat = typeof args.category === "string" && Object.hasOwn(CATEGORIES, args.category) ? (args.category as Category) : "";
    const items = await explore(user, { mode: "likely", category: cat, q: (args.query as string) ?? "" });
    const max = typeof args.max_price === "number" ? args.max_price : Infinity;
    return text(
      id,
      items
        .filter((l) => l.price <= max && l.status === "active")
        .slice(0, Number(args.limit ?? 5))
        .map((l) => ({
          id: l.id,
          title: l.title,
          price: l.price,
          fair_range: [l.aiPriceLow, l.aiPriceHigh],
          taste_fit: l.tasteFit,
          seller_trust: l.trust,
          distance_km: Math.round(l.distanceKm),
          ...tradeInfo(l),
        })),
    );
  }

  if (name === "get_listing") {
    const l = await repo().getListing(String(args.id));
    if (!l) return fail(id, -32002, "找不到物品");
    return text(id, {
      id: l.id,
      title: l.title,
      description: l.description,
      price: formatNTD(l.price),
      fair_range: `${formatNTD(l.aiPriceLow)}–${formatNTD(l.aiPriceHigh)}`,
      status: l.status,
      ...tradeInfo(l),
    });
  }

  if (name === "make_offer") {
    const quantity = args.quantity === undefined || args.quantity === null ? 1 : Number(args.quantity);
    const pm = args.payment_method;
    if (pm !== undefined && pm !== null && !isPaymentMethod(pm)) return fail(id, -32602, `payment_method 只能是 ${PAYMENT_METHODS.join("、")}`);
    const res = await createOffer(user, String(args.listing_id), Number(args.amount), String(args.message ?? ""), true, {
      quantity,
      paymentMethod: pm ?? undefined,
    });
    return res.ok
      ? text(id, { offer_id: res.data?.id, total: res.data?.total ?? null, notice: res.notice ?? null })
      : fail(id, -32003, res.error);
  }

  return fail(id, -32602, `Unknown tool ${name}`);
}
