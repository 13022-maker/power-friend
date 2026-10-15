/**
 * Meta Muse Spark 用戶端（OpenAI 相容的 Chat Completions 格式）。
 * 官方：base URL https://api.meta.ai/v1、金鑰放 MODEL_API_KEY、model 例如 "muse-spark-1.1"。
 * 只在伺服器端使用；金鑰絕不送到前端。
 */

export interface MuseConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function museConfig(): MuseConfig | null {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey || process.env.MUSE_DISABLED === "1") return null;
  return {
    apiKey,
    baseUrl: (process.env.MUSE_BASE_URL || "https://api.meta.ai/v1").replace(/\/+$/, ""),
    model: process.env.MUSE_MODEL || "muse-spark-1.1",
    timeoutMs: Number(process.env.MUSE_TIMEOUT_MS || 8000),
  };
}

export const isMuseEnabled = () => museConfig() !== null;

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Part[];
}

export class MuseError extends Error {}

/** 呼叫 Muse Spark，要求回傳 JSON 物件；逾時、HTTP 錯誤或格式不符都丟 MuseError，由上層退回本地規則 */
export async function museJSON<T>(
  messages: ChatMessage[],
  opts: { reasoningEffort?: "minimal" | "low" | "medium" | "high"; maxTokens?: number } = {},
  cfg: MuseConfig | null = museConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (!cfg) throw new MuseError("Muse 未設定");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? 800,
        reasoning_effort: opts.reasoningEffort ?? "minimal",
      }),
    });
    if (!res.ok) throw new MuseError(`Muse HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    return extractJSON<T>(text);
  } catch (e) {
    if (e instanceof MuseError) throw e;
    throw new MuseError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** 容忍 ```json 包裹或前後多餘文字，取出第一個 JSON 物件 */
export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const body = fenced ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new MuseError("Muse 回傳不是 JSON");
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    throw new MuseError("Muse 回傳 JSON 解析失敗");
  }
}
