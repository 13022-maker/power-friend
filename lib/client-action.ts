import { unstable_rethrow } from "next/navigation";

export const NETWORK_ERROR = "連線失敗，請稍後再試";

/**
 * Client 端呼叫 server action：`await action()` 本身 reject（網路斷線、伺服器 5xx 等）時不讓錯誤冒泡成整頁錯誤，
 * 改呼叫 onFail(NETWORK_ERROR) 並回傳 undefined。
 *
 * 例外：server action 內 redirect() 時，client 端的 promise 會以 redirect 例外 reject，需交回 Next 處理導頁，
 * 因此先以 unstable_rethrow 重新丟出（browser 版只放行 Next router 例外）。
 */
export async function callAction<T>(fn: () => Promise<T>, onFail: (msg: string) => void): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    onFail(NETWORK_ERROR);
    return undefined;
  }
}
