"use client";

import { useTransition } from "react";
import { switchUser } from "@/app/actions";

export function UserSwitcher({ users, current }: { users: { id: string; name: string }[]; current: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="switcher" title="原型用：切換示範帳號扮演買家或賣家">
      <select
        aria-label="切換示範帳號"
        value={current}
        disabled={pending}
        onChange={(e) => start(() => switchUser(e.target.value))}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            我是 {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}
