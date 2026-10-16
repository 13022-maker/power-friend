import { unstable_rethrow } from "next/navigation";

/** server action 的失敗回傳形狀（client 元件依此顯示 error） */
export type ActionFail = { ok: false; error: string };

/**
 * 包住 server action 主體：repo／service 丟出非預期例外時，改回傳固定中文訊息，不讓整頁變成錯誤頁。
 *
 * - `redirect()`／`notFound()`／`forbidden()`／`unauthorized()` 與 Next 內部的動態渲染例外都以 throw 實作，
 *   一律交給 `unstable_rethrow` 重新丟出（Next 16 文件：node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md，
 *   必須在 catch 第一行呼叫）。currentUser() 未登入時的 redirect("/login") 也靠這裡放行。
 * - 伺服器端只記 action 名稱與錯誤本身；**不記**參數（使用者輸入、收件資訊、訊息內容）。
 * - 回給使用者的訊息是固定字串，不含例外內容（避免洩漏資料庫細節）。
 */
export async function safeAction<T>(name: string, fn: () => Promise<T>, fallbackMsg: string): Promise<T | ActionFail> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    logActionError(name, err);
    return { ok: false, error: fallbackMsg };
  }
}

/** 只記 action 名稱與錯誤（名稱、訊息、stack），不帶任何輸入參數 */
export function logActionError(name: string, err: unknown) {
  console.error(`[action:${name}] 非預期錯誤`, err instanceof Error ? err : String(err));
}
