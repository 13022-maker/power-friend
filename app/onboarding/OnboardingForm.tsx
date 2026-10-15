"use client";

import { useActionState } from "react";
import { AREAS } from "@/lib/catalog";
import { createProfileAction, type OnboardingState } from "./actions";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createProfileAction, {});
  return (
    <form action={action} className="panel stack" style={{ maxWidth: 480 }}>
      <div className="field">
        <label htmlFor="displayName">暱稱</label>
        <input id="displayName" name="displayName" className="input" required maxLength={24} defaultValue={defaultName.slice(0, 24)} />
      </div>
      <div className="field">
        <label htmlFor="areaId">面交區域</label>
        <select id="areaId" name="areaId" className="select" required defaultValue="">
          <option value="" disabled>
            請選擇（只顯示到捷運站／行政區）
          </option>
          {Object.entries(AREAS).map(([id, a]) => (
            <option key={id} value={id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="interests">興趣（用逗號分隔）</label>
        <input id="interests" name="interests" className="input" placeholder="露營, 底片相機, 公仔" />
      </div>
      <div className="field">
        <label htmlFor="bio">自我介紹（選填）</label>
        <textarea id="bio" name="bio" className="textarea" maxLength={200} placeholder="喜歡什麼、通常在哪裡面交…" />
      </div>
      {state.error && <p className="notice err">{state.error}</p>}
      <button className="btn green" disabled={pending}>
        {pending ? "建立中…" : "開始使用"}
      </button>
    </form>
  );
}
