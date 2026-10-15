import type { Repo } from "./repo";
import { demoRepo } from "./demo";
import { supabaseRepo } from "./supabase";

export type AppMode = "demo" | "supabase";

/** Supabase 伺服器端存取需要 URL ＋ service role key（不接受只有 anon key） */
export const isSupabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * 決定資料模式：
 * - APP_MODE=demo｜supabase 明確指定（建議正式環境一律設定）。
 * - 未設定：有 Supabase 環境變數就用 Supabase，否則 demo；
 *   但 production（NODE_ENV=production）若缺 Supabase 環境變數則直接報錯，絕不默默退回 demo
 *   （demo 模式可切換身分，正式環境開到等於無驗證）。
 * - `next build` 也以 NODE_ENV=production 執行；建置階段（NEXT_PHASE=phase-production-build）不擋，
 *   錯誤留到實際處理請求時才拋出。
 */
export function appMode(): AppMode {
  const explicit = process.env.APP_MODE?.trim().toLowerCase();
  if (explicit === "demo") return "demo";
  if (explicit === "supabase") {
    if (!isSupabaseConfigured() && !isBuildPhase())
      throw new Error("APP_MODE=supabase 但缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    return "supabase";
  }
  if (explicit) throw new Error(`APP_MODE 只能是 "demo" 或 "supabase"（目前為 "${process.env.APP_MODE}"）`);

  if (isSupabaseConfigured()) return "supabase";
  if (process.env.NODE_ENV === "production" && !isBuildPhase())
    throw new Error(
      "正式環境（NODE_ENV=production）未設定 Supabase（NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY）。" +
        "若確定要以 demo 記憶體資料執行，請明確設定 APP_MODE=demo。",
    );
  return "demo";
}

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

export function repo(): Repo {
  return appMode() === "supabase" ? supabaseRepo : demoRepo;
}

export { newId } from "./repo";
