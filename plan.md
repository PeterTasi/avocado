# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 完成的功能記錄在 `DEVLOG.md`，從這裡刪除。
> 更新於 2026-08-15。

> **待辦 E（技能樹）已於 2026-08-15 實機驗收通過並從本檔移除**，分支 `ui/graph-skill-tree` 可 merge main。同日修好時區、跨課程語義橋、Gemini 模型備援鏈三個 bug（詳見 DEVLOG）。

---

## 待辦 F：跨課程語義橋的前端（2026-08-15 新增，目前最大缺口）

> **狀態：** 後端已完全可用——8/15 修好三個 bug 後，上傳線代＋機器學習兩份教材會自動產出 9 條連結，`/api/cross-course-edges` 正常回傳。**但前端沒有任何元件消費它**：`webapp/frontend/src/utils/graphUtils.ts` 只有一行 `// cross-course bridges` 註解。功能是通的，畫面上看不到。
> **為什麼值得做：** 這是單文件工具（NotebookLM、一般 AI 筆記工具）結構上做不到的事——需要跨課程的概念向量與掌握度狀態。實測品質夠好可以直接 demo：「奇異值分解 ↔ 矩陣對角化」被標成 generalization (0.812)，是系統自己找出來的真實數學關係。

- **最小可用版本：** 在 `KnowledgeGraphPanel` 下方加一張卡片，列出當前課程的跨課程連結（來源概念 ←→ 目標概念 ＋ 相似度 ＋ link_type），資料走現成的 `/api/cross-course-edges`。約 60–80 行，不動後端。
- **進階版（選配）：** 在技能樹畫布上用虛線把跨課程概念接起來。要處理的是兩門課的節點不在同一張圖上——可能需要「並排兩棵技能樹」的佈局，工作量大得多。**先做最小版本。**
- **前置：** `/api/concepts` 只回傳當前課程的概念，所以前端拿到的 `to_concept_id` 解不出名字。要嘛後端在 `/api/cross-course-edges` 回傳時就把兩端的 `name` / `subject` join 好（推薦，改一支 SQL），要嘛前端多打一支 API。
- **驗收：** 上傳兩門有重疊概念的課程，卡片上看得到至少 3 條連結，且概念名稱與課程名稱都正確顯示。

---

## 待辦 G：`review_plan` 表是全域的（審查 #4，已從「多課程才爆」變成會實際發生）

> **狀態升級原因：** 原本判定「Demo 只用一門課就完全無感、賽前不用修」。8/15 起本機已同時存在線代與機器學習兩門課，這個 bug 會真的觸發。

- **位置：** `database.py` `save_review_plan` 開頭 `DELETE FROM review_plan` 全刪；`pipeline.py:293-300`。
- **症狀：** 重算複習計畫時只用「當前課程」的概念建計畫，卻把**所有課程**的舊計畫刪光 → 切換課程後上一門的複習計畫消失；`get_tonight_study_dashboard` 讀到殘留他課 item 時 chapter 顯示 "Unknown"。
- **修法：** `save_review_plan` 加 `course_id` 參數，`DELETE` 只刪該課程的列（`review_plan` 需加 `course_id` 欄位 → 需要一次 migration）。
- **驗收：** 兩門課各自重算後，切回第一門仍看得到自己的複習計畫。

---

## 待辦 H：Claude API 當第一層、Gemini 當第二層（2026-08-15 討論，**尚未決策**）

> **動機：** 8/02 與 8/15 兩次都因 Gemini 免費額度（20 次/日）中斷 demo；且概念抽取／批改是判斷密集的活，模型品質差異直接反映在產品上（LLM 掛掉時 heuristic 會切出「主成分分析是最常用的」這種假概念）。

**兩個硬限制（決策前必須知道）：**

1. **Anthropic 沒有 embedding API。** `vector_store.py` 的跨課程語義橋只能繼續用 `gemini-embedding-001` 或改本地模型——這一層 Claude 取代不了。
2. **Anthropic 沒有免費額度。** 好處是不會被日配額砍斷，壞處是每次呼叫都計費（以目前用量約幾分錢／次 ingest）。

**建議分層：**

| 工作 | 第一層 | 第二層 |
|---|---|---|
| 概念抽取＋先修關係 | Claude | Gemini |
| 出題 | Claude | Gemini |
| 批改＋回饋 | Claude | Gemini |
| 手寫 OCR | GLM-OCR（本地） | Gemini vision → Claude vision |
| 向量嵌入 | **只能 Gemini** | — |

