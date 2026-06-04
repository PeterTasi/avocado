# AdaptLearn — 任務計畫

> **這份文件是給下一個 session 用的執行計畫。**
> 更新於 2026-06-04。
>
> 設計總規範在 `CLAUDE.md`「UI/UX Redesign」章節，先讀那段。

---

# ✅ 已完成批次（不要重做）

## 第一批：全站亮色主題遷移
- SetupPanel、QuizPanel、StudyPanels + MasteryTable、KnowledgeGraphPanel + MindMapCanvas + ClassHeatmapPanel 全部改亮色，legacy-surface 全移除。

## 第二批：登入頁 + 像素酪梨 logo + Emil 基礎動效
- `LandingScreen.tsx`（全螢幕極簡入口，stagger 入場 + 快速離場）
- `PixelAvocadoLogo.tsx`（AI 暫時版，使用者將自製最終版）
- `index.css` easing token、`scale(0.97)` 按壓、`prefers-reduced-motion`
- App.tsx `showLanding` gate、頂欄換酪梨 logo、stat-card stagger 入場

## 第三批：LaTeX / 跨 Session / Emil 動效升級 / 繁中詳解
- `MathRenderer.tsx`（KaTeX，`$...$` / `\(...\)`）→ 套用至 QuizPanel 題目、feedback、參考答案
- 跨 Session 確認 modal（`sessionUploaded` prop，未上傳時彈 modal）
- 題目卡 `.question-enter`、評分結果 `.grade-enter` / `.correct` 彈跳、答對粒子 8 顆多色分散、`.pill:hover` pixel-flash
- `gemini_client.py` grading + question generation prompt 全改繁體中文，`$...$` 數學式指示

---

# 🟡 剩餘待辦

## 待辦 0：UI 像素圖示全站替換 ✅ (2026-06-04)

**說明：** 所有 Lucide 主題圖示（LayoutDashboard / Activity / Sparkles / CalendarClock / Network / BookOpen / TrendingUp）已換成自製像素 SVG 圖示。
新元件：`src/components/PixelIcons.tsx`（PixelHome / PixelUpload / PixelStar / PixelCalendar / PixelGraph / PixelBook / PixelChart）。
保留 lucide：ArrowRight / ChevronLeft / ChevronRight / UserCircle2（純 UI 導覽用途）。

Logo 部分：`PixelAvocadoLogo.tsx` 已改用 `<img>` 載入 `src/assets/bibilavocado.png`（使用者自製去背版）。

---

## 待辦 1：像素酪梨 Logo — 已更新為比比拉布角色版 ✅ (2026-06-04)

**說明：** `PixelAvocadoLogo.tsx` 已從舊抽象酪梨更新為像素酪梨貓（比比拉布）。
品牌名稱全站已從 "AdaptLearn" 改為 "avocado"（頂欄 + 登入頁 + document.title）。

若使用者想再調整像素圖稿，直接改 `PixelAvocadoLogo.tsx` 元件，全站自動生效。
**格式需求（保持相容）：**
- export 名稱維持 `PixelAvocadoLogo`
- props：`size?: number`（預設 32）、`className?`、`withPulse?: boolean`
- 頂欄用 `size={30}`，登入頁用 `size={104}`

---

## 待辦 1b：圖譜觸控板縮放 Bug ✅ 已修 (2026-06-04)

**症狀：** Mac 觸控板雙指滑動觸發 wheel 事件 → `MindMapCanvas` 把它當縮放 → 飛速放大縮小。

**根因：** `onWheel` 沒區分「pinch」vs「一般捲動」；Mac 上雙指捲動 `ctrlKey=false`，
pinch 才是 `ctrlKey=true`。舊代碼不管哪種都縮放。

**修復（`MindMapCanvas.tsx`）：**
- `ctrlKey=true`（pinch）→ 縮放，factor 縮小為 1.04/0.96（原本 1.12/0.88 過快）
- `ctrlKey=false`（一般雙指捲動）→ 平移（pan）

---

## 待辦 2：Bug 5 跨 Session 概念殘留（後端根本解）

**現況：** 前端方案 A（確認 modal）已完成，使用者知道在使用舊教材出題。

**若之後要更根本的解法：**

