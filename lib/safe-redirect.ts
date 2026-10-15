/**
 * 登入回呼的 `next` 參數白名單（防 open redirect）。
 * 只接受下列站內路徑；其他一律回到預設值。
 * 例：`/\evil.com`、`/\t/evil.com`、`//evil.com`、`/%2F%2Fevil.com` 都不會通過。
 */
const SAFE_PATHS: RegExp[] = [
  /^\/$/,
  /^\/(?:onboarding|sell|inbox|me)$/,
  /^\/(?:listing|chat)\/[A-Za-z0-9_-]{1,64}$/,
];

export const DEFAULT_NEXT = "/onboarding";

export function safeNextPath(next: string | null | undefined, origin: string, fallback = DEFAULT_NEXT): string {
  if (!next || next.length > 200) return fallback;
  if (!SAFE_PATHS.some((re) => re.test(next))) return fallback;
  try {
    if (new URL(next, origin).origin !== new URL(origin).origin) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
