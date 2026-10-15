-- POWER Friend 以物會友二手市集 · Supabase schema
-- 在 Supabase SQL Editor 依序執行：schema.sql → seed.sql
-- 之後再依編號執行 supabase/migrations/*.sql（001_auth.sql：Supabase Auth 的 RLS 與 trigger）
-- 本檔可重複執行；但重跑後請再依序重跑 migrations/001→004（004_hardening 會收回本檔建立的部分權限與政策）。
-- 原型向量維度 256（對應 lib/ai/embedding.ts）；換成多模態 embedding 模型時改維度並重建索引。

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ───────────── 使用者 ─────────────
create table if not exists profiles (
  id text primary key,                     -- 第一階段改為 uuid references auth.users
  display_name text not null,
  area_id text not null,                   -- 只存到捷運站／行政區粒度
  bio text default '',
  interests text[] default '{}',
  verification_level smallint not null default 0 check (verification_level between 0 and 2),
  joined_at timestamptz not null default now(),
  deals int not null default 0,
  positive_rate real not null default 0,
  valid_reports int not null default 0,
  taste_vec vector(256)
);

-- 敏感聯絡資料：pgp_sym_encrypt（每次加密隨機 IV），金鑰放在 Supabase Vault
create table if not exists profiles_private (
  id text primary key references profiles(id) on delete cascade,
  phone_enc bytea,
  real_name_enc bytea
);

-- 先在 Vault 建立金鑰：select vault.create_secret('<隨機長字串>', 'pii_key');
create or replace function set_private_contact(p_id text, p_phone text, p_real_name text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare k text := (select decrypted_secret from vault.decrypted_secrets where name = 'pii_key');
begin
  insert into profiles_private (id, phone_enc, real_name_enc)
  values (p_id, pgp_sym_encrypt(p_phone, k), pgp_sym_encrypt(p_real_name, k))
  on conflict (id) do update set phone_enc = excluded.phone_enc, real_name_enc = excluded.real_name_enc;
end $$;
revoke all on function set_private_contact from public, anon, authenticated;

-- ───────────── 物品 ─────────────
create table if not exists listings (
  id text primary key,
  seller_id text not null references profiles(id) on delete cascade,
  title text not null,
  description text default '',
  category text not null,
  condition text not null,
  price int not null check (price > 0),
  ai_price_low int not null,
  ai_price_high int not null,
  area_id text not null,
  photo_url text,                          -- 正式版放 Storage，不存 base64
  status text not null default 'active' check (status in ('active','reserved','sold')),
  created_at timestamptz not null default now(),
  views int not null default 0,
  embedding vector(256)
);
create index if not exists listings_status_idx on listings (status, created_at desc);
create index if not exists listings_embedding_idx on listings using hnsw (embedding vector_ip_ops);

-- ───────────── 出價（被接受才開聊） ─────────────
create table if not exists offers (
  id text primary key,
  listing_id text not null references listings(id) on delete cascade,
  buyer_id text not null references profiles(id) on delete cascade,
  seller_id text not null references profiles(id) on delete cascade,
  amount int not null check (amount > 0),
  message text not null,
  message_hash text not null,              -- 首訊去重（同一句話群發多位賣家即擋）
  ai_drafted boolean not null default false,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
create index if not exists offers_buyer_idx on offers (buyer_id, created_at desc);
create index if not exists offers_seller_idx on offers (seller_id, created_at desc);

create table if not exists conversations (
  id text primary key,
  offer_id text not null unique references offers(id) on delete cascade,
  listing_id text not null references listings(id) on delete cascade,
  buyer_id text not null references profiles(id) on delete cascade,
  seller_id text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  sender_id text not null,                 -- 'system' 為系統訊息
  body text not null,
  ai_drafted boolean not null default false,
  risk text not null default 'none' check (risk in ('none','low','high')),
  risk_reasons text[] default '{}',
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);

-- ───────────── 安全 ─────────────
create table if not exists blocks (
  blocker_id text not null references profiles(id) on delete cascade,
  blocked_id text not null references profiles(id) on delete cascade,
  primary key (blocker_id, blocked_id)
);

create table if not exists reports (
  id text primary key,
  reporter_id text not null references profiles(id) on delete cascade,
  target_id text not null references profiles(id) on delete cascade,
  reason text not null,
  counted boolean not null default false,  -- 只採計可信帳戶的檢舉
  created_at timestamptz not null default now(),
  unique (reporter_id, target_id)
);

create table if not exists scam_blocklist (
  kind text not null check (kind in ('bank','line','phone','url')),
  value_hash text not null,                -- 只存雜湊
  source text not null default '165',
  added_at timestamptz not null default now(),
  primary key (kind, value_hash)
);

-- ───────────── 同好社團（第二階段） ─────────────
create table if not exists clubs (
  id text primary key,
  name text not null unique,
  embedding vector(256)
);
create table if not exists club_members (
  club_id text references clubs(id) on delete cascade,
  user_id text references profiles(id) on delete cascade,
  primary key (club_id, user_id)
);

-- ───────────── 品味配對查詢 ─────────────
-- 依使用者品味向量排序（內積，向量皆已正規化），排除自己與封鎖雙方
create or replace function match_listings(viewer text, k int default 30)
returns table (id text, taste_fit int)
language sql stable as $$
  select l.id, round(100 * (1 - (l.embedding <#> p.taste_vec)) / 2)::int
  from listings l, profiles p
  where p.id = viewer
    and l.status = 'active'
    and l.seller_id <> viewer
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = viewer and b.blocked_id = l.seller_id)
         or (b.blocker_id = l.seller_id and b.blocked_id = viewer))
  order by l.embedding <#> p.taste_vec
  limit k;
$$;

-- 接受出價、成交更新（雙方成交數 +1、買家品味向量）、瀏覽數、有效檢舉數的原子操作
-- 見 migrations/004_hardening.sql（accept_offer、complete_deal、increment_views、add_valid_report；僅 service role 可呼叫）。

-- ───────────── RLS ─────────────
-- 伺服器端用 service role 會略過 RLS；以下規則保護未來前端直連（anon key + Supabase Auth）。
alter table profiles enable row level security;
alter table profiles_private enable row level security;
alter table listings enable row level security;
alter table offers enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;
alter table reports enable row level security;
alter table scam_blocklist enable row level security;
alter table clubs enable row level security;
alter table club_members enable row level security;

create or replace function is_blocked(a text, b text) returns boolean language sql stable as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles for select using (true);
drop policy if exists "profiles self update" on profiles;
create policy "profiles self update" on profiles for update using (id = auth.uid()::text);

drop policy if exists "private self only" on profiles_private;
create policy "private self only" on profiles_private for select using (id = auth.uid()::text);

drop policy if exists "listings readable unless blocked" on listings;
create policy "listings readable unless blocked" on listings for select
  using (status <> 'sold' and not is_blocked(auth.uid()::text, seller_id) or seller_id = auth.uid()::text);
drop policy if exists "listings own write" on listings;
create policy "listings own write" on listings for all using (seller_id = auth.uid()::text) with check (seller_id = auth.uid()::text);

drop policy if exists "offers parties" on offers;
create policy "offers parties" on offers for select using (auth.uid()::text in (buyer_id, seller_id));
drop policy if exists "offers buyer insert" on offers;
create policy "offers buyer insert" on offers for insert
  with check (buyer_id = auth.uid()::text and not is_blocked(buyer_id, seller_id));
drop policy if exists "offers seller respond" on offers;
create policy "offers seller respond" on offers for update using (seller_id = auth.uid()::text);

drop policy if exists "conversations parties" on conversations;
create policy "conversations parties" on conversations for select using (auth.uid()::text in (buyer_id, seller_id));

drop policy if exists "messages parties read" on messages;
create policy "messages parties read" on messages for select using (
  exists (select 1 from conversations c where c.id = conversation_id and auth.uid()::text in (c.buyer_id, c.seller_id)));
drop policy if exists "messages parties write" on messages;
create policy "messages parties write" on messages for insert with check (
  sender_id = auth.uid()::text and exists (
    select 1 from conversations c where c.id = conversation_id
      and auth.uid()::text in (c.buyer_id, c.seller_id)
      and not is_blocked(c.buyer_id, c.seller_id)));

drop policy if exists "blocks own" on blocks;
create policy "blocks own" on blocks for all using (blocker_id = auth.uid()::text) with check (blocker_id = auth.uid()::text);
drop policy if exists "reports own insert" on reports;
create policy "reports own insert" on reports for insert with check (reporter_id = auth.uid()::text);
-- reports、scam_blocklist 無 select 政策：僅 service role（管理後台）可讀

drop policy if exists "clubs readable" on clubs;
create policy "clubs readable" on clubs for select using (true);
drop policy if exists "club members readable" on club_members;
create policy "club members readable" on club_members for select using (true);
drop policy if exists "club join self" on club_members;
create policy "club join self" on club_members for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

-- Realtime：聊天訊息推播（冪等：已加入就略過）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
