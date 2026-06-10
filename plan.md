# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 完成的功能記錄在 `DEVLOG.md`，從這裡刪除。
> 更新於 2026-06-10。

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

### E6：全離線 LLM fallback（最大項，海報級賣點，~半天）

- **目標：** 場地斷網/Gemini 全掛時，整條流程（OCR→建圖譜→出題→批改）在 M4 Air 上完全離線可跑。OCR 已離線（glm-ocr），缺的是文字 LLM。
- **方案：**
  1. `ollama_client.py` 新增 `generate_text(prompt: str) -> str`：打同一個 `/api/generate`（無 images），model 用新 env `OLLAMA_LLM_MODEL`（如 `llama3.1:latest`，機器已 pull）；`temperature 0`；錯誤回 ""（與 OCR 同模式）。Opt-in：未設 env 即停用，Render 零回歸。`config.py` + `.env.example` 補欄位。
  2. 抽 JSON 解析共用：`gemini_client._parse_json_payload` 移到新 `src/adaptlearn/llm_json.py`（或由 ollama 端 import gemini_client 的私有函式 —— 選前者，避免反向耦合），兩邊共用。
  3. fallback 接點（pattern 統一：Gemini 失敗/回空 → Ollama 文字模型同 prompt 重試一次 → 再失敗走既有錯誤路徑）：
     - 建圖譜：`knowledge_graph.py` 的 LLM 呼叫處
     - 出題：`gemini_client.generate_questions` 的呼叫端（`pipeline.generate_diagnostics`）
     - 批改：grade 流程的呼叫端
     - 概念詳解**不做**（lazy + 已有 degraded UI，離線時顯示降級提示即可）
  4. 回應加旗標（如 `llm_backend: "ollama"`）讓前端可顯示「離線模式」pill（選配，時間不夠可跳過 UI）。
- **驗收：** 拔網路（或清掉 GEMINI_API_KEY）後：上傳 txt 教材 → 建圖譜成功（概念非模板）→ 出題成功 → 批改成功。新增 unit tests：fake ollama text client 驗證 fallback 順序（仿既有 fake gemini 測試）。
- **風險：** llama3.1 的 JSON 輸出穩定性不如 Gemini → prompt 要加強硬 JSON 指令、共用 robust parser、失敗重試 1 次；品質較低是預期內（demo 講「降級仍可用」的故事）。記憶體：glm-ocr 2.2GB + llama3.1 4.9GB 同時駐留，16GB 可承受。

### 建議執行順序

E1 → E2 → E4 → E3 → E5 → E6（前五項都是小時級，E6 留完整的半天）。

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