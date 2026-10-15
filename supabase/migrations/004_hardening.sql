-- 004_hardening：安全審查修正（可重複執行）
-- 執行順序：schema.sql → seed.sql → 001_auth.sql → 002_storage_realtime.sql → 003_server_only_writes.sql → 本檔
-- 重點：
--   H2  profiles 只能由伺服器（service role）寫入
--   L3  前端可讀 profiles，但讀不到 taste_vec（品味向量屬推論個資）
--   L1  Storage 寫入只走伺服器；公開 bucket 讀取不需要 select 政策
--   L2  is_blocked 改 security definer（看得到對方封鎖自己的紀錄）且只回答當事人；match_listings 不開放 anon
--   M3  被檢舉者刪除帳號後，檢舉紀錄仍保留（target_id → null，target_ref 保留原 id 的 sha256）
--   原子操作 RPC：increment_views、accept_offer、complete_deal、add_valid_report（僅 service role）

-- ───────────── H2：profiles 只由伺服器寫入 ─────────────
-- onboarding 改由伺服器以 service role 建立 profile；前端不再能 insert／update。
-- （表層級 revoke 會一併收回 001 給的欄位層級 update 權限；這裡也明列以示清楚）
revoke insert, update, delete on profiles from anon, authenticated;
revoke update (display_name, area_id, bio, interests) on profiles from anon, authenticated;
drop policy if exists "profiles self insert" on profiles;
drop policy if exists "profiles self update" on profiles;

-- ───────────── L3：profiles 可讀，但不含 taste_vec ─────────────
-- 欄位層級 grant 蓋不過表層級 grant，所以先整表 revoke 再逐欄 grant。
-- 注意：前端直連時不能再用 select('*')，必須列出欄位。
revoke select on profiles from anon, authenticated;
grant select (id, display_name, area_id, bio, interests, verification_level, joined_at, deals, positive_rate, valid_reports)
  on profiles to anon, authenticated;

-- ───────────── L1：Storage 政策（listing-photos） ─────────────
-- 公開 bucket 以公開 URL 讀取，不需要 select 政策；保留 select 政策反而讓任何人能 list 全部檔名（含使用者 id 資料夾）。
-- 上傳／刪除一律由伺服器以 service role 執行（lib/storage.ts），移除前端寫入政策。
drop policy if exists "listing photos public read" on storage.objects;
drop policy if exists "listing photos own insert" on storage.objects;
drop policy if exists "listing photos own delete" on storage.objects;

