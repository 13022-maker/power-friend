import { redirect } from "next/navigation";
import { repo } from "@/lib/data";
import { authUser, isAuthMode } from "@/lib/session";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "建立個人檔案・POWER Friend" };

export default async function OnboardingPage() {
  if (!isAuthMode()) redirect("/"); // demo 模式沒有註冊流程
  const u = await authUser();
  if (!u) redirect("/login");
  if (await repo().getProfile(u.id)) redirect("/");

  return (
    <>
      <h1>歡迎加入 POWER Friend</h1>
      <p className="lead">設定暱稱與面交區域就能開始。興趣用來計算「品味契合 %」，之後成交會自動更新。</p>
      <OnboardingForm defaultName={u.name ?? u.email?.split("@")[0] ?? ""} />
    </>
  );
}
