import Link from "next/link";
import { redirect } from "next/navigation";
import { authUser, isAuthMode } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "登入・POWER Friend" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
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
      {sp.error && <p className="notice err" style={{ maxWidth: 420 }}>登入失敗：{sp.error.slice(0, 120)}，請再試一次。</p>}
      <LoginForm phoneEnabled={process.env.NEXT_PUBLIC_AUTH_PHONE === "1"} />
    </>
  );
}
