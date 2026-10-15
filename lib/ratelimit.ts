/**
 * 簡易記憶體 sliding-window 限流（以「使用者 id + 動作」為 key）。
 * 注意：只在單一 process 內有效。多 instance／serverless 部署（Vercel 等）各 instance 各算各的，
 * 正式上線需改用 Redis／Upstash（例如 @upstash/ratelimit）共用計數。
 */

const HOUR = 3_600_000;
const buckets = new Map<string, number[]>();
let lastSweep = 0;

export const RATE_LIMIT_ERROR = "操作太頻繁，請稍後再試";

export const LIMITS = {
  analyze: { limit: 20, windowMs: HOUR },
  suggest: { limit: 60, windowMs: HOUR },
  museRisk: { limit: 200, windowMs: HOUR },
} as const;

/** 嘗試消耗一次額度；允許回傳 true（並記錄），超過上限回傳 false（不記錄） */
export function rateLimit(userId: string, action: string, limit: number, windowMs: number, now = Date.now()): boolean {
  sweep(now);
  const key = `${action}:${userId}`;
  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function checkLimit(userId: string, name: keyof typeof LIMITS, now = Date.now()): boolean {
  const { limit, windowMs } = LIMITS[name];
  return rateLimit(userId, name, limit, windowMs, now);
}

/** 測試用 */
export function resetRateLimits() {
  buckets.clear();
}

/** 每 10 分鐘清掉過期 key，避免記憶體無限成長 */
function sweep(now: number) {
  if (now - lastSweep < 600_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (!v.some((t) => t > now - HOUR)) buckets.delete(k);
}
