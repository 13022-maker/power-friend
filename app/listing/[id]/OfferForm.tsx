"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buyerSuggestAction, offerAction } from "@/app/actions";
import type { Suggestion } from "@/lib/ai/negotiate";
import { formatNTD } from "@/lib/catalog";
import { PAYMENT_HINTS, PAYMENT_LABELS, PREPAY_WARNING, isPrepay, quoteTotal } from "@/lib/payment";
import type { PaymentMethod } from "@/lib/types";

export function OfferForm({
  listingId,
  price,
  available,
  paymentMethods,
  shippingFee,
}: {
  listingId: string;
  price: number;
  available: number;
  paymentMethods: PaymentMethod[];
  shippingFee: number;
}) {
  const [amount, setAmount] = useState(String(price));
  const [qtyText, setQtyText] = useState("1");
  // 前端只做夾限讓總額可即時顯示；伺服器端仍以 services 驗證為準
  const qty = Math.min(available, Math.max(1, Math.floor(Number(qtyText)) || 1));
  const [method, setMethod] = useState<PaymentMethod>(paymentMethods[0]);
  const [message, setMessage] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[]>();
  const [result, setResult] = useState<{ ok: boolean; text: string; notice?: string }>();
  const [pending, start] = useTransition();

  const loadSugs = () =>
    start(async () => {
      const r = await buyerSuggestAction(listingId);
      if (r.ok) setSugs(r.data);
      else setResult({ ok: false, text: r.error });
    });
  const pick = (s: Suggestion) => {
    setMessage(s.text);
    if (s.amount) setAmount(String(s.amount));
    setAiDrafted(true);
  };

  const submit = () =>
    start(async () => {
      const r = await offerAction(listingId, Number(amount), message, aiDrafted, { quantity: qty, paymentMethod: method });
      setResult(
        r.ok
          ? { ok: true, text: `出價已送出（${qty} 件・${PAYMENT_LABELS[method]}${r.total !== undefined ? `・總額 ${formatNTD(r.total)}` : ""}）。賣家接受後會開啟聊天室。`, notice: r.notice }
          : { ok: false, text: r.error },
      );
    });

  const unit = Number(amount);
  const total = Number.isFinite(unit) && unit > 0 ? quoteTotal({ amount: unit, quantity: qty, paymentMethod: method }, { shippingFee }) : undefined;

  if (result?.ok)
    return (
      <div className="stack">
        <div className="notice ok">
          {result.text} <Link href="/inbox" style={{ textDecoration: "underline" }}>查看我的出價</Link>
        </div>
        {result.notice && <div className="notice warn">{result.notice}</div>}
      </div>
    );

  return (
    <div className="panel stack" style={{ boxShadow: "none" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>出價開聊</strong>
        <span className="muted">賣家接受後才開聊天室，減少騷擾與詐騙</span>
      </div>
      <div className={available > 1 ? "grid2" : undefined}>
        <div className="field">
          <label htmlFor="amt">{available > 1 ? "出價單價（NT$）" : "出價（NT$）"}</label>
          <input id="amt" className="input price" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {available > 1 && (
          <div className="field">
            <label htmlFor="qty">件數（剩 {available} 件）</label>
            <input
              id="qty"
              className="input price"
              type="number"
              inputMode="numeric"
              min={1}
              max={available}
              step={1}
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              onBlur={() => setQtyText(String(qty))}
            />
          </div>
        )}
      </div>
      <fieldset className="field opts">
        <legend>付款方式</legend>
        {paymentMethods.map((m) => (
          <label key={m} className={`opt ${method === m ? "on" : ""}`}>
            <input type="radio" name="pay" value={m} checked={method === m} onChange={() => setMethod(m)} />
            <span>
              <strong>
                {PAYMENT_LABELS[m]}
                {m === "cod" && <span className="muted">（運費 {shippingFee > 0 ? formatNTD(shippingFee) : "含運"}）</span>}
              </strong>
              <span className="muted">{PAYMENT_HINTS[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {isPrepay(method) && <div className="notice warn">⚠ {PREPAY_WARNING}</div>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted">
          {total !== undefined
            ? `${formatNTD(unit)} × ${qty}${method === "cod" && shippingFee > 0 ? ` ＋ 運費 ${formatNTD(shippingFee)}` : ""}`
            : "請輸入出價"}
        </span>
        <strong>
          總額 <span className="price">{total !== undefined ? formatNTD(total) : "—"}</span>
        </strong>
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
