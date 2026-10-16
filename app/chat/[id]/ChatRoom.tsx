"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chatSuggestAction, sendMessageAction } from "@/app/actions";
import type { Suggestion } from "@/lib/ai/negotiate";
import type { Message } from "@/lib/types";
import { messageFromRow, realtimeClient } from "@/lib/realtime";
import { displayRiskReasons } from "@/lib/ai/risk-labels";

const time = (iso: string) => new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

/** 依 id 去重並依時間排序 */
function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 訊息同步：
 * - Supabase 模式：Realtime 訂閱 messages INSERT（conversation_id=eq.<id>），新訊息即時出現。
 * - 輪詢（2.5 秒）一律保留作為後備：demo 模式、頻道未 SUBSCRIBED、或 RLS 尚未讓 Realtime 送出資料時都靠它。
 *   確認 Realtime 真的送到過資料後，輪詢放慢到 15 秒當保險。
 */
export function ChatRoom({
  conversationId,
  meId,
  initial,
  blocked,
}: {
  conversationId: string;
  meId: string;
  initial: Message[];
  blocked: boolean;
}) {
  const [msgs, setMsgs] = useState(initial);
  const [text, setText] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[]>();
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // 對方改變訂單狀態（填收件資訊、寄出、成交、取消）時會寫系統訊息；收到新的系統訊息就重新整理訂單面板
  const sysCount = msgs.filter((m) => m.senderId === "system").length;
  const sysSeen = useRef(sysCount);
  useEffect(() => {
    if (sysCount > sysSeen.current) router.refresh();
    sysSeen.current = sysCount;
  }, [sysCount, router]);

  useEffect(() => {
    let cancelled = false;
    let live = false; // Realtime 已 SUBSCRIBED 且至少送達過一筆
    let subscribed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const list = (await res.json()) as Message[];
          setMsgs((prev) => mergeMessages(prev, list));
        }
      } catch {
        // 網路暫時失敗：下一輪再試
      }
      if (!cancelled) timer = setTimeout(poll, live && subscribed ? 15_000 : 2500);
    };
    timer = setTimeout(poll, 2500);

    const sb = realtimeClient();
    const channel = sb
      ?.channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          live = true;
          setMsgs((prev) => mergeMessages(prev, [messageFromRow(payload.new as Record<string, unknown>)]));
        },
      )
      .subscribe((status) => {
        subscribed = status === "SUBSCRIBED";
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (sb && channel) void sb.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = () =>
    start(async () => {
      setErr(undefined);
      const r = await sendMessageAction(conversationId, text, aiDrafted);
      if (!r.ok) return setErr(r.error);
      setMsgs((m) => mergeMessages(m, [r.message]));
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
              {m.risk === "high" && !mine && <strong style={{ color: "var(--danger)", display: "block" }}>⚠ 高風險訊息：{displayRiskReasons(m.riskReasons).join("、")}。請勿匯款或點連結。</strong>}
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
          <button className="btn ghost small" title="AI 議價助手" disabled={pending} onClick={() =>
              start(async () => {
                const r = await chatSuggestAction(conversationId);
                if (r.ok) setSugs(r.data);
                else setErr(r.error);
              })
            }>
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
    </div>
  );
}
