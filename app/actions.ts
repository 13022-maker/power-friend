"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { SESSION_COOKIE, currentUser } from "@/lib/session";
import { repo } from "@/lib/data";
import { resetDemoStore } from "@/lib/data/demo";
import type { ItemAnalysis } from "@/lib/ai/vision";
import type { Suggestion } from "@/lib/ai/negotiate";
import { analyzeItemSmart, suggestRepliesSmart } from "@/lib/ai/smart";
import * as svc from "@/lib/services";
import { removePhotoByUrl, savePhoto, stripPhotoMetadata } from "@/lib/storage";
import { RATE_LIMIT_ERROR, checkLimit } from "@/lib/ratelimit";
import { logActionError, safeAction } from "@/lib/safe-action";
import type { Category, Condition, PaymentMethod, ShippingMethod } from "@/lib/types";

/** 表單值的基本型別轉換：空字串／非數字 → undefined（驗證交給 services） */
const toInt = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const toStr = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

export async function switchUser(id: string) {
  if (repo().mode !== "demo") return; // Supabase 模式用真正的登入，絕不允許切換身分
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

export async function logout() {
  if (repo().mode === "demo") return;
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const sb = await createSupabaseServerClient();
  await sb.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function resetDemo() {
  if (repo().mode === "demo") resetDemoStore();
  revalidatePath("/", "layout");
}

/* 上架 */
export async function analyzeAction(
  hint: string,
  fileName: string,
  photo?: string,
): Promise<{ ok: true; data: ItemAnalysis } | { ok: false; error: string }> {
  return safeAction("analyzeAction", async () => {
    const me = await currentUser(); // 只有登入者能用 AI 辨識（避免被當免費代理）
    if (!checkLimit(me.id, "analyze")) return { ok: false, error: RATE_LIMIT_ERROR };
    if (typeof photo !== "string" || photo.length > 3_000_000) photo = undefined;
    if (photo) {
      try {
        photo = await stripPhotoMetadata(photo); // 去除 EXIF／GPS 後才送 Muse
      } catch {
        photo = undefined; // 無效照片：只用文字描述辨識
      }
    }
    return { ok: true as const, data: await analyzeItemSmart(String(hint ?? "").slice(0, 300), String(fileName ?? "").slice(0, 120), photo) };
  }, "AI 辨識失敗，請稍後再試");
}

export async function createListingAction(input: {
  title: string;
  description: string;
  category: Category;
  condition: Condition;
  price: number;
  originalPrice?: number;
  photo?: string;
  quantity?: number;
  paymentMethods?: PaymentMethod[];
  shippingFee?: number;
}): Promise<{ error?: string; notice?: string; id?: string }> {
  const r = await safeAction("createListingAction", async (): Promise<{ error?: string; notice?: string; id?: string }> => {
    const me = await currentUser();
    input = {
      ...input,
      quantity: toInt(input.quantity),
      paymentMethods: Array.isArray(input.paymentMethods) ? input.paymentMethods.map(toStr) as PaymentMethod[] : undefined,
      shippingFee: toInt(input.shippingFee),
    };
    const invalid = svc.validateListingInput(input, me); // 上傳照片前先驗證（含先付款類的賣家資格），避免孤兒照片
    if (invalid) return { error: invalid };
    if (input.photo !== undefined && typeof input.photo !== "string") return { error: "照片格式不支援" };
    if (input.photo && input.photo.length > 3_000_000) return { error: "照片太大，請壓縮後再上傳" };
    let photo: string | undefined;
    if (input.photo) {
      try {
        photo = await savePhoto(input.photo, me.id); // demo：原樣 data URL；supabase：上傳 Storage 回傳 public URL
      } catch (e) {
        return { error: e instanceof Error ? e.message : "照片上傳失敗" };
      }
    }
    let res: Awaited<ReturnType<typeof svc.createListing>>;
    try {
      res = await svc.createListing(me, { ...input, photo });
    } catch (e) {
      if (photo) await removePhotoByUrl(photo).catch(() => {}); // 寫入例外也要清掉孤兒照片
      throw e;
    }
    if (!res.ok) {
      if (photo) await removePhotoByUrl(photo).catch(() => {}); // 上架失敗：清掉剛上傳的孤兒照片
      return { error: res.error };
    }
    revalidatePath("/");
    return { id: res.data?.id, notice: res.notice };
  }, "上架失敗，請稍後再試");
  return "ok" in r ? { error: r.error } : r;
}

/* 出價 */
export async function offerAction(
  listingId: string,
  amount: number,
  message: string,
  aiDrafted: boolean,
  opts: { quantity?: number; paymentMethod?: PaymentMethod } = {},
) {
  return safeAction("offerAction", async () => {
    const me = await currentUser();
    const res = await svc.createOffer(me, toStr(listingId), Number(amount), toStr(message), aiDrafted === true, {
      quantity: toInt(opts?.quantity),
      paymentMethod: opts?.paymentMethod ? (toStr(opts.paymentMethod) as PaymentMethod) : undefined,
    });
    revalidatePath("/inbox");
    return res.ok ? { ok: true as const, notice: res.notice, total: res.data?.total } : { ok: false as const, error: res.error };
  }, "出價失敗，請稍後再試");
}

export async function buyerSuggestAction(listingId: string): Promise<{ ok: true; data: Suggestion[] } | { ok: false; error: string }> {
  return safeAction("buyerSuggestAction", async () => {
    const me = await currentUser(); // 需登入，避免 AI 端點被匿名濫用
    if (!checkLimit(me.id, "suggest")) return { ok: false, error: RATE_LIMIT_ERROR };
    const l = await repo().getListing(listingId);
    if (!l) return { ok: true, data: [] };
    return {
      ok: true,
      data: await suggestRepliesSmart({ role: "buyer", listingTitle: l.title, listPrice: l.price, aiLow: l.aiPriceLow, aiHigh: l.aiPriceHigh }),
    };
  }, "AI 建議暫時無法使用，請稍後再試");
}

export async function respondOfferAction(formData: FormData) {
  let res: Awaited<ReturnType<typeof svc.respondOffer>>;
  try {
    const me = await currentUser();
    const offerId = String(formData.get("offerId"));
    const accept = formData.get("decision") === "accept";
    res = await svc.respondOffer(me, offerId, accept);
  } catch (e) {
    unstable_rethrow(e); // currentUser() 的 redirect("/login") 等交回 Next
    logActionError("respondOfferAction", e);
    redirect("/inbox?error=unknown"); // 白名單代碼，頁面顯示固定中文
  }
  revalidatePath("/inbox");
  revalidatePath("/");
  if (res.ok && res.data?.conversationId) redirect(`/chat/${res.data.conversationId}`);
  // 只帶錯誤代碼（白名單），inbox 依代碼顯示固定中文；不把錯誤字串放進網址
  if (!res.ok) redirect(`/inbox?error=${svc.respondErrorCode(res.error)}`);
}

/* 聊天 */
export async function sendMessageAction(conversationId: string, body: string, aiDrafted: boolean) {
  return safeAction("sendMessageAction", async () => {
    const me = await currentUser();
    const res = await svc.sendMessage(me, conversationId, body, aiDrafted);
    return res.ok ? { ok: true as const, message: res.data! } : { ok: false as const, error: res.error };
  }, "訊息送出失敗，請稍後再試");
}

export async function chatSuggestAction(conversationId: string): Promise<{ ok: true; data: Suggestion[] } | { ok: false; error: string }> {
  return safeAction("chatSuggestAction", async () => {
    const me = await currentUser();
    const r = repo();
    const conv = await r.getConversation(conversationId);
    if (!conv || (conv.buyerId !== me.id && conv.sellerId !== me.id)) return { ok: true, data: [] };
    if (!checkLimit(me.id, "suggest")) return { ok: false, error: RATE_LIMIT_ERROR };
    const [l, offer, msgs] = await Promise.all([r.getListing(conv.listingId), r.getOffer(conv.offerId), r.listMessages(conversationId)]);
    if (!l) return { ok: true, data: [] };
    const data = await suggestRepliesSmart(
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
    return { ok: true, data };
  }, "AI 建議暫時無法使用，請稍後再試");
}

export async function completeDealAction(conversationId: string) {
  return safeAction("completeDealAction", async () => {
    const me = await currentUser();
    const res = await svc.completeDeal(me, conversationId);
    revalidatePath(`/chat/${conversationId}`);
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  }, "標記成交失敗，請稍後再試");
}

/* 訂單：取消、貨到付款（收件資訊、標記寄出）。身分一律取自 session */
export async function cancelOrderAction(conversationId: string) {
  return safeAction("cancelOrderAction", async () => {
    const me = await currentUser();
    const res = await svc.cancelOrder(me, toStr(conversationId));
    revalidatePath(`/chat/${conversationId}`);
    revalidatePath("/inbox");
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  }, "取消訂單失敗，請稍後再試");
}

export async function setShippingInfoAction(
  conversationId: string,
  info: { method: ShippingMethod; recipientName: string; phone: string; storeOrAddress: string },
) {
  return safeAction("setShippingInfoAction", async () => {
    const me = await currentUser();
    const res = await svc.setShippingInfo(me, toStr(conversationId), {
      method: toStr(info?.method) as ShippingMethod,
      recipientName: toStr(info?.recipientName),
      phone: toStr(info?.phone),
      storeOrAddress: toStr(info?.storeOrAddress),
    });
    revalidatePath(`/chat/${conversationId}`);
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  }, "收件資訊儲存失敗，請稍後再試");
}

export async function markShippedAction(conversationId: string, trackingNo?: string) {
  return safeAction("markShippedAction", async () => {
    const me = await currentUser();
    const res = await svc.markShipped(me, toStr(conversationId), toStr(trackingNo) || undefined);
    revalidatePath(`/chat/${conversationId}`);
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  }, "標記寄出失敗，請稍後再試");
}

/* 封鎖與檢舉 */
export async function toggleBlockAction(targetId: string) {
  return safeAction("toggleBlockAction", async () => {
    const me = await currentUser();
    const res = await svc.toggleBlock(me, targetId);
    revalidatePath("/", "layout");
    return res.ok ? { ok: true as const, blocked: res.data!.blocked } : { ok: false as const, error: res.error };
  }, "封鎖操作失敗，請稍後再試");
}

export async function reportAction(targetId: string, reason: string) {
  return safeAction("reportAction", async () => {
    const me = await currentUser();
    const res = await svc.report(me, targetId, reason);
    return res.ok ? { ok: true as const, notice: res.notice } : { ok: false as const, error: res.error };
  }, "檢舉送出失敗，請稍後再試");
}

/* 刪除帳號（個資法）：需輸入顯示名稱確認 */
export async function deleteAccountAction(confirmName: string): Promise<{ error?: string }> {
  const r = await safeAction("deleteAccountAction", async (): Promise<{ error?: string }> => {
    const me = await currentUser();
    if (confirmName.trim() !== me.displayName.trim()) return { error: "輸入的名稱與你的顯示名稱不符，未刪除任何資料" };
    const res = await svc.deleteAccount(me);
    if (!res.ok) return { error: res.error };
    const jar = await cookies();
    if (repo().mode === "demo") {
      jar.delete(SESSION_COOKIE); // 回到預設示範帳號
    } else {
      try {
        const { createSupabaseServerClient } = await import("@/lib/supabase/server");
        await (await createSupabaseServerClient()).auth.signOut({ scope: "local" }); // 清掉本機 session cookie
      } catch {
        // auth user 已刪除，signOut 失敗不影響結果
      }
    }
    revalidatePath("/", "layout");
    redirect(`/?deleted=${res.data?.released ?? 0}`); // released：因刪帳號而取消、釋出保留數量的訂單數
  }, "刪除帳號失敗，請稍後再試");
  return "ok" in r ? { error: r.error } : r;
}
