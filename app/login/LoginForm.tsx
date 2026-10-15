"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Channel = "email" | "phone";

export function LoginForm({ phoneEnabled }: { phoneEnabled: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const callbackUrl = () => `${window.location.origin}/auth/callback`;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = createSupabaseBrowserClient();
    const v = target.trim();
    const { error } =
      channel === "email"
        ? await sb.auth.signInWithOtp({ email: v, options: { emailRedirectTo: callbackUrl() } })
        : await sb.auth.signInWithOtp({ phone: v });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: error.message });
    setSent(true);
    setMsg({
      kind: "ok",
      text: channel === "email" ? "已寄出：點信中的連結，或輸入信中的 6 位數驗證碼。" : "已傳送簡訊驗證碼。",
    });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = createSupabaseBrowserClient();
    const token = code.trim();
    const { error } =
      channel === "email"
        ? await sb.auth.verifyOtp({ email: target.trim(), token, type: "email" })
        : await sb.auth.verifyOtp({ phone: target.trim(), token, type: "sms" });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: error.message });
    router.replace("/onboarding");
    router.refresh();
  }

  async function google() {
    setBusy(true);
    const sb = createSupabaseBrowserClient();
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
    if (error) {
      setBusy(false);
      setMsg({ kind: "err", text: error.message });
    }
  }

  return (
    <div className="panel stack" style={{ maxWidth: 420 }}>
      <button type="button" className="btn" onClick={google} disabled={busy} style={{ width: "100%" }}>
        使用 Google 帳號登入
      </button>
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>或</p>

      {phoneEnabled && (
        <div className="segmented" role="tablist" aria-label="驗證方式" >
          {(["email", "phone"] as Channel[]).map((c) => (
            <a
              key={c}
              href="#"
              className={c === channel ? "on" : ""}
              onClick={(e) => {
                e.preventDefault();
                setChannel(c);
                setSent(false);
                setCode("");
                setMsg(null);
              }}
            >
              {c === "email" ? "Email" : "手機簡訊"}
            </a>
          ))}
        </div>
      )}

      {!sent ? (
        <form onSubmit={send} className="stack">
          <input
            className="input"
            type={channel === "email" ? "email" : "tel"}
            required
            autoComplete={channel === "email" ? "email" : "tel"}
            placeholder={channel === "email" ? "you@example.com" : "+886912345678"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <button className="btn" disabled={busy || !target.trim()}>
            {busy ? "傳送中…" : "寄送驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            required
            placeholder="6 位數驗證碼"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn" disabled={busy || !code.trim()}>
            {busy ? "驗證中…" : "登入"}
          </button>
          <button type="button" className="btn ghost" onClick={() => setSent(false)} disabled={busy}>
            重新輸入{channel === "email" ? " Email" : "手機號碼"}
          </button>
        </form>
      )}
      {msg && (
        <p role="status" className={`notice ${msg.kind}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
