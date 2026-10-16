-- 005_quantity_payment：多件數量、多種付款方式、貨到付款（可重複執行）
-- 執行順序：schema.sql → seed.sql → 001 → 002 → 003 → 004 → 本檔（之後可再跑一次 seed.sql 套用示範物品的數量／付款設定）
-- 原則：
--   平台不經手金流：付款方式只是買賣雙方約定的方式，平台只記錄、提示風險。
--   數量計數與狀態只由下列 security definer 函式（僅 service role）原子變更；status 由 trigger 依數量推導。
--   收件資訊（offer_shipping）整包 JSON 以 pgp_sym_encrypt 加密（金鑰：Vault pii_key），
--   RLS 開啟且不 grant 給 anon／authenticated；只能經 get_shipping_info 讀（伺服器端再檢查是否為訂單雙方）。
--   成交或取消即刪除收件資訊。

-- ───────────── listings：數量、付款方式、運費 ─────────────
alter table listings add column if not exists quantity int not null default 1;
alter table listings add column if not exists reserved_qty int not null default 0;
alter table listings add column if not exists sold_qty int not null default 0;
alter table listings add column if not exists payment_methods text[] not null default array['meetup_cash']::text[];
alter table listings add column if not exists shipping_fee int not null default 0;

-- 舊資料回填（只動計數仍為 0 的列，重跑不會重複加）：reserved → 保留 1 件；sold → 成交 1 件
update listings set reserved_qty = quantity
  where status = 'reserved' and reserved_qty = 0 and sold_qty = 0;
update listings set sold_qty = quantity
  where status = 'sold' and reserved_qty = 0 and sold_qty = 0;

alter table listings drop constraint if exists listings_quantity_check;
alter table listings add constraint listings_quantity_check check (quantity between 1 and 999);
alter table listings drop constraint if exists listings_qty_counts_check;
alter table listings add constraint listings_qty_counts_check
  check (reserved_qty >= 0 and sold_qty >= 0 and reserved_qty + sold_qty <= quantity);
alter table listings drop constraint if exists listings_payment_methods_check;
alter table listings add constraint listings_payment_methods_check
  check (
    cardinality(payment_methods) >= 1
    and payment_methods <@ array['meetup_cash','cod','bank_transfer','mobile_pay']::text[]
    and array_position(payment_methods, null) is null
  );
alter table listings drop constraint if exists listings_shipping_fee_check;
alter table listings add constraint listings_shipping_fee_check check (shipping_fee between 0 and 1000);

-- status 一律由數量推導：可售 > 0 → active；全部成交 → sold；其餘（有保留、無可售）→ reserved
create or replace function listings_derive_status() returns trigger
language plpgsql set search_path = public as $$
begin
  new.status := case
    when new.quantity - new.reserved_qty - new.sold_qty > 0 then 'active'
    when new.sold_qty >= new.quantity then 'sold'
    else 'reserved'
  end;
  return new;
end $$;
drop trigger if exists listings_derive_status on listings;
create trigger listings_derive_status before insert or update on listings
  for each row execute function listings_derive_status();
-- 讓既有資料的 status 與數量一致（trigger 會重算）
update listings set status = status
  where status is distinct from (case
    when quantity - reserved_qty - sold_qty > 0 then 'active'
    when sold_qty >= quantity then 'sold'
    else 'reserved' end);

-- ───────────── offers：數量、付款方式、寄出 ─────────────
alter table offers add column if not exists quantity int not null default 1;
alter table offers add column if not exists payment_method text not null default 'meetup_cash';
alter table offers add column if not exists shipped_at timestamptz;
alter table offers add column if not exists tracking_no text;
-- 運費快照：出價當下物品的運費（只有 cod 才有）；總額以此計算，之後物品改運費不影響既有出價
alter table offers add column if not exists shipping_fee int not null default 0;

alter table offers drop constraint if exists offers_status_check;
alter table offers add constraint offers_status_check
  check (status in ('pending','accepted','declined','completed','cancelled'));
alter table offers drop constraint if exists offers_quantity_check;
alter table offers add constraint offers_quantity_check check (quantity between 1 and 999);
alter table offers drop constraint if exists offers_payment_method_check;
alter table offers add constraint offers_payment_method_check
  check (payment_method in ('meetup_cash','cod','bank_transfer','mobile_pay'));
alter table offers drop constraint if exists offers_shipping_fee_check;
alter table offers add constraint offers_shipping_fee_check
  check (shipping_fee between 0 and 1000 and (payment_method = 'cod' or shipping_fee = 0));
