"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeAction, createListingAction } from "@/app/actions";
import { CATEGORIES, CONDITIONS, formatNTD } from "@/lib/catalog";
import type { ItemAnalysis } from "@/lib/ai/vision";
import { PAYMENT_HINTS, PAYMENT_LABELS, PAYMENT_METHODS, QTY_LIMITS, SHIPPING_FEE_MAX, isPrepay } from "@/lib/payment";
import type { Category, Condition, PaymentMethod } from "@/lib/types";

/** 在瀏覽器端把照片縮到 900px 寬、轉成 JPEG，避免上傳過大 */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 900 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SellForm({ museEnabled, canPrepay }: { museEnabled: boolean; canPrepay: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [hint, setHint] = useState("");
  const [ai, setAi] = useState<ItemAnalysis>();
  const [form, setForm] = useState({ title: "", description: "", category: "other" as Category, condition: "good" as Condition, price: "", original: "" });
  const [qty, setQty] = useState("1");
  const [methods, setMethods] = useState<PaymentMethod[]>(["meetup_cash"]);
  const [shippingFee, setShippingFee] = useState("0");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string }>();
  const [analyzing, startAnalyze] = useTransition();
  const [saving, startSave] = useTransition();

  const onFile = async (f?: File) => {
    if (!f) return;
    setFileName(f.name);
    setPhoto(await shrink(f));
  };

  const runAI = () =>
    startAnalyze(async () => {
      const res = await analyzeAction(hint, fileName, photo);
      if (!res.ok) return setMsg({ kind: "err", text: res.error });
      const r = res.data;
      setAi(r);
      setForm({ title: r.title, description: r.description, category: r.category, condition: r.condition, price: String(r.price.mid), original: r.originalPrice ? String(r.originalPrice) : "" });
      setMsg(undefined);
    });

  const submit = () =>
    startSave(async () => {
      const { original, ...rest } = form;
      const hasCod = methods.includes("cod");
      const res = await createListingAction({
        ...rest,
        price: Number(form.price),
        originalPrice: original ? Number(original) : undefined,
        photo,
        quantity: qty.trim() === "" ? 1 : Number(qty),
        paymentMethods: PAYMENT_METHODS.filter((m) => methods.includes(m)), // 依固定順序送出
        shippingFee: hasCod ? (shippingFee.trim() === "" ? 0 : Number(shippingFee)) : undefined,
      });
      if (res.error) return setMsg({ kind: "err", text: res.error });
      if (res.notice) setMsg({ kind: "warn", text: res.notice });
      router.push(`/listing/${res.id}`);
    });

  const toggleMethod = (m: PaymentMethod) =>
    setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="detail" style={{ marginTop: 8 }}>
      <div className="stack">
        <div className="photo-drop" onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="上架照片預覽" /> : <div><strong>點這裡拍照或選照片</strong><div className="muted">{museEnabled ? "按「AI 幫我填表」時，照片會送到 Meta Muse Spark 辨識" : "照片只留在本機，不送到外部 AI"}</div></div>}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div className="field">
          <label htmlFor="hint">用一句話描述（AI 會讀這句與照片）</label>
          <input id="hint" className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="例如：Nikon FM2 底片相機，快門正常，原價 15000" />
        </div>
        <button className="btn green" onClick={runAI} disabled={analyzing || (!hint && !fileName)}>
          {analyzing ? "AI 辨識中…" : "AI 幫我填表"}
        </button>
        {ai && (
          <div className="panel" style={{ boxShadow: "none" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>AI 建議售價</strong>
              <span className="row" style={{ gap: 6 }}>
                <span className={`badge ${ai.source === "muse" ? "trust-hi" : "ai"}`}>{ai.source === "muse" ? "Muse Spark" : "本地規則"}</span>
                <span className="badge ai">信心 {Math.round(ai.confidence * 100)}%</span>
              </span>
            </div>
            <div className="price" style={{ fontSize: 22, margin: "6px 0" }}>
              {formatNTD(ai.price.low)} – {formatNTD(ai.price.high)}
            </div>
            <div className="muted">{ai.price.basis}</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="muted">
              {ai.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="panel stack">
        <div className="field">
          <label htmlFor="title">品名</label>
          <input id="title" className="input" value={form.title} onChange={set("title")} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="cat">分類</label>
            <select id="cat" className="select" value={form.category} onChange={set("category")}>
              {(Object.keys(CATEGORIES) as Category[]).map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cond">成色</label>
            <select id="cond" className="select" value={form.condition} onChange={set("condition")}>
              {(Object.keys(CONDITIONS) as Condition[]).map((c) => <option key={c} value={c}>{CONDITIONS[c].label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="price">售價（NT$）</label>
            <input id="price" className="input price" inputMode="numeric" value={form.price} onChange={set("price")} />
          </div>
          <div className="field">
            <label htmlFor="orig">原價（選填，估價用）</label>
            <input id="orig" className="input price" inputMode="numeric" value={form.original} onChange={set("original")} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="qty">數量（同款共幾件）</label>
          <input id="qty" className="input price" type="number" inputMode="numeric" min={QTY_LIMITS.min} max={QTY_LIMITS.max} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <fieldset className="field opts">
          <legend>接受的付款方式（可複選）</legend>
          {PAYMENT_METHODS.map((m) => {
            const locked = isPrepay(m) && !canPrepay;
            return (
              <label key={m} className={`opt ${methods.includes(m) ? "on" : ""} ${locked ? "locked" : ""}`}>
                <input type="checkbox" checked={methods.includes(m)} disabled={locked} onChange={() => toggleMethod(m)} />
                <span>
                  <strong>{PAYMENT_LABELS[m]}</strong>
                  <span className="muted">{locked ? "完成手機驗證後才能開啟（先付款是詐騙最常見的手法）" : PAYMENT_HINTS[m]}</span>
                </span>
              </label>
            );
          })}
          {methods.length === 0 && <span className="muted" style={{ color: "var(--danger)" }}>請至少選擇一種付款方式</span>}
        </fieldset>
        {methods.includes("cod") && (
          <div className="field">
            <label htmlFor="ship">貨到付款運費（NT$，0 表示含運）</label>
            <input id="ship" className="input price" type="number" inputMode="numeric" min={0} max={SHIPPING_FEE_MAX} step={1} value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} />
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>平台不經手金流：付款方式只是你和買家約定的方式，平台不收款、不代收。</p>
        <div className="field">
          <label htmlFor="desc">說明</label>
          <textarea id="desc" className="textarea" value={form.description} onChange={set("description")} />
        </div>
        <p className="muted" style={{ margin: 0 }}>電話、LINE ID、外部連結會被自動遮蔽；銀行帳號與詐騙話術會被擋下。面交地點只顯示到捷運站。</p>
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <button className="btn" onClick={submit} disabled={saving || !form.title || !form.price || methods.length === 0}>
          {saving ? "上架中…" : "確認上架"}
        </button>
      </div>
    </div>
  );
}
