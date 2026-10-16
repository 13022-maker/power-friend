import Link from "next/link";
import { notFound } from "next/navigation";
import { repo } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { getOrderSummary, getShippingInfo, isBlockedBetween } from "@/lib/services";
import { formatNTD } from "@/lib/catalog";
import { TrustBadge } from "@/components/ui";
import { SafetyActions } from "@/components/SafetyActions";
import type { ShippingInfo } from "@/lib/types";
import { ChatRoom } from "./ChatRoom";
import { OrderPanel } from "./OrderPanel";
import { OFFER_STATUS_LABELS } from "@/lib/payment";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const r = repo();
  const conv = await r.getConversation(id);
  if (!conv || (conv.buyerId !== me.id && conv.sellerId !== me.id)) notFound();
  const otherId = conv.buyerId === me.id ? conv.sellerId : conv.buyerId;
  const [listing, other, messages, blocked, orderRes] = await Promise.all([
    r.getListing(conv.listingId),
    r.getProfile(otherId),
    r.listMessages(id),
    isBlockedBetween(me.id, otherId),
    getOrderSummary(me, id),
  ]);
  if (!orderRes.ok || !orderRes.data) notFound();
  const order = orderRes.data;
  // 收件資訊（個資）：只在伺服器端、經 services 確認是這筆訂單的買賣雙方後才取得，只傳給此頁的訂單面板
  let shipping: ShippingInfo | null = null;
  if (order.cod && order.status === "accepted") {
    const res = await getShippingInfo(me, id);
    shipping = res.ok ? (res.data ?? null) : null;
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/inbox">← 出價與聊天</Link>
      </p>
      <div className="panel" style={{ padding: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <Link href={`/listing/${conv.listingId}`}><strong>{listing?.title}</strong></Link>
            <div className="muted">
              {order.quantity > 1 ? `${order.quantity} 件・` : ""}總額 <span className="price">{formatNTD(order.total)}</span>・
              {OFFER_STATUS_LABELS[order.status]}
            </div>
          </div>
          {other && (
            <div className="row" style={{ gap: 6 }}>
              <span>{other.displayName}</span>
              <TrustBadge profile={other} />
            </div>
          )}
        </div>
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>安全工具</summary>
          <SafetyActions targetId={otherId} blocked={blocked} />
        </details>
      </div>
      <OrderPanel key={`${order.status}-${order.cod?.hasShippingInfo}-${order.cod?.shipped}`} order={order} shipping={shipping} blocked={blocked} />
      <ChatRoom
        conversationId={id}
        meId={me.id}
        initial={messages}
        blocked={blocked}
      />
    </>
  );
}