alter table offers drop constraint if exists offers_tracking_no_check;
alter table offers add constraint offers_tracking_no_check
  check (tracking_no is null or tracking_no ~ '^[A-Za-z0-9-]{1,40}$');

-- 舊資料：物品已售出的已接受出價視為已成交（成交以 offer 為單位計算）
update offers o set status = 'completed'
  from conversations c join listings l on l.id = c.listing_id
  where c.offer_id = o.id and o.status = 'accepted' and l.status = 'sold';

-- 運費快照回填：尚未快照（0）的 cod 出價取物品目前運費（只動 pending／accepted；已結束的訂單不追溯）
update offers o set shipping_fee = l.shipping_fee
  from listings l
  where l.id = o.listing_id and o.payment_method = 'cod' and o.shipping_fee = 0
    and o.status in ('pending', 'accepted') and l.shipping_fee > 0;

create index if not exists offers_listing_idx on offers (listing_id, status);

-- ───────────── offer_shipping：貨到付款收件資訊（加密） ─────────────
create table if not exists offer_shipping (
  offer_id text primary key references offers(id) on delete cascade,
  payload bytea not null,                  -- pgp_sym_encrypt(整包 JSON, Vault pii_key)
  updated_at timestamptz not null default now()
);
alter table offer_shipping enable row level security;
-- 不建立任何政策、不 grant：前端（anon／authenticated）一律讀寫不到
revoke all on offer_shipping from public, anon, authenticated;

-- ───────────── 原子操作函式（僅 service role） ─────────────

