"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { chatSuggestAction, completeDealAction, sendMessageAction } from "@/app/actions";
import type { Suggestion } from "@/lib/ai/negotiate";
import type { Message } from "@/lib/types";

const time = (iso: string) => new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

/**
 * 原型以 2.5 秒輪詢同步訊息；接 Supabase 後可改為 Realtime 訂閱 messages 表
 * （supabase.channel(...).on('postgres_changes', { table: 'messages', filter: `conversation_id=eq.${id}` }, …)）。
 */
export function ChatRoom({
  conversationId,
  meId,
  initial,
  isSeller,
  sold,
  blocked,
}: {
  conversationId: string;
  meId: string;
  initial: Message[];
  isSeller: boolean;
  sold: boolean;
  blocked: boolean;
}) {
  const [msgs, setMsgs] = useState(initial);
  const [text, setText] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[]>();
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(sold);
  const [pending, start] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, { cache: "no-store" });
      if (res.ok) setMsgs(await res.json());
    }, 2500);
    return () => clearInterval(t);
  }, [conversationId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = () =>
    start(async () => {
      setErr(undefined);
      const r = await sendMessageAction(conversationId, text, aiDrafted);
      if (!r.ok) return setErr(r.error);
      setMsgs((m) => [...m, r.message]);
      setText("");
      setAiDrafted(false);
      setSugs(undefined);
    });

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef} aria-live="polite">
        {msgs.map((m) => {
          const mine = m.senderId === meId;
          const cls = m.senderId === "system" ? "sys" : mine ? "me" : "";
          return (
            <div key={m.id} className={`bubble ${cls} ${m.risk !== "none" ? `risk-${m.risk}` : ""}`}>
              {m.risk === "high" && !mine && <strong style={{ color: "var(--danger)", display: "block" }}>⚠ 高風險訊息：{m.riskReasons.join("、")}。請勿匯款或點連結。</strong>}
              {m.body}
              <span className="meta">
                {time(m.createdAt)}
                {m.aiDrafted && "・AI 代擬"}
                {m.risk === "low" && "・已遮蔽聯絡方式"}
                {m.risk === "high" && mine && "・已標記高風險，對方會看到警示"}
              </span>
            </div>
          );
        })}
      </div>

      {err && <div className="notice err">{err}</div>}
      {sugs && (
        <div className="suggest">
          {sugs.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setText(s.text);
                setAiDrafted(true);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {blocked ? (
        <div className="notice err">此對話已封鎖。</div>
      ) : (
        <div className="chat-input">
          <button className="btn ghost small" title="AI 議價助手" disabled={pending} onClick={() => start(async () => setSugs(await chatSuggestAction(conversationId)))}>
            AI
          </button>
          <input
            className="input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAiDrafted(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && text.trim() && send()}
            placeholder={aiDrafted ? "AI 草稿，可修改後送出" : "輸入訊息"}
          />
          <button className="btn" onClick={send} disabled={pending || !text.trim()}>送出</button>
        </div>
      )}
      {isSeller && !done && !blocked && (
        <button
          className="btn green small"
          style={{ marginTop: 8, alignSelf: "flex-end" }}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await completeDealAction(conversationId);
              if (r.ok) setDone(true);
              else setErr(r.error);
            })
          }
        >
          面交完成，標記成交
        </button>
      )}
    </div>
  );
}
