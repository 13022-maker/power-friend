import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { repo } from "@/lib/data";
import { currentUserId, currentUserOrNull, authUser } from "@/lib/session";
import { logout } from "@/app/actions";
import { UserSwitcher } from "@/components/UserSwitcher";
import { isMuseEnabled } from "@/lib/ai/muse";

export const metadata: Metadata = {
  title: "POWER Friend 以物會友二手市集",
  description: "AI 世代的二手交易平台：拍照即上架、品味配對、出價開聊、內建防詐。",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const r = repo();
  const demo = r.mode === "demo";
  // demo：示範帳號切換；supabase：真正登入（未登入也能看探索頁）
  const [profiles, uid] = demo ? await Promise.all([r.listProfiles(), currentUserId()]) : [[], ""];
  const me = demo ? null : await currentUserOrNull();
  const signedIn = !demo && !me ? await authUser() : null; // 已登入但尚未建立 profile

  return (
    <html lang="zh-Hant-TW">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="stamp">PF</span>
              POWER Friend <small>以物會友二手市集</small>
            </Link>
            <nav className="nav-desktop">
              <Link href="/">探索</Link>
              <Link href="/sell">上架</Link>
              <Link href="/inbox">出價與聊天</Link>
              <Link href="/me">我的</Link>
            </nav>
            <span className="spacer" />
            <span className="mode-pill">
              {r.mode === "demo" ? "Demo 資料" : "Supabase"}・AI：{isMuseEnabled() ? "Muse Spark" : "本地規則"}
            </span>
            {demo ? (
              <UserSwitcher users={profiles.map((p) => ({ id: p.id, name: p.displayName }))} current={uid} />
            ) : me || signedIn ? (
              <form action={logout} className="row" style={{ gap: 8 }}>
                {me ? <Link href="/me">{me.displayName}</Link> : <Link href="/onboarding">完成註冊</Link>}
                <button className="btn ghost small">登出</button>
              </form>
            ) : (
              <Link href="/login" className="btn small">登入</Link>
            )}
          </div>
        </header>
        <main className="shell">{children}</main>
        <nav className="bottomnav">
          <Link href="/"><span className="ico">探</span>探索</Link>
          <Link href="/sell"><span className="ico">＋</span>上架</Link>
          <Link href="/inbox"><span className="ico">聊</span>出價聊天</Link>
          <Link href="/me"><span className="ico">我</span>我的</Link>
        </nav>
      </body>
    </html>
  );
}
