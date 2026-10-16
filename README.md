# POWER Friend 以物會友二手市集 · MVP 原型

AI 世代的二手交易平台（交易為主、社交為輔）。Next.js 16 + Supabase。
設計借鏡 pH7Builder（審核／黑名單／權限旗標）、Alovoa（隱私加密／封鎖／無付費牆）、Duolicious（多向量配對／首訊防濫用），**只借設計，不含其程式碼**（後兩者為 AGPL-3.0）。

## 快速開始

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 78 個單元測試：防詐、估價、品味向量、交易流程、原子操作、Muse（模擬 API）、帳號刪除、輸入驗證、多件數量／付款方式／貨到付款
npm run build && npm run start:demo   # 以 production 模式跑 demo（必須明確 APP_MODE=demo）
```

不設任何環境變數即為 **Demo 模式**：記憶體假資料，5 個示範帳號、12 件物品，免金鑰可完整體驗。
右上角「我是 ○○」可切換帳號，一人扮演買賣雙方。

## 體驗流程（約 3 分鐘）

1. **上架**：以「小安」到「上架」，輸入「Snow Peak 天幕 近全新，原價 8800」→「AI 幫我填表」→ 確認上架。
2. **出價**：切換成「阿哲」，打開剛上架的物品 →「AI 議價助手」挑一個草稿 → 送出（會標記「AI 代擬」）。
3. **接受開聊**：切回「小安」→「出價與聊天」→ 接受，自動進入聊天室。
4. **防詐**：用「阿哲」在聊天室輸入「先到賣貨便點連結完成認證」→ 對方看到紅色高風險警示；輸入「加賴 abc123」會被遮蔽。
5. **成交**：「小安」按「面交完成，標記成交」→ 雙方成交數＋1，買家品味向量更新。
6. **我的**：信任分數組成、個資匯出 JSON。

**多件＋貨到付款（約 2 分鐘）**：seed 的「一番賞 A 賞 公仔 未拆」（`l_figure`，阿哲賣，共 3 件，面交／貨到付款／行動支付，運費 NT$60）。

1. 以「小安」打開該物品：看到「剩 3 件／共 3 件」與三種付款方式。件數填 2、付款方式選「貨到付款」→ 總額即時顯示「單價 × 2 ＋ 運費 60」→ 送出。（改選「行動支付轉帳」會出現先付款防詐提醒。）
2. 切換成「阿哲」→「出價與聊天」→ 接受。物品變成「剩 1 件」，其他人仍可對剩下的 1 件出價。
3. 聊天室上方的「訂單」面板：切回「小安」→ 填收件資訊（超商取貨或宅配、姓名、手機、門市或地址），寄出前都能修改。
4. 「阿哲」看到收件資訊 → 填物流單號（選填）→「標記已寄出」→ 再「買家已取貨付款，標記成交」（未寄出不能成交）。成交後收件資訊自動刪除。
5. 任一方在成交前都可「取消訂單」（需確認），保留的件數會釋出；已寄出後只有賣家能取消。

多捲合購可改用小安賣的「過期底片 Kodak ColorPlus 單捲」（`l_film`，共 5 件、貨到付款含運；以「阿哲」或「Mia」出價）。

## 功能對照

| 功能 | 位置 | 借鏡 |
| --- | --- | --- |
| 拍照即上架（辨識、成色、估價） | `lib/ai/vision.ts`、`lib/ai/pricing.ts` | pH7 自訂欄位 |
| 品味契合 %、三種排序（最可能成交／品味／附近） | `lib/ai/embedding.ts`、`lib/services.ts#explore` | Duolicious 多向量 |
| 出價被接受才開聊 | `createOffer` / `respondOffer` | Alovoa 互相喜歡才開聊 |
| 首訊去重、依信任分數的每日開聊上限 | `createOffer` | Duolicious intro gating |
| 四層防詐：規則、黑名單、（AI 分類器介面）、人工佇列 | `lib/ai/scam.ts` | pH7 Spam + Ban（bank_account） |
| 信任分數（公開組成、不能付費購買） | `lib/trust.ts` | — |
| 只採計可信帳戶的檢舉 | `services.report` | Duolicious lodgereport |
| 封鎖雙向生效、封鎖／檢舉分開 | `toggleBlock`、`supabase/schema.sql` RLS | Alovoa block/report |
| 個資匯出 | `/api/me/export` | Alovoa GDPR |
| 給 AI agent 的工具端點（JSON-RPC，對齊 MCP） | `/api/mcp` | — |
| 多件數量（以件數保留、並行接受不超賣） | `lib/payment.ts#listingAvailable`、`acceptOffer`（Repo，原子） | — |
| 多種付款方式（先付款類需手機驗證、出價時防詐提醒；平台不經手金流） | `lib/payment.ts`、`createListing` / `createOffer` | — |
| 貨到付款（收件資訊加密、只限雙方、寄出→成交、取消釋出數量） | `setShippingInfo` / `markShipped` / `cancelOrder`、`app/chat/[id]/OrderPanel.tsx` | — |

