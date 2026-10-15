import { cookies } from "next/headers";
import { repo } from "./data";
import type { Profile } from "./types";

export const SESSION_COOKIE = "pf_uid";
const DEFAULT_USER = "u_an";

/**
 * 原型用「切換示範帳號」取代登入，方便一人扮演買賣雙方。
 * 第一階段改為 Supabase Auth（簡訊 OTP / Google），此函式改讀 auth.getUser()。
 */
export async function currentUserId(): Promise<string> {
  const jar = await cookies();
  const v = jar.get(SESSION_COOKIE)?.value;
  return v && /^[a-z0-9_-]{1,64}$/i.test(v) ? v : DEFAULT_USER; // 只接受安全字元，避免帶入查詢語法
}

export async function currentUser(): Promise<Profile> {
  const id = await currentUserId();
  const r = repo();
  const p = (await r.getProfile(id)) ?? (await r.getProfile(DEFAULT_USER));
  if (!p) throw new Error("找不到示範帳號，請確認 seed 資料");
  return p;
}