- **順帶可以拿到的好處：** Claude 的 structured outputs（`output_config.format` + json_schema）能保證回傳合法 JSON，`gemini_client.py` 裡那堆硬撈 JSON 的 regex 可以整段刪掉；prompt caching 可讓固定的抽取 system prompt 只付約 1/10 輸入成本。
- **模型：** 預設 `claude-opus-5`（$5/$25 每百萬 token）。`claude-sonnet-5` 較便宜（$3/$15）但屬成本取捨，由使用者決定。
- **移植陷阱：** Opus 5 的 thinking **預設開啟**，且 `max_tokens` 同時涵蓋 thinking 與回答——照搬 Gemini 的 `max_tokens` 可能在思考階段就用光導致截斷。
- **工程量：** 約 150–250 行。一支 `claude_client.py` 對齊 `gemini_client.py` 介面，加雙金鑰設定與降級邏輯。codebase 已有 `vector_store.py` 的 `Embedder` Protocol 慣例可循，`pipeline.py` 不需知道背後是誰。
- **待決策：** 要不要做／用哪個模型／是否同時保留 Gemini 為第二層。**動工前需先切 Opus 更新本檔。**

---

## 待辦 I：本機測試會污染 demo 資料庫（2026-08-15 新增，小但煩）

- **症狀：** `tests/` 直連 `.env` 的本機 PostgreSQL，跑一次 `pytest` 就灌進一批測試課程（Algorithms/notes.txt、Linear Algebra/handwritten.png…）。8/15 當日庫裡累積 11 個課程、81 個概念，多數是測試垃圾，每次 demo 前要手動清。
- **修法選項：** (a) `tests/conftest.py` 改用獨立測試資料庫（`adaptlearn_test`）；(b) 測試結束自動清理自己建的課程。(a) 較乾淨。
- **註：** `tests/db_guard.py` 已有白名單機制，但目前允許本機 DB。

---


## 待辦 C：概念卡名稱／章節跟著語言切換（需 Gemini 額度才驗得了）

> **背景：** 朋友初衷是「按 EN 時不只抽屜裡的詳解，外面的概念卡名稱＋章節也要變英文」。目前語言切換只控制抽屜內 lazy 詳解；卡片名稱仍是 ingest 時抽取的中文。
> **為何沒一起做：** 2026-06-09 當下 Gemini 免費額度（20/天）已用盡，翻譯也吃 API，當天無法驗收（會看到降級回中文，誤判成 bug）。等額度恢復或換金鑰再做。

- **方案：** 新增輕量後端 `GET /api/concepts/labels?lang=en` —— 一次 Gemini 呼叫把當前課程「所有概念名稱＋章節」翻成英文（只翻短標籤、快），用 in-process TTLCache 快取（key=course_id+lang）。
- **前端：** `ConceptSection` 在 EN／中英時改用翻譯後標籤顯示卡片；中文維持原樣，中英顯示「English（中文）」。
- **降級：** 無金鑰／API 失敗 → 回原中文標籤，不崩（與抽屜 degraded 一致，可考慮也回 `degraded` 旗標讓 UI 提示）。
- **影響檔案：** `gemini_client.py`（`translate_labels`）、`main.py`（新 endpoint）、`useApi.ts`（hook）、`ConceptSection.tsx`（卡片標籤）。
- **注意：** 卡片標籤翻譯是「整批一次生成」（非 lazy），因為切 EN 要立刻看到所有卡片變英文；與抽屜的「點開才生成」不同。

---

## 待辦 D：手寫 OCR 升級 — qwen2.5vl:7b → GLM-OCR（2026-06-10 規劃）

> **背景：** 20+ 頁手寫 PDF 本地 ingest 跑 4–5 分鐘以上仍抽不出有用文字。診斷出三個疊加成因：
> 1. `OllamaClient.transcribe_images` 逐頁序列推論，qwen2.5vl:7b 在 M4 Air 每頁 30–60 秒，28 頁 = 15–25 分鐘，超過前端 12 分鐘輪詢上限（單頁 timeout 還設 300 秒，卡一頁燒 5 分鐘）。
> 2. 7B 通用視覺模型不是 OCR 特化，中文手寫＋數學式辨識弱，常整份回空。
> 3. 全有或全無：fallback 鏈抽不到字直接 raise ValueError，已辨識成功的頁全丟。
>
> **調研結論（2026-06-10，來源見 DEVLOG）：** GLM-OCR（智譜，0.9B、下載 2.2GB）已進 Ollama 官方庫，OmniDocBench v1.5 排名第一（94.62），官方主打**手寫、雜訊掃描、中文、LaTeX 公式**，速度為開源最快一檔。對現有 `OllamaClient` 架構幾乎零改動。備選：`deepseek-ocr`（Ollama 官方庫，3B/6.7GB，91 分）、PaddleOCR-VL-MLX、deepseek-ocr.rs。

### 階段一：模型替換驗證 ✅（2026-06-10 驗收通過——23 節點/59 邊真實概念，詳見 DEVLOG）

