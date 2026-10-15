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
          <div className="price" style={{ fontSize: 28 }}>{formatNTD(listing.price)}</div>
          <PriceBand listing={listing} />
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{listing.description}</p>
          <p className="muted" style={{ margin: 0 }}>
            面交區域：{AREAS[listing.areaId]?.label}（{distanceBand(distanceKm(me.areaId, listing.areaId))}）・ {listing.views} 人看過
          </p>

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
              <div className="muted">收到 {offers.length} 筆出價，到「出價與聊天」處理。</div>
            </div>
          ) : blocked ? (
            <div className="notice err">你與這位賣家之間有封鎖，無法出價。</div>
          ) : listing.status !== "active" ? (
            <div className="notice warn">這件物品已被保留或售出。</div>
          ) : (
            <OfferForm listingId={listing.id} price={listing.price} />
          )}
        </div>
      </div>
    </>
  );
}
