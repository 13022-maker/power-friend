"use client";

import { createBrowserClient } from "@supabase/ssr";

/** 瀏覽器端 Supabase client（anon key），session 存在 cookie，伺服器端讀得到 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
