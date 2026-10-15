-- 001_auth：接上 Supabase Auth
-- 在 schema.sql、seed.sql 之後執行（可重複執行）。
-- profiles.id 仍為 text，登入使用者存 auth.users.id 的 uuid 字串（auth.uid()::text）。
-- 伺服器端資料存取用 service role（略過 RLS）；以下政策保護前端直連（anon key + 使用者 JWT）。

-- 已登入使用者可以建立「自己的」profile；信任相關欄位只能是初始值
drop policy if exists "profiles self insert" on profiles;
create policy "profiles self insert" on profiles for insert to authenticated
  with check (
    id = auth.uid()::text
    and deals = 0 and positive_rate = 0 and valid_reports = 0 and verification_level = 0
  );

-- 收緊既有的 self update：只限 authenticated，且更新後 id 仍須是自己
drop policy if exists "profiles self update" on profiles;
create policy "profiles self update" on profiles for update to authenticated
  using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- 欄位層級權限：使用者只能改自己的公開資料；成交數、好評率、有效檢舉、驗證等級、品味向量
-- 只能由伺服器（service role）修改，避免竄改信任分數。
-- （Postgres 的欄位 revoke 蓋不過資料表層級 grant，所以先整表 revoke 再逐欄 grant）
revoke update on profiles from anon, authenticated;
grant update (display_name, area_id, bio, interests) on profiles to authenticated;

-- 使用者刪除 Auth 帳號時一併刪除 profile（profiles.id 為 text，無法直接加 FK，改用 trigger）
create or replace function public.handle_auth_user_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id::text;
  return old;
end $$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();