- `ollama --version` 確認版本夠新（deepseek-ocr 要 v0.13.0+，glm-ocr 比照辦理）→ `ollama pull glm-ocr`
- `.env`：`OLLAMA_OCR_MODEL=glm-ocr`、`MAX_OCR_PAGES=30`（不調高的話 20+ 頁會跳過本地直接掉 Gemini）
- 實測 28 頁手寫 PDF，驗證品質與速度（預期每頁從 30–60 秒降到數秒）
- **兩個可能要動程式碼的點：**
  - OCR 特化模型對 prompt 敏感，官方建議 `Text Recognition:` 風格短指令 → 視結果在 `ollama_client.py` 加 per-model 短 prompt 分支
  - 官方範例走 `/api/chat`，現行打 `/api/generate` → 煙霧測試，不行就加 chat 端點支援
- 品質不過關 → 退 `deepseek-ocr` 再試；都不行則維持 qwen2.5vl，只做階段二/三

### 階段二：體驗保險（不論用哪個模型都該做）

- **部分成功保留：** 逐頁 transcripts 累積，單頁失敗/超時不丟整份；鏈尾「全空才 raise」改成「有部分文字就繼續建圖」
- **逐頁真實進度：** `_stage` 細化「OCR 第 n/N 頁」，前端輪詢顯示（接續 2026-06-09 真實進度條的做法）
- **影響檔案：** `ollama_client.py`（per-page callback）、`pdf_parser.py`（部分成功邏輯）、`pipeline.py`（`_stage`）、`useApi.ts`、`SetupPanel.tsx`、`webapp/static/*`（npm run build）

### 階段三：比賽保險絲（選配）

- 大檔路由：頁數超過門檻時優先走 Gemini 整份 `transcribe_pdf`，本地當 fallback（只動本地分支順序，不影響 Render 上既有 Gemini 路徑）
- Demo 快取：檔案 hash → ingest 結果快取，現場上傳同一份檔案秒回

### 風險

- glm-ocr 對「我們這份」手寫教材品質未實測 → 階段一先驗再往下走
- Ollama 版本過舊不支援新模型 → 先確認/升級
- 無 DB schema migration，不動 PostgreSQL

### 驗收標準

28 頁手寫 PDF 本地 ingest 在 5 分鐘內完成、概念圖譜為真實內容（非模板）、前端進度逐頁更新。

---

## 待辦 E：比賽前衝刺包（2026-06-10 規劃，Opus 架構 / Sonnet 實作）

> 六項已與使用者確認。E1/E2 是風險修補（先做）、E3/E4/E5 是 demo 體驗、E6 最大（全離線能力，留最後）。
> **各項彼此獨立，可單獨實作、單獨 commit。** 每項做完：跑測試 + `npm run build`（有前端時）+ commit。
>
> **進度（2026-06-11）：E1–E5 ✅ 已完成並推送 demo/sprint-pack；E6 待實作。**

### E1：測試 DB 隔離（✅ DONE — commit `9eb641e`）

- **問題：** `pytest` 的 DB 測試直連 Render 正式庫（DEVLOG 2026-06-08 附帶發現），跑測試會污染 demo 資料。`conftest.py` 目前只處理 import path。
- **方案：**
  1. `conftest.py` 開頭（在任何 adaptlearn import 之前）讀 env：若設了 `TEST_DATABASE_URL` → `os.environ["DATABASE_URL"] = TEST_DATABASE_URL`（覆寫，讓測試走測試庫）。
  2. 新增 `tests/db_guard.py`：`require_safe_db()` —— 若 `DATABASE_URL` 含 `render.com`（正式庫特徵）且未設 `ALLOW_PROD_DB_TESTS=1`，raise `unittest.SkipTest("拒絕對正式 DB 跑測試；請設 TEST_DATABASE_URL")`。
  3. 在會碰 DB 的測試檔的 setUp/setUpClass 呼叫：`test_api_integration.py`、`test_database_concept_detail.py`、`test_pipeline_concept_detail.py`、`test_unit.py` 中需要真實 DB 的 case（先 grep `StudyRepository(`/`DATABASE_URL` 確認清單）。
- **驗收：** 本地（DATABASE_URL=render）跑 pytest → DB 測試全部 skip 且訊息清楚；其餘測試照跑。`.env.example` 補 `TEST_DATABASE_URL` 說明。
- **風險：** config.py 在 import 時讀 env —— 覆寫必須發生在 conftest 最頂部、任何專案 import 之前。

### E2：API_ACCESS_KEY 守門（✅ DONE — commit `c20eabf`）

