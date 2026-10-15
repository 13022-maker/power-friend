-- 003_server_only_writes：交易相關資料一律經伺服器寫入（可重複執行）
-- 原因：出價閘門、首訊去重、防詐檢查、成交更新都在伺服器（lib/services.ts）執行。
-- 若允許前端用 anon key 直接 insert messages / offers，就能把 risk 設成 'none' 繞過防詐，
-- 或自行改出價金額、把物品標成已售。前端只保留「讀取」（含 Realtime），寫入全部走 service role。

revoke insert, update, delete on listings, offers, conversations, messages, reports from anon, authenticated;

-- 既有的前端寫入政策已無作用，移除以免誤解
drop policy if exists "listings own write" on listings;
drop policy if exists "offers buyer insert" on offers;
drop policy if exists "offers seller respond" on offers;
drop policy if exists "messages parties write" on messages;
drop policy if exists "reports own insert" on reports;

-- 前端讀取（Realtime 訂閱需要）
grant select on listings, offers, conversations, messages to authenticated;
grant select on listings to anon;

-- 封鎖、社團加入是純個人設定，維持可由本人直接寫入（政策見 schema.sql）