- **方案 B（需 DB schema migration）：** 後端新增 `session_id` 欄位，每次 ingest 產生一個 session；`/api/diagnostics/generate` 只取最新 session 的 concepts。
  - 需改 `database.py`（schema + query）、`pipeline.py`（ingest 寫入 session_id）、`main.py`（quiz generation 過濾）
- **方案 C：** 前端提供「清除課程資料」按鈕，呼叫新後端 DELETE endpoint 清空 concepts/questions。

**目前方案 A 已足夠競賽使用，方案 B/C 為選配。**

---

## ✅ Bug 8：複習頁假通過率（2026-06-04 修）

**症狀：** 未上傳任何教材/未作答，複習頁「今晚衝刺計畫」仍顯示 63.4% / +30% / 93.4%。

**根因：** `pipeline._estimate_pass_probability` 無 attempts 時回傳固定 `0.55` baseline，再加上 seed concepts 產生的 uplift（每 item +6.5%，5 items = +30%），導致全是假數字。

**修復：**
- `pipeline.py`：計算 `has_data = bool(attempts)`；無資料時 before/uplift/after 全為 0，回傳 `"has_data": False`。
- `useApi.ts`：`TonightDashboard` 加 `has_data?: boolean`。
- `StudyPanels.tsx`：`hasData` 為 false 時顯示「尚無作答記錄」提示，不顯示數字。

---

## 待辦 3：Bug 7 — 班級熱力圖課程 tab 重複（2026-06-04 發現）

**症狀：** `ClassHeatmapPanel` 的課程篩選 tab 出現同名課程多次（截圖見 2026-06-04 session）：
Linear Algebra × 3、通用課程 × 2、General Course 單獨出現。

**可能根因（待調查）：**
1. 前端取得課程列表的 API 回傳了重複課程（`/api/courses` 或 `useHeatmap` hook 沒去重）。
2. 後端 `courses` 表有重複 row（同名課程被多次 insert）。
3. 前端 tab 渲染時沒做 `Array.from(new Set(...))`。

**調查順序：** 先看 `ClassHeatmapPanel.tsx` 拿 courses 的邏輯 → 再看 `useApi.ts` hook → 最後查 DB。

**修復目標：** tab 列表去重（以 `course_id` 為 key，不用名稱），不影響熱力圖資料本身。

---

# 🔵 架構改善建議（2026-06-04 Opus 評估）

> 評估範圍：`main.py`、`pipeline.py`、`database.py`、`config.py`。
> 依「競賽 CP 值」排序：**P1–P2 改了同時解 bug + 解鎖已規劃功能，最值得做**；
> P3–P4 是正確性/效能；P5–P6 是長期健康度，競賽期可延後。
> 每項都標了 證據 / 影響 / 建議 / 影響範圍。實作前切回 Sonnet。

---

## P1 ⭐ 全域 `reset_learning_state` 摧毀所有歷史 — 架構級根因

- **證據：** `pipeline.py:146` 每次 `ingest_material` 都呼叫
  `self.repo.reset_learning_state(include_attempts=True)`，
  `database.py:147` 直接 `DELETE FROM concepts / edges / questions / review_plan / attempts`。
- **問題：** schema 明明有 `course_id`（`concepts.course_id`、`courses` 表），
  但寫入路徑每次上傳就清空整個 DB。資料模型支援多課程，寫入邏輯卻是「單課程覆蓋」。
- **影響（三個一起爆）：**
  1. **Bug 5 跨 Session 殘留的真正根因** — 前端方案 A（modal）只是貼 OK 繃。
  2. **多課程不可能** — 上傳第二份教材直接洗掉第一份，`/api/courses` 列表與實際概念對不上。
  3. **封死已規劃 Feature 2（學習進度追蹤）** — attempts 每次上傳被刪，沒有縱向歷史可追。
- **建議（= Bug 5 方案 B 的正解）：**
  - 移除 ingest 路徑的全域 wipe。改為查詢全部用 `course_id` 範圍化。
  - 「目前作用中的課程」用最新 `uploaded_at` 的 course 決定（或前端傳 `active_course_id`）。
  - `generate_diagnostics` / `list_concepts` / mastery / review 都加 `WHERE course_id = ?`。
  - attempts 保留歷史（見 P2）。
- **影響範圍：** `database.py`（查詢加 course 過濾 + 移除 wipe）、`pipeline.py:146` 與下游聚合、
  `main.py`（concepts/mastery/diagnostics 等端點傳 course_id）。需 schema migration（見 P5）。
