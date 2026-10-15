"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, currentUser } from "@/lib/session";
import { repo } from "@/lib/data";
import { resetDemoStore } from "@/lib/data/demo";
import type { ItemAnalysis } from "@/lib/ai/vision";
import type { Suggestion } from "@/lib/ai/negotiate";
import { analyzeItemSmart, suggestRepliesSmart } from "@/lib/ai/smart";
import * as svc from "@/lib/services";
import type { Category, Condition } from "@/lib/types";

export async function switchUser(id: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

export async function resetDemo() {
  if (repo().mode === "demo") resetDemoStore();
  revalidatePath("/", "layout");
}

/* 上架 */
export async function analyzeAction(hint: string, fileName: string, photo?: string): Promise<ItemAnalysis> {
  await currentUser(); // 只有登入者能用 AI 辨識（避免被當免費代理）
  if (photo && photo.length > 3_000_000) photo = undefined;
  return analyzeItemSmart(hint.slice(0, 300), fileName.slice(0, 120), photo);
}

export async function createListingAction(input: {
  title: string;
  description: string;
  category: Category;
  condition: Condition;
  price: number;
  originalPrice?: number;
  photo?: string;
}): Promise<{ error?: string; notice?: string; id?: string }> {
  const me = await currentUser();
  if (input.photo && input.photo.length > 3_000_000) return { error: "照片太大，請壓縮後再上傳" };
  const res = await svc.createListing(me, input);
  if (!res.ok) return { error: res.error };
  revalidatePath("/");
  return { id: res.data?.id, notice: res.notice };
}

/* 出價 */
export async function offerAction(listingId: string, amount: number, message: string, aiDrafted: boolean) {
  const me = await currentUser();
  const res = await svc.createOffer(me, listingId, amount, message, aiDrafted);
  revalidatePath("/inbox");
  return res.ok ? { ok: true as const, notice: res.notice } : { ok: false as const, error: res.error };
}

export async function buyerSuggestAction(listingId: string): Promise<Suggestion[]> {
  const l = await repo().getListing(listingId);
  if (!l) return [];
  return suggestRepliesSmart({ role: "buyer", listingTitle: l.title, listPrice: l.price, aiLow: l.aiPriceLow, aiHigh: l.aiPriceHigh });
}

export async function respondOfferAction(formData: FormData) {
  const me = await currentUser();
  const offerId = String(formData.get("offerId"));
  const accept = formData.get("decision") === "accept";
  const res = await svc.respondOffer(me, offerId, accept);
  revalidatePath("/inbox");
  revalidatePath("/");
  if (res.ok && res.data?.conversationId) redirect(`/chat/${res.data.conversationId}`);
}

/* 聊天 */
export async function sendMessageAction(conversationId: string, body: string, aiDrafted: boolean) {
  const me = await currentUser();
  const res = await svc.sendMessage(me, conversationId, body, aiDrafted);
  return res.ok ? { ok: true as const, message: res.data! } : { ok: false as const, error: res.error };
}

export async function chatSuggestAction(conversationId: string): Promise<Suggestion[]> {
  const me = await currentUser();
  const r = repo();
  const conv = await r.getConversation(conversationId);
  if (!conv || (conv.buyerId !== me.id && conv.sellerId !== me.id)) return [];
  const [l, offer, msgs] = await Promise.all([r.getListing(conv.listingId), r.getOffer(conv.offerId), r.listMessages(conversationId)]);
  if (!l) return [];
  return suggestRepliesSmart(
    {
      role: conv.sellerId === me.id ? "seller" : "buyer",
      listingTitle: l.title,
      listPrice: l.price,
      aiLow: l.aiPriceLow,
      aiHigh: l.aiPriceHigh,
      lastOffer: offer?.amount,
    },
    msgs.filter((m) => m.senderId !== "system").map((m) => `${m.senderId === me.id ? "我" : "對方"}：${m.body}`),
  );
}

export async function completeDealAction(conversationId: string) {
  const me = await currentUser();
  const res = await svc.completeDeal(me, conversationId);
  revalidatePath(`/chat/${conversationId}`);
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
}

/* 封鎖與檢舉 */
export async function toggleBlockAction(targetId: string) {
  const me = await currentUser();
  const res = await svc.toggleBlock(me, targetId);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true as const, blocked: res.data!.blocked } : { ok: false as const, error: res.error };
}

export async function reportAction(targetId: string, reason: string) {
  const me = await currentUser();
  const res = await svc.report(me, targetId, reason);
  return res.ok ? { ok: true as const, notice: res.notice } : { ok: false as const, error: res.error };
}