-- 婉拒出價：pending 且屬於 p_seller → declined
create or replace function decline_offer(p_offer text, p_seller text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update offers set status = 'declined'
    where id = p_offer and seller_id = p_seller and status = 'pending';
  return found;
end $$;

-- 接受出價：offer 須 pending 且屬於 p_seller、可售數量 ≥ offer.quantity
-- → reserved_qty += q（status 由 trigger 重算）、offer accepted、建立對話與首訊；前提不成立回傳 false 且不做變更。
-- 並行安全：offer 以 for update 鎖定；listing 以條件式 update 搶數量，
-- 並行的另一個交易會等前者 commit 後以新列重新評估 where（READ COMMITTED），數量不足即 not found → false，不會超賣。
-- （check constraint reserved_qty + sold_qty <= quantity 是最後一道防線）
create or replace function accept_offer(p_offer text, p_seller text, p_conv jsonb, p_msg jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o offers%rowtype;
begin
  select * into o from offers
    where id = p_offer and seller_id = p_seller and status = 'pending'
    for update;
  if not found then
    return false;
  end if;

  update listings set reserved_qty = reserved_qty + o.quantity
    where id = o.listing_id and seller_id = p_seller
      and quantity - reserved_qty - sold_qty >= o.quantity;
  if not found then
    return false;
  end if;

  update offers set status = 'accepted' where id = o.id;

  insert into conversations (id, offer_id, listing_id, buyer_id, seller_id, created_at)
  values (p_conv->>'id', o.id, o.listing_id, o.buyer_id, o.seller_id,
          coalesce((p_conv->>'created_at')::timestamptz, now()));

  insert into messages (id, conversation_id, sender_id, body, ai_drafted, risk, risk_reasons, created_at)
  values (p_msg->>'id', p_conv->>'id', p_msg->>'sender_id', p_msg->>'body',
          coalesce((p_msg->>'ai_drafted')::boolean, false),
          coalesce(p_msg->>'risk', 'none'),
          array(select jsonb_array_elements_text(coalesce(p_msg->'risk_reasons', '[]'::jsonb))),
          coalesce((p_msg->>'created_at')::timestamptz, now()));
  return true;
end $$;

-- 成交（以對話對應的 offer 為單位）：對話賣家須為 p_seller、offer 須 accepted；貨到付款須已寄出
-- → reserved_qty -= q、sold_qty += q（status 由 trigger 重算）、offer completed；
-- 這對帳號（不分買賣方向）先前沒有任何已成交出價時，雙方 deals 才各 +1（防洗成交數）；
-- 買家 taste_vec = p_buyer_taste；寫入系統訊息；刪除收件資訊。前提不成立回傳 false。
-- 並行安全：offer for update；雙方 profile 依 id 排序上鎖，同一對帳號的兩筆成交序列化，後者看得到前者已 completed。
create or replace function complete_deal(p_conv text, p_seller text, p_buyer_taste text, p_msg jsonb) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  c conversations%rowtype;
  o offers%rowtype;
  dealt_before boolean;
begin
  select * into c from conversations where id = p_conv and seller_id = p_seller;
  if not found then
    return false;
  end if;

  select * into o from offers where id = c.offer_id and status = 'accepted' for update;
  if not found then
    return false;
  end if;
  if o.payment_method = 'cod' and o.shipped_at is null then
    return false;
  end if;

  update listings set reserved_qty = reserved_qty - o.quantity, sold_qty = sold_qty + o.quantity
    where id = o.listing_id and seller_id = p_seller and reserved_qty >= o.quantity;
  if not found then
    return false;
  end if;

  update offers set status = 'completed' where id = o.id;
  delete from offer_shipping where offer_id = o.id;

  perform 1 from profiles where id in (c.buyer_id, c.seller_id) order by id for update;

  select exists (
    select 1 from offers o2
    where o2.id <> o.id
      and o2.status = 'completed'
      and ((o2.buyer_id = o.buyer_id and o2.seller_id = o.seller_id)
        or (o2.buyer_id = o.seller_id and o2.seller_id = o.buyer_id))
  ) into dealt_before;

  if not dealt_before then
    update profiles set deals = deals + 1 where id in (c.buyer_id, c.seller_id);
  end if;

  update profiles set taste_vec = p_buyer_taste::vector where id = c.buyer_id;

  insert into messages (id, conversation_id, sender_id, body, ai_drafted, risk, risk_reasons, created_at)
  values (p_msg->>'id', c.id, coalesce(p_msg->>'sender_id', 'system'), p_msg->>'body',
          coalesce((p_msg->>'ai_drafted')::boolean, false),
          coalesce(p_msg->>'risk', 'none'),
          array(select jsonb_array_elements_text(coalesce(p_msg->'risk_reasons', '[]'::jsonb))),
          coalesce((p_msg->>'created_at')::timestamptz, now()));
  return true;
end $$;

-- 取消訂單：p_actor 須為對話雙方之一、offer 須 accepted；
-- 已寄出的貨到付款只有賣家可取消（p_allow_shipped 僅供伺服器刪除帳號時使用）
-- → offer cancelled、reserved_qty -= q（status 由 trigger 重算）、系統訊息、刪除收件資訊。前提不成立回傳 false。
create or replace function cancel_order(p_conv text, p_actor text, p_msg jsonb, p_allow_shipped boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c conversations%rowtype;
  o offers%rowtype;
begin
  select * into c from conversations where id = p_conv and p_actor in (buyer_id, seller_id);
  if not found then
    return false;
  end if;

  select * into o from offers where id = c.offer_id and status = 'accepted' for update;
  if not found then
    return false;
  end if;
  if o.shipped_at is not null and p_actor <> c.seller_id and not coalesce(p_allow_shipped, false) then
    return false;
  end if;

  update listings set reserved_qty = greatest(reserved_qty - o.quantity, 0) where id = o.listing_id;
  update offers set status = 'cancelled' where id = o.id;
  delete from offer_shipping where offer_id = o.id;

  insert into messages (id, conversation_id, sender_id, body, ai_drafted, risk, risk_reasons, created_at)
  values (p_msg->>'id', c.id, coalesce(p_msg->>'sender_id', 'system'), p_msg->>'body',
          coalesce((p_msg->>'ai_drafted')::boolean, false),
          coalesce(p_msg->>'risk', 'none'),
          array(select jsonb_array_elements_text(coalesce(p_msg->'risk_reasons', '[]'::jsonb))),
          coalesce((p_msg->>'created_at')::timestamptz, now()));
  return true;
end $$;

-- 填寫／重填收件資訊：p_buyer 須為對話買方、offer 須為 accepted 的貨到付款且未寄出。
-- p_info: {"method","recipientName","phone","storeOrAddress"}（應用層已驗證與正規化，這裡再檢查一次格式）
create or replace function set_shipping_info(p_conv text, p_buyer text, p_info jsonb) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  c conversations%rowtype;
  o offers%rowtype;
  k text := (select decrypted_secret from vault.decrypted_secrets where name = 'pii_key');
  clean jsonb;
begin
  if k is null then
    raise exception 'Vault 金鑰 pii_key 不存在';
  end if;
  if coalesce(p_info->>'method', '') not in ('cvs_pickup', 'home_delivery')
     or char_length(coalesce(p_info->>'recipientName', '')) not between 1 and 20
     or coalesce(p_info->>'phone', '') !~ '^09[0-9]{8}$'
     or char_length(coalesce(p_info->>'storeOrAddress', '')) not between 2 and 100 then
    return false;
  end if;

  select * into c from conversations where id = p_conv and buyer_id = p_buyer;
  if not found then
    return false;
  end if;
  select * into o from offers
    where id = c.offer_id and status = 'accepted' and payment_method = 'cod' and shipped_at is null
    for update;
  if not found then
    return false;
  end if;

  clean := jsonb_build_object(
    'method', p_info->>'method',
    'recipientName', p_info->>'recipientName',
    'phone', p_info->>'phone',
    'storeOrAddress', p_info->>'storeOrAddress');
  insert into offer_shipping (offer_id, payload, updated_at)
  values (o.id, pgp_sym_encrypt(clean::text, k), now())
  on conflict (offer_id) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  return true;
end $$;

-- 讀取收件資訊：p_user 須為對話雙方之一；回傳 {"offerId",...} 或 null
create or replace function get_shipping_info(p_conv text, p_user text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c conversations%rowtype;
  enc bytea;
  k text;
begin
  select * into c from conversations where id = p_conv and p_user in (buyer_id, seller_id);
  if not found then
    return null;
  end if;
  select payload into enc from offer_shipping where offer_id = c.offer_id;
  if enc is null then
    return null;
  end if;
  k := (select decrypted_secret from vault.decrypted_secrets where name = 'pii_key');
  if k is null then
    raise exception 'Vault 金鑰 pii_key 不存在';
  end if;
  return pgp_sym_decrypt(enc, k)::jsonb || jsonb_build_object('offerId', c.offer_id);
end $$;

-- 標記已寄出：p_seller 須為對話賣方、offer 須為 accepted 的貨到付款、已有收件資訊、未寄出
-- → shipped_at = now()、tracking_no、系統訊息。前提不成立回傳 false。
create or replace function mark_shipped(p_conv text, p_seller text, p_tracking text, p_msg jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c conversations%rowtype;
  o offers%rowtype;
begin
  if p_tracking is not null and p_tracking !~ '^[A-Za-z0-9-]{1,40}$' then
    return false;
  end if;
  select * into c from conversations where id = p_conv and seller_id = p_seller;
  if not found then
    return false;
  end if;
  select * into o from offers
    where id = c.offer_id and status = 'accepted' and payment_method = 'cod' and shipped_at is null
    for update;
  if not found then
    return false;
  end if;
  if not exists (select 1 from offer_shipping where offer_id = o.id) then
    return false;
  end if;

  update offers set shipped_at = now(), tracking_no = p_tracking where id = o.id;

  insert into messages (id, conversation_id, sender_id, body, ai_drafted, risk, risk_reasons, created_at)
  values (p_msg->>'id', c.id, coalesce(p_msg->>'sender_id', 'system'), p_msg->>'body',
          coalesce((p_msg->>'ai_drafted')::boolean, false),
          coalesce(p_msg->>'risk', 'none'),
          array(select jsonb_array_elements_text(coalesce(p_msg->'risk_reasons', '[]'::jsonb))),
          coalesce((p_msg->>'created_at')::timestamptz, now()));
  return true;
end $$;

-- match_listings：以可售數量 > 0 判斷（與 status = 'active' 等價，明列以免依賴 trigger）
create or replace function match_listings(viewer text, k int default 30)
returns table (id text, taste_fit int)
language sql stable security definer set search_path = public, extensions as $$
  select l.id, round(100 * (1 - (l.embedding <#> p.taste_vec)) / 2)::int
  from listings l, profiles p
  where p.id = viewer
    and (auth.uid() is null or auth.uid()::text = viewer)
    and l.quantity - l.reserved_qty - l.sold_qty > 0
    and l.seller_id <> viewer
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = viewer and b.blocked_id = l.seller_id)
         or (b.blocker_id = l.seller_id and b.blocked_id = viewer))
  order by l.embedding <#> p.taste_vec
  limit least(greatest(k, 1), 100);
$$;
revoke execute on function match_listings(text, int) from public, anon;
grant execute on function match_listings(text, int) to authenticated, service_role;

-- 權限：只允許伺服器（service role）呼叫
revoke execute on function decline_offer(text, text) from public, anon, authenticated;
revoke execute on function accept_offer(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function complete_deal(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function cancel_order(text, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function set_shipping_info(text, text, jsonb) from public, anon, authenticated;
revoke execute on function get_shipping_info(text, text) from public, anon, authenticated;
revoke execute on function mark_shipped(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function listings_derive_status() from public, anon, authenticated;
grant execute on function decline_offer(text, text) to service_role;
grant execute on function accept_offer(text, text, jsonb, jsonb) to service_role;
grant execute on function complete_deal(text, text, text, jsonb) to service_role;
grant execute on function cancel_order(text, text, jsonb, boolean) to service_role;
grant execute on function set_shipping_info(text, text, jsonb) to service_role;
grant execute on function get_shipping_info(text, text) to service_role;
grant execute on function mark_shipped(text, text, text, jsonb) to service_role;
