# POWER Friend 以物會友二手市集 · MVP 原型

AI 世代的二手交易平台（交易為主、社交為輔）。Next.js 16 + Supabase。
設計借鏡 pH7Builder（審核／黑名單／權限旗標）、Alovoa（隱私加密／封鎖／無付費牆）、Duolicious（多向量配對／首訊防濫用），**只借設計，不含其程式碼**（後兩者為 AGPL-3.0）。

## 快速開始

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 21 個單元測試：防詐、估價、品味向量、交易流程、Muse 串接（模擬 API）
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

### Agent 端點範例

```bash
curl -s localhost:3000/api/mcp -H 'content-type: application/json' -H 'x-agent-for: u_zhe' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_listings","arguments":{"query":"露營","max_price":10000}}}'
```

工具：`search_listings`、`get_listing`、`make_offer`（agent 出價一律標記 AI 代擬）。

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

1. 建立 Supabase 專案，SQL Editor 依序執行 `supabase/schema.sql`、`supabase/seed.sql`。
2. Vault 建立加密金鑰：`select vault.create_secret('<隨機長字串>', 'pii_key');`
3. 複製 `.env.example` 為 `.env.local`，填入 URL 與 service role key，重啟即自動切換。

`npm run seed:sql` 會由 `lib/data/seed.ts` 重新產生 `seed.sql`，確保兩種模式資料一致。

## 原型限制（上線前必做）

- **登入**：目前用 cookie 切換示範帳號。Supabase 模式也是如此，**不可直接對外部署**；第一階段改接 Supabase Auth（簡訊 OTP／Google），`lib/session.ts` 改讀 `auth.getUser()`。
- **AI**：未設 Muse 金鑰時，辨識、議價、防詐分類是本地規則；品味 embedding 目前一律是雜湊向量（Meta 的 Muse 開發者頁面未提到 embedding 端點，正式版需另選 embedding 模型，並調整 schema 的 256 維）。Muse 串接只用模擬 API 測過，接上真金鑰後請先跑一次上架與聊天流程確認回應格式。
- **照片**：demo 以 data URL 存記憶體；正式版改 Supabase Storage。
- **聊天同步**：2.5 秒輪詢；Supabase 模式可改 Realtime 訂閱（`ChatRoom.tsx` 註解有寫法，schema 已加入 publication）。
- **成交更新**：目前在應用層；前端直連後改為 security definer 函式，避免竄改成交數。
- 黑名單只有 3 筆示範資料；正式版匯入 165 公開資料到 `scam_blocklist`（只存雜湊）。

## 結構

```
app/                頁面與 server actions（探索、上架、物品、出價聊天、我的、API）
components/         共用 UI（卡片、信任徽章、行情條、封鎖檢舉）
lib/ai/             vision・pricing・embedding・scam・negotiate
lib/data/           Repo 介面＋demo（記憶體）／supabase 兩種實作、seed
lib/services.ts     商業邏輯（只依賴 Repo 介面）
supabase/           schema.sql（RLS、pgvector、Vault 加密）、seed.sql
tests/              vitest
```
