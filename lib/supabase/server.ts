import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Auth 用的伺服器端 client（anon key + 使用者 cookie，受 RLS 約束）。
 * 注意：資料存取仍走 lib/data/supabase.ts（service role）；這個 client 只用來讀取登入狀態。
 * 每個 request 都要建立新的 client（@supabase/ssr 的規定），不可共用。
 */
export function supabaseAuthEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase Auth 需要 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, anonKey };
}

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseAuthEnv();
  const jar = await cookies(); // Next 16：cookies() 為 async
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Server Component 內不能寫 cookie；session 由 proxy.ts 負責刷新，可安全忽略
        }
      },
    },
  });
}

/** 給 /api/mcp 等以 `Authorization: Bearer <access token>` 呼叫的端點：驗證 token 並回傳使用者 id */
export async function userIdFromAccessToken(token: string): Promise<string | null> {
  const { url, anonKey } = supabaseAuthEnv();
  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token); // 向 Supabase Auth 伺服器驗證，不只解碼 JWT
  return error || !data.user ? null : data.user.id;
}
