"use client"; // Error boundary 必須是 Client Component

import Link from "next/link";

/**
 * 最後防線：頁面渲染或未處理的 server action 例外。
 * 只顯示固定中文訊息，不顯示 error.message／digest（正式環境的伺服器錯誤細節本來就不會傳到前端，這裡也不印出）。
 * Next 16.3 起 `retry` 為穩定 prop：重新取得並渲染此區段。
 */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="empty stack" style={{ marginTop: 40, alignItems: "center" }}>
      <strong>這個頁面暫時無法載入</strong>
      <span className="muted">可能是連線或伺服器忙碌，請稍後再試。</span>
      <div className="row" style={{ gap: 8, justifyContent: "center" }}>
        <button type="button" className="btn small" onClick={() => retry()}>
          重試
        </button>
        <Link href="/" className="btn ghost small">
          回探索
        </Link>
      </div>
    </div>
  );
}
