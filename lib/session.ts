import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repo } from "./data";
import type { Profile } from "./types";

export const SESSION_COOKIE = "pf_uid";
const DEFAULT_USER = "u_an";

/**
 * 兩種登入方式：
 * - Demo 模式：cookie `pf_uid` 切換示範帳號（一人扮演買賣雙方）。
 * - Supabase 模式：Supabase Auth（Email OTP／Google），id = auth.users.id（uuid 字串，存在 profiles.id text）。
 */
export const isAuthMode = () => repo().mode === "supabase";

function demoId(v: string | undefined): string {
  return v && /^[a-z0-9_-]{1,64}$/i.test(v) ? v : DEFAULT_USER; // 只接受安全字元，避免帶入查詢語法
}

/** Supabase 模式：回傳已登入的 auth user（未登入為 null）。Demo 模式一律 null。 */
export async function authUser(): Promise<{ id: string; email?: string; phone?: string; name?: string } | null> {
  if (!isAuthMode()) return null;
  const { createSupabaseServerClient } = await import("./supabase/server");
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const name = (meta.full_name ?? meta.name) as string | undefined;
  return { id: data.user.id, email: data.user.email, phone: data.user.phone, name };
}

/** 目前使用者 id。Supabase 模式未登入 → 導向 /login（不檢查是否已建立 profile）。 */
export async function currentUserId(): Promise<string> {
  if (isAuthMode()) {
    const u = await authUser();
    if (!u) redirect("/login");
    return u.id;
  }
  const jar = await cookies();
  return demoId(jar.get(SESSION_COOKIE)?.value);
}

/** 需要登入的頁面／動作用。Supabase 模式：未登入 → /login；已登入但沒有 profile → /onboarding。 */
export async function currentUser(): Promise<Profile> {
  if (isAuthMode()) {
    const u = await authUser();
    if (!u) redirect("/login");
    const p = await repo().getProfile(u.id);
    if (!p) redirect("/onboarding");
    return p;
  }
  const id = await currentUserId();
  const r = repo();
  const p = (await r.getProfile(id)) ?? (await r.getProfile(DEFAULT_USER));
  if (!p) throw new Error("找不到示範帳號，請確認 seed 資料");
  return p;
}

/** 可未登入瀏覽的頁面用（探索、layout）。Supabase 模式未登入或尚未建立 profile → null；demo 模式同 currentUser()。 */
export async function currentUserOrNull(): Promise<Profile | null> {
  if (isAuthMode()) {
    const u = await authUser();
    return u ? await repo().getProfile(u.id) : null;
  }
  return currentUser();
}

/** API route 用：未登入回傳 null（由 route 回 401），不做 redirect。 */
export async function apiUserId(): Promise<string | null> {
  if (isAuthMode()) return (await authUser())?.id ?? null;
  return currentUserId();
}