- **問題：** 後端守門已做好（`main.py:80`、未設 key 即全開），Render 沒設 → 任何人可 DELETE 課程、換 Gemini 金鑰、燒額度。
- **方案（前端配合，一處改完全站生效）：**
  1. `useApi.ts` 的統一 fetch wrapper（line 8 `fetch(\`${API_BASE}${path}\`)`）：注入 header `X-API-Key`，值來自 `localStorage.getItem("adaptlearn_api_key") ?? ""`；空值不送 header。
  2. App 啟動時讀 URL 參數：`?key=xxx` 存在 → 寫入 localStorage 後用 `history.replaceState` 清掉參數（網址不留痕）。demo 時開 `https://站台/?key=xxx` 一次即解鎖。
  3. wrapper 收到 401 → throw 帶識別的錯誤；各 hook 既有錯誤顯示即可呈現「API 金鑰無效」中文訊息（後端已回中文 detail），不需新 UI。
  4. **手動步驟（使用者）：** Render 環境變數設 `API_ACCESS_KEY`（隨機長字串）→ redeploy。本地 `.env` 不設（開發不受影響）。
- **驗收：** Render 設 key 後：無 key 開站 → API 回 401、畫面顯示金鑰錯誤；帶 `?key=` 開站 → 一切正常；`/api/health` 不受影響（守門排除 health）。
- **風險：** CORS 已允許 `X-API-Key`（main.py:69），無需動後端。key 存 localStorage 對「評審亂試」級別的威脅足夠，不防決心攻擊者（賽後 A1 再說）。

### E3：逐頁 OCR 進度（✅ DONE — commit `0894880`）

- **方案：**
  1. `ollama_client.transcribe_images(images, course_name, on_progress=None)`：每頁開始辨識前呼叫 `on_progress(index, total)`；錯誤行為不變（單頁失敗回 "" 跳過 —— 頁級部分成功其實已存在，本項重點是進度可見）。
  2. `pdf_parser.extract_material_text(..., ocr_progress=None)` 把 callback 傳給 Ollama 路徑（Chandra/Gemini 雲端路徑不需要）。
  3. `pipeline.ingest_material`：傳 `lambda i, n: self._set_stage(f"OCR 辨識第 {i}/{n} 頁")`（沿用 2026-06-09 真實進度條的 `_stage` 機制與命名）。
  4. 前端零改動：`useApi.ts` 輪詢已回拋 `stage`、`SetupPanel` 已顯示子階段文字。
- **驗收：** 上傳 28 頁手寫 PDF，SetupPanel 第一階段顯示「OCR 辨識第 n/28 頁」遞增；新增 unit test：fake ollama client 驗證 callback 被逐頁呼叫。
- **風險：** `_stage` 寫入是跨執行緒讀取（threadpool → 輪詢），沿用既有機制即可（前例已驗證安全）。

### E4：OCR 結果快取（✅ DONE — commit `aac9cbd`）

- **方案：**
  1. `pipeline.ingest_material` 在呼叫 `extract_material_text` 前：算 `sha256(file_bytes)`，查 `data/ocr_cache/{hash}.json` —— 命中且格式合法 → 直接用快取的 `{text, source_type, ocr_used}` 跳過 OCR；未命中 → 照跑，成功後寫入快取（`json.dump`，寫失敗只 log 不中斷）。
  2. 只快取 OCR 段（最慢的一段）；建圖譜照常執行（1 次 Gemini 呼叫，快，且讓 DB 狀態正確重建）。
  3. log 快取命中：`logger.info("OCR cache hit: %s", hash[:12])`（符合「no silent caps」精神）。
- **驗收：** 同一份 28 頁 PDF 上傳第二次，OCR 階段 < 1 秒跳過；`data/ocr_cache/` 進 `.gitignore`。
- **風險：** Render 磁碟 ephemeral → 快取重啟即失效，可接受（此功能本來就為本地 demo）。不做 LRU 上限（demo 用量小），但 log 寫入的檔案大小。

### E5：首頁空狀態引導（✅ DONE — commit `40c1283`）

- **方案：**
  1. 新元件 `webapp/frontend/src/components/EmptyStateOnboarding.tsx`：卡片含三步驟（① 上傳教材 → ② 做診斷測驗 → ③ 看圖譜與複習計畫），每步一個 Pixel 風 icon（沿用 `PixelIcons.tsx`）+ 按鈕導到對應 view（呼叫 App 傳入的 `onNavigate(view)`）。
  2. `App.tsx` home view：`useCourses()` 載入完成且為空 → 以 EmptyStateOnboarding 取代 MetricCardsGrid/InsightFeed 區塊；有課程 → 照舊。
  3. 風格遵循 CLAUDE.md 設計語言（`.card`、`--accent`、最多 1 個像素裝飾）。
- **驗收：** 清空課程後首頁顯示引導卡、按鈕能跳轉；上傳課程後恢復原 dashboard；`npm run build` 零錯誤。
- **風險：** 無。純前端、條件渲染。

