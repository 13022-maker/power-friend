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
const qty: string[] = [];
for (const p of seedProfiles()) {
  lines.push(
    `insert into profiles (id, display_name, area_id, bio, interests, verification_level, joined_at, deals, positive_rate, valid_reports, taste_vec) values (${[
      q(p.id), q(p.displayName), q(p.areaId), q(p.bio), arr(p.interests), p.verificationLevel, q(p.joinedAt), p.deals, p.positiveRate, p.validReports, vec(p.tasteVec),
    ].join(", ")}) on conflict (id) do nothing;`,
  );
}
for (const l of seedListings()) {
  // 數量／付款欄位由 005_quantity_payment.sql 新增：先跑 seed.sql 再跑 005 時，物品先以舊欄位建立，
  // 005 之後重跑 seed.sql 會以 update 套用數量與付款方式（只在尚未有任何保留／成交時，避免蓋掉交易狀態）。
  lines.push(
    `insert into listings (id, seller_id, title, description, category, condition, price, ai_price_low, ai_price_high, area_id, status, created_at, views, embedding) values (${[
      q(l.id), q(l.sellerId), q(l.title), q(l.description), q(l.category), q(l.condition), l.price, l.aiPriceLow, l.aiPriceHigh, q(l.areaId), q(l.status), q(l.createdAt), l.views, vec(l.embedding),
    ].join(", ")}) on conflict (id) do nothing;`,
  );
  qty.push(
    `  update listings set quantity = ${l.quantity}, payment_methods = ${arr(l.paymentMethods)}, shipping_fee = ${l.shippingFee} where id = ${q(l.id)} and reserved_qty = 0 and sold_qty = 0;`,
  );
}
lines.push(
  "-- 005_quantity_payment.sql 執行後才有的欄位：欄位存在才套用（本檔在 005 前後執行都可以）",
  "do $seed$",
  "begin",
  "  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name = 'payment_methods') then",
  ...qty.map((x) => `  ${x}`),
  "  end if;",
  "end $seed$;",
);
lines.push("commit;", "");
writeFileSync(new URL("../supabase/seed.sql", import.meta.url), lines.join("\n"));
console.log(`wrote supabase/seed.sql (${lines.length} lines)`);
