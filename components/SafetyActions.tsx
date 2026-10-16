"use client";

import { useState, useTransition } from "react";
import { reportAction, toggleBlockAction } from "@/app/actions";
import { callAction } from "@/lib/client-action";
import { REPORT_REASONS } from "@/lib/validation";

const REASONS = REPORT_REASONS;

/** 封鎖、檢舉分開（借鏡 Alovoa：block / hide / report 三種動作） */
export function SafetyActions({ targetId, blocked }: { targetId: string; blocked: boolean }) {
  const [isBlocked, setBlocked] = useState(blocked);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();

  return (
    <div className="stack" style={{ marginTop: 10, gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn ghost small"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const fail = (text: string) => setNote({ ok: false, text });
              const r = await callAction(() => toggleBlockAction(targetId), fail);
              if (!r) return;
              if (r.ok) setBlocked(r.blocked);
              else fail(r.error);
            })
          }
        >
          {isBlocked ? "解除封鎖" : "封鎖"}
        </button>
        <button className="btn danger small" onClick={() => setOpen(!open)}>檢舉</button>
      </div>
      {open && (
        <div className="suggest">
          {REASONS.map((r) => (
            <button
              key={r}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const fail = (text: string) => setNote({ ok: false, text });
                  const res = await callAction(() => reportAction(targetId, r), fail);
                  setOpen(false);
                  if (!res) return;
                  setNote(res.ok ? { ok: true, text: res.notice ?? "已送出" } : { ok: false, text: res.error });
                })
              }
            >
              {r}
            </button>
          ))}
        </div>
      )}
      {note && <div className={`notice ${note.ok ? "ok" : "err"}`}>{note.text}</div>}
    </div>
  );
}