### E6（決策已變更 2026-06-30）：離線 LLM ❌ → 預烤 Demo 資料保險絲 ✅

> **為何改（第一性原理 + YAGNI）：** E6 真正要解的功能是「**斷網/Gemini 掛掉時 Demo 不爆**」，不是「整條 AI pipeline 離線跑」。原方案為一個罕見邊角案例，在 16GB 機器同時駐留 glm-ocr 2.2GB + llama3.1 4.9GB、建三套平行 fallback、且自承 JSON 不穩——成本/風險過高。改用「**預先烤好 demo 資料，斷網即切換重播**」，約 1 小時、可靠得多。
> 原「離線 LLM」方案封存：賽後若真有「全離線」需求再議（`generate_text` + ollama 文字模型 fallback 那套）。

**目標：** Demo 現場斷網或 Gemini 全掛時，核心動線（上傳手寫 → 知識圖譜 → 弱點 → FSRS 複習表）仍能完整走完。

**方案（由簡到繁，建議方案 1）：**
1. **預烤課程 seed（最簡、最穩）：** demo 用的教材先在有網時 ingest 一次，把結果（課程＋概念＋邊＋題目）匯出成 seed（SQL dump 或 JSON）。現場若線上 ingest 失敗，載入 seed 課程繼續 demo。
2. **快取延伸（接 E4）：** 把現有「檔案 hash → OCR 快取」往上延伸到「建好的知識圖譜＋已生成題目」JSON。同一份 demo 檔第二次（或離線）ingest 直接重播全部結果，不打任何 API。

**影響範圍：**
- `pipeline.py`：ingest 末段把 graph/questions 結果寫入快取；起頭命中即跳過 LLM（沿用 E4 `data/ocr_cache` 模式，新增 `data/demo_cache/{hash}.json`）。【方案 2】
- `scripts/`：新增匯出／載入 seed 課程的小腳本。【方案 1】
- `.gitignore`：快取目錄。
- **不動** DB schema、**不動** Render 既有 Gemini 路徑。

**實作步驟：**
1. 先選方案 1 或 2（方案 1 更省更穩；方案 2 較「自動」）。
2. 有網時跑一次完整 ingest 產生 seed／快取。
3. 加「命中即重播」判斷 + log（符合 no silent caps）。
4. 拔網彩排：確認整條動線零 API 也能跑完。

**風險：** 低。純加法、opt-in、不影響線上正式路徑。唯一注意：快取／seed 要與當前 DB schema 對得上。

**驗收：** 拔網路（或清 GEMINI_API_KEY）後，載入／重播 demo 課程 → 圖譜、題目、複習表皆正常顯示。

---

## 決策凍結清單（2026-06-30，競賽收斂）

> 第一性原理：這是**競賽 Demo**，核心亮點（P1–P4）已全完成。剩餘時間最高槓桿是「**讓一個故事可靠 + 彩排**」，不是加功能。本次決策：

- **凍結 scope：** 待辦 C（雙語概念卡）、待辦 D（GLM-OCR 換模型）一律延後，除非彩排時當場壞掉才動。
- **不再投資 P6（ChromaDB 持久化）與 Chandra OCR：** 兩者在真實 demo 路徑幾乎不執行（Chroma 在 Render redeploy 歸零、Chandra 需 GPU）。競賽期間**不拆**（風險>收益，比照 A4），但停止投入。賽後再用第一性原理檢討是否該存在（跨課程相似度可改 PG／in-process 餘弦相似度；Chandra 可刪）。
- **流程儀式放寬：** 「改任何一行 code（含純 CSS）都要先報計畫」放寬為「**架構級**變更才強制先報計畫」，保留原意、去掉對單人衝刺的摩擦。（此項需另外改 `CLAUDE.md` 的「⚠️ 更改程式碼前必須先說計畫」段落才生效。）
- **保留不動：** FSRS-5、知識圖譜路徑尋找（真差異化、demo 主菜）；A4 god object 賽期勿動。

### 原 E1–E5

E1–E5 ✅ 已完成並推送 `demo/sprint-pack`（見各項）。E6 已改決策如上。

---

## 待辦 F：跨課程語義橋前端（2026-08-16 規劃，Opus 架構 / Sonnet 實作）

> 後端 8/15 已修好並實測可用（63 條連結）。**但 CLAUDE.md 原本寫「API 都好了，缺一張卡片」是錯的**——
> `/api/cross-course-edges` 只回 concept_id，沒有概念名稱與課程名稱，前端也無法自行補齊
> （`/api/concepts` 只回 active course 的概念，查不到連結另一端那門課）。
> 所以 F = 後端 enrich endpoint + 前端卡片，不是純前端。

### 決策（已與使用者確認 2026-08-16）

