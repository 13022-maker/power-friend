import Link from "next/link";
import { CATEGORIES, CONDITIONS, distanceBand, formatNTD } from "@/lib/catalog";
import { computeTrust } from "@/lib/trust";
import type { Category, Listing, Profile, RankedListing } from "@/lib/types";

export function Thumb({ category, photo, fit, status }: { category: Category; photo?: string; fit?: number; status?: string }) {
  const c = CATEGORIES[category];
  return (
    <div
      className="thumb"
      style={
        photo
          ? undefined
          : {
              background: `linear-gradient(135deg, hsl(${c.hue} 45% 86%), hsl(${(c.hue + 30) % 360} 40% 76%))`,
              color: `hsl(${c.hue} 45% 28%)`,
            }
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img src={photo} alt="" /> : <span className="glyph">{c.glyph}</span>}
      {fit !== undefined && <span className="fit">契合 {fit}%</span>}
      {status && status !== "active" && <span className="status">{status === "reserved" ? "已保留" : "已售出"}</span>}
    </div>
  );
}

export function TrustBadge({ profile }: { profile: Profile }) {
  const t = computeTrust(profile);
  const cls = t.tier === "高信任" ? "trust-hi" : t.tier === "可信" ? "trust-mid" : "trust-lo";
  return (
    <span className={`badge ${cls}`} title={`信任分數 ${t.total}`}>
      {profile.verificationLevel >= 2 ? "✓ " : ""}
      {t.tier} {t.total}
    </span>
  );
}

export function ListingCard({ l, showFit = true }: { l: RankedListing; showFit?: boolean }) {
  return (
    <Link href={`/listing/${l.id}`} className="card">
      <Thumb category={l.category} photo={l.photo} fit={showFit ? l.tasteFit : undefined} status={l.status} />
      <div className="card-body">
        <div className="card-title">{l.title}</div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="pricetag">{formatNTD(l.price)}</span>
          <span className="muted">{distanceBand(l.distanceKm)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>{l.seller.displayName}</span>
          <TrustBadge profile={l.seller} />
        </div>
      </div>
    </Link>
  );
}

export function PriceBand({ listing }: { listing: Listing }) {
  const min = Math.min(listing.aiPriceLow, listing.price) * 0.8;
  const max = Math.max(listing.aiPriceHigh, listing.price) * 1.15;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const verdict =
    listing.price < listing.aiPriceLow ? "低於行情" : listing.price > listing.aiPriceHigh ? "高於行情" : "落在行情區間";
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>AI 行情估價</strong>
        <span className="muted">{verdict}・{CONDITIONS[listing.condition].label}</span>
      </div>
      <div className="band" role="img" aria-label={`行情 ${formatNTD(listing.aiPriceLow)} 到 ${formatNTD(listing.aiPriceHigh)}，售價 ${formatNTD(listing.price)}`}>
        <div className="range" style={{ left: pos(listing.aiPriceLow), width: `calc(${pos(listing.aiPriceHigh)} - ${pos(listing.aiPriceLow)})` }} />
        <span className="lbl" style={{ left: pos(listing.aiPriceLow) }}>{formatNTD(listing.aiPriceLow)}</span>
        <span className="lbl" style={{ left: pos(listing.aiPriceHigh) }}>{formatNTD(listing.aiPriceHigh)}</span>
        <div className="pin" style={{ left: pos(listing.price) }} />
        <span className="pinlbl" style={{ left: pos(listing.price) }}>售價</span>
      </div>
    </div>
  );
}
