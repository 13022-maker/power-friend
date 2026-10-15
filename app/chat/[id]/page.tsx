import Link from "next/link";
import { notFound } from "next/navigation";
import { repo } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { isBlockedBetween } from "@/lib/services";
import { formatNTD } from "@/lib/catalog";
import { TrustBadge } from "@/components/ui";
import { SafetyActions } from "@/components/SafetyActions";
import { ChatRoom } from "./ChatRoom";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  const r = repo();
  const conv = await r.getConversation(id);
  if (!conv || (conv.buyerId !== me.id && conv.sellerId !== me.id)) notFound();
  const otherId = conv.buyerId === me.id ? conv.sellerId : conv.buyerId;
  const [listing, other, offer, messages, blocked] = await Promise.all([
    r.getListing(conv.listingId),
    r.getProfile(otherId),
    r.getOffer(conv.offerId),
    r.listMessages(id),
    isBlockedBetween(me.id, otherId),
  ]);

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
              成交價 <span className="price">{offer ? formatNTD(offer.amount) : "—"}</span>・
              {listing?.status === "sold" ? "已成交" : "保留中"}
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
      <ChatRoom
        conversationId={id}
        meId={me.id}
        initial={messages}
        isSeller={conv.sellerId === me.id}
        sold={listing?.status === "sold"}
        blocked={blocked}
      />
    </>
  );
}
