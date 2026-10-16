"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/actions";
import { callAction } from "@/lib/client-action";

/** Alovoa 式刪除確認：必須輸入自己的顯示名稱才可送出 */
export function DeleteAccount({ displayName, demo }: { displayName: string; demo: boolean }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const match = name.trim() === displayName.trim();

  return (
    <div className="panel stack" style={{ borderColor: "var(--danger)" }}>
      <strong style={{ color: "var(--danger)" }}>刪除帳號</strong>
      <div className="notice err">
        刪除後<strong>無法復原</strong>，以下資料會永久刪除：
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li>個人檔案、信任分數與成交紀錄</li>
          <li>你的所有上架物品與照片</li>
          <li>你發出與收到的出價</li>
          <li>你參與的所有對話與訊息（對方也會看不到）</li>
          <li>你的封鎖名單與你送出的檢舉</li>
          {!demo && <li>登入帳號（Supabase Auth）</li>}
        </ul>
        <div style={{ marginTop: 6 }}>你以買家身分尚未成交的訂單會自動取消（含已寄出的貨到付款），保留的數量釋出給賣家；你填過的收件資訊一併刪除。</div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        建議先 <a href="/api/me/export" download style={{ textDecoration: "underline" }}>下載個資匯出 JSON</a> 留存副本。
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!match) return;
          start(async () => {
            setErr(undefined);
            const r = await callAction(() => deleteAccountAction(name), setErr);
            if (r?.error) setErr(r.error); // 成功時 server action 會 redirect("/")：其 redirect 例外由 callAction 交回 Next 導頁
          });
        }}
      >
        <label className="muted" htmlFor="confirm-name">
          請輸入你的顯示名稱「<strong>{displayName}</strong>」以確認
        </label>
        <input id="confirm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={displayName} />
        {err && <div className="notice err">{err}</div>}
        <div className="row">
          <button className="btn danger small" disabled={!match || pending}>
            {pending ? "刪除中…" : "永久刪除我的帳號"}
          </button>
        </div>
      </form>
    </div>
  );
}
