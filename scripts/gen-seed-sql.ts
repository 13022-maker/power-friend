/**
 * 由 lib/data/seed.ts 產生 supabase/seed.sql（含向量），確保 demo 與 Supabase 資料一致。
 * 用法：npm run seed:sql
 */
import { writeFileSync } from "node:fs";
import { seedListings, seedProfiles } from "../lib/data/seed";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const vec = (v: number[]) => q(`[${v.map((x) => +x.toFixed(6)).join(",")}]`);
const arr = (a: string[]) => `array[${a.map(q).join(",")}]::text[]`;

const lines: string[] = ["-- 由 scripts/gen-seed-sql.ts 產生，請勿手改", "begin;"];
for (const p of seedProfiles()) {
  lines.push(
    `insert into profiles (id, display_name, area_id, bio, interests, verification_level, joined_at, deals, positive_rate, valid_reports, taste_vec) values (${[
      q(p.id), q(p.displayName), q(p.areaId), q(p.bio), arr(p.interests), p.verificationLevel, q(p.joinedAt), p.deals, p.positiveRate, p.validReports, vec(p.tasteVec),
    ].join(", ")}) on conflict (id) do nothing;`,
  );
}
for (const l of seedListings()) {
  lines.push(
    `insert into listings (id, seller_id, title, description, category, condition, price, ai_price_low, ai_price_high, area_id, status, created_at, views, embedding) values (${[
      q(l.id), q(l.sellerId), q(l.title), q(l.description), q(l.category), q(l.condition), l.price, l.aiPriceLow, l.aiPriceHigh, q(l.areaId), q(l.status), q(l.createdAt), l.views, vec(l.embedding),
    ].join(", ")}) on conflict (id) do nothing;`,
  );
}
lines.push("commit;", "");
writeFileSync(new URL("../supabase/seed.sql", import.meta.url), lines.join("\n"));
console.log(`wrote supabase/seed.sql (${lines.length} lines)`);
