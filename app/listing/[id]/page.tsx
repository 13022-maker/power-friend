import Link from "next/link";
import { notFound } from "next/navigation";
import { repo } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { viewListing, isBlockedBetween } from "@/lib/services";
import { tasteFit } from "@/lib/ai/embedding";
import { AREAS, CATEGORIES, CONDITIONS, distanceBand, distanceKm, formatNTD } from "@/lib/catalog";
import { computeTrust } from "@/lib/trust";
import { PriceBand, Thumb, TrustBadge } from "@/components/ui";
import { OfferForm } from "./OfferForm";
import { SafetyActions } from "@/components/SafetyActions";
import { PAYMENT_HINTS, PAYMENT_LABELS, isPrepay, listingAvailable } from "@/lib/payment";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await viewListing(id);
  if (!listing) notFound();
  const me = await currentUser();
  const seller = await repo().getProfile(listing.sellerId);
  if (!seller) notFound();

  const mine = seller.id === me.id;
  const blocked = !mine && (await isBlockedBetween(me.id, seller.id));
  const fit = tasteFit(me.tasteVec, listing.embedding);
  const trust = computeTrust(seller);
  const offers = mine ? await repo().listOffers({ listingId: listing.id }) : [];
  const available = listingAvailable(listing);
  const hasCod = listing.paymentMethods.includes("cod");

  return (
    <>
      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/">← 回探索</Link>
      </p>
      <div className="detail">
        <Thumb category={listing.category} photo={listing.photo} status={listing.status} />
        <div className="stack">
          <div className="row" style={{ gap: 6 }}>
            <span className="badge">{CATEGORIES[listing.category].label}</span>
            <span className="badge">{CONDITIONS[listing.condition].label}</span>
            {!mine && <span className="badge trust-hi">品味契合 {fit}%</span>}
          </div>
          <h1 style={{ margin: 0 }}>{listing.title}</h1>
          <div className="row" style={{ alignItems: "baseline" }}>
            <div className="price" style={{ fontSize: 28 }}>{formatNTD(listing.price)}</div>
            {listing.quantity > 1 && <span className="muted">單價・剩 {available} 件／共 {listing.quantity} 件</span>}
          </div>
          <PriceBand listing={listing} />
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{listing.description}</p>
          <p className="muted" style={{ margin: 0 }}>
            面交區域：{AREAS[listing.areaId]?.label}（{distanceBand(distanceKm(me.areaId, listing.areaId))}）・ {listing.views} 人看過
          </p>

          <div className="panel stack" style={{ boxShadow: "none", gap: 8 }}>
            <strong>付款方式</strong>
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
              {listing.paymentMethods.map((m) => (
                <li key={m}>
                  {PAYMENT_LABELS[m]}
                  {m === "cod" && <>（運費 {listing.shippingFee > 0 ? formatNTD(listing.shippingFee) : "含運"}）</>}
                  <span className="muted">・{PAYMENT_HINTS[m]}</span>
                  {isPrepay(m) && <span className="muted" style={{ color: "var(--warn)" }}>・先付款，請確認賣家身分</span>}
                </li>
              ))}
            </ul>
            <div className="muted">平台不經手金流，付款由買賣雙方自行約定。{hasCod && "貨到付款於取貨時付款。"}</div>
          </div>

          <div className="panel" style={{ boxShadow: "none" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{seller.displayName}</strong>
              <TrustBadge profile={seller} />
            </div>
            <div className="muted">
              成交 {seller.deals} 筆・好評 {Math.round(seller.positiveRate * 100)}%・
              {seller.verificationLevel >= 2 ? "已自拍驗證" : seller.verificationLevel === 1 ? "已手機驗證" : "未驗證"}
            </div>
            {trust.tier === "新手" && (
              <div className="notice warn" style={{ marginTop: 8 }}>
                新手賣家：建議選擇面交或安心交易，不要先匯款、不要點對方給的連結。
              </div>
            )}
            {!mine && <SafetyActions targetId={seller.id} blocked={blocked} />}
          </div>

          {mine ? (
            <div className="panel" style={{ boxShadow: "none" }}>
              <strong>這是你的物品</strong>
              <div className="muted">
                收到 {offers.length} 筆出價，到「出價與聊天」處理。
                {listing.quantity > 1 && `（已保留 ${listing.reservedQty} 件・已成交 ${listing.soldQty} 件）`}
              </div>
            </div>
          ) : blocked ? (
            <div className="notice err">你與這位賣家之間有封鎖，無法出價。</div>
          ) : available <= 0 ? (
            <div className="notice warn">{listing.status === "sold" ? "這件物品已售出。" : "這件物品目前全數被保留，若有訂單取消會再開放。"}</div>
          ) : (
            <OfferForm
              listingId={listing.id}
              price={listing.price}
              available={available}
              paymentMethods={listing.paymentMethods}
              shippingFee={listing.shippingFee}
            />
          )}
        </div>
      </div>
    </>
  );
}
