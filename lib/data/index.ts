import type { Repo } from "./repo";
import { demoRepo } from "./demo";
import { supabaseRepo } from "./supabase";

export const isSupabaseConfigured = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** 有 Supabase 環境變數就用 Supabase，否則自動退回 demo 記憶體資料 */
export function repo(): Repo {
  return isSupabaseConfigured() ? supabaseRepo : demoRepo;
}

export { newId } from "./repo";
