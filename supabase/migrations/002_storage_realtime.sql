-- 002_storage_realtime：上架照片 Storage bucket、Storage RLS、Realtime 確認
-- 在 schema.sql、seed.sql、001_auth.sql 之後執行（可重複執行）。

-- ───────────── Storage：listing-photos（公開讀取） ─────────────
-- 路徑慣例：<owner_id>/<random>.jpg；伺服器端以 service role 上傳／刪除（略過 RLS），
-- 以下政策保護前端直連（anon key + 使用者 JWT）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "listing photos public read" on storage.objects;
create policy "listing photos public read" on storage.objects for select
  using (bucket_id = 'listing-photos');

drop policy if exists "listing photos own insert" on storage.objects;
create policy "listing photos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "listing photos own delete" on storage.objects;
create policy "listing photos own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────── Realtime：messages ─────────────
-- schema.sql 已執行 `alter publication supabase_realtime add table messages`；重複執行會報錯，這裡改成冪等檢查。
-- Realtime 會套用 messages 的 select RLS（"messages parties read"），只有對話雙方（已登入）收得到 INSERT。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
