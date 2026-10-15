"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buyerSuggestAction, offerAction } from "@/app/actions";
import type { Suggestion } from "@/lib/ai/negotiate";

export function OfferForm({ listingId, price }: { listingId: string; price: number }) {
  const [amount, setAmount] = useState(String(price));
  const [message, setMessage] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[]>();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const [pending, start] = useTransition();

  const loadSugs = () => start(async () => setSugs(await buyerSuggestAction(listingId)));
  const pick = (s: Suggestion) => {
    setMessage(s.text);
    if (s.amount) setAmount(String(s.amount));
    setAiDrafted(true);
  };

  const submit = () =>
    start(async () => {
      const r = await offerAction(listingId, Number(amount), message, aiDrafted);
      setResult(r.ok ? { ok: true, text: `出價已送出${r.notice ? `（${r.notice}）` : ""}。賣家接受後會開啟聊天室。` } : { ok: false, text: r.error });
    });

  if (result?.ok)
    return (
      <div className="notice ok">
        {result.text} <Link href="/inbox" style={{ textDecoration: "underline" }}>查看我的出價</Link>
      </div>
    );

  return (
    <div className="panel stack" style={{ boxShadow: "none" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>出價開聊</strong>
        <span className="muted">賣家接受後才開聊天室，減少騷擾與詐騙</span>
      </div>
      <div className="field">
        <label htmlFor="amt">出價（NT$）</label>
        <input id="amt" className="input price" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="msg">給賣家的一句話</label>
        <textarea
          id="msg"
          className="textarea"
          style={{ minHeight: 70 }}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setAiDrafted(false);
          }}
          placeholder="針對這件物品說一句話，比複製貼上的「還在嗎？」更容易被接受"
        />
      </div>
      {sugs ? (
        <div className="suggest">
          {sugs.map((s) => (
            <button key={s.label} type="button" onClick={() => pick(s)}>{s.label}</button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn ghost small" onClick={loadSugs} disabled={pending}>AI 議價助手</button>
      )}
      {aiDrafted && <span className="badge ai">此訊息將標記為「AI 代擬」</span>}
      {result && !result.ok && <div className="notice err">{result.text}</div>}
      <button className="btn" onClick={submit} disabled={pending || !amount}>送出出價</button>
    </div>
  );
}
