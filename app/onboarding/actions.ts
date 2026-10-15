"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { repo } from "@/lib/data";
import { authUser } from "@/lib/session";
import { LIMITS, isArea } from "@/lib/validation";
import { embed } from "@/lib/ai/embedding";
import type { Profile } from "@/lib/types";

export type OnboardingState = { error?: string };

/** 第一次登入：建立 profiles 列（id = auth user id）。只在 Supabase 模式有效。 */
export async function createProfileAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const r = repo();
  if (r.mode === "demo") redirect("/");
  const u = await authUser();
  if (!u) redirect("/login");
  if (await r.getProfile(u.id)) redirect("/"); // 已建立過，不覆寫成交數等欄位

  const displayName = String(formData.get("displayName") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "");
  const bio = String(formData.get("bio") ?? "").trim().slice(0, LIMITS.bioMax);
  const interests = String(formData.get("interests") ?? "")
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!displayName) return { error: "請輸入暱稱" };
  if (displayName.length > LIMITS.nicknameMax) return { error: `暱稱請在 ${LIMITS.nicknameMax} 字以內` };
  if (!isArea(areaId)) return { error: "請選擇面交區域" };
  if (interests.length > LIMITS.interestsMax) return { error: `興趣最多 ${LIMITS.interestsMax} 項` };
  if (interests.some((s) => s.length > LIMITS.interestLenMax)) return { error: `每項興趣請在 ${LIMITS.interestLenMax} 字以內` };

  const profile: Profile = {
    id: u.id,
    displayName,
    areaId,
    bio,
    interests,
    verificationLevel: 0,
    joinedAt: new Date().toISOString(),
    deals: 0,
    positiveRate: 0,
    validReports: 0,
    tasteVec: embed(`${interests.join(" ")} ${bio}`),
  };
  await r.updateProfile(profile); // upsert
  revalidatePath("/", "layout");
  redirect("/");
}
