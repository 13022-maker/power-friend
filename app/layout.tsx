import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { repo } from "@/lib/data";
import { currentUserId } from "@/lib/session";
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
  const [profiles, uid] = await Promise.all([r.listProfiles(), currentUserId()]);

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
            <UserSwitcher users={profiles.map((p) => ({ id: p.id, name: p.displayName }))} current={uid} />
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