-- ───────────── L2：is_blocked、match_listings ─────────────
-- security definer：RLS 下使用者只看得到自己建立的封鎖，invoker 版本會漏掉「對方封鎖我」。
-- 為避免任意查詢他人封鎖關係：已登入者只能查自己是當事人的組合；anon 一律 false；
-- 伺服器（service role／SQL editor，無 auth.uid()）照常回答。
create or replace function is_blocked(a text, b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where ((blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
      and (
        (auth.uid() is not null and auth.uid()::text in (a, b))
        or (auth.uid() is null and coalesce(auth.role(), '') <> 'anon')
      )
  );
$$;

-- match_listings 需要讀 taste_vec（前端已無此欄位的 select 權限），改 security definer；
-- 已登入者只能以自己為 viewer 查詢（避免推測他人品味），伺服器端（無 auth.uid()）不限。
create or replace function match_listings(viewer text, k int default 30)
returns table (id text, taste_fit int)
language sql stable security definer set search_path = public, extensions as $$
  select l.id, round(100 * (1 - (l.embedding <#> p.taste_vec)) / 2)::int
  from listings l, profiles p
  where p.id = viewer
    and (auth.uid() is null or auth.uid()::text = viewer)
    and l.status = 'active'
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

-- ───────────── M3：檢舉證據保留 ─────────────
-- 被檢舉者刪除帳號 → target_id 設為 null（紀錄保留）；檢舉人刪除帳號 → 其提出的檢舉隨之刪除（reporter_id 維持 cascade）。
alter table reports add column if not exists target_ref text;  -- sha256(原 target_id) hex，應用層 insert 時填入
update reports
  set target_ref = encode(sha256(convert_to(target_id, 'UTF8')), 'hex')
  where target_ref is null and target_id is not null;
alter table reports alter column target_id drop not null;
alter table reports drop constraint if exists reports_target_id_fkey;
alter table reports add constraint reports_target_id_fkey
  foreign key (target_id) references profiles(id) on delete set null;
create index if not exists reports_target_ref_idx on reports (target_ref);

-- ───────────── 原子操作 RPC（僅 service role） ─────────────

-- 瀏覽數 +1（不改寫其他欄位，避免 read-modify-write 蓋掉並行的狀態變更）
create or replace function increment_views(p_listing text) returns void
language sql security definer set search_path = public as $$
  update listings set views = views + 1 where id = p_listing;
$$;

-- 有效檢舉數 +1
create or replace function add_valid_report(p_target text) returns void
language sql security definer set search_path = public as $$
  update profiles set valid_reports = valid_reports + 1 where id = p_target;
$$;

-- 接受出價：offer 須 pending 且屬於 p_seller、listing 須 active
-- → listing reserved、offer accepted、建立對話與第一則訊息；任一前提不成立回傳 false 且不做變更。
-- 並行安全：offer 以 for update 鎖定；listing 以 `update … where status = 'active'` 搶狀態，
-- 第二個交易會等第一個 commit 後重新評估 where（READ COMMITTED），因而 not found → false。
-- p_conv: {"id", "created_at"}；雙方與物品一律取自 offer，不信任呼叫端。
-- p_msg:  {"id","sender_id","body","ai_drafted","risk","risk_reasons","created_at"}（conversation_id 以 p_conv.id 為準）
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

  update listings set status = 'reserved'
    where id = o.listing_id and seller_id = p_seller and status = 'active';
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

-- 成交：對話賣家須為 p_seller、listing 須 reserved → listing sold；
-- 這對帳號（不分買賣方向）先前沒有任何已成交紀錄時，雙方 deals 才各 +1（防洗成交數）；
-- 買家 taste_vec = p_buyer_taste（pgvector 文字格式 "[0.1,0.2,…]"）；寫入系統訊息。前提不成立回傳 false。
-- 並行安全：listing 以 `where status = 'reserved'` 搶狀態；雙方 profile 依 id 排序上鎖，
-- 同一對帳號的兩筆成交會序列化，後者重新查詢時看得到前者已 sold，不會重複加分。
create or replace function complete_deal(p_conv text, p_seller text, p_buyer_taste text, p_msg jsonb) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  c conversations%rowtype;
  dealt_before boolean;
begin
  select * into c from conversations where id = p_conv and seller_id = p_seller;
  if not found then
    return false;
  end if;

  update listings set status = 'sold'
    where id = c.listing_id and seller_id = p_seller and status = 'reserved';
  if not found then
    return false;
  end if;

  perform 1 from profiles where id in (c.buyer_id, c.seller_id) order by id for update;

  select exists (
    select 1
    from conversations c2
    join listings l on l.id = c2.listing_id
    where c2.id <> c.id
      and l.status = 'sold'
      and ((c2.buyer_id = c.buyer_id and c2.seller_id = c.seller_id)
        or (c2.buyer_id = c.seller_id and c2.seller_id = c.buyer_id))
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

-- 只允許伺服器（service role）呼叫；Supabase 預設會把 public schema 新函式的 execute 授權給 anon／authenticated，需明確收回
revoke execute on function increment_views(text) from public, anon, authenticated;
revoke execute on function add_valid_report(text) from public, anon, authenticated;
revoke execute on function accept_offer(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function complete_deal(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function increment_views(text) to service_role;
grant execute on function add_valid_report(text) to service_role;
grant execute on function accept_offer(text, text, jsonb, jsonb) to service_role;
grant execute on function complete_deal(text, text, text, jsonb) to service_role;
