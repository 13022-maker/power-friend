"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOrderAction, completeDealAction, markShippedAction, setShippingInfoAction } from "@/app/actions";
import { formatNTD } from "@/lib/catalog";
import { OFFER_STATUS_LABELS, SHIPPING_LIMITS, SHIPPING_METHOD_LABELS, SHIPPING_METHODS, TRACKING_NO_MAX } from "@/lib/payment";
import type { OrderSummary } from "@/lib/services";
import type { ShippingInfo, ShippingMethod } from "@/lib/types";


/**
 * 聊天室的訂單面板：數量、單價、付款方式、總額、狀態、下一步，以及依 myActions 顯示的動作。
 * shipping（收件個資）只由伺服器端在確認是該訂單買賣雙方後傳入；這裡只顯示，不記錄、不外傳。
 */
export function OrderPanel({ order, shipping, blocked }: { order: OrderSummary; shipping: ShippingInfo | null; blocked: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [trackingNo, setTrackingNo] = useState("");
  const [form, setForm] = useState<{ method: ShippingMethod; recipientName: string; phone: string; storeOrAddress: string }>(() => ({
    method: shipping?.method ?? "cvs_pickup",
    recipientName: shipping?.recipientName ?? "",
    phone: shipping?.phone ?? "",
    storeOrAddress: shipping?.storeOrAddress ?? "",
  }));

  // 封鎖時停用其他動作，但「取消訂單」不受影響：否則保留數量會卡死、無法釋出
  const can = (a: OrderSummary["myActions"][number]) => (a === "cancel_order" || !blocked) && order.myActions.includes(a);
  const isBuyer = order.role === "buyer";

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setErr(undefined);
      const r = await fn();
      if (!r.ok) return setErr(r.error);
      after?.();
      router.refresh();
    });

  const showShipForm = can("set_shipping_info") && (editing || !order.cod?.hasShippingInfo);

  return (
    <div className="panel order-panel stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>訂單</strong>
        <span className={`badge ${order.status === "completed" ? "trust-hi" : order.status === "cancelled" ? "trust-lo" : ""}`}>
          {OFFER_STATUS_LABELS[order.status]}
        </span>
      </div>
      <table className="breakdown">
        <tbody>
          <tr>
            <td>單價 × 數量</td>
            <td>
              {formatNTD(order.unitPrice)} × {order.quantity}
            </td>
          </tr>
          {order.cod && (
            <tr>
              <td>運費</td>
              <td>{order.shippingFee > 0 ? formatNTD(order.shippingFee) : "含運"}</td>
            </tr>
          )}
          <tr>
            <td>付款方式</td>
            <td>{order.paymentLabel}</td>
          </tr>
          <tr>
            <td>
              <strong>總額</strong>
            </td>
            <td>
              <strong>{formatNTD(order.total)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      {order.isPrepay && order.prepayWarning && order.status === "accepted" && <div className="notice warn">⚠ {order.prepayWarning}</div>}
      <div className="muted">下一步：{order.nextStep}</div>
      {blocked && order.status === "accepted" && order.myActions.includes("cancel_order") && (
        <div className="notice warn">已封鎖，可取消訂單釋出數量</div>
      )}

      {order.cod && order.status === "accepted" && (
        <div className="stack" style={{ gap: 8 }}>
          {order.cod.shipped && (
            <div className="notice ok">
              賣家已寄出{order.cod.trackingNo ? `・物流單號 ${order.cod.trackingNo}` : ""}
            </div>
          )}
          {shipping && !showShipForm && (
            <div className="ship-box" aria-label="收件資訊">
              <span className="muted">收件資訊（只有你們兩人看得到，成交或取消後自動刪除）</span>
              <span>{SHIPPING_METHOD_LABELS[shipping.method]}</span>
              <span>
                {shipping.recipientName}・{shipping.phone}
              </span>
              <span>{shipping.storeOrAddress}</span>
              {can("set_shipping_info") && (
                <button type="button" className="btn ghost small" style={{ justifySelf: "start", marginTop: 4 }} onClick={() => setEditing(true)}>
                  修改收件資訊
                </button>
              )}
            </div>
          )}
          {showShipForm && (
            <form
              className="stack"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                run(() => setShippingInfoAction(order.conversationId, form), () => setEditing(false));
              }}
            >
              <strong style={{ fontSize: 14 }}>填寫收件資訊</strong>
              <div className="row" role="radiogroup" aria-label="取貨方式">
                {SHIPPING_METHODS.map((m) => (
                  <label key={m} className={`opt ${form.method === m ? "on" : ""}`} style={{ marginTop: 0 }}>
                    <input type="radio" name="ship-method" checked={form.method === m} onChange={() => setForm({ ...form, method: m })} />
                    <span>{SHIPPING_METHOD_LABELS[m]}</span>
                  </label>
                ))}
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="rn">收件人姓名</label>
                  <input id="rn" className="input" autoComplete="name" maxLength={SHIPPING_LIMITS.nameMax} value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ph">手機</label>
                  <input id="ph" className="input" type="tel" autoComplete="tel" inputMode="tel" placeholder="09xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="sa">{form.method === "cvs_pickup" ? "取貨門市（例：7-11 中壢站前門市）" : "收件地址"}</label>
                <input id="sa" className="input" autoComplete={form.method === "home_delivery" ? "street-address" : "off"} maxLength={SHIPPING_LIMITS.storeOrAddressMax} value={form.storeOrAddress} onChange={(e) => setForm({ ...form, storeOrAddress: e.target.value })} />
              </div>
              <div className="muted">只有賣家看得到，成交或取消後自動刪除。寄出前都可以修改。</div>
              <div className="order-actions">
                {editing && (
                  <button type="button" className="btn ghost small" onClick={() => setEditing(false)} disabled={pending}>
                    取消修改
                  </button>
                )}
                <button className="btn small" disabled={pending}>
                  {pending ? "儲存中…" : "儲存收件資訊"}
                </button>
              </div>
            </form>
          )}
          {!isBuyer && !shipping && !order.cod.shipped && <div className="muted">買家尚未填寫收件資訊。</div>}
          {can("mark_shipped") && (
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 140 }}
                placeholder="物流單號（選填）"
                maxLength={TRACKING_NO_MAX}
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
                aria-label="物流單號（選填）"
              />
              <button type="button" className="btn small" disabled={pending} onClick={() => run(() => markShippedAction(order.conversationId, trackingNo))}>
                標記已寄出
              </button>
            </div>
          )}
        </div>
      )}

      {err && <div className="notice err">{err}</div>}

      {(can("complete_deal") || can("cancel_order")) && (
        <div className="order-actions">
          {can("cancel_order") &&
            (confirmCancel ? (
              <>
                <span className="muted" style={{ alignSelf: "center" }}>確定取消這筆訂單？保留的數量會釋出。</span>
                <button type="button" className="btn ghost small" disabled={pending} onClick={() => setConfirmCancel(false)}>
                  先不要
                </button>
                <button type="button" className="btn danger small" disabled={pending} onClick={() => run(() => cancelOrderAction(order.conversationId), () => setConfirmCancel(false))}>
                  確定取消
                </button>
              </>
            ) : (
              <button type="button" className="btn ghost small" disabled={pending} onClick={() => setConfirmCancel(true)}>
                取消訂單
              </button>
            ))}
          {can("complete_deal") && !confirmCancel && (
            <button type="button" className="btn green small" disabled={pending} onClick={() => run(() => completeDealAction(order.conversationId))}>
              {order.paymentMethod === "meetup_cash" ? "面交完成，標記成交" : order.cod ? "買家已取貨付款，標記成交" : "已收款交貨，標記成交"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
