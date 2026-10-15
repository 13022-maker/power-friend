"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase/client";
import type { Message } from "./types";

/**
 * 瀏覽器端 Realtime client。Demo 模式（沒有 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY）回傳 null。
 * 使用 @supabase/ssr 的瀏覽器 client：它讀得到 cookie 裡的登入 session，
 * messages 的 RLS（只有對話雙方可讀）才會把 INSERT 推送給這位使用者。
 * ChatRoom 仍保留輪詢作為後備。
 */
let client: SupabaseClient | null | undefined;

export function realtimeClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? (createSupabaseBrowserClient() as unknown as SupabaseClient) : null;
  return client;
}

/** messages 資料列（snake_case）→ Message */
export function messageFromRow(r: Record<string, unknown>): Message {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    senderId: String(r.sender_id),
    body: String(r.body ?? ""),
    aiDrafted: !!r.ai_drafted,
    risk: (r.risk as Message["risk"]) ?? "none",
    riskReasons: (r.risk_reasons as string[]) ?? [],
    createdAt: String(r.created_at),
  };
}
