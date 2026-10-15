import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { repo } from "@/lib/data";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Supabase Auth 回呼：
 * - `?code=`：Google OAuth 與 magic link（PKCE flow）→ exchangeCodeForSession
 * - `?token_hash=&type=`：自訂 Email 範本的連結 → verifyOtp
 * 成功後導向 `next`（只接受白名單站內路徑，見 lib/safe-redirect.ts），預設 /onboarding（已有 profile 會再轉回首頁）。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, origin));
  if (repo().mode === "demo") return NextResponse.redirect(new URL("/", origin));

  // 白名單站內路徑（防 open redirect：`/\evil.com`、`/\t/evil.com` 等）
  const next = safeNextPath(searchParams.get("next"), origin);

  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError) return fail(oauthError);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const sb = await createSupabaseServerClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return fail(error.message);
  } else if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail(error.message);
  } else {
    return fail("缺少驗證參數");
  }
  return NextResponse.redirect(new URL(next, origin));
}