- **放置：** 圖譜頁，技能樹（KnowledgeGraphPanel）下方、熱力圖旁。語意一致、demo 動線順、只動 graph view。
- **範圍：** 只顯示**至少一端屬於目前課程**的連結。63 條會縮到十幾條，不需分頁，且對學生有意義。

### 實作步驟

1. **`database.py`** — 新增 `list_cross_course_edges_detailed(course_id=None)`：
   以 `cross_course_edges` 為主表，兩次 JOIN `concepts` 取兩端名稱，再 JOIN `courses` 取兩端課程名稱。
   帶 `course_id` 時用 `WHERE from.course_id = %s OR to.course_id = %s` 過濾。
   **不改既有的 `list_cross_course_edges()`**（它餵 ingest 流程，動它會波及既有行為）。
2. **`pipeline.py`** — `list_cross_course_edges_detailed()` 薄包裝，預設帶入 active course_id。
3. **`webapp/main.py`** — `/api/cross-course-edges` 加 `?detailed=true&scope=active` 分支回傳
   enrich 後的欄位（兩端概念名/課程名/similarity/link_type）。
   **舊的無參數行為保持不變**，避免破壞任何既有消費者。
4. **`useApi.ts`** — `useCrossCourseEdges()` hook。
5. **`CrossCourseBridgePanel.tsx`（新檔）** — 卡片：每列一條連結，左右兩端概念名 + 課程名 pill，
   中間 link_type 標籤（equivalent/generalization/analogy/semantic 對應中文與色階），右側相似度。
   空狀態：「目前只有一門課程，上傳第二份教材或輸入第二個主題後，系統會自動尋找關聯。」
6. **`App.tsx`** — graph view 掛載新元件。
7. **測試** — `tests/test_cross_course_detailed.py`：離線，驗證 JOIN 後欄位齊全、course_id 過濾正確、
   單一課程時回空陣列。

### 風險

- **無破壞性變更、無 migration。** 只新增查詢與端點分支，既有 API 行為不變。
- link_type 的中文對照要謹慎：`analogy` 是「類比」不是「相似」，跨領域學習最有價值的就是這一類。
- 熱力圖的 `avg_attempts` 是假數字（fable5-review #6），本卡片不得引用任何 heatmap 數據。

### 驗收標準

圖譜頁在有兩門以上課程時，技能樹下方出現卡片，列出與目前課程相關的連結，
兩端顯示可讀的概念名與課程名（非 ID），similarity 由高到低排序；只有一門課程時顯示空狀態而非空白區塊。

---

## 待辦 K：Demo 資料快照／還原（2026-08-16 規劃）

> **動機：** 比賽上台只有 4 分鐘。手寫 PDF 的 OCR 實測約 150 秒／頁（14 頁 ≈ 35 分鐘），
> 主題生成也要約 2 分鐘——現場等不起。課程必須事先建好，並能一鍵還原。
> 同時解掉待辦 I（跑 `pytest` 會洗掉 demo 資料庫）。
>
> **內容必須是真實產出。** 事先跑真實管線、保存真實結果 = 正當的 demo 準備；
> 手寫假概念塞進 DB 假裝是系統算的 = 不行，且沒必要——功能是真的會動。

### 決策：用 pg_dump + tar，不要自己寫序列化腳本

原本規劃「Python 腳本逐表 dump」被否決：資料全在 PostgreSQL（Homebrew 17.10，`pg_dump` 可用）
與 `data/chroma`（2.4 MB）。`pg_dump` 已經把這件事做完，且**未來新增資料表不需要改腳本**，
手寫版本則會默默漏表——這正是最難察覺的失敗模式。

### 實作步驟

1. **`scripts/demo_snapshot.sh`**（約 40 行，唯一新檔）：
   - `save [名稱]` → `pg_dump --clean --if-exists` 寫到 `demo_snapshots/<名稱>.sql`
     ＋ `tar czf demo_snapshots/<名稱>-chroma.tgz data/chroma`
   - `restore <名稱>` → `psql < .sql` ＋ 解開 chroma tgz（**先停後端**，Chroma 開著時寫入會
     報 `attempt to write a readonly database`）
   - `list` → 列出現有快照
   - **restore 前必須二次確認**（會覆蓋整個資料庫），除非帶 `--yes`
   - DATABASE_URL 從 `.env` 讀，非 localhost 一律拒絕執行（防手滑打到正式庫）
2. **`.gitignore`** — 加入 `demo_snapshots/`（含真實學習資料，不進版控）
3. **`CLAUDE.md`** — 「Running Locally」補一段用法

### 風險

- **`restore` 是破壞性操作**：整個資料庫會被覆蓋。靠二次確認 + localhost 檢查擋。
- Chroma 還原必須在後端停止時進行，否則向量庫損毀。腳本會檢查 port 8000 是否在監聽並拒絕執行。
- 快照含真實學習紀錄，不進 git。