- **風險：** 中。動到核心讀寫，需回歸測試。但這是整個系統最高槓桿的修正。

### ✅ P1 解法設計（細）

> **⚠️ 先決發現：** `_concept_id = uuid5(chapter + name)`（`knowledge_graph.py:480`）**沒有 course 維度**。
> 目前靠「每次全清」才沒撞 ID。一旦停止 wipe，A 課程與 B 課程的同名同章概念會撞同一個 PK
> → upsert 互相覆蓋，且 A 的 attempts/questions 會錯接到 B 的概念。**所以 ID 必須先 course-scope。**

**Step 1 — 概念 ID 加入 course 維度（不可省）**
- `knowledge_graph._concept_id(name, chapter, course_id)`：`raw = f"{course_id}:{chapter}:{name}"`。
- `build_knowledge_graph(...)` 多收一個 `course_id` 參數，往下傳給 `_concept_id`（含 line 206/241/266/289 的邊解析，全用同一個 course_id 才一致）。
- `pipeline.ingest_material`：把 `course_id` 的計算**移到 `build_knowledge_graph` 之前**
  （它只依賴 `course_name + file_name`，現在在 `:131` 才算，提前即可），再傳進去。
- seed template 概念（`domain_templates`）合併後也要重算 ID 帶 course_id（`_merge_concept_sets` 後補）。

**Step 2 — 用「逐課程 reset」取代「全域 wipe」**
- 移除 `pipeline.py:146` 的 `reset_learning_state(include_attempts=True)`。
- `database.py` 新增 `reset_course_state(course_id)`：只刪該 course 的
  `concepts`（`WHERE course_id=?`）、其衍生 `concept_edges`、`questions`、該 course 的 `review_plan`。
  **不刪 attempts**（保留歷史，給 P2）。
- 因 ID 是 deterministic，重傳同一檔案 → 同 course_id → 同概念 ID，attempts 仍正確掛回。
- `concept_edges` 目前無 `course_id` 欄 → migration 加上（見 P5），或先用
  `DELETE FROM concept_edges WHERE source_id IN (SELECT id FROM concepts WHERE course_id=?)`（在刪 concepts 之前執行）。

**Step 3 — 讀取路徑全部 course-scope**
- `database.list_concepts(course_id=None)`、`list_edges(course_id=None)` 加可選過濾。
- 「作用中課程」決策：`database.get_active_course_id()` = `uploaded_at` 最新的 course。
  Phase 1 後端自動取最新（前端零改動，直接解掉 Bug 5）；
  Phase 2 再讓 `main.py` 各端點吃可選 `course_id` query param，前端做課程切換下拉。
- 下游同步 scope：`generate_diagnostics`、`get_concept_mastery`、`get_chapter_mastery`、
  `get_tonight_*`、`get_graphviz`、`build_and_save_review_plan` 都改用「作用中課程的 concepts」。
- `review_plan` 也加 `course_id`（migration），或視為「僅作用中課程」的快取，rebuild 時帶 course。

**Step 4 — 回歸測試**
- 兩課程連續上傳 → 各自概念都在、互不覆蓋；`/api/courses` 與概念數一致。
- 同檔案重傳 → 概念不重複、attempts 歷史保留。
- 跨課程連結（`cross_course_edges`）此時才第一次真的有兩個 course 可連 → 順便驗證它能動。

**前端配合（Phase 1 可不動）：** 解掉根因後，Bug 5 的確認 modal（方案 A）可保留為 UX 提示或移除。

### 拆解小工單（P1）✅ 已完成 (2026-06-04)

- [x] migration：schema_version 表 + `_run_migrations()` (P5)；`concept_edges.course_id` 用 subquery 取代
- [x] `knowledge_graph._concept_id` + `build_knowledge_graph` 加 `course_id`
- [x] `pipeline.ingest_material` course_id 提前計算並傳入；移除全域 wipe，改 `reset_course_state`
- [x] `database`：`reset_course_state(course_id)`、`get_active_course_id()`（in-memory+DB）、`list_concepts/list_edges` 加過濾
- [x] pipeline 下游聚合（mastery/diagnostics/review/graph）全部 scope 到作用中課程
- [x] 回歸測試：40/41 通過（1 pre-existing 失敗）

## P2 ⭐ 時間欄位全是 TEXT + 攻擊歷史被刪 → 進度追蹤無法做

- **證據：** `database.py` 所有 `created_at / uploaded_at / next_review_at` 都是 `TEXT`
  （存 `datetime.now().isoformat()`，naive 本地時間，無時區）。
- **問題：** 排序靠 ISO 字串字典序「剛好」能用，但無法在 SQL 做日期區間運算
  （「過去 7 天正確率趨勢」做不到）；server 上 `datetime.now()` 是 naive 時間。
- **建議：** 欄位改 `TIMESTAMPTZ`，寫入用 `datetime.now(timezone.utc)`。
  搭配 P1 保留 attempts 後，新增 `GET /api/progress/concepts`：
  以 `date_trunc('day', created_at)` 分組回傳每概念每日 avg_score 趨勢（improving/declining/plateaued）。
- **影響範圍：** `database.py`（欄位型別 + 寫入）、`models.py`、新增 `pipeline` 方法 + `main.py` 端點。
- **風險：** 低–中。是 Feature 2 的地基，做完直接多一個競賽亮點頁面。

### ✅ P2 解法設計（細）

**Step 1 — 欄位 TEXT → TIMESTAMPTZ（migration）**
- 對 `attempts.created_at`、`questions.created_at`、`courses.uploaded_at`、
  `review_plan.next_review_at`、`class_node_stats.updated_at` 執行：
  `ALTER TABLE x ALTER COLUMN col TYPE timestamptz USING col::timestamptz;`
- 既有資料是 ISO 字串，`::timestamptz` 可直接轉。
  ⚠️ 舊資料是 naive 本地時間，轉換時會被當成 server 時區 → 記錄此一次性誤差，可接受。

**Step 2 — 寫入改 timezone-aware UTC**
- 所有 `datetime.now()` → `datetime.now(timezone.utc)`（`pipeline.py`、`database.py`）。
- psycopg2 會自動把 aware datetime 轉成 timestamptz，**不要再 `.isoformat()` 後存字串**。

**Step 3 — 讀取改用原生 datetime（重要陷阱）**
- timestamptz 欄位 `RealDictCursor` 回傳的是 `datetime` 物件，**不是字串**。
- 把所有 `datetime.fromisoformat(row["..."])` 改成直接 `row["..."]`
  （`list_attempts`、`list_courses`、`get_course`、`list_review_plan`、`list_class_node_stats`）。
  這步漏改會 runtime crash，務必全掃。

**Step 4 — 新增進度趨勢 API**
- `database.concept_progress(course_id, days)`：
  ```sql
  SELECT concept_id,
         date_trunc('day', created_at) AS day,
         AVG(score) AS avg_score,
         COUNT(*)   AS n
  FROM attempts
  WHERE created_at >= now() - (%s || ' days')::interval
    AND concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
  GROUP BY concept_id, day
  ORDER BY concept_id, day;
  ```
- `pipeline.get_concept_progress(days=30)`：把每概念的每日序列組起來，並判趨勢：
  比較前半段平均 vs 後半段平均，差 > +0.05 → `improving`、< −0.05 → `declining`、否則 `plateaued`。
- `main.py`：`GET /api/progress/concepts?days=30`（`@cached`，scope 作用中課程；依賴 P1 的 course-scope）。

**Step 5 — 前端進度頁（競賽亮點，Phase 2 可選）**
- `ProgressPanel.tsx`：用 Recharts（已在技術棧）畫每概念 avg_score 折線 + 趨勢徽章
  （↑improving 綠 / ↓declining 紅 / →plateaued 灰）。掛到 review 或新分頁。

### 拆解小工單（P2）✅ 後端已完成 (2026-06-04)

- [x] migration：5 個時間欄位轉 TIMESTAMPTZ（Migration 001）
- [x] 寫入全改 `datetime.now(timezone.utc)`，移除存字串
- [x] 讀取移除所有 `datetime.fromisoformat(row[...])`（5 處）
- [x] `database.concept_progress` + `pipeline.get_concept_progress` + `/api/progress/concepts`
- [ ] （選配）`ProgressPanel.tsx` Recharts 趨勢圖

> **P1/P2 依賴關係：** P2 的 Step 4 progress API 需要 P1 的 course-scope 才有意義
> （否則跨課程 attempts 混在一起）。順序仍是 **P5 → P1 → P2**。

## P3 服務單例的併發競態 — `_service_lock` 宣告了卻沒用

- **證據：** `main.py:46` 宣告 `_service_lock = asyncio.Lock()`，註解寫「Fix #2」，
  但 `_get_service`（`main.py:144`）切換 API key、重建 service 時**從未 acquire 這個 lock**。
- **問題：** 兩個請求同時帶不同 key 進來，會同時 `AdaptLearnService(...)` 重建
  → 兩個 DB pool、兩個 Chroma client，舊的可能在被其他請求使用時就 `close()`。
- **額外成本：** 每次換 key 都重建整個 service（新 DB pool + 重開 Chroma），過重。
- **建議：** 把 GeminiClient 的 key 切換做成「只換 client，不重建整個 service」；
  或真的用 lock 包住重建。競賽單人 demo 風險低，但這是貨真價實的 bug，值得順手修。
- **影響範圍：** `main.py:144-158`、`pipeline.py:__init__`（讓 key 可熱替換）。
- **風險：** 低。

## P4 掌握度聚合在 Python 端做，每次拉 5000 筆 attempts

- **證據：** `pipeline.py` `get_concept_mastery` / `get_chapter_mastery` / `get_tonight_*`
  各自 `list_attempts(limit=5000)` 後在 Python 用 `defaultdict` 聚合。
- **問題：** 重複把全部 attempts 載進記憶體做平均，該用 SQL `GROUP BY concept_id` 算。
  TTLCache 擋了一部分，但 cache miss 時三個端點各跑一次全量聚合。
- **建議：** `database.py` 加 `concept_score_summary()`（`GROUP BY` 回傳 avg_score、count），
  pipeline 改用它；mastery band 仍在 Python 判。
- **影響範圍：** `database.py`（新 query）、`pipeline.py`（三處改用）。
- **風險：** 低。純效能/整潔，行為不變。

## P5 沒有 migration 機制 — schema 演進靠 ad-hoc `information_schema` 檢查

- **證據：** `database.py:140` 只有一段手寫的「加 course_id 欄位」檢查。
- **問題：** P1/P2 會再加 `session_id`、改 TIMESTAMPTZ、課程範圍欄位，繼續用手寫檢查會失控。
- **建議：** 引入輕量 migration（編號 SQL 檔 + `schema_version` 表，或 yoyo/alembic 擇一）。
  競賽期可先用「編號 SQL + version 表」最小方案，不引重依賴。
- **影響範圍：** `database.py` + 新 `migrations/`。
- **風險：** 低，但要先做才好做 P1/P2。

## P6 ChromaDB 持久化在 Render free tier 是暫存碟 → 重新部署就清空

- **證據：** `config.py:53` `chroma_path = data/chroma`（本地磁碟）；Render free 無持久碟。
- **問題：** 每次 redeploy，向量庫歸零 → 跨課程語意連結（`cross_course_edges`）失效，
  與 PostgreSQL 裡留存的 edges 不一致。
- **建議（擇一）：** (a) 跨課程連結改用 PG `pgvector` 取代 Chroma（單一資料源）；
  (b) 或接受「重啟後首次查詢重建」並在 ingest 時重算。競賽 demo 可只記錄此限制，不急著改。
- **影響範圍：** `vector_store.py`、`cross_course_linker.py`、`requirements.txt`。
- **風險：** 中。pgvector 要改依賴；競賽期建議只記錄，賽後再做。

---

## 建議實作順序（若要動架構）

1. **P5（migration 地基）→ P1（course 範圍化 + 停止 wipe）→ P2（時間欄位 + 進度 API）**
   這三個是一條線：解掉 Bug 5 根因、解鎖多課程、解鎖 Feature 2 進度追蹤，是最高槓桿的一包。
2. P3、P4 可獨立穿插，風險低。
3. P6 競賽期只記錄限制，賽後處理。

> ⚠️ 競賽取捨提醒：若 demo 只展示「單課程單人」流程，P1–P2 不是必須；
> 但只要想展示「多科目知識圖譜」或「進度成長曲線」，P1–P2 就是前置條件。

---

# 執行規則（延用）

- 每改完一個檔案 → `npm run build` 零錯誤
- 不新增 npm 套件（**例外：KaTeX 已加**）
- 完成後更新 `CLAUDE.md` 進度追蹤 + `DEVLOG.md`