### Agent 端點範例

```bash
curl -s localhost:3000/api/mcp -H 'content-type: application/json' -H 'x-agent-for: u_zhe' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_listings","arguments":{"query":"露營","max_price":10000}}}'
```

工具：`search_listings`、`get_listing`（含 `available`、`payment_methods`、`shipping_fee`）、`make_offer`（`quantity` 預設 1、`payment_method` 預設物品第一種；agent 出價一律標記 AI 代擬）。

## 接上 Meta Muse Spark（AI 能力）

設定 `MODEL_API_KEY` 後，三項 AI 功能改由 Meta 的 Muse Spark 處理（OpenAI 相容格式，`https://api.meta.ai/v1/chat/completions`），未設定或呼叫失敗一律自動退回本地規則，畫面右上角會顯示目前的 AI 來源。

| 功能 | Muse 負責 | 本地仍負責 |
| --- | --- | --- |
| 拍照即上架 | 看照片＋描述 → 品名、分類、成色、瑕疵、原價 | 估價公式（避免模型亂開價） |
| 防詐第三層 | 判斷話術（假客服、索取驗證碼等） | 規則層先跑；規則判高風險就不呼叫；Muse 只能升級不能降級 |
| 議價助手 | 依對話寫 3 個回覆草稿 | 金額限制在行情 70%～標價 110%；草稿再過一次遮蔽 |

```bash
MODEL_API_KEY=你的金鑰          # dev.meta.ai 申請
MUSE_MODEL=muse-spark-1.1       # 有新版可改，例如官方公布的 1.3 ID
```

隱私：送出前電話、LINE ID、連結已被規則層遮蔽；只有按「AI 幫我填表」時照片才會送出。程式在 `lib/ai/muse.ts`（API 用戶端）與 `lib/ai/smart.ts`（呼叫策略與退回邏輯）。

> Meta 的開發者頁面在本次整理時寫明 Muse Spark API 為**美國地區公開預覽**。台灣能否申請、計價與 1.3 版的正式 model ID 請以 dev.meta.ai 主控台為準。

## 接上 Supabase

**SQL 執行順序**（SQL Editor，全部可重複執行）：

1. `supabase/schema.sql`：資料表、RLS、pgvector、Vault 加密函式
2. `supabase/seed.sql`：示範資料（選用；`npm run seed:sql` 由 `lib/data/seed.ts` 重新產生）
3. `supabase/migrations/001_auth.sql`：Auth 使用者刪除時連動刪 profile
4. `supabase/migrations/002_storage_realtime.sql`：照片 bucket `listing-photos`、messages 加入 Realtime
5. `supabase/migrations/003_server_only_writes.sql`：交易資料改為伺服器寫入，前端只讀
6. `supabase/migrations/004_hardening.sql`：原子操作函式、profiles 前端唯讀且不含 `taste_vec`、Storage 只允許伺服器寫入、檢舉在被檢舉者刪帳號後保留（`target_ref` 雜湊）
7. `supabase/migrations/005_quantity_payment.sql`：多件數量（`quantity`／`reserved_qty`／`sold_qty`，`status` 由 trigger 依數量推導）、付款方式與運費、貨到付款收件資訊 `offer_shipping`（`pgp_sym_encrypt` 加密、前端不可讀寫），取代 `accept_offer`／`complete_deal` 並新增 `decline_offer`、`cancel_order`、`set_shipping_info`、`get_shipping_info`、`mark_shipped`（僅 service role）。執行後再跑一次 `seed.sql` 可套用示範物品的數量與付款設定

再到 Vault 建立加密金鑰：`select vault.create_secret('<隨機長字串>', 'pii_key');`（`profiles_private` 與 005 的收件資訊共用）