### 驗收標準

`save demo` → 手動刪掉一門課 → `restore demo` → 課程、概念、技能樹、跨課程連結全部回來，
且圖譜頁與跨課程卡片渲染正常。

---

## 待辦 L：三個已診斷未修的問題（2026-08-17 發現，用真實手寫講義驗證時挖出）

> 這三個都**已經定位到根因、有證據**，只是還沒動手。動工前先讀這段，別重新診斷。

### L1（優先）：ChromaDB 與 PostgreSQL 不同步 → 跨課程連結全是幽靈

**證據（2026-08-17 實測）：**

| | 數量 |
|---|---|
| PostgreSQL 概念 | 107 |
| Chroma 向量（`adaptlearn_concepts_gemini`） | 104 |
| **Chroma 有、PG 沒有（幽靈）** | **80** |
| PG 有、Chroma 沒有 | 83 |

重疊只有 24 筆（剛 ingest 的手寫課程）。

**根因：** `reset_learning_state()`（`database.py`，測試用的全域清除）刪 Postgres 概念，
但碰不到 vector store，所以 Chroma 留下 80 筆幽靈向量。8/16 修 `cross_course_edges`
漏掉的時候沒看到向量庫是同一個問題的另一半。

**後果：** ingest 手寫講義時建立了 65 條跨課程連結，**全部指向已不存在的概念**
（`from_exists=1, to_exists=0`）。前端卡片顯示「沒有關聯」是正確的——INNER JOIN 擋下了
壞資料，錯的是資料本身。

**修法（兩層都要）：**
1. **根因**：在 `pipeline.AdaptLearnService` 開一個全域重設方法，同時清 Postgres 與
   ChromaDB；測試改呼叫它，不要直接呼叫 repo 的 `reset_learning_state()`。
2. **防線**：`cross_course_linker.find_cross_course_links` 存邊之前，先確認對方概念
   存在於 Postgres（一次 `WHERE id = ANY(...)`）。向量庫是索引，Postgres 才是真相來源；
   索引過期不該污染真相。這層更重要——不管未來什麼原因造成不同步都擋得住。

### L2：空白頁被算成 OCR 成功

第 14 頁是空白頁，但模型輸出了 `線性代數 8-1~8-3（手寫）\nPDF page 14`——把 prompt 裡的
課程名與頁標當成內容吐回來，於是計為成功，`pages_ok` 報 14 而非 13。

**修法：** `_clean_transcription_text` 或 `transcribe_images` 把「只包含課程名／頁標」
的回應視為空白。門檻要小心，別誤殺真的只有一行標題的頁。

### L3：前端輪詢 12 分鐘上限，手寫大檔必定逾時

`useApi.ts` 的 `MAX_WAIT_MS = 12 * 60 * 1000`。14 頁手寫 PDF 用 qwen2.5vl 約需 12 分鐘、
qwen3-vl 需 35 分鐘——**使用者會看到「教材處理逾時」，但後端其實還在跑而且會成功**。

**修法（建議）：** 不要單純調大上限（真的卡死的 job 會空轉更久）。改成
**「卡住才算逾時」**：後端每頁都回報 `OCR 辨識第 N/M 頁`，只要 stage 字串有變化就重設
計時器，連續 N 分鐘沒進展才判逾時。約 3 行。

---

# 🟡 選配待辦（競賽後可做）

## 失敗測試：OCR 頁數上限訊息對不上（pre-existing，141a6bd 後壞）

- **測試：** `tests/test_unit.py::TestAdaptLearnService::test_scanned_pdf_uses_configurable_ocr_page_limit`
- **現象：** 2 頁掃描 PDF + `max_ocr_pages=1`，測試期待 ValueError 含「上限 1 頁」，實際回「這份檔案幾乎沒有可讀文字…」。
- **成因：** 141a6bd 原生 PDF 旁路改動後，page-limit 的提示訊息路徑變了；測試斷言沒跟著更新。經 `git stash` 確認在 main 上就失敗，與 async ingest(feat/async-ingest)無關。
- **處理建議：** 另開 `fix/` 分支，對齊 `pdf_parser` 實際訊息或更新測試斷言；非緊急（純訊息文字）。

## 失敗測試：integration 測試仍假設同步 ingest（async 重構後壞，pre-existing）

- **測試：** `tests/test_api_integration.py` 的 `test_low_text_is_rejected_in_generic_mode`、`test_full_api_flow_generic_mode`、`test_image_upload_uses_gemini_ocr_when_available`。
- **現象：** 斷言 POST `/api/material/ingest` 回 400/200，實際回 `202`（async 背景任務）。
- **成因：** ee9f06f 把 ingest 改成「立刻回 job_id(202) + 輪詢」，這些測試還在驗舊的同步行為。經 checkout main 確認在 main 上就失敗，與本分支無關。
- **處理建議：** 更新測試改走「POST→輪詢 status」流程再斷言結果；非緊急。


