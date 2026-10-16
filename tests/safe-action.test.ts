import { afterEach, describe, expect, it, vi } from "vitest";
import { notFound, redirect } from "next/navigation";
import { safeAction } from "../lib/safe-action";
import { NETWORK_ERROR, callAction } from "../lib/client-action";
import { demoRepo, resetDemoStore } from "../lib/data/demo";
import type { Profile } from "../lib/types";

// actions.ts 依賴 session（cookies）與 revalidatePath（需 Next 請求環境）：測試以 mock 取代
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "pf_uid",
  currentUser: async () => (await demoRepo.getProfile("u_an")) as Profile,
}));

afterEach(() => {
  vi.restoreAllMocks();
  resetDemoStore();
});

describe("safeAction（server action 例外保護）", () => {
  it("正常結果原樣回傳", async () => {
    await expect(safeAction("t", async () => ({ ok: true as const, n: 1 }), "失敗")).resolves.toEqual({ ok: true, n: 1 });
  });

  it("一般錯誤 → ok:false＋固定訊息，console.error 只記 action 名稱與錯誤", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await safeAction(
      "offerAction",
      async () => {
        throw new Error("Supabase: column offers.shipping_fee does not exist");
      },
      "出價失敗，請稍後再試",
    );
    expect(r).toEqual({ ok: false, error: "出價失敗，請稍後再試" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("offerAction");
    expect(log.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("非 Error 的 throw 值也轉為 ok:false", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(safeAction("t", () => Promise.reject("boom"), "失敗")).resolves.toEqual({ ok: false, error: "失敗" });
  });

  it("redirect() 例外重新丟出（不被吞成 ok:false）", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = safeAction("t", async () => redirect("/login"), "失敗");
    await expect(p).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) });
    expect(log).not.toHaveBeenCalled();
  });

  it("notFound() 例外重新丟出", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(safeAction("t", async () => notFound(), "失敗")).rejects.toMatchObject({ digest: expect.stringMatching(/NEXT_HTTP_ERROR_FALLBACK;404/) });
  });
});

describe("callAction（client 端 await 失敗）", () => {
  it("action reject（網路斷線）→ onFail(連線失敗)，回傳 undefined", async () => {
    const onFail = vi.fn();
    await expect(callAction(() => Promise.reject(new TypeError("Failed to fetch")), onFail)).resolves.toBeUndefined();
    expect(onFail).toHaveBeenCalledWith(NETWORK_ERROR);
  });
  it("redirect 例外交回 Next", async () => {
    const onFail = vi.fn();
    await expect(callAction(async () => redirect("/chat/c1"), onFail)).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) });
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe("app/actions：repo 丟例外時回傳 ok:false 而非 throw", () => {
  it("offerAction：repo.createOffer 失敗（如缺欄位）→ ok:false 固定訊息，不記錄使用者輸入", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(demoRepo, "createOffer").mockRejectedValue(new Error("Supabase: column offers.shipping_fee does not exist"));
    const { offerAction } = await import("../app/actions");
    const secret = "我的私人訊息 0912345678";
    const r = await offerAction("l_fm2", 9000, secret, false);
    expect(r).toEqual({ ok: false, error: "出價失敗，請稍後再試" });
    expect(JSON.stringify(log.mock.calls.map((c) => c.map(String)))).not.toContain(secret);
  });

  it("respondOfferAction：非預期錯誤 → redirect 到 /inbox?error=unknown（不帶錯誤字串）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(demoRepo, "getOffer").mockRejectedValue(new Error("Supabase: relation does not exist"));
    const { respondOfferAction } = await import("../app/actions");
    const fd = new FormData();
    fd.set("offerId", "o_x");
    fd.set("decision", "accept");
    await expect(respondOfferAction(fd)).rejects.toMatchObject({ digest: expect.stringContaining(";/inbox?error=unknown;") });
  });
});
