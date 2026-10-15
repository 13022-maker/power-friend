"use client";

import { useState, useTransition } from "react";
import { reportAction, toggleBlockAction } from "@/app/actions";

const REASONS = ["疑似詐騙", "要求私下交易／先匯款", "騷擾或不當言語", "商品與描述不符"];

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
              const r = await toggleBlockAction(targetId);
              if (r.ok) setBlocked(r.blocked);
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
                  const res = await reportAction(targetId, r);
                  setNote(res.ok ? { ok: true, text: res.notice ?? "已送出" } : { ok: false, text: res.error });
                  setOpen(false);
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