## Bug 5 方案 B — 跨 Session 概念殘留（後端根本解，暫不做）

**現況：** 方案 A（前端確認 modal）+ 方案 C（清除課程資料）皆已完成，競賽夠用。A1 決策已定：單人輪流 demo 用現有 `course_id` active scoping 即可，session 隔離屬賽後。

> ✅ 方案 C「清除課程資料」已於 2026-06-08 完成並通過正式環境端對端驗證，詳見 DEVLOG。

### 方案 B（暫不做，需 DB schema migration）

後端新增 `session_id` 欄位，每次 ingest 產生一個 session；`/api/diagnostics/generate` 只取最新 session 的 concepts。需改 `database.py`（schema + query）、`pipeline.py`（ingest 寫入 session_id）、`main.py`（quiz generation 過濾）。

---

## P6 — ChromaDB 持久化（賽後處理）

- **問題：** ChromaDB 存本地磁碟（`data/chroma`），Render free redeploy 後向量庫歸零，跨課程語意連結失效。
- **建議（擇一）：** (a) 跨課程連結改用 PG `pgvector` 取代 Chroma；(b) 接受「重啟後首次查詢重建」並在 ingest 時重算。
- **影響範圍：** `vector_store.py`、`cross_course_linker.py`、`requirements.txt`。

---

## A1 完整多租戶（賽後）

- 全域可變單例 `webapp/main.py` `_service = AdaptLearnService(...)` → 整個 App 單租戶，所有請求共用同一份 service / 知識圖譜 / mastery 狀態。
- 中期解：加 `users` 表 + token，service 改成 per-request 由 `user_id` 決定 scope，`set_api_key` 改傳參數、不 mutate 全域。
- **短期解已決策不做**（見上方 Bug 5 / A1 決策）。

## A4 拆 God object（賽後，競賽期間勿動）

- `database.py` 806 行、`pipeline.py` 628 行、`App.tsx` 803 行。
- ⚠️ 競賽期間**不要動**，風險高於收益。

---

# 🏆 競品分析與差異化策略

## 競品：ThetaWave AI（thetawave.ai）

定位：「上傳資料 → 自動筆記 + 閃卡 + 心智圖」。主打**整理工具**，輸出一次性複習材料。聲稱 300,000+ 學生、100+ 所大學。

## AdaptLearn 現有的硬優勢

| 特性 | ThetaWave | AdaptLearn |
|---|---|---|
| 知識圖譜（互動式） | 心智圖（靜態輸出） | ✅ 動態概念圖 + 路徑尋找 |
| 間隔重複 | 閃卡（無排程演算法） | ✅ FSRS-5 科學排程 |
| 掌握度追蹤 | 無 | ✅ 每個概念量化分數 |
| 自適應出題 | 固定生成 | ✅ 針對弱點概念出題 |
| 跨課程連結 | 無 | ✅ semantic cross-course linking |
| 班級熱力圖 | 無 | ✅ 錯誤率可視化 |

**一句話定位：** ThetaWave 幫你「整理」資料；AdaptLearn 幫你「知道你不知道什麼」，並科學安排何時複習。

## 差異化強化（競賽 Demo 優先）

| 優先度 | 項目 | 說明 | 狀態 |
|---|---|---|---|
| 🔴 P1 | 知識圖譜路徑尋找 | 選一個概念，高亮 prerequisites。最強 Demo 亮點。 | ✅ 已完成（MindMapCanvas，見 DEVLOG 2026-06-05） |
| 🟠 P2 | 遺忘曲線預測顯示 | Review 頁 FSRS-5 迷你遺忘曲線 + 記憶徽章。ThetaWave 沒有。 | ✅ 已完成（見 DEVLOG 2026-06-06） |
| 🟡 P3 | 掌握度時間折線圖 | ProgressPanel 加強量化成效呈現。 | ✅ 已完成 |
| 🟢 P4 | 手寫筆記 OCR → 圖譜 | Ollama OCR 已支援，Demo 主打「連手寫都能分析」。 | ✅ 技術就緒 |

> **競賽核心 Demo 亮點皆已完成。** 剩餘全為賽後 / 選配項目。

---

# 執行規則

- 每改完一個檔案 → `npm run build` 零錯誤
- 不新增 npm 套件（**例外：KaTeX 已加**）
- 完成後更新 `CLAUDE.md` 進度追蹤 + `DEVLOG.md`

> 朋友試用回饋 4 項（心智圖排版、概念抽屜詳解、深度重點、語言選項）已於 2026-06-09 完成，詳見 DEVLOG 與 `docs/superpowers/specs|plans/2026-06-09-trial-feedback-improvements*`。 