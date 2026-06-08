# AdaptLearn 開發與除錯紀錄(DevLog)

> 本檔記錄專案的開發過程與除錯歷程,供日後製作海報與報告使用。
> 條目由新到舊,每段標註日期、症狀、根因、修法、驗證。

---

## 2026-06-09 — ingest 速度 + 真實進度條（進行中，分支 fix/ingest-speed-progress）

- **起點（使用者回報）：** async ingest 已不再 502，但 28 頁手寫教材處理逾 210 秒卡在第三階段「建立圖譜與向量索引」，體驗差。
- **診斷：**
  1. **向量索引慢（真兇）：** `vector_store.py` 沒指定 embedding function → ChromaDB 用預設本地 ONNX 模型（all-MiniLM ~80MB）。Render free tier 下載 + 載入 + 慢 CPU 推論、加上 P6 每次 redeploy 磁碟歸零要重下載 → 卡數分鐘近 OOM。
  2. **進度條是假的：** `SetupPanel.tsx` 用 `elapsedSec`（>5s / >15s）硬切步驟打勾，完全沒用後端真實 `stage`（輪詢回應其實有帶，前端丟掉）。截圖的「前兩步打勾、卡第三步」只是「已過 15 秒」假象。
- **決策（OCR 不動）：** OCR 早在 141a6bd 改為「Gemini 原生 PDF 一次送」，且那正是當初 502 元兇（DEVLOG 2026-06-03），已用 timeout + async 壓下；不可再回頭加速 OCR。本次只動：(1) 向量 embedding 改 Gemini API（有金鑰時）繞過本地模型、無金鑰回退；(2) 前端進度接後端真實 stage + 第三階段細分。
- **影響範圍：** `gemini_client.py`（新增 `embed_texts`）、`vector_store.py`（可選 embedder + collection 依 backend 命名避維度衝突）、`pipeline.py`（傳 embedder + 細分 stage）、`useApi.ts`（回拋 stage）、`SetupPanel.tsx`（真實 stage 驅動）。詳見 plan.md「進行中」。

---

## 2026-06-08 — Bug 5 方案 C「清除課程資料」完成 ✅

- **動機：** 方案 A（前端確認 modal）只是過濾，跨 session 概念仍殘留在 DB。方案 C 提供後端根本解——一鍵徹底清除某課程所有衍生資料。
- **決策：** ①整門課完全刪除（含 `courses` 列，課程從清單消失）②刪除按鈕放 SetupPanel 課程清單。
- **後端改動：**
  - `database.py`：`reset_course_state` 補清 `cross_course_edges`、`class_node_stats`；新增 `delete_course(course_id)` 刪 `courses` 列並重置 `_active_course_id`
  - `vector_store.py`：新增 `delete_course(course_id)`，用 `collection.delete(where={"course_id": ...})` 清向量
  - `pipeline.py`：新增 `clear_course(course_id)` 統籌 PG + 向量，課程不存在時拋 `ValueError`
  - `main.py`：新增 `DELETE /api/courses/{course_id}`（`@limiter.limit("10/minute")`），404 對應 `ValueError`，成功後 `invalidate_cache`
- **測試（TDD，先紅後綠）：** `test_reset_course_state_clears_cross_edges_and_class_stats`、`test_delete_course_removes_course_record`、`test_clear_course_removes_course_and_concepts`、`test_clear_course_unknown_id_raises`。全套 51 個測試 50 passed（1 既有失敗 `test_scanned_pdf_uses_configurable_ocr_page_limit` 與本次無關）。
- **前端：** `useApi.ts` 新增 `useDeleteCourse`（成功後 invalidate courses/concepts/mastery/graph/heatmap/health）；`SetupPanel.tsx` 新增「已上傳課程」清單區塊（每列垃圾桶按鈕）+ 確認 modal（沿用方案 A 樣式，紅色「永久刪除」按鈕）。
- **驗證：** `npm run build` 零 TS 錯誤；以 Playwright 對正式環境（render.com production DB）做端對端驗證——上傳一次性測試課程 `__VERIFY_DELETE_TEST__` → UI 點擊刪除 → 確認 modal → 「刪除中...」狀態 → 課程從清單消失 → API 二次確認 DB 已無該筆記錄。
- **附帶發現：** 測試套件透過 `config.py` 的 `load_dotenv` 連到正式 production DB（非本地 test DB），本次規劃時誤建的 `course-a`/`course-b` 測試列已用新做的 `DELETE /api/courses/{id}` 端點清除（順便驗證了端點本身）。**此為既有風險，建議賽後檢視測試環境隔離。**

---

## 2026-06-06 — P2 遺忘曲線預測顯示（FSRS-5 視覺化）✅

- **動機：** 競賽差異化強化 P2。Review 頁複習排程只顯示 priority 數字，無法直覺呈現 FSRS-5 的科學排程優勢；ThetaWave 完全沒有遺忘模型。
- **關鍵發現：** `_build_fsrs_card` 已算出 `retrievability`（記憶機率）和 `card.stability`（穩定度），但兩者只被塞進 `reason` 除錯字串，從未獨立暴露。不需後端重算，只要提升欄位即可。
- **後端改動（TDD）：**
  - `models.py`：`ReviewItem` 末尾加 `retention: float = 0.0`、`stability: float = 0.0`（有預設值，向後相容）。
  - `review_scheduler.py`：`build_review_plan` 將 FSRS 計算值填入新欄位（`round(retrievability, 4)`、`round(float(card.stability or 0), 4)`）。
  - `database.py`：`review_plan` 表加 `retention REAL`、`stability REAL` 兩欄（`ADD COLUMN IF NOT EXISTS` migration，同 `concepts.course_id` 低風險手法）；`save_review_plan` / `list_review_plan` 讀寫兩欄，SELECT 用 `COALESCE(retention, 0.0)` 相容舊資料。
  - `webapp/main.py`：`_serialize_review_item` 補兩欄。
- **測試（先紅後綠）：**
  - `test_save_and_list_review_plan_retention_round_trip`：retention=0.87、stability=4.2 寫入再讀出，差值 < 0.001。
  - `TestBuildReviewPlanRetention`：無歷史 → retention/stability 均 0；有作答 → retention∈(0,1]、stability>0。
  - 全套 41 個測試，40 passed（1 既有失敗 `test_scanned_pdf_uses_configurable_ocr_page_limit` 確認與本次無關）。
- **前端元件 `ForgettingCurve.tsx`（新建）：**
  - FSRS-5 公式：`R(t) = (1 + FACTOR·t/S)^DECAY`，`DECAY=-0.5`、`FACTOR=19/81`
  - 從 `retention` 反推目前 elapsed：`elapsed = ((R^(1/DECAY))-1)·S/FACTOR`
  - 畫未來 `max(daysUntilReview×1.5, 14)` 天的 SVG 衰減曲線（60 個採樣點）
  - 綠點標「現在記憶 N%」；琥珀虛線 + 點標「N 天後複習·剩 N%」
  - `stability=0`（無歷史）→ 顯示「尚無作答，完成測驗後產生遺忘曲線」
- **整合 `StudyPanels.tsx`：** 每個複習概念卡加「🧠 記憶 N%」徽章 + `ForgettingCurve`；移除原本顯示的 FSRS `reason` 除錯字串。
- **驗證：** `npm run build` 零 TS 錯誤，後端 pytest 40/41 passed（無迴歸）。
- **commit：** `6d554d8`

---

## 2026-06-06 — A2 釘死 requirements.txt 版本號 ✅

- **動機：** 架構健檢 A2，競賽保命。`requirements.txt` 全用 `>=`，Render redeploy 時套件自動更新可能無預警壞掉。
- **做法：** `pip freeze` 取得 venv 實際版本，逐一改成 `==`（fastapi==0.135.3、uvicorn==0.43.0 等共 13 個套件）。
- **commit：** `31e12f0`

---

## 2026-06-06 — UI 動畫升級：比比拉布 logo + 微互動（A+C）✅

- **動機：** 整體 UI/UX 升級，讓吉祥物有生命感、資料元件有動態回饋。
- **A — Logo 動畫（`PixelAvocadoLogo.tsx`）：**
  - 新增 `animate?: "idle" | "subtle" | "none"` prop。
  - `"idle"`（登陸頁 size=104）：`avocado-breathe` keyframe，scale + translateY 呼吸漂浮，3.6s 循環。
  - `"subtle"`（頂欄 size=30）：`avocado-float-subtle` keyframe，±2px 上下漂浮，4s 循環。
  - 兩個 keyframe 加入 `index.css`。
- **C — 微互動：**
  - `DailyProgressRing`：mount 後 80ms 弧形從 0 畫到目標值（利用既有 SVG `stroke-dasharray` transition）；中心數字用 `useCountUp` hook 從 0 count-up（800ms）。
  - 新 hook `hooks/useCountUp.ts`：rAF 線性 count-up，自動偵測 `prefers-reduced-motion` 直接跳終值。
  - `MasteryTable` 掌握度橫條：`requestAnimationFrame` mount trick，從 0% 填充（觸發既有 CSS transition）。
  - `ModuleCard` 進度條：同手法，從 0% 填充（Tailwind `transition-all duration-700`）。
- **全部動畫自動尊重 `prefers-reduced-motion`（全域 CSS 規則已覆蓋）。**
- **commit：** `1c746d4`

---

## 2026-06-06 — A1 session 隔離決策：不做 📋

- **評估：** 競賽為單人輪流 demo（評審看操作，非多人同時連線）。現有 `course_id` active scoping 機制（ingest 時呼叫 `set_active_course` + `reset_course_state`，出題 / 圖譜 / 掌握度查詢全只取 active course）已完整解決 Bug 5。session 隔離只在「多人同時連同一 Render 部署」才有意義，對單人 demo 是過度工程。
- **決定：** A1 短期解（`session_id` scope）跳過；完整多租戶仍屬賽後事項。

---

## 2026-06-05 — A5 清理 repo：雜物加進 .gitignore ✅

- **動機:** 架構健檢 A5。repo 根目錄有非專案來源的暫存產物會被 `git add .` 誤掃進 commit。
- **加入 `.gitignore`:** `.superpowers/`(Claude Code tooling 區)、`architecture-explain.html`、
  `bug-report.html`(本地暫存產物區)。
- **註:** `.github/workflows/react-doctor.yml` 是合法 CI 設定,**不 ignore**(留待之後決定是否提交)。

---

## 2026-06-05 — A3 刪死碼：移除未掛載的圖譜元件 ✅

- **動機:** 架構健檢 A3。路徑尋找功能最後做在 `MindMapCanvas`,確認另兩個圖譜元件成為死碼。
- **查證（刪前必做）:** `grep` 全 `src/` 確認 `ForceGraphCanvas` 與 `GraphCanvas` **零引用**;
  `MindMapCanvas` 仍被 `KnowledgeGraphPanel.tsx` 使用 → 保留。
- **刪除:**
  - `components/ForceGraphCanvas.tsx`、`components/GraphCanvas.tsx` 兩檔。
  - `package.json` 依賴 `react-force-graph-2d`(唯一使用者是 ForceGraphCanvas,已刪)。
  - `vite.config.js` 連帶清掉 `manualChunks.forcegraph` 與 `optimizeDeps.include` 的對應項
    (否則產生 0.03 kB 空 chunk)。
- **驗證:** `npm run build` 兩次皆綠(`✓ built`),無壞 import、無 TS 錯誤,空 chunk 消失。
- **保留:** `utils/graphUtils.ts`(MindMapCanvas 路徑功能在用)。

---

## 2026-06-05 — 架構健檢（Opus review，未動程式碼）🩺

- **動機:** 競賽前請 Opus 全面檢查架構,讀實際程式碼(非僅文件)後給評分與改善清單。
- **總評分:** **8 / 10**(以大二競賽標準屬高於平均)。模組化、migration + `schema_version`、
  連線池、rate limit、cache、optional auth、OCR fallback chain、`run_in_threadpool`、
  約 1000 行測試皆到位;`_estimate_pass_probability` 誠實標註為未驗證 placeholder。
- **發現的問題(依嚴重度,已寫入 `plan.md` 健檢表 A1–A6):**
  - **A1 🔴 致命 — 全域可變單例 → 單租戶:** `webapp/main.py:45` import 時即建 `_service`,
    所有請求共用同一份 service / 知識圖譜 / mastery,沒有 user 概念;`_get_service()` 的
    `set_api_key()` 改動共享全域 → 併發 race。**既有 Bug 5「跨 Session 概念殘留」即此症狀,
    非獨立 bug**。短期解=加 `session_id` scope(plan 方案 B);中期解(賽後)=`users` 表 + token。
  - **A2 🟠 高 — 依賴全用 `>=` 未釘版本:** `requirements.txt` redeploy 可能無預警壞掉。
    解:`pip freeze` 或改 `==`。**列為競賽 P1(最快保命)**。
  - **A3 🟠 高 — 三個圖譜元件並存含死碼:** `ForceGraphCanvas`(未掛載) / `MindMapCanvas` / `GraphCanvas`。
  - **A4 🟡 中 — God object:** `database.py` 806 / `pipeline.py` 628 / `App.tsx` 803 行。
    **競賽期間不動**(風險 > 收益),賽後再拆。
  - **A5 🟡 中 — repo 根目錄雜物未追蹤:** `architecture-explain.html`、`bug-report.html`、
    `.superpowers/` → 應進 `.gitignore`。
  - **A6 🟢 低 — ChromaDB 本地碟 redeploy 歸零(已知 P6,賽後處理)。**
- **驗證安全性:** SQL 幾乎全參數化;唯一 f-string(`database.py:194` ALTER COLUMN)的表名/欄名
  來自寫死清單,**非使用者輸入,無注入風險**。
- **建議執行順序:** A2 → A1 短期(`session_id`) → A5 → A3 → (賽後)A1 完整多租戶 / A4 拆檔。
- **產出:** `plan.md` 新增「🩺 架構健檢結果」一節(嚴重度表 + 具體作法 + 優先順序)。本次未動任何程式碼。

---

## 2026-06-05 — 知識圖譜路徑尋找模式 ✅

- **功能目標：** 在現有 `MindMapCanvas` 上加「路徑模式」，使用者點兩個概念，BFS 自動找出最短先修路徑並高亮顯示。

- **架構決策：**
  - 沿用 `MindMapCanvas.tsx`（放射狀 SVG），不切換 `ForceGraphCanvas`（未掛 UI、舊深色主題，重配成本高）。
  - BFS 只走 `prerequisite` + `progression` 邊（有明確先後語意）；`related`/`semantic` 忽略。
  - 後端零改動——DOT 邊方向與 `relation` 欄位已足夠。
  - 不新增 npm 套件，BFS 自寫純函式。

- **`utils/graphUtils.ts` — `findLearningPath()` BFS 純函式：**
  - 輸入 `ParsedGraph` + `startId` + `endId`，回傳 `PathResult { found, nodeIds, edgeKeys, steps }`。
  - 建 adjacency map 只收符合條件的邊（順向）；標準 BFS + parent map 回溯組路徑。
  - 純函式，無 React 依賴，獨立單元測試（`graphUtils.path.test.ts`，直線路徑、多分支取最短、無路徑、起=終等 5 個案例）。

- **`MindMapCanvas.tsx` — 路徑模式 state 與互動：**
  - 新增 `pathMode`、`startId`、`endId` state；`pathResult` 用 `useMemo` 響應式重算。
  - 點擊分流：path 模式關 → 維持原有選取/詳情卡行為；path 模式開 → 第一點設起點、第二點設終點、第三點重設起點。
  - 空白處點擊或「清除」按鈕 → 清空起終點；切出 path 模式自動清空。

- **視覺高亮（SVG render loop）：**
  - 起點：綠框（`--high`）粗框 + 「起」標記；終點：紅框（`--low`）+ 「終」標記。
  - 路徑中間節點：accent indigo 框、全 opacity。
  - 非路徑節點：opacity 0.2；非路徑邊：opacity 0.15；路徑邊：粗 2.5px accent 色。
  - 未選齊（缺起點或終點）時全部正常顯示，不變淡。

- **控制列與回饋：**
  - 「路徑模式」toggle 按鈕 + 「清除」按鈕（覆蓋層，沿用 zoom 控制區樣式）。
  - 提示條：「點第一個概念設為起點，再點第二個設為終點」。
  - 找到路徑 → 顯示「從 [A] 到 [B] · 共 N 步」+ 有序概念名列。
  - 找不到 → fallback 文案提示 LLM prerequisite 關係可能尚未建立。

- **Bug 修正（同日）：** `clearPath useCallback` 宣告在 `onMouseDown` 之後，造成 TS block-scoped forward reference 錯誤，修正宣告順序。

---

## 2026-06-05 — P3 修復（_service_lock）+ P4 效能優化（mastery SQL GROUP BY）✅

- **P3 — Gemini API key 熱替換，不重建 service：**
  - **根因：** `_get_service()` 換 key 時重建整個 `AdaptLearnService`（DB pool、Chroma 全部重啟），而 `_service_lock` 宣告了卻從未 acquire（`_get_service` 是 sync，無法用 asyncio.Lock）。
  - **修法：** `GeminiClient.set_api_key(key)` 只重建 HTTP client；`AdaptLearnService.set_api_key(key)` 委派給 `self.gemini`；`main.py` 的 `_get_service()` 改呼叫 `set_api_key()`，移除無效的 `_service_lock` 與 `asyncio` import。
  - 換 key 時 DB pool、Chroma、Ollama、Chandra 完全不受影響。

- **P4 — mastery 聚合改用 SQL GROUP BY：**
  - **根因：** `get_concept_mastery()`、`generate_diagnostics()` 各自拉 3000–5000 筆 attempts 到 Python 端做 `defaultdict` 聚合，cache miss 時重複全量載入。
  - **修法：** `database.concept_score_summary(course_id)` — 一條 `GROUP BY concept_id` 回傳 `{concept_id: {avg_score, count}}`；`pipeline` 改用此 dict，`_select_weak_concepts` 簽名從 `list[Attempt]` 改為 `dict[str, dict]`。
  - `build_and_save_review_plan` / `get_tonight_study_dashboard` 保留 `list_attempts`（FSRS 需完整時間序列重播）。

---

## 2026-06-05 — UI 清理 + Bug 7 修復 + ProgressPanel 學習趨勢圖 ✅

- **移除「Gemini 已啟用」pill：** 頂欄右側、學習流程卡、系統狀態卡「運行模式」行、目前課程卡的 runtimeLabel paragraph、SetupPanel「目前狀態」的系統模式 card-subtle，共 5 處全部移除。`runtimeLabel` / `runtimeHint` 變數保留（仍用於「今晚優先」卡片的 fallback 文字）。

- **Bug 7 — ClassHeatmapPanel 課程 tab 重複：**
  - **根因：** 同一門課上傳多次 → `courses` 表多筆同 `subject` 不同 `id` 的 row；`list_courses()` 按 `uploaded_at DESC` 回傳全部，前端沒去重。
  - **修法：** `ClassHeatmapPanel.tsx` 在渲染 tab 前以 `subject` 去重，保留最新一筆（API 已排序，第一筆最新）。不動後端，不影響熱力圖資料。

- **ProgressPanel.tsx — 學習進度趨勢圖（P2 Step 5）：**
  - 新建 `webapp/frontend/src/components/ProgressPanel.tsx`：Recharts `LineChart`，X 軸日期、Y 軸 avg_score（%），每個概念一條線，顏色依趨勢（綠/紅/灰）。
  - 概念列表卡片：顯示最新得分 + 趨勢徽章（↑進步中 / ↓需加強 / →穩定）。
  - 右上角 7/14/30 天切換 tab。無資料時顯示提示。
  - `useApi.ts` 新增 `useConceptProgress(days)` hook + `ConceptProgressItem` / `ConceptDailyPoint` 型別。
  - 掛入複習頁（`activeView === "review"`）`MasteryTable` 下方，以 `<ErrorBoundary>` 包裹。

---

## 2026-06-04 — P5/P1/P2 架構實作：Migration 系統 + Course Scope + TIMESTAMPTZ + 進度 API ✅

- **P5 Migration 系統：** `database.py` 加 `schema_version` 表 + `_run_migrations()` 方法，用版本號追蹤 migration 狀態。Migration 001 把 5 個 TEXT 時間欄位轉 TIMESTAMPTZ（`attempts.created_at`、`questions.created_at`、`courses.uploaded_at`、`review_plan.next_review_at`、`class_node_stats.updated_at`）。

- **P1 — 概念 ID 加入 course 維度：** `knowledge_graph._concept_id(name, chapter, course_id)` hash 從 `chapter:name` 改成 `course_id:chapter:name`，跨課程同名概念不再撞 PK。`build_knowledge_graph` 新收 `course_id` 參數往下傳。

- **P1 — 停止全域 wipe：** `pipeline.ingest_material` 把 course_id 計算提前到 `build_knowledge_graph` 之前，改呼叫 `repo.reset_course_state(course_id)`（只刪該課程的概念/邊/題目/複習計畫，**保留 attempts 歷史**）。`database.py` 新增 `reset_course_state(course_id)`。

- **P1 — 讀取路徑全部 course-scope：** `list_concepts(course_id=None)`、`list_edges(course_id=None)` 加可選過濾；新增 `get_active_course_id()`（in-memory cache + DB fallback，過濾 `WHERE uploaded_at <= now()` 避免 migration 產生的未來時間戳干擾）；`generate_diagnostics`、`list_concepts`、`get_concept_mastery`、`get_tonight_study_dashboard`、`get_graphviz` 全部改用 active course。

- **P1 隱藏地雷（migration timezone bug）：** 舊 TEXT 時間字串（本地時間如 `2026-06-04T16:11:27`）被 `::timestamptz` 解析為 UTC，在 UTC+8 環境會得到比現在早 8 小時的「未來時間戳」。解法：`get_active_course_id()` 加 `WHERE uploaded_at <= now()` + in-memory `set_active_course(course_id)` 在 ingest 後立即設定 active course，不依賴 DB 查詢順序。

- **P2 — TIMESTAMPTZ 讀寫：** 所有 `datetime.now()` 改 `datetime.now(timezone.utc)`；`save_attempt`/`save_review_plan`/`save_course` 直接傳 datetime 物件（不再 `.isoformat()`）；`list_attempts`/`list_review_plan`/`list_courses`/`get_course`/`list_class_node_stats` 移除 `datetime.fromisoformat(row[...])`（psycopg2 已回傳 datetime 物件）。

- **P2 — 進度趨勢 API：** `database.concept_progress(course_id, days)` SQL `date_trunc('day')` 分組；`pipeline.get_concept_progress(days)` 判趨勢（improving/declining/plateaued，±0.05 閾值）；`GET /api/progress/concepts?days=30` 新端點。

- **回歸測試：** 40 通過，1 pre-existing 失敗（`test_scanned_pdf_uses_configurable_ocr_page_limit`，與本次修改無關）。

---

## 2026-06-04 — 架構評估 + P1/P2 解法設計（Opus 規劃，未動程式碼）📐

- **背景：** 使用者要求評估系統架構可改善處，並把計畫寫進 `plan.md` / `CLAUDE.md`。
  Opus 通讀 `main.py`、`pipeline.py`、`database.py`、`config.py`、`knowledge_graph.py`、`models.py`。
- **找出 6 項架構債（P1–P6），寫進 plan.md「🔵 架構改善建議」+ CLAUDE.md「架構限制與技術債」速查表。**

- **P1 ⭐ 根因發現 — 全域 wipe 摧毀所有歷史：**
  `pipeline.ingest_material:146` 每次上傳都 `reset_learning_state(include_attempts=True)`
  → `database.py:147` 直接 `DELETE FROM concepts/edges/questions/review_plan/attempts`。
  schema 有 `course_id`，但寫入是「單課程覆蓋」。一個 bug 連帶炸三件：
  ① **Bug 5 跨 Session 殘留的真正根因**（前端 modal 只是 OK 繃）；
  ② 多課程不可能（第二份教材洗掉第一份）；
  ③ 封死 Feature 2 進度追蹤（attempts 每次被刪）。

- **P1 隱藏地雷（評估時挖出）：** `_concept_id = uuid5(chapter+name)`（`knowledge_graph.py:480`）
  **沒有 course 維度**，目前靠「每次全清」才不會撞。**停止 wipe 前必須先把 course_id 併進 ID hash**，
  否則跨課程同名同章概念撞同一 PK → upsert 互相覆蓋，且 A 的 attempts/questions 錯接到 B 的概念。
  → 已在 plan.md P1 解法列為不可省的 Step 1。

- **P2 ⭐ — 時間欄位全是 TEXT（naive 本地時間）：** 無法在 SQL 做日期區間運算，
  成長曲線做不出來。解法：5 個時間欄改 `timestamptz`、寫入改 `datetime.now(timezone.utc)`、
  新增 `GET /api/progress/concepts`（`date_trunc('day')` 分組 + 趨勢判定）。
  **隱藏地雷：** 轉 timestamptz 後 psycopg2 回傳 datetime 物件不是字串，
  所有 `datetime.fromisoformat(row[...])`（5 處）要拔掉，漏改 runtime crash。

- **P3–P6（僅註記，本回合不動）：** P3 `_service_lock` 宣告卻沒 acquire（換 key 競態）；
  P4 mastery 聚合在 Python 端每次拉 5000 筆 attempts（該用 SQL `GROUP BY`）；
  P5 無 migration 機制；P6 ChromaDB 存本地碟、Render redeploy 歸零。

- **建議實作順序：** P5（migration 地基）→ P1（course-scope + 停 wipe）→ P2（時間欄 + 進度 API）。
  這三個一條線，同時解 Bug 5 根因、解鎖多課程、解鎖進度追蹤。

- **產出：** plan.md 兩段「✅ 解法設計（細）」+ 拆解小工單（可當 Sonnet checklist）；
  CLAUDE.md「P1/P2 解法摘要」。**本回合純規劃，未改任何程式碼。**
- **下一步：** clear 後切回 Sonnet，依 plan.md 從 P5 起手實作。

---

## 2026-06-04 — 第三批：LaTeX 渲染 + 跨 Session 確認 + Emil 動效 + 繁中詳解 ✅

- **任務 1 — KaTeX 渲染：** 新增 `MathRenderer.tsx`（regex 切 `$...$` / `\(...\)`，KaTeX renderToString），套用到 QuizPanel 題目、feedback、expected_answer。
- **任務 2 — 跨 Session 確認 modal：** QuizPanel 加 `sessionUploaded` prop；若本 session 未上傳就點「產生題目」，先彈出確認 modal（「使用舊教材出題？」）再繼續，不動 DB schema。App.tsx 傳入 `sessionUploaded`。
- **任務 3 — Emil 動效升級：** `.question-enter`（題目卡片滑入 240ms）、`.grade-enter`（評分結果 scale-in）+ `.correct` 彈跳；答對粒子從 3 顆增為 8 顆多色分散；`.pill:hover` pixel-flash keyframe。
- **任務 4 — 繁中詳解：** `gemini_client.grade_answer` prompt 改要求繁體中文回饋；fallback heuristic 訊息和空答案提示也改繁中。出題 prompt 亦改為繁體中文 + 數學式 `$...$` 指示。
- **技術：** `npm install katex @types/katex`；`npm run build` 零錯誤。

---

## 2026-06-04 — UI 第一批：全站 5 個子頁面遷移為亮色主題（全部完成） ✅

- **範圍：** SetupPanel → QuizPanel → StudyPanels + MasteryTable → KnowledgeGraphPanel + MindMapCanvas + ClassHeatmapPanel。
- **核心改動：**
  1. `SetupPanel.tsx`：`.card` + 拖曳上傳區（`.upload-zone` drag-over 狀態）+ 像素風 SVG 資料夾插圖 + 3 步驟進度條（`.progress-step` 60s/15s 自動推進）；修正 OCR 說明文字（反映實際 Ollama → Chandra → Gemini 優先順序）。
  2. `ConceptSection.tsx`：全面改亮色，`.pill`/`.card-subtle` 取代舊暗底圓角。
  3. `QuizPanel.tsx`：SVG 半圓弧進度（`QuizArc`）+ 題目元信息用 `.pill`/難度 tag；答對噴 `.pixel-particle` 方塊粒子（3 顆，stagger 0/80/160ms）；像素風空箱插圖。
  4. `StudyPanels.tsx`：TonightPanel 大數字前/提升/後三欄；StudyPlansPanel 用 `.mastery-bar-track/fill` 漸層條顯示優先度。
  5. `MasteryTable.tsx`：`.mastery-bar-track/fill` 漸層條取代舊 table；100% 掌握概念旁顯示 ★ 彩蛋。
  6. `MindMapCanvas.tsx`：畫布換亮底 `var(--bg-subtle)`；中心節點改 pixel-border 方塊（`rx=2` + 偏移矩形模擬像素邊框）；concept pill 換白底深字；zoom 控制改 `.btn-secondary`；detail panel 改 `.card` 光色；`MindMapLegend` 換亮色。**同次修復 Mac 觸控板 Bug：** `onWheel` 加 `ctrlKey` 判斷 — `ctrlKey=true`（Mac pinch 縮放）→ scale factor 1.04/0.96；`ctrlKey=false`（雙指捲動）→ setPan 平移（deltaX/deltaY）。修前：雙指捲動觸發飛速縮放。
  7. `KnowledgeGraphPanel.tsx`：`.card` + `.btn-secondary` 控制鈕。
  8. `ClassHeatmapPanel.tsx`：GitHub 貢獻圖風熱力格子（`2px gap`、`border-radius: 0`、頂部 `3px solid` 顏色條）+ hover tooltip + 圖例。
  9. `LoadingSkeleton.tsx`：Skeleton 換 `--bg-sunken`，cardSkeleton 等換 `.card`。
  10. `main.jsx`：LoadingFallback 換亮色 `.card` + `--accent` spinner。
  11. `index.css`：移除已完成遷移後不再需要的 `.legacy-surface` 整段 CSS。
- **App.tsx 整合：** 移除所有 setup/quiz/review/graph 的 `.legacy-surface` 包裹；loading skeleton 改亮色 `.card`；各 sidebar 面板換 `.card`/`.card-subtle`。
- **驗證：** `npm run build` 零錯誤（1.38s）；grep 確認主要元件無殘留 `glass-panel`/`glass-subpanel`/`glass-button`/`glass-input`/`legacy-surface`。

---

## 2026-06-04 — Bug fix：Landing 導向錯誤 + 首頁殘留舊資料 ✅

- **症狀 A：** 點「開始學習」後跳到教材頁（`/setup`），不是首頁（`/`）。
- **根因 A：** `onEnter` callback 只有 `setShowLanding(false)`，沒有重置路由；`activeView` 保留上次離開時的 URL。
- **修法 A：** `App.tsx` 改為 `onEnter={() => { setShowLanding(false); navigateTo("home"); }}`。
- **症狀 B：** 首頁 stat cards（概念節點數、待排複習數）和工作流程狀態文字顯示前一 session 從 DB 撈的舊資料。
- **根因 B：** `concept_count`、`reviewItems.length`、`accuracyPct`、`topChapter`、`topFocus` 直接用 DB 回傳值，沒有 `sessionUploaded` gate 保護。
- **修法 B：** 新增 `sessionConceptCount` / `sessionReviewCount` gated 中間變數，`topChapter` / `topFocus` / `accuracyPct` 也套上 `sessionUploaded ? 真實值 : 空值`。
- **驗證：** `npm run build` 零錯誤（1.46s）。
- **附記：** 使用者將自行設計最終版酪梨 logo，現有 `PixelAvocadoLogo.tsx` 為 AI 暫時版。

---

## 2026-06-04 — UI 第二批實作：登入頁 + 像素酪梨 logo + Emil 級動效打磨 ✅

- **實作內容：**
  1. `index.css` — 新增 Emil 推薦的自訂 easing token（`--ease-out`/`--ease-in-out`/`--ease-drawer`）；
     按鈕 `:active` 改 `scale(0.97)`（替代舊 `translateY(1px)`）；所有 btn 過渡改用 `var(--ease-out)`；
     `.card-interactive`/`.stat-card` 的 `transform` hover 移入 `@media (hover:hover) and (pointer: fine)`；
     補 `prefers-reduced-motion` 全域守門；新增 `.pixel-border`/`.pixel-grid-bg`/`.pixel-particle` 三個像素 class；
     新增 landing 動畫 keyframe（`landing-enter-item`/`landing-leave-container`）+ `.landing-item` stagger 類。
  2. `PixelAvocadoLogo.tsx`（新）— 純 SVG `<rect>` 格子酪梨：深綠果皮 + 淺綠果肉 + 果核 indigo ECG 脈搏線；
     支援 `size` / `className` / `withPulse` props；`shape-rendering="crispEdges"` 保持像素感；30px 與 104px 尺寸皆清晰可辨。
  3. `LandingScreen.tsx`（新）— 全螢幕極簡入口頁：大酪梨 logo → 字標 → tagline → 「開始學習 →」→ 支援說明；
     5 元素 stagger 入場（`0/50/100/150/200ms` delay，360ms ease-out，從 `scale(0.96)+Y8px` 入）；
     離場比入場快（240ms，`scale(0.98)` 淡出），`setTimeout(onEnter,240)` 銜接主儀表板。
     右下/左上角極淡 `.pixel-grid-bg` 品牌點綴。
  4. `App.tsx` — `showLanding` 預設 `true` gate（landing 不渲染頂欄）；頂欄 brand logo 換成 `<PixelAvocadoLogo size={30}/>`；
     首頁 stat-card stagger 從 80ms 調整為 50ms。
  5. `SetupPanel.tsx`（小修）— file input `file:bg-white/18 file:text-white` 改成亮色主題正確樣式，
     修掉「選擇檔案」按鈕在亮底下反白的視覺問題。
- **驗證：** `npm run build` 零錯誤，1.54s。無 `transition: all` 殘留。
- **下一批：** 4 個子頁面（教材/測驗/複習/圖譜）亮色遷移 + 移除 `.legacy-surface`（見 plan.md 第一批）。

---

## 2026-06-04 — UI 第二批規劃：登入頁 + 像素酪梨 logo + Emil 級動效（設計，待實作）📐

- **起點（使用者痛點）:** ① 一進站就把所有按鈕/儀表板全攤開，缺一個「入口」儀式感；
  ② 現有 logo（indigo 方塊 + Activity 脈搏 icon）辨識度低，想要更有記憶點的品牌符號。
- **方法:** 用 brainstorming 技能釐清需求，並導入使用者新裝的 **Emil Kowalski 設計工程技能**
  （`.agents/skills/emil-design-eng/SKILL.md`）作為動效準則。
- **三項已拍板決策（使用者選定）:**
  1. **置中極簡登入頁** —— 大酪梨 logo → 字標 → tagline →「開始學習 →」單一主按鈕 → 「已支援 PDF・手寫・圖片」。
     全螢幕、不渲染頂欄（呼應「不要一進來全部按鈕都出現」）；點按鈕淡出後接入既有 5-view 儀表板。
     `showLanding` 預設 true、每次重整都重播入場（競賽 demo 記憶點）。
  2. **logo 改像素酪梨 + 脈搏混合** —— 深綠果皮 + 淺綠果肉 + **果核位置一條 indigo ECG 脈搏線**，
     兼顧新辨識度與舊「學習脈搏」品牌延續。純 SVG `<rect>`、可變 size（登入頁 ~104px / 頂欄 ~30px）、不新增套件。
  3. **首頁 + 頂欄 Emil 級打磨** —— 加自訂 easing token（`--ease-out` 等）、按鈕 `:active` 改 `scale(0.97)`、
     首頁 stat-card stagger 入場、消滅 `transition: all`、hover 加裝置守門、補 `prefers-reduced-motion`。
- **Emil 準則重點（寫進 plan）:** 絕不從 `scale(0)` 入場（改 `scale(0.96)+opacity`）、進場慢/離場快（不對稱）、
  stagger 30–80ms、UI 動效 < 300ms、只動 `transform`/`opacity`、自訂 cubic-bezier 比內建 easing 有力。
- **範圍界定:** 本回合只做 ①②③；plan.md 第一批的 4 個子頁面遷移維持原計畫、之後再做。不動後端/API/hooks、不加 npm 套件。
- **產出:** 設計與逐任務步驟（A 改 CSS／B 酪梨 logo 元件／C LandingScreen／D App.tsx 整合）寫進
  `plan.md`「🟢 本回合優先（第二批）」；`CLAUDE.md` UI 章節 + 進度追蹤同步更新。**實作交由 Sonnet。**

---

## 2026-06-03 — 知識圖譜改為放射狀心智圖(SVG) ✅

- **起點(使用者痛點):** 圖譜頁原本是 `react-force-graph-2d` 力導向圖——節點隨機堆在中間、
  標籤截斷(≥22字就變「Eigenvalues of Ma...」)、看不出章節階層，完全不像「把觀念連起來」的心智圖。
  線性代數課特別需要能看出概念之間依存關係的視覺化。
- **決策:** 換成純 SVG 放射狀心智圖，不加任何新 npm 套件。
- **新架構(`MindMapCanvas.tsx`):**
  - **佈局:** 中心節點(課程名稱) → 第一環:章節圓圈(每章一個調色盤顏色) → 第二環:概念 pill 節點
  - **幾何:** 章節在半徑 170px、概念在半徑 340px(固定虛擬座標空間 1000×700,再 scale 到容器寬)
  - **概念 fan 展開:** 每章的概念以章節角度為中心，依數量展開 ±75° 扇形,不重疊
  - **邊線三層:** trunk(中心→章節,粗透明彩線) / branch(章節→概念,細彩線) / cross-edges(概念→概念 Bezier 箭頭,依 relation type 著色)
  - **Pill 寬度:** 動態計算(約字數 × 7.5px + 32),不截斷 ≤22 字的名稱
  - **互動:** 拖曳平移、滾輪縮放(0.25x~3x)、點 pill 節點顯示底部 detail panel(掌握度%)、右上角 +/−/⟳ 按鈕
- **額外修正(同次):** `gemini_client.py extract_concepts` 提示詞加入語言指令 —
  「IMPORTANT: Match the language of the source material. If primarily in Traditional Chinese, output Chinese names and descriptions.」
  修前:概念名稱總輸出英文(提示詞全英文 → Gemini 照英文回);修後:中文筆記 → 中文概念名稱。
- **驗證:** `npm run build` 零錯誤。`react-force-graph-2d` chunk 縮至 0.03 kB(舊路徑保留備用但不再掛載)。
- **KnowledgeGraphPanel 變化:** 移除舊 `ForceGraphCanvas`/`MasteryLegend` import,換 `MindMapCanvas`/`MindMapLegend`;
  `courseName` prop 從 App.tsx 的 `activeCourseName` 傳入,顯示在中心節點。

---

## 2026-06-03 — 本地 Ollama 視覺 OCR:手寫辨識的真正升級(取代「在 Render 跑 Chandra」幻想)✅

- **起點(使用者痛點):** 手寫辨識太弱。線上 Render 版上傳手寫 PDF 仍出 502,且就算成功,
  Gemini `flash` 對手寫的品質也不夠。使用者問:「真的沒辦法啟用 Chandra 嗎?」
- **查證(推翻與釐清幾個假設):**
  - **Chandra 在 Render 免費方案「機器內」確實跑不動:** vLLM 後端要 GPU;HF 後端官方建議
    **16–24GB VRAM** 載 Qwen3-VL。Render 免費約 512MB、無 GPU。`requirements.txt` 的
    `chandra-ocr` 在線上只是「裝了卻永遠連不到 localhost:8000」。
  - **但 Chandra 有雲端託管 API**(datalab.to,$5 免費額度、250 頁約 15 秒)——
    這才是免 GPU「啟用 Chandra」的路;不過要註冊+付費。
  - **Gemini `flash` 手寫確實弱:** 公開比較顯示 flash 手寫「4 頁錯 3 頁」,
    `2.5-pro` 約 93%。但 pro 較慢、API 計費,且**學生方案的「Gemini Pro」是 App 訂閱、不含 API 額度**
    (常見誤會,已向使用者澄清:本專案用 API 金鑰,計費與 App 訂閱是兩條獨立帳)。
- **決策(關鍵轉折):** 使用者比賽 demo **用本地跑**。偵測其機器為 **MacBook Air M4 / 16GB / 已裝 Ollama**
  (已在跑 deepseek-r1:8b 5.2GB)。→ 結論:**本地 demo 用 Ollama 跑視覺 OCR** 才是最佳解——
  手寫品質高、**零 API 成本、本地無 proxy 故不會 502**、離線可用。選 `qwen2.5vl:7b`
  (與 Chandra 同源的 Qwen-VL 家族、Ollama 官方有、4-bit 約 6GB 在 16GB M4 跑得順)。
  Render 線上版維持 Gemini 後備。
- **實作:**
  - 新增 `src/adaptlearn/ollama_client.py`(`OllamaClient`):純 stdlib(`urllib`)打 Ollama
    `/api/generate`,逐頁送 base64 圖、temperature 0、`num_predict=4096`;任何錯誤(連不到/模型不存在/逾時)
    都 log 並回 `""` 讓上層 fallback。介面對齊 `GeminiClient`(`enabled`/`transcribe_images`)。
  - **Opt-in:** 只有設了 `OLLAMA_OCR_MODEL` 才啟用(`enabled` 只做便宜檢查、不連網),
    所以 Render(未設)完全跳過、零回歸。新增 `OLLAMA_URL` / `OLLAMA_OCR_MODEL`(config + .env.example)。
  - `pdf_parser.py` OCR fallback 鏈改為:**Ollama(本地、受 `MAX_OCR_PAGES`)→ Chandra(本地、同上限)
    → Gemini 原生 PDF(無上限)→ Gemini 逐頁 vision(無上限)**。Ollama 與 Chandra **共用同一份**
    逐頁影像(少渲染一次)。超過頁數上限時**明確 log**(符合「no silent caps」)。
    新增 `source_type`:`pdf-ollama-ocr`、`image-ollama-ocr`。
  - `pipeline.py` 建 `self.ollama` 並傳入 `extract_material_text`。
- **順手修掉一個既有回歸(HEAD 上就壞的測試):** `test_page_limit_still_blocks_without_native_pdf`
  在 HEAD 已 **FAIL**——上一輪「Gemini 逐頁 vision 不受頁數限制」(commit 37b1204)改變了語意:
  **有 Gemini 時超頁不再擋下**,改由 Gemini 接手。原測試還假設會擋下,故失敗。
  重寫為正確語意並補一支正向測試:
  - `test_page_limit_blocks_local_ocr_without_gemini`:capped 本地 OCR(Ollama)+ 超頁 + **無 Gemini** → 擋下。
  - `test_over_cap_not_blocked_when_gemini_available`:有 Gemini → 超頁**不擋**,走 `pdf-ocr`。
  - 新增 `TestLocalOllamaOcr` 三支:Ollama 優先於 Gemini、Ollama 空回退 Gemini、圖片走 `image-ollama-ocr`。
- **驗證:** `py_compile` 綠;`ruff` 對新原始碼全綠(測試檔 7 個 E402 為**既有**,stash 前後皆 7);
  免 DB 的 6 支 OCR 測試全過;對**真實本地 Ollama** 煙霧測試:`enabled` 閘門正確、
  不存在的模型 → 404 → 優雅回 `""`(會 fallback)✅。
- **使用者的手動步驟(demo 前一次):** `ollama pull qwen2.5vl:7b`,在 `.env` 設 `OLLAMA_OCR_MODEL=qwen2.5vl:7b`。
  28 頁那份要本地整份 OCR 的話,把 `MAX_OCR_PAGES` 調到 ≥28(否則超頁會跳過本地、改用 Gemini)。
- **取捨/備註:** 本地 7B VLM 逐頁約數十秒,28 頁會跑數分鐘——但本地無 proxy、不會 502;
  嫌慢可減頁數或改用雲端 Chandra API。社群移植的 `chandra-ocr-2` Ollama 版亦可換 env 試,但品質未經官方驗證。

---

## 2026-06-03 — Render 上傳手寫 PDF 回 502,狀態列被塞滿原始 HTML ✅

- **症狀:** 在 Render 線上版上傳手寫 PDF(`線性代數第七章內積空間.pdf`)按「建立知識圖譜」後,
  狀態列出現一整頁原始 HTML,`<title>` 是 **502**。
- **根因(兩個疊加):**
  1. **單一 worker 被卡死。** `render.yaml` 用 `uvicorn`(預設單 worker、單事件迴圈)。
     路由 `async def ingest_material` 卻**直接同步呼叫** `service.ingest_material(...)`,
     在長時間 OCR/LLM 期間整個事件迴圈被卡住,worker 無法回應 Render 健康檢查 →
     邊緣 proxy 斷線 → **502 Bad Gateway**(那頁 HTML)。
  2. **Gemini 呼叫沒有逾時上限。** `GeminiClient` 建 `genai.Client(api_key=...)` 未設 `http_options`,
     `transcribe_pdf` 整份 PDF 一次送,手寫文件可能跑很久而無上界,既餵養根因 1 也可能撞 proxy 逾時。
  - 另:前端 `apiFetch` 在非 JSON 錯誤(502 的 HTML)時把整個 body 當訊息丟出,
    `SetupPanel` 直接把它當狀態文字顯示——這是讓 HTML 外露的**前端既有行為**(非本次 502 根因)。
- **修法(後端):**
  - `webapp/main.py`:`ingest_material` 改用 `await run_in_threadpool(service.ingest_material, ...)`,
    讓同步重工跑在執行緒池,事件迴圈保持可回應健康檢查 → 消除主要 502 路徑。
  - `gemini_client.py`:建 client 時帶 `HttpOptions(timeout=120_000ms)`,讓卡住的轉寫快速失敗;
    並把 `httpx.TimeoutException` / `TransportError` 併入 `_API_ERRORS`,逾時改為優雅降級(回 "")→
    走既有的「文字太少」400 JSON,而非 502。
- **驗證:** `py_compile` + `ruff` 全綠;`pytest` 的 2 支 `TestNativePdfTranscription`(免 DB)通過;
  確認 SDK `types.HttpOptions(timeout=...)` 與 `httpx.TimeoutException/TransportError` 皆存在。
- **前端 apiFetch HTML 外露一併修掉:** `useApi.ts` 新增 `errorMessage(status, payload)`——
  只信任 JSON 的 `detail`,任何非 JSON body(proxy 的 502 HTML 頁)一律忽略內容,
  改用依狀態碼的乾淨訊息(502/503/504→「伺服器忙線或處理逾時」、413→檔案過大、429→過於頻繁、
  其餘 5xx/4xx 通用)。原始 HTML 不再外露。`npm run build` 綠燈,產物已進 `webapp/static/`。
- **重要提醒:** 後端與前端產物都需 **push 觸發 Render 重新部署**後才生效;目前線上版仍是舊行為。

---

## 2026-06-03 — 教材「已抽取概念」與首頁「學習動態摘要」殘留前次資料 ✅

- **症狀:** 尚未上傳任何檔案(未選擇檔案)時,教材頁的「已抽取概念」就已列出 16 個
  線性代數概念(Linear Combination、Span…),首頁/側欄的「學習動態摘要」也顯示
  「優先複習：…」卡片。學生會誤以為這是自己教材的結果,實際上是資料庫殘留的前次 ingest
  (或種子模板)。此外無資料時還會顯示兩則寫死的假洞察(`FALLBACK_INSIGHTS`,
  「預估保留率 +3.8%」等),同樣誤導。
- **根因:** 這些面板忠實顯示 `GET /api/concepts` 與 `GET /api/tonight` 回傳的 DB 內容;
  PostgreSQL 跨 session 保留舊概念,前端沒有「本次 session 是否真的上傳過」的概念,
  讀取失敗也被 `?? []` 吞掉,看起來只是「空的」而非「壞掉」。
- **決策:** 採**前端 session 閘門**(不刪資料,DB 內容保留)。
- **修法(前端):**
  - `App.tsx` 新增 `sessionUploaded` 狀態,成功 ingest(`SetupPanel` 的 `onIngested`)後才設 true;
    重新整理頁面(= 重新「登入」)即歸零。
  - `concepts` 與 `insights` 都以 `sessionUploaded` 閘門:上傳前一律空。
  - 移除誤導性的 `FALLBACK_INSIGHTS` 假資料。
  - 讀取失敗改為**明確紅色報錯**:`useConcepts` / `useTonightDashboard` 的 `isError`
    傳入 `ConceptSection` 與 `InsightFeed`,顯示「無法讀取…請確認後端連線」而非偽裝成空。
  - 空狀態文案:「尚未上傳教材。匯入講義後,這裡會顯示自動抽取的概念。」
- **驗證:** `npm run build` 綠燈,產物已寫入 `webapp/static/`。

---

## 2026-06-03 — OCR / Gemini 整合的三個 Bug + 原生 PDF 辨識

### 背景與決策:要重寫整個專案嗎?

專案前期有不少程式碼由 Gemini 產生,後期遇到 bug 時感覺「難修」,一度考慮整個重寫。
經實際評估後決定**不重寫,改為逐個修復**,理由:

- 程式總規模約 **6,200 行**(後端 ~2,900、前端 ~3,300),不算大。
- 模組切分乾淨、單一職責明確(`pipeline` 編排、`gemini_client` 管 LLM、`database` 管 SQL),
  有型別註記、logging、docstring,耦合度低。
- 三個已知 bug 其實是**同一條因果鏈**,集中在 OCR / Gemini 整合,根因已被定位。

**結論:** 重寫 6000 行需 2–3 週且風險高;三個 bug 半天到一天可解。選擇修復。

---

### Bug 1 — OCR 失敗時靜默套用模板,偽裝成成功 ✅

- **症狀:** 上傳「線性代數第七章 內積空間」手寫 PDF,文字 < 40 字、OCR 又抽不到內容時,
  `pipeline.ingest_material` 會安靜地把線性代數種子模板的 16 個概念(Vector Space、Span…)當成結果,
  前端顯示「建立完成」。學生以為筆記被處理了,其實沒有。
- **根因:** `low_text_mode and used_seed_template` 分支直接套模板,且回傳結果與正常成功無區別。
- **修法:** 該分支新增 `ocr_failed: true` + 中文 `ocr_message` + `llm_last_error`;
  前端 `SetupPanel.tsx` 顯示**紅色**警告(與既有 amber 的 `llm_degraded` 區隔),
  成功狀態文字在失敗時轉為中性,不再偽裝成「建立完成」。
- **commit:** `cc1f626`

### Bug 2 — Gemini 錯誤處理對不上新版 `google-genai` SDK ✅

- **症狀:** 真正的 Gemini 失敗(無效金鑰、配額、壞模型)沒被攔截,變成 HTTP 500。
- **根因:** `_API_ERRORS` 只用舊 SDK 的 `google.api_core.exceptions` 建構,
  新版 SDK 丟的是 `google.genai.errors.APIError`(`ClientError`/`ServerError` 的基底),
  沒被 `except _API_ERRORS` 接住,撞到 `except Exception: raise`。
- **修法:** `gemini_client.py` 防禦性 import `google.genai.errors`,
  把 `APIError` 併入 `_API_ERRORS`;舊型別保留作向後相容。
- **驗證:** 用假金鑰實測,401 被乾淨攔截、記下原因、`extract_concepts` 回 `[]` 而非拋例外。
- **commit:** `cc1f626`

### Bug 3 — Render 上手寫 PDF 一直跑出模板概念(最具報告價值的除錯歷程)✅

這是今天最有價值的一段 debug,過程一波三折,最終靠**逐步逼近**找到真因。

**初始假設(後來證實只對一半):** 懷疑 `requirements.txt` 把 `google-genai` 釘在 `>=0.3.0` 太舊,
不支援新格式金鑰。→ 先升到 `>=1.20.0`(commit `cc1f626`)。

**關鍵診斷:用 curl 直接打 API,觀察錯誤理由的變化**

| 傳遞方式 | 回應 | 推論 |
|---|---|---|
| `?key=`(query param) | `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` | 金鑰未被當成 API key 接受 |
| `x-goog-api-key` header(SDK 用的) | `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` | 同上 |
| `Authorization: Bearer` | `401 **API_KEY_SERVICE_BLOCKED**` | 金鑰被認得,但被擋在服務外 |

**轉折:** 原以為 `AQ.` 開頭 = 無效格式。上網查證後**推翻自己的假設**——
Google AI Studio 從 2026 年 4 月起確實會發 `AQ.` 新格式金鑰,且 Google 官方論壇承認
`AQ.` 金鑰有已知相容性問題,官方暫解是「重新產生一把非 AQ. 金鑰」。

**真正根因(確認):** Render 上那把金鑰所屬的 GCP 專案**沒有啟用 Generative Language API**
(`API_KEY_SERVICE_BLOCKED`)。不是 SDK 版本問題,也不單是格式問題。

**修法(GCP / Render 端,非程式):**
1. 在 GCP 專案 `my-project-avocado-498303` 啟用 **Generative Language API**(免費額度免綁帳單)。
2. 在 AI Studio 重新產生金鑰。
3. **驗證方式很重要**:不要只用 curl `?key=`(對 AQ. 金鑰有假陰性),要用 app 真正的方式——
   `google-genai` SDK——測試。實測新金鑰用 SDK `client.models.list()` 成功列出模型。
