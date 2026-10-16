import Link from "next/link";
import { redirect } from "next/navigation";
import { authUser, isAuthMode } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "登入・POWER Friend" };

const LOGIN_ERRORS: Record<string, string> = {
  oauth: "第三方登入未完成或被取消",
  exchange: "驗證連結無效或已過期",
  missing: "驗證連結不完整",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  // 只認白名單代碼，查無則不顯示（不把網址參數原文顯示在頁面上）
  const errorText = typeof sp.error === "string" && Object.hasOwn(LOGIN_ERRORS, sp.error) ? LOGIN_ERRORS[sp.error] : null;
  if (!isAuthMode()) {
    return (
      <>
        <h1>登入</h1>
        <p className="lead">目前是 Demo 模式，不需要登入：用右上角「我是 ○○」切換示範帳號即可。</p>
        <p>
          <Link href="/" className="btn">回探索</Link>
        </p>
      </>
    );
  }
  if (await authUser()) redirect("/onboarding"); // 已登入：onboarding 會判斷是否已有 profile
  return (
    <>
      <h1>登入 POWER Friend</h1>
      <p className="lead">用 Email 驗證碼或 Google 帳號登入，第一次登入會請你設定暱稱與面交區域。</p>
      {errorText && <p className="notice err" style={{ maxWidth: 420 }}>登入失敗：{errorText}，請再試一次。</p>}
      <LoginForm phoneEnabled={process.env.NEXT_PUBLIC_AUTH_PHONE === "1"} />
    </>
  );
}