**環境變數**：複製 `.env.example` 為 `.env.local`，設 `APP_MODE=supabase`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`（登入與 Realtime 用）、`SUPABASE_SERVICE_ROLE_KEY`（伺服器寫入用，必填）。正式環境未設 `APP_MODE` 又缺 Supabase 變數時會直接報錯，不會默默退回可切換身分的 demo 模式。

### 安全模型

- **寫入只走伺服器**：上架、出價、聊天、成交、檢舉、個人資料都經 server action，用 service role 寫入；前端（anon key＋使用者 JWT）只能讀，且 RLS 只給對話雙方讀訊息。前端無法把訊息 `risk` 改成 `none` 繞過防詐，也無法竄改成交數或信任分數。
- **原子操作**：接受出價（`accept_offer`）、標記成交（`complete_deal`）、取消訂單（`cancel_order`）、貨到付款寄出（`mark_shipped`）、瀏覽數（`increment_views`）、有效檢舉（`add_valid_report`）都是資料庫函式，鎖列後一次完成。多件物品以條件式 update 搶可售數量，並行接受不會超賣（另有 check constraint 兜底）；同一對買賣家重複成交只計一次，防止分身刷分。
- **付款方式**：平台不經手金流，只記錄買賣雙方約定的方式（面交、貨到付款、匯款、行動支付）。先付款類（匯款、行動支付）只限完成手機驗證的賣家開啟，買家選用時固定提醒詐騙風險。
- **貨到付款收件資訊**：只有該筆訂單的買家可寫、買賣雙方可讀，整包加密存放；成交、取消或刪除帳號即清除。MCP agent 讀寫不到。
- **登入後的跳轉**：`/auth/callback` 只允許站內白名單路徑（`lib/safe-redirect.ts`）。
- **聯絡方式遮蔽**：先去除零寬字元、全形轉半形，再比對與遮蔽同一個字串；含 Email 規則。
- **照片**：伺服器端以 sharp 重新編碼，移除 EXIF／GPS，送 Muse 前也一樣；驗證格式、大小與檔頭。
- **AI 警示文字**：Muse 只回傳固定代碼，畫面顯示固定中文標籤，不顯示模型產生的文字（防止借平台警示框釣魚）。
- **限流**：AI 辨識每小時 20 次、議價建議 60 次、Muse 防詐檢查 200 次（超過只跑規則）。目前是單機記憶體版本，多台部署要換 Redis／Upstash（`lib/ratelimit.ts`）。

### 照片、即時聊天、刪除帳號

- **照片 Storage**：`lib/storage.ts#savePhoto` 重新編碼後以 service role 上傳，`listings.photo_url` 存 public URL；上架失敗會刪除剛上傳的照片。demo 模式存 data URL。
- **Realtime**：`ChatRoom.tsx` 用帶登入 session 的瀏覽器 client 訂閱 `messages` INSERT，2.5 秒輪詢保留為後備。
- **刪除帳號**：「我的」頁底部，輸入顯示名稱確認。先取消本人作為買家的已接受訂單、釋出保留數量（收件資訊一併刪除），再刪 Supabase Auth 使用者（失敗會回報，不會假裝成功）、profile、照片資料夾。別人對本人的檢舉會保留，作為防詐證據。

## 登入（Supabase Auth）

Demo 模式維持原樣（右上角切換示範帳號）。Supabase 模式改為真正登入：

1. Authentication → Providers：啟用 **Email**（OTP／magic link）與 **Google**（填入 Google Cloud OAuth Client ID／Secret；Google 端的 redirect URI 用 `https://<project>.supabase.co/auth/v1/callback`）。
2. Authentication → URL Configuration：Site URL 設為網站網址，Redirect URLs 加入 `<site>/auth/callback`（本機開發加 `http://localhost:3000/auth/callback`）。
3. 想用 6 位數驗證碼登入：Email Templates 的 Magic Link 範本加入 `{{ .Token }}`。

流程：`/login`（Email 驗證碼或 Google）→ `/auth/callback` 交換 session → 第一次登入到 `/onboarding` 填暱稱、面交區域、興趣 → 伺服器建立 profile（id = `auth.users.id`）。
探索頁可未登入瀏覽（契合 % 不顯示）；上架、出價、聊天、我的需要登入。`proxy.ts`（Next 16 取代 `middleware.ts`）負責刷新 session。

- **簡訊 OTP**：設 `NEXT_PUBLIC_AUTH_PHONE=1` 顯示「手機簡訊」分頁；需先在 Supabase 啟用 Phone provider 並設定簡訊供應商（會產生費用）。
- **Agent 端點**：Supabase 模式下 `/api/mcp` 改用 `Authorization: Bearer <access token>`，`x-agent-for` 只在 demo 模式有效。

## 尚未完成／未驗證

- **沒有接過真的 Supabase 專案**：SQL 已在本機 Postgres 16（以替身模擬 Supabase 的 auth、storage、pgvector）實際執行兩次並驗證原子操作與權限；但登入、Google OAuth、Storage 上傳、Realtime 推送、`auth.admin.deleteUser` 都只通過型別檢查。第一次部署請照「體驗流程」完整跑一遍。
- **AI**：Muse 只用模擬 API 測過；品味 embedding 仍是雜湊向量（需另選 embedding 模型並調整 256 維）。
- **評價系統**：信任分數的「好評率」尚無資料來源，目前一律顯示「尚無評價」。
- **照片上傳**：仍經 server action（4 MB 上限），之後可改 signed upload URL 直傳。
- 黑名單只有 3 筆示範資料；正式版匯入 165 公開資料到 `scam_blocklist`（只存雜湊）。

## 結構

```
app/                頁面與 server actions（探索、上架、物品、出價聊天、我的、API）
components/         共用 UI（卡片、信任徽章、行情條、封鎖檢舉）
lib/ai/             vision・pricing・embedding・scam・negotiate・muse・smart
lib/supabase/       Supabase Auth（server／browser client）
lib/data/           Repo 介面＋demo（記憶體）／supabase 兩種實作、seed
lib/services.ts     商業邏輯（只依賴 Repo 介面）
lib/payment.ts      付款方式標籤、數量推導（listingAvailable／deriveStatus）、總額、收件資訊驗證
supabase/           schema.sql、seed.sql、migrations/001–005
tests/              vitest
```