4. 把金鑰貼回 Render `GEMINI_API_KEY`,設 `GEMINI_MODEL=gemini-2.5-flash`,重新部署。

**教訓:**
- **錯誤理由(reason code)比錯誤碼(status code)資訊量大**:同樣 401,
  `ACCESS_TOKEN_TYPE_UNSUPPORTED` 與 `API_KEY_SERVICE_BLOCKED` 指向完全不同的問題。
- **用「應用程式真正的呼叫方式」驗證**,而非旁路工具(curl `?key=` 與 SDK 的行為不同)。
- **隨時準備推翻自己的假設**:`AQ.=無效` 的直覺是錯的,查證後才看清。
- Bug 1/2 的修復雖非 Bug 3 的根因,但**價值在於讓失敗可見**——金鑰修好前,
  系統不再「靜默套模板假裝成功」,而是明確報錯。
- **commit:** `e7a2d3d`、`7630757`(紀錄根因與解法)

---

### 功能 — 原生 PDF 直送 Gemini(取代逐頁圖片)✅

修好金鑰後,實測 28 頁手寫 PDF 又撞到新問題:**`MAX_OCR_PAGES=12` 把檔案擋下**,
連 OCR 都還沒開始。深入後發現是**架構問題**。

- **原設計:** 把 PDF 每一頁轉成 PNG、逐頁丟給 Gemini → 所以才需要頁數上限,28 頁 = 28 次呼叫。
- **查證發現:** Gemini 支援**原生 PDF 輸入**(單請求最多分析 1000 頁,inline < 20MB),
  整份 PDF 一次送即可,根本不需逐頁。
- **修法(方案 B):**
  - 新增 `GeminiClient.transcribe_pdf()`:整份 PDF 以 `application/pdf` 一次送 Gemini。
  - 改 `pdf_parser._extract_pdf_material`:Chandra(若有,逐頁、仍受頁數上限)→
    否則 Gemini 原生 PDF(**無頁數上限**)。
  - `MAX_OCR_PAGES` 現在只管 Chandra 圖片路徑。
- **驗證:**
  - 28 頁 PDF + Gemini → 走原生 PDF、繞過上限 ✅
  - 只有 Chandra、超頁、無 Gemini → 仍正確擋下 ✅
  - **真實 Gemini API**:多頁 PDF 一次送、內容正確轉回 ✅
- **取捨:** 28 頁手寫從 28 次呼叫變成 1 次,大幅降低 Render 逾時風險;
  手寫辨識品質仍受 Gemini 限制(官方文件指出手寫準確度會下降),
  若日後需要更高品質可考慮 Mathpix(數學手寫)或 Chandra(需 GPU/vLLM,Render 免費方案跑不動)。
- **commit:** `141a6bd`

---

### 本日環境 / 部署備註

- **Chandra OCR** 在 Render 免費方案上**必然失敗**(`CHANDRA_METHOD=vllm` 指向 `localhost:8000`,
  無 vLLM server)——這是預期行為,Gemini 後備才是 Render 上實際運作的路徑。
- **Render 免費方案**:閒置 15 分鐘會 spin down,下次請求約 1 分鐘冷啟動;長請求有逾時風險。
- 前端產物需本地 `npm run build` 後提交到 `webapp/static/`(Render 無 Node build step)。

---

## 2026-06-03 — Bug 4:壞測試使用已移除的 `database_path` 欄位 ✅

- **症狀:** `tests/test_unit.py::test_scanned_pdf_uses_configurable_ocr_page_limit`
  以 `Settings(database_path=...)` 建構,SQLite→PostgreSQL 遷移後此欄位已改名,
  直接 `TypeError: unexpected keyword argument 'database_path'`,連測試本體都進不去。
- **根因:** 遷移時 `Settings.database_path` 改成 `database_url`,但這支舊測試沒同步更新。
- **修法:** 把該欄位改為 `database_url=_TEST_DB_URL`(與檔內其他 fixture 一致)。
- **驗證:**
  - `TypeError` 已消失;現在只在無本機 PostgreSQL 時因 `AdaptLearnService.__init__`
    連線失敗而中止(DEVLOG 既有備註:多數單元測試需真實 `DATABASE_URL`)。
  - 為了在無 DB 環境確認斷言仍成立(141a6bd 原生 PDF 改動後),直接呼叫
    `pdf_parser.extract_material_text`(繞過 service/DB):2 頁 PDF + 缺 `transcribe_pdf`
    的 fake Gemini → 仍正確擋下並報「超過目前 OCR 上限 1 頁」,`"上限 1 頁"` 斷言為真 ✅。
  - 關鍵點:`_FakeVisionGemini` 沒有 `transcribe_pdf`,故 `gemini_pdf_ok=False`,
    原生 PDF 旁路不啟動,頁數上限照常生效——測試語意在原生 PDF 改動後依然有效。
- **補強測試(新增 `TestNativePdfTranscription`):** 原本只覆蓋「沒有原生 PDF 能力 → 擋下」這一半,
  現補上「**有 `transcribe_pdf` → 28 頁也放行**」的回歸測試,鎖住 141a6bd 的旁路行為:
  - `test_native_pdf_bypasses_page_limit`:fake 提供 `transcribe_pdf`,28 頁 + 上限 1 頁,
    斷言不報錯、`ocr_used=True`、`source_type=="pdf-ocr"`。
  - `test_page_limit_still_blocks_without_native_pdf`:fake 缺 `transcribe_pdf`,2 頁 + 上限 1 頁 → 仍擋下。
  - 兩支都在 `pdf_parser` 層直接呼叫 `extract_material_text`,**不需 PostgreSQL**,本機即可跑綠 ✅。

---

## 2026-06-09 — 大 PDF 502 修復（async ingest，分支 feat/async-ingest）

- **回報：** 朋友試用上傳 50 頁老師講義 → Render 502。
- **診斷：** 502 是 Render 閘道對「單一請求處理太久」主動切線，非程式報錯。`/api/material/ingest` 是同步長請求，前端要掛著等整份處理完；free tier 冷啟動（休眠後 ~50s）疊加處理時間 → 超過閘道上限。先前 `run_in_threadpool` 只讓 health check 不被卡，沒讓請求本身變快。
- **隱藏缺陷：** 文字型 PDF 走 `build_knowledge_graph → extract_concepts`，後者 `text[:18000]`（約前 6 頁）→ 50 頁講義其實只分析了開頭，知識圖譜漏掉大半（主場景剛好是上課講義）。
- **決策：** 走方案 A（背景任務 + 前端輪詢，根本消滅 502），順手修分塊涵蓋整份，並加檔案大小守門（OOM 風險）。文字型確認 → 主因是逾時/冷啟動而非 OCR。
- 實作見 plan.md「進行中」段。

---

## 待辦(clear 後再處理)
- [ ] **async ingest 正式站端對端驗收**(feat/async-ingest 已併 main，205baa8):Render redeploy 後，親自上正式站傳一份 50 頁講義，確認(1)不再 502、(2)輪詢進度有跑、(3)知識圖譜涵蓋整份而非前 6 頁。本機只做了單元驗證，冷啟動 + 背景任務這條路需真實 Render 環境確認。
- [ ] **安全**:debug 過程中金鑰曾在對話明文出現,建議事後更換或對金鑰加上 API 限制。
- [ ] **最終 end-to-end 驗證**:Render 換上新金鑰 + 設 `GEMINI_MODEL` + 重新部署後,
      重新上傳手寫 PDF 確認跑出真實概念。
- [ ] **UI/UX 重設計**:待匯入流程穩定後再做(優先序最低)。
