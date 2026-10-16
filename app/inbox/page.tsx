import Link from "next/link";
import { repo } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { respondOfferAction } from "@/app/actions";
import { formatNTD } from "@/lib/catalog";
import { Thumb, TrustBadge } from "@/components/ui";
import { PAYMENT_LABELS, offerTotal } from "@/lib/payment";
import type { Listing, Offer, Profile } from "@/lib/types";

/** 「2 件・貨到付款・總額 NT$5,060」 */
function orderLine(o: Offer, l?: Listing) {
  const parts = [`${o.quantity} 件`, PAYMENT_LABELS[o.paymentMethod]];
  if (l) parts.push(`總額 ${formatNTD(offerTotal(o, l))}`);
  return parts.join("・");
}

const STATUS: Record<Offer["status"], string> = { pending: "等待回覆", accepted: "已接受", declined: "已婉拒", completed: "已成交", cancelled: "已取消" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await currentUser();
  const { error } = await searchParams;
  const r = repo();
  const [received, sent, convs, listings, profiles] = await Promise.all([
    r.listOffers({ sellerId: me.id }),
    r.listOffers({ buyerId: me.id }),
    r.listConversations(me.id),
    r.listListings(),
    r.listProfiles(),
  ]);
  const L = new Map<string, Listing>(listings.map((l) => [l.id, l]));
  const P = new Map<string, Profile>(profiles.map((p) => [p.id, p]));
  // 已售出的物品不在 listListings（Supabase 版），補查
  for (const id of new Set([...received, ...sent, ...convs].map((x) => x.listingId))) {
    if (!L.has(id)) {
      const l = await r.getListing(id);
      if (l) L.set(id, l);
    }
  }
  const convByOffer = new Map(convs.map((c) => [c.offerId, c]));
  const byNewest = (a: Offer, b: Offer) => b.createdAt.localeCompare(a.createdAt);

  return (
    <>
      <h1>出價與聊天</h1>
      <p className="lead">賣家接受出價後才會開啟聊天室。AI 會依行情提示每筆出價是否合理。</p>
      {typeof error === "string" && error && <div className="notice err" style={{ marginBottom: 12 }}>{error.slice(0, 120)}</div>}

      <h2>收到的出價（{received.filter((o) => o.status === "pending").length} 筆待處理）</h2>
      {received.length === 0 ? (
        <div className="empty">還沒有人出價。切換右上角帳號，用另一個身分對你的物品出價試試。</div>
      ) : (
        <div className="list">
          {received.sort(byNewest).map((o) => {
            const l = L.get(o.listingId);
            const buyer = P.get(o.buyerId);
            const conv = convByOffer.get(o.id);
            const low = l && o.amount < l.aiPriceLow * 0.9;
            return (
              <div className="item" key={o.id}>
                <div className="mini">{l && <Thumb category={l.category} photo={l.photo} />}</div>
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{buyer?.displayName}</strong>
                    {buyer && <TrustBadge profile={buyer} />}
                    {o.aiDrafted && <span className="badge ai">AI 代擬</span>}
                  </div>
                  <div className="muted">
                    {l?.title}・出價 <span className="price">{formatNTD(o.amount)}</span>
                    {o.quantity > 1 && " /件"}
                    {l && ` / 售價 ${formatNTD(l.price)}`}
                    {low && <span style={{ color: "var(--warn)" }}>・低於行情</span>}
                  </div>
                  <div className="muted">{orderLine(o, l)}{o.status !== "pending" && `・${STATUS[o.status]}`}</div>
                  <div style={{ fontSize: 14 }}>「{o.message}」</div>
                </div>
                {o.status === "pending" ? (
                  <form action={respondOfferAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <input type="hidden" name="offerId" value={o.id} />
                    <button className="btn green small" name="decision" value="accept">接受</button>
                    <button className="btn ghost small" name="decision" value="decline">婉拒</button>
                  </form>
                ) : conv ? (
                  <Link className="btn small" href={`/chat/${conv.id}`}>聊天</Link>
                ) : (
                  <span className="muted">{STATUS[o.status]}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2>我送出的出價</h2>
      {sent.length === 0 ? (
        <div className="empty">
          還沒出價過。<Link href="/" style={{ textDecoration: "underline" }}>去探索</Link>
        </div>
      ) : (
        <div className="list">
          {sent.sort(byNewest).map((o) => {
            const l = L.get(o.listingId);
            const conv = convByOffer.get(o.id);
            return (
              <div className="item" key={o.id}>
                <div className="mini">{l && <Thumb category={l.category} photo={l.photo} />}</div>
                <div className="grow">
                  <Link href={`/listing/${o.listingId}`}><strong>{l?.title}</strong></Link>
                  <div className="muted">
                    出價 <span className="price">{formatNTD(o.amount)}</span>{o.quantity > 1 && " /件"}・{P.get(o.sellerId)?.displayName}
                  </div>
                  <div className="muted">{orderLine(o, l)}・{STATUS[o.status]}</div>
                </div>
                {conv ? <Link className="btn small" href={`/chat/${conv.id}`}>聊天</Link> : <span className="muted">{STATUS[o.status]}</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
