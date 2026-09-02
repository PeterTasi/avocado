# AdaptLearn 開發與除錯紀錄(DevLog)

> 本檔記錄專案的開發過程與除錯歷程,供日後製作海報與報告使用。
> 條目由新到舊,每段標註日期、症狀、根因、修法、驗證。

---

## 2026-08-18 — Demo 資料重建 + Gemini 503 重試 ✅（commit `20eba47`）

### 起因：講稿與 demo 資料對不上

審視四分鐘講稿時查了實際資料庫，發現講稿的兩個高潮橋段**都跑不出來**：

| 講稿寫的 | 資料庫實際狀況 |
|---|---|
| 點「正交投影」→ 掌握度 67% → 追到「正交性」0% | 沒有任何叫「正交性」的概念；`attempts = 0` 所以不可能有 67% |
| 「奇異值分解，是矩陣對角化的推廣」 | 沒有這組配對；「矩陣對角化」概念不存在 |

另外兩門主題生成課程（線性代數的正交性、機率的貝氏定理）概念數都是 0，只剩課程殼。
`demo_snapshots/demo.sql` 的 attempts 段是空的——這份快照從來就沒有作答紀錄。

### 重建（全程真實管線，沒有手動塞資料）

依 待辦 K 的原則：「事先跑真實管線、保存真實結果 = 正當；手寫假概念塞 DB = 不行」。

1. 重新 ingest 兩門主題課程 → 線代正交性 13 概念／17 邊、貝氏定理 11 概念
2. 產生測驗，**只回答「正交基底」三題**（讓先修概念維持未測驗＝0%）：
   兩題答對、一題故意用典型誤區（把「正規化」當成「正交化」）→
   Gemini 真實批改後平均 **0.667**，剛好就是講稿原本寫的 67%
3. 用 API 刪掉 11 門測試殘留課程（`clear_course` 會一併清 PG／課程／向量庫）
4. 存新快照

**結果比原講稿的設計更強：** 這門課的先修鏈是
`內積 → 正交向量 → 正交集合 → 正交基底`，卡關歸因會一路追**三層**回到最基礎的
「內積」，藍色鏈路橫跨整棵技能樹——比原本「正交投影 → 正交性」的單跳有力得多。

**最終狀態：** 4 門課、63 概念、44 條跨課程連結、12 題、3 筆作答；
ChromaDB 63 = PostgreSQL 63，**幽靈向量 0**（待辦 L1 的不變式成立）。

### 附帶挖到並修好：Gemini 503 會直接降級成英文模板題

重建過程中 Google 對**三個備援模型同時**回 503 UNAVAILABLE
（"This model is currently experiencing high demand"）。降級鏈只跑一輪就放棄，
出題靜默掉到英文模板題（`docs/fable5.1-review.md` #7 的症狀）——
在評審面前是最難看的失敗模式，而 Google 自己的錯誤訊息就寫著 *"usually temporary"*。

**修法：** 整條鏈跑完仍失敗且錯誤為暫時性 → 退避重試整條鏈（3 輪，2s/6s，
最壞多花約 8 秒）。用 SDK 例外型別精確判斷而非比對字串：`ServerError`（5xx）
與 429 算暫時性；400/401/403 不重試——金鑰無效重試再多次也一樣，只會拖慢降級。

**測試 8 條**（`tests/test_gemini_retry.py`）。施工時踩到一個坑：一開始用自製的
`Exception` 當假錯誤，結果走到「未知錯誤重新拋出」那條路，完全測不到重試邏輯——
改用真正的 `genai_errors.ServerError` / `ClientError` 才測得準。

### 講稿同步對齊（`docs/pitch-4min.md`）

卡關歸因改用真實三層鏈路；跨課程改引用真實連結（正交集合 ↔ 單範正交集 等價 87%、
特徵分解 ↔ 譜分解 一般化 82%）；移除 FSRS-5「現在最新」（FSRS-6 已存在，
是不必要的風險）；「真的有在理解教材」改成可辯護的說法；
備援劇本補上 503 應對（**上台不要按「產生測驗」**，題目已事先產好）。

---

## 2026-08-18 — 待辦 I／L2 規劃：兩個都比原記錄更嚴重 📐

Opus 規劃，尚未實作。完整步驟見 `plan.md` 待辦 I 與 L2。

### 待辦 I：根因是 `db_guard` 的判斷條件問了錯的問題

原記錄寫「小但煩：跑測試會灌進一批測試垃圾課程」。做 G 驗證時兩度親身觸發，
實際症狀是 `test_service_workflow.py` 的 `setUp()` 呼叫 `reset_learning_state()`，
**把 `concepts` 表整個清空**（120 → 0），不是灌垃圾。

追查後發現根因不在「conftest 沒設測試庫」，而在 `db_guard.require_safe_db()`
問錯了問題：它檢查的是「**是不是本機**」（`localhost` / `127.0.0.1` / `adaptlearn_test`）。
這道 guard 當初是為了擋 Render 正式庫而寫的，但 demo 資料庫本身就在本機，
所以它穩穩通過——**真正發生災情的地方正是它放行的那一側**。
正確的判斷條件是「**是不是可以隨便丟掉的測試庫**」。

方案兩層：conftest 把測試庫從 opt-in 改成預設（沒設 `TEST_DATABASE_URL` 就從
`DATABASE_URL` 推導出 `_test` 後綴的名字，並自動建立），db_guard 改成檢查
資料庫名稱是否為測試庫。第一層讓正確的事自動發生，第二層在第一層失效時擋下來。
順帶查到 `adaptlearn_test` 目前根本不存在，所以現在就算去設 `TEST_DATABASE_URL`
也只會連線失敗。

### 待辦 L2：偵測可以是精確比對，不需要啟發式門檻

原修法備註寫「把只包含課程名／頁標的回應視為空白，門檻要小心，別誤殺只有一行標題的頁」。
查完發現不需要任何門檻：**那兩個被回吐的字串是我們自己塞進 prompt 的**
（`Course context: {context}.` / `Page label: {label}.`），所以可以拿已知值做精確比對，
而不是猜「這看起來像不像標題」。

另外兩個原記錄沒提到的點：`_clean_transcription_text` 是拿不到 `context`／`label` 的
module-level 純函式，不是正確的下手處（該在 `transcribe_images` 迴圈內處理）；
OCR 特化模型（`glm-ocr` / `deepseek-ocr`）的 prompt 裡沒有注入這兩個值，
那條路徑出現課程名就是真的寫在紙上，檢查必須用 `is_specialized` 擋掉。

誤判方向不對稱：漏判只是 `pages_ok` 虛高一頁；誤判會讓 `pages_ok` 虛低，
可能誤觸 `_OCR_MIN_PAGE_RATIO = 0.6` 對使用者跳出不該跳的警告。判定要往保守側倒。

## 2026-08-18 — 待辦 I 實作完成：`pytest` 不再洗掉本機 demo 資料庫 ✅ FIXED（commit `f714897`）

**改動：** `conftest.py` 的 `DATABASE_URL` 覆寫從「只在設了 `TEST_DATABASE_URL` 時才做」
改成無條件執行——沒設就從現有 `DATABASE_URL`（shell env 或 `.env`）推導出 `<name>_test`；
都沒有就退回 `postgresql://localhost/adaptlearn_test`。測試庫不存在時用
`CREATE DATABASE` 自動建立（只認 `_test` 結尾的名字，多一層防呆避免誤建）。
`db_guard.require_safe_db()` 的判斷條件從「主機是不是 localhost」改成
「資料庫名稱是不是以 `_test` 結尾」。

**驗證：**
- 兩次跑 `pytest tests/`，demo DB 的 `concepts` 筆數維持 120 不變（先前會被洗成 0）
- `adaptlearn_test` 自動建立，92 passed（5 個既有失敗與此改動無關）
- 附帶驗證：`test_cross_course_detailed.py` 裡原本因 `DATABASE_URL` 不含
  `"adaptlearn_test"` 而被跳過的 `test_global_reset_clears_cross_course_edges`，
  現在正確執行且通過——這條測試本來就是同一個問題的局部修補，
  修好 `db_guard` 之後它終於能真的跑到
- 手動把 `DATABASE_URL` 指到 demo DB 直接呼叫 `require_safe_db()`，正確 `SkipTest`
  而非放行

**待辦 K 同步生效：** demo 快照的 `restore` 不再是「跑完測試的必要善後步驟」，
純粹回到它原本的定位——賽前準備已知良好狀態。

## 2026-08-18 — 待辦 L2 實作完成：空白頁不再被誤判成 OCR 成功 ✅ FIXED（commit `a533a74`）

**改動：** `ollama_client.py` 新增 `_is_prompt_echo(page_text, context, label)`：
扣掉注入 prompt 的 `context`（課程名）與 `label`（頁標）兩個已知字串，
再扣掉所有標點與空白（用 `unicodedata.category().startswith("P")` 判斷，
含全形標點），殘留為空就視為回吐。`transcribe_images` 迴圈內在
`_transcribe_one` 之後、`is_specialized` 為否時呼叫這個檢查，命中就設
`page_text = ""`、`last_error` 帶上原因，直接沿用既有的 `failed_pages` 分支
與 log，不新增額外的錯誤處理路徑。OCR 特化模型（`glm-ocr`／`deepseek-ocr`）
的 prompt 沒有注入這兩個值，用 `is_specialized` 擋掉，避免誤殺那條路徑上
真實寫在紙上的課程名。

**為什麼是精確比對而不是門檻：** 原本的修法備註擔心「誤殺只有一行標題的
頁」，但那兩個被回吐的字串是我們自己塞進去的已知值，不需要猜測「像不像
標題」——這比任何啟發式門檻都安全，也不會有假陽性。

**測試：** 新增 `PromptEchoTest`（純回吐視為空白頁、回吐+真實內容完整保留
不截斷、特化模型不受檢查影響）與 `IsPromptEchoUnitTest`（標點/空白清除的
直接單元測試），共 5 條，都放進既有的 `test_ocr_partial_failure.py`
（待辦 L 系列測試檔）。用回報 bug 的原始字串
（`線性代數 8-1~8-3（手寫）` / `PDF page 14`）額外做了一次 sanity check，
包含真實模型可能加的結尾句點。

**驗證：** `pytest tests/` 97 passed（5 個既有失敗與此改動無關）；demo DB
概念數維持 120 不變（待辦 I 生效）；`ruff`／`mypy` 乾淨。

---

## 2026-08-18 — 待辦 G 重新規劃：決定刪掉 `review_plan` 表 📐

**決策：** 待辦 G（`review_plan` 全域表）改採根因解——**刪表，複習計畫一律即時計算**，
而非原方案的「加 `course_id` 欄位 + migration」。完整實作步驟見 `plan.md` 待辦 G。

**為什麼推翻原方案（Opus 重新規劃，2026-08-18）：**

1. **原方案的前提是錯的。** 它寫「`review_plan` 需加 `course_id` 欄位」，但 `_concept_id()`
   已經把 `course_id` 算進 hash，概念 ID 可反查課程；而 `reset_course_state` 早就用
   `concept_id IN (SELECT id FROM concepts WHERE course_id=%s)` 對這張表做過課程限定。
   加欄位等於把推導得出的值反正規化，還多一個不同步的風險。
2. **原描述只涵蓋一半的 bug。** 寫入端全域 `DELETE` 是一半，讀取端 `list_review_plan()`
   同樣沒有課程過濾——那才是「chapter 顯示 Unknown」的真正來源。只修寫入端不會好。
3. **更根本的問題：這張表是沒有 key 的快取。** `build_review_plan()` 是
   (concepts, attempts, now) 的純函數，FSRS 狀態從 `attempts` 重播重建，沒有任何東西依賴
   這張表存活；`get_tonight_study_dashboard` 在表為空時**已經**會即時計算。
   而且 retrievability 隨時間衰減，**持久化的數字一放就過期**——快取本身在製造錯誤答案。

**評估過但沒選的中間方案：** 讀寫兩端都加 `course_id` 參數、用子查詢過濾（約 15 行、無 migration）。
它能修好 G，風險最低，**原本是我的建議——但那個建議建立在「比賽逼近、沒時間驗證複習頁」
的前提上**。確認距離比賽還有 20 幾天後前提不成立，改採刪表的根因解。

時程拉長反而讓刪表更划算：中間方案保留快取，而 retrievability 隨時間衰減，
**今天建好的複習計畫過幾天彩排打開就是錯的數字**——彩排次數越多、跨的天數越長咬得越兇。
刪表沒有快取就沒有這個問題，另外淨刪約 80 行，並讓待辦 L6 的 demo 地雷
（「多課程時不要按重算複習計畫」）自動作廢。兩案都能修掉 L6，這點不構成差異。

**已知取捨：** migration 003 會 `DROP TABLE review_plan`（不可逆，但內容是推導得出的快取、
目前 0 筆）；失敗面落在複習頁與今晚頁，改完必須實機點過，不能只跑測試。
前端零改動——`/api/review` 回傳結構不變。

## 2026-08-18 — 待辦 G 實作完成：刪掉 `review_plan` 表 ✅ FIXED（commit `da926a4`）

**改動：** `database.py` 移除 `review_plan` 的 `CREATE TABLE`、`save_review_plan`／
`list_review_plan`、兩處 `DELETE FROM review_plan`，新增 migration 003
`DROP TABLE IF EXISTS review_plan`。`pipeline.py` 把 `build_and_save_review_plan()` 和
`list_review_plan()` 合併成單一 `get_review_plan()`（純函數，不寫 DB）；
`get_tonight_study_dashboard` 拿掉「表為空才即時算」的 fallback，直接算。
`main.py` 的 `/api/review` 與 `/api/review/recalculate` 都改呼叫 `get_review_plan()`，
HTTP 層 `@cached`／`invalidate_cache` 不變，重算按鈕語意不變。前端零改動。

**測試：** 移除兩條測試已刪除持久化的舊測試（`test_save_and_list_review_plan` 及其
retention round-trip 版本）；`test_service_workflow.py` 新增
`test_review_plan_scoped_to_active_course`——兩門課切換 active course，驗證
`get_review_plan()` 只回傳當前課程的概念，互不污染。`pytest tests/` 91 passed
（5 個既有失敗與此改動無關，已用 `git stash` 對照乾淨樹確認）。

**實機驗證（瀏覽器 + curl）：**
- 複習頁「今晚衝刺計畫」章節正確顯示「8-1」，不再是 Unknown（L2 症狀同步消失）
- 課程「機器學習的主成分分析」重算複習計畫（15 項）後切回「線性代數 8-1~8-3（手寫）」，
  24 項複習計畫原封不動——這是修復前 G 會直接炸掉的場景
- 用 8/16 舊快照（`schema_version={1,2}`）驗證了 migration 003 的自癒行為：
  還原後啟動，migration 3 自動套用、清掉還原回來的舊表

**意外插曲：** 驗證過程中兩次不慎用 `pytest` 洗掉本機 demo 資料庫——
`test_service_workflow.py` 的 `setUp()` 呼叫 `reset_learning_state()`，而
`.env` 的 `DATABASE_URL` 指向本機真實 demo DB（非隔離測試庫），跑一次測試套件
就把 `concepts` 表清空。這正是**待辦 I** 記錄的已知症狀，與本次 G 的改動無關，
純粹是驗證流程踩到既有雷。兩次都用 `./scripts/demo_snapshot.sh restore demo` 復原，
最終 120 概念、四門課程資料完整。**待辦 I 目前仍未修**——只要有人在本機對著
真實 `DATABASE_URL` 跑 `pytest`，這個雷還會再踩到一次。

**待辦 L6 同步作廢：** 「多課程時不要按重算複習計畫」的 demo 操作提醒，
在沒有 `review_plan` 表可以被錯誤清空之後，不再是真的風險。

---

## 2026-08-18 — 空白抽屜 bug 第三個根因（前兩個已修，這個沒抓到）✅ FIXED

**症狀：** 8/17 那次修完（見下方 8/16 條目「兩個獨立 bug 疊在一起」）後，使用者回報教材頁還是會
出現同一塊空白面板（截圖：右側「目前狀態」欄位置疊著一片空白，帶 ✕ 與「Esc 關閉」）。

**追查（`systematic-debugging`，實機 DOM 量測）：** 在本機 `/setup` 用瀏覽器 JS 量測抽屜元素，
`openId` 其實是 `null`（抽屜邏輯上是「關閉」的），但 `.concept-drawer` 的 `visibility`／`opacity`／
`pointer-events` 全部維持預設可見可點，`z-index: 20`。關閉狀態只用
`transform: translateX(100%)` 把它推到 stage 右緣外 420px——而那塊區域沒有任何祖先設
`overflow: hidden`，右側「目前狀態」欄剛好在那個位置，於是「關閉」的抽屜整片畫在使用者眼前，
還吃掉那一整欄的點擊。8/17 修的兩條路徑都成立、也真的修對了，但兩者都只處理
「`openId` 指向不存在的概念」這條路徑；這次的成因是**抽屜本來就沒有 `openId` 時該有的「真正隱藏」**，
是第三個獨立成因，範圍更廣（只要視窗寬度讓 stage 右側有空間露出來就會發生，不需要切課程觸發）。

**修法：** `webapp/frontend/src/index.css` `.concept-drawer` 關閉狀態加
`visibility: hidden; pointer-events: none`，`.concept-stage.open .concept-drawer` 加回
`visibility: visible; pointer-events: auto`。`visibility` 走獨立的 `0s linear .55s` transition，
等滑出動畫跑完才真的隱藏；開啟時立刻可見，不影響原本的 spring 滑入動畫。

**驗證（瀏覽器實機）：** 關閉狀態量測 `visibility: hidden`／`pointer-events: none`，
右側「目前狀態」欄可正常點擊；開一張概念卡確認滑入動畫、酪梨蓋章、內容都正常；
按 Esc 關閉後畫面完全乾淨、無殘影，與使用者原始截圖同視窗尺寸（1280×800）下重現確認。

---

## 2026-08-16 — 主題生成技能樹（待辦 J）+ OCR 換 qwen3-vl + 待辦 F 規劃 🌱

### 待辦 J：沒有教材也能學 ✅ — commit `c3ae924`

**動機：** 整理講稿時發現，網站在「學生手上沒有教材」時完全無法運作。

**做法（刻意取巧）：** 讀 `ingest_material` 後發現 `extract_material_text` 對 `.txt` 是直接 decode、不碰 OCR。
所以主題模式不需要新管線——LLM 先生成 800–1500 字講義大綱，再以 `f"{topic}.txt"` 餵給既有的
`ingest_material`。概念抽取、course_id、DB、ChromaDB、跨課程橋、回傳格式全部沿用，**`ingest_material` 一行未動**。

**實機驗收：**
- 線性代數的正交性 → 1774 字、19 概念、24 邊、53 條跨課程連結。
  技能樹：`向量空間 → 子空間/內積 → 範數/線性獨立/點積 → 正交投影/正交集合 → 規範正交基底 → 正交矩陣`
- 機率的貝氏定理 → 11 概念。
  `條件機率/事前機率 → 乘法法則/概似度 → 全機率公式 → 邊際機率 → 貝氏定理 → 基本比率謬誤/檢察官謬誤`

**已知限制：** 主題模式完全依賴 Gemini generateContent 配額（沒教材就只能靠 LLM 生），錯誤訊息會明講是配額問題。

### Bug — 教材頁出現關不掉的空白抽屜 ✅ FIXED

**症狀（使用者回報，附截圖）：** 教材頁跑出一個空白面板，只有 ✕ 和「Esc 關閉」字樣，
按 Esc 沒反應。

**根因是兩個獨立的 bug 疊在一起：**

1. `ConceptSection` 的 `openConcept` 從 **`filtered`**（搜尋過濾後的清單）取，
   但抽屜的開闔由 `openId` 控制的 CSS class 決定：

   ```js
   const openConcept = filtered.find(c => c.id === openId) ?? null;  // filtered
   <div className={`concept-stage ${openId ? "open" : ""}`}>          // openId
   ```

   概念清單一換（切課程、重新 ingest、資料被清空），`openId` 就指向不存在的概念，
   抽屜於是「開著卻是空的」。

2. `ConceptDrawer` 的 Esc 監聽器寫著 `if (!concept) return;`——
   **正好在卡住的那個狀態下不註冊**，使用者只剩點 ✕ 或重整。

**修法（三處）：** `openConcept` 改從未過濾的 `concepts` 取；`openId` 指向不存在的概念時
自動清掉；Esc 監聽改成抽屜存在就註冊，不依賴 `concept` 是否解析成功。

**驗證：** 開啟抽屜 → 切換課程 → 抽屜自動關閉（不再卡住）；Esc 正常關閉。
附帶發現：搜尋框目前不在 UI 上（`App.tsx` 的 `setSearch` 是未使用的死碼），
所以「搜尋過濾造成孤兒」這條路徑目前觸發不到，但修法同樣涵蓋。

### 功能 — 點課程直接切回既有結果 ✅

先前只有 ingest 會設定 active course，所以早先上傳的課程**無法回去看**，只能重新上傳。
新增 `POST /api/courses/{id}/activate`，課程列表改成可點擊並標示「使用中」。

**關鍵細節：** `SetupPanel` 有 `sessionUploaded` 閘門（Bug 5 方案 A），沒在本次 session
上傳過就顯示「尚未上傳教材」。切換課程時必須一併打開這個閘門，否則概念切了也看不到。

**驗證：** 點「線性代數 8-1~8-3（手寫）」→ 閘門打開、24 張概念卡出現、標示「使用中」。

### Bug — 題目裡的 LaTeX 被 JSON 跳脫吃掉（待辦 L4）✅ FIXED

**症狀：** 產生的 6 題有 2 題長這樣：`設 $V$ 為複數內積空間，$T: V <TAB>o V$ 為線性算子`。
公式在畫面上破碎，是評審現場看得到的品質問題。

**根因：** LLM 產 JSON 時反斜線跳脫不一致——同一句裡 `\ker` 有寫成 `\\ker`，
`\to` 卻只寫一個反斜線。`json.loads` 把 `\t` 當成合法的 tab 跳脫，於是靜默地把
`\to` 變成 TAB+`o`。反過來 `\k` 不是合法跳脫，會直接丟 JSONDecodeError 被擋下——
**所以「壞掉的剛好是合法跳脫的那些」，才會無聲無息。**

實測對照：

| 原本 | 變成 | 可否確定還原 |
|---|---|---|
| `\to` `\times` `\theta` | TAB `0x09` | ✅ |
| `\frac` `\forall` | 換頁 `0x0c` | ✅ |
| `\begin` `\bar` | 退格 `0x08` | ✅ |
| `\rangle` | CR `0x0d` | ✅（後面非換行時）|
| `\neq` `\nabla` | 換行 `0x0a` | ❌ 與真換行無法區分 |
| `\ker` `\lambda` | JSONDecodeError | ✅ 本來就被擋下 |

**修法（兩層）：** prompt 層要求反斜線一律加倍（四個產 JSON 的 prompt 都加）；
解析層 `_repair_latex_escapes()` 遞迴還原那四種確定的控制字元。`\n` 刻意不修——
`\neq` 與合法換行相同，只能靠 prompt 擋，事後猜會誤傷答案裡的換行。

**施工時踩到自己的坑：** 插入 prompt 的那行寫在非 raw 的 f-string 裡，
`\to` 在 Python 原始碼層就先變成 TAB，等於送給模型一個壞掉的示範。已改成 `\\\\to`。

**驗證：** 重新產生 9 題，殘留控制字元 0，`$T: \mathbb{C}^2 \to \mathbb{C}^2$` 正常。

### 手寫講義完整驗收 ✅ — 換模型 + 修靜默失敗後重跑

同一份 14 頁手寫線代講義（8-1~8-3），修復前後：

| | 修復前（qwen3-vl） | 修復後（qwen2.5vl + 頁數統計） |
|---|---|---|
| 辨識頁數 | 未統計（實際 1/14） | 14／14 |
| 教材字數 | 285 | 6931 |
| 抽出概念 | 4 | 24 |
| 先備關係邊 | 3 | 30 |

抽出的 24 個概念與原稿逐項對得上，章節標題還自動抓到原稿的 8-1／8-2／8-3 分節：
伴隨算子、正規算子／矩陣、自伴／斜自伴算子、埃爾米特／斜埃爾米特、對稱／斜對稱、
么正／正交矩陣、保持內積與長度、旋轉矩陣、么正／正交相似、么正／正交對角化、譜分解、
二次式、正定／半正定算子與矩陣。技能樹先修順序正確
（`伴隨算子 → 正規算子 → 自伴/斜自伴 → 埃爾米特 → 么正相似 → 保持內積與長度 → 么正對角化 → 譜分解`）。

**未被抽成概念的：** Gram-Schmidt、領導主子行列式。OCR **有**讀到（文字裡各出現 1–2 次），
是概念抽取那層沒把它們當獨立概念——不是 OCR 的問題。

**出題與複習流程也一併驗過（同一份手寫課程）：**

| 流程 | 結果 |
|---|---|
| 出題 | 6 題，每概念三個難度階梯；內容是真的線代證明題，其中一題正好對應筆記「相異特徵根所對特徵向量正交」 |
| 批改 | 1.0 分、判定正確、回饋指出定義式與共軛轉置皆正確，另附 rationale |
| 複習排程 | 24 項、FSRS 正常、`reason` 說明「尚無作答紀錄，建議盡早初次測驗」、建議時段 19:30–21:00 |
| 今晚儀表板 | 章節、focus items、預估提升齊全 |

**驗證時挖出六個問題（皆已診斷未修，見 `plan.md` 待辦 L）：**
L1 ChromaDB 與 PostgreSQL 不同步造成 80 筆幽靈向量（跨課程連結全部無效）、
L2 空白頁被算成 OCR 成功、L3 前端 12 分鐘輪詢上限會讓手寫大檔誤報逾時、
L4 題目 LaTeX 被 JSON 跳脫打壞（`\to` → TAB，demo 現場看得到）、
L5 通過率 94% 來自未驗證的佔位公式、L6 多課程時按重算複習計畫會刪別的課程（待辦 G）。

### ⚠️ 更正（同日稍晚）：qwen3-vl:8b 是錯的選擇，已換回 qwen2.5vl:7b

用**真實手寫講義**（14 頁線代 8-1~8-3）實測後推翻了下面那則的結論。

**症狀：** 整份 ingest 回報成功（`ocr_failed: false`），但 `material_chars` 只有 **285**——
約等於第 1 頁的量，只抽出 4 個概念。第 2–14 頁全部沒進去，且日誌沒有任何錯誤。

**根因：** `qwen3-vl:8b` 是**思考型模型**。Ollama 把推理放在獨立的 `thinking` 欄位，
`response` 只放最終答案。密集頁面的推理就把 `num_predict` 燒光，回傳
`done_reason: length`、`eval_count: 2115`、`response: ""`。`thinking` 欄位裡看得到它
其實正確讀出了內容（"self-adjoint, skew self-adjoint"、"T* = T 稱為自伴算子"），
只是永遠送不到 `response`。第 1 頁夠簡單才僥倖有輸出。

**排除過的假設：** 降解析度（dpi 110）、放大 context（num_ctx 16384）、
卸載模型讓失敗頁當第一個請求、`"think": false`——**全部無效**，都還是空字串。

**修法：** 換回 `qwen2.5vl:7b`（非思考型）。同樣兩頁 44–51 秒成功
（qwen3-vl 要 130–170 秒還是空的），整份 14 頁預估約 12 分鐘而非 35 分鐘。
已知弱點：輸出簡體（概念抽取層會轉繁中）、偶有語意錯字（把「λ 為 0 或純虛數」
讀成「λ 不為 0」）。

**教訓：** 先前的選型只用一張**自己造的打字測試頁**驗證，那張簡單到模型思考完還有
額度輸出，所以看起來正常。選 OCR 模型必須拿真實的目標素材測。

**順手清掉的地雷：** OCR 快取只以「檔案 bytes 的 sha256」為 key，**不含模型名稱**，
所以換模型不會讓舊快取失效。那份只有第 1 頁的壞轉寫已手動刪除，否則重跑會直接命中它。

### Bug — glm-ocr 陷入重複迴圈，把教材文字灌成三倍 🩹

**症狀：** `.env` 原設 `OLLAMA_OCR_MODEL=glm-ocr`。同一張測試頁比較兩個模型：

| 模型 | 耗時 | 結果 |
|---|---|---|
| qwen3-vl:8b | 37.6s | 乾淨、一次、正確 |
| glm-ocr | 52.7s | **同一段輸出重複 3 次以上**，各自包在 ` ```markdown ` 圍欄裡 |

**根因：** OCR 專用小模型的 looping hallucination（DeepSeek-OCR 同類問題已見於公開實測）。
`_clean_transcription_text` 只剝頭尾圍欄，中間的留著，於是每頁文字被灌成三倍餵進 `extract_concepts`，
扭曲概念權重也白燒 token。

**修法：** `.env` 改 `qwen3-vl:8b`（6.1 GB，M4 16GB 可跑），原因寫進註解避免被改回去。
**未做：** 沒有替 `_clean_transcription_text` 加去重——那是為已淘汰的模型寫防護（YAGNI）。

**未驗證：** 上述比較是打字測試頁，不是手寫。glm-ocr 有一個真的較好處：輸出正規 LaTeX
（`$\delta_{i,j}$`），qwen3-vl 會把 `<u, v>` 的逗號吃掉。真正的手寫比較待用實際講義驗。

### 待辦 F 規劃 — 發現 CLAUDE.md 的前提是錯的

CLAUDE.md 原寫「後端與 API 都好了，缺一張卡片（約 60–80 行）」。實查：
`/api/cross-course-edges` 只回 `concept_id`，沒有概念名稱與課程名稱；而 `/api/concepts` 只回
**active course** 的概念，所以前端無法自行補齊連結另一端那門課的名稱。
F 實際上是「後端 enrich endpoint + 前端卡片」。規劃見 `plan.md`。

### 待辦 F 實作 ✅ DONE — commit `ae3e1ed`（同日 23:20）

規劃完當晚就做完了，但當時沒補這條 DEVLOG 條目，導致 `plan.md`／`CLAUDE.md` 的待辦清單
一直沒清掉——8/18 檢查待辦清單時才發現「F」是假警報，程式碼其實已經在跑。

- `database.py` 新增 `list_cross_course_edges_detailed()`：JOIN concepts×2 + courses×2；
  既有 `list_cross_course_edges()` 不動（餵 ingest 流程）
- `main.py` `/api/cross-course-edges?detailed=true` 分支；ingest 完成的 `invalidate_cache`
  補上 `"cross"`（否則新連結最多 30 秒才出現）
- `CrossCourseBridgePanel.tsx`：四級關係標籤（等價概念／一般化／類比／語義相關），
  `analogy` 譯「類比」不譯「相似」——跨領域學習最有價值的正是這一級；空狀態文案依課程數分兩種
- 順手修一個資料損壞 bug：`reset_learning_state()` 刪 concepts 沒刪 `cross_course_edges`
  （無 FK），本機累積 63 條孤兒邊，INNER JOIN 已擋下不顯示殘缺列
- 測試：`tests/test_cross_course_detailed.py` 5 條（含孤兒邊必須被濾掉）

**驗證（8/18 補驗）：** `pytest tests/test_cross_course_detailed.py` 4 passed 1 skipped
（skip 為需要真實 DB 連線的 case）；元件已掛載於 `App.tsx` 圖譜頁。

---

## 2026-08-15 — 待辦 E 實機驗收通過 + 修三個環境／整合 bug 🩹

### 待辦 E（技能樹）實機驗收 ✅ — 可 merge main

7/06 程式完成後一直卡在「本機連不上 Render DB」無法驗收。本日改用本機 PostgreSQL 重跑，四項驗收標準全過：

1. **邊數多於修復前** — 同一份線代教材，修復前 3 邊 → 修復後 25–30 邊。
2. **先修箭頭同向、無橫跨曲線** — 分層 DAG 佈局正常，頂部「基礎 →→ 進階」軸線正確。
3. **「可以學了」發光態** — frontier 三態渲染正確（綠實心／indigo 光環／灰化 🔒）。
4. **卡關歸因** — 點「正交投影」(學習中 67%) → 藍色鏈路回溯至「正交性」(0%)，詳情卡顯示「最可能的根因：『正交性』（掌握度 0%）——先回去補它」。

### Bug — FSRS 排程用 naive 本地時間冒充 UTC（`docs/fable5.1-review.md` #3）✅

- **症狀：** 本機 demo 時 next_review_at 顯示偏移、priority 全體虛高。
- **根因：** `review_scheduler.build_review_plan` 預設 `now=datetime.now()`（naive），`_to_utc` 一律當成 UTC。UTC+8 下「現在」被推後 8 小時 → retrievability 被低估。
- **修法：** 一行，`datetime.now(timezone.utc)`。commit `1263693`。
- **驗證：** 重算後複習頁顯示 75.0% → 98.0%，時間戳正常。

### Bug — 跨課程語義橋長期是空的（三個 bug 疊在一起）✅

審查報告只涵蓋第一個，實際挖出三個：

1. **距離空間錯誤**（審查 #1）：ChromaDB collection 沒指定距離空間，預設平方 L2，但 `query_cross_course` 用 `1 - distance` 換算相似度——只對 cosine 成立，結果幾乎全被 clamp 成 0。
2. **embedding 模型已下架**（新發現）：`text-embedding-004` 被 Google 移除，呼叫回 404，**向量根本沒寫進去**。改用 `gemini-embedding-001`（3072 維，走獨立配額，不受 generateContent 日配額影響）。
3. **排除來源課程的時機錯誤**（新發現）：先取 top-N 再事後過濾，同課程鄰居永遠最近、會把跨課程結果整批擠掉。改成把 `where={"course_id": {"$ne": ...}}` 下推到 ANN 查詢。

- **門檻校準：** 用標註樣本實測 `gemini-embedding-001` 的分佈——同義（不同措辭）0.896、同義（跨語言）0.846、真跨課程對應 0.689/0.728、弱相關 0.666、不相關 0.594、完全不相關 0.528。舊門檻 0.82 等於只認同義詞，故改為 **0.68**；`_infer_link_type` 分級同步從 0.95/0.90/0.85 降為 0.84/0.76/0.71。校準表寫進 `vector_store.py` 註解。
- **端到端驗證：** 上傳線性代數＋機器學習兩份教材，系統自動產出 9 條連結。品質佳：正規方程↔正規方程 0.881 (equivalent)、**奇異值分解↔矩陣對角化 0.812 (generalization)**、主成分分析↔矩陣對角化 0.743 (analogy)、主成分分析↔特徵向量 0.688。決策樹等雜訊正確被排除。
- **新增測試：** `tests/test_cross_course_links.py`（5 條，fake embedder 離線跑，不需 API）。
- commit `9ddffc4`。**注意：改距離空間必須刪 `data/chroma/` 重建，且要先停掉後端**——後端開著時刪會讓 ChromaDB 抓著已刪除的 SQLite handle，寫入報 `attempt to write a readonly database`。

### Bug — Gemini 模型備援鏈整條失效 ✅

- **症狀：** ingest 出現「主成分分析是最常用的」「做法是對資料的共變異」這種切字元的假概念（heuristic 降級產物），但主模型明明可用。
- **根因：** `_build_model_candidates` 的四個備援模型（`gemini-2.5-flash`、`2.5-flash-lite`、`2.0-flash`、`2.0-flash-lite`）**全部被 Google 下架、回 404**。主模型偶發一次 504 逾時，整條鏈就崩到 heuristic。
- **修法：** 用 `client.models.list()` 對過現況，改為實際可呼叫的 flash 系列。註解記下這是會隨下架而腐化的清單。commit `c1bf499`。

### 環境 — Render 免費資源全掛，改用本機 PostgreSQL

- Render 免費 PostgreSQL 與 web service 皆已停用（`SSL connection has been closed unexpectedly` / `x-render-routing: no-server`）。
- 改用 Homebrew PostgreSQL 17（`localhost:5432/adaptlearn`），`.env` 的 `DATABASE_URL` 已切換，原 Render 字串註解保留。

### 新發現的缺口 — 跨課程語義橋沒有前端

後端算出連結、`/api/cross-course-edges` 正常回傳，但 `webapp/frontend/src/utils/graphUtils.ts` 只有一行 `// cross-course bridges` 註解，**沒有任何元件消費該 API**。功能通了但畫面上完全看不到。已記入 `plan.md`。

---

## 2026-07-06 — 知識圖譜技能樹（待辦 E 步驟 0–3 實作）🌳

- **分支：** `ui/graph-skill-tree`。
- **步驟 0 — 先修邊向後引用 bug**（`knowledge_graph.py`）：`_records_to_concepts` 改兩段式——先收全部合法概念名，再過濾 prerequisites，先修可以指向 LLM 輸出列表「後面」的概念了。新增 `tests/test_knowledge_graph_prereqs.py`（2 測試）。順手刪死碼 `_slugify`/`_unique_id`/`used_ids`。
- **步驟 1 — 佈局改左→右分層 DAG**（`graphUtils.ts` 新增 `computeDagLayers` + `MindMapCanvas.tsx` 重寫 `buildLayout`）：layer = 先修最長路徑深度，環狀先修切回邊（console.warn 記數）；孤立節點跟同章節平均層。移除放射狀的中心節點/章節圓/主幹線；章節改用 pill 邊框色表達；頂部加「基礎 →→ 進階」進度軸。邊改水平貝茲（pill 右緣→左緣）；人工 `next` 章節串鏈邊從預設視圖移到「全部關聯」開關。
- **步驟 2 — frontier 三態**：已掌握（綠光暈）/ 可以學了（indigo 光環，所有先修已綠）/ 先修未完成（灰化+🔒）。**順手修掉潛伏 bug：** 後端 mastery status 是 `green/yellow/red`，前端色表 key 是 `mastered/learning/...`，對不上 → 圖上掌握度著色其實從未生效過；加 `normalizeStatus` 對映（含 attempts=0 → 未測驗）。掌握度查表同時從「名稱比對」改成「concept_id 比對」（DOT 節點 id 即後端 concept.id，更可靠）。
- **步驟 3 — 卡關歸因**（`graphUtils.ts` `traceWeakestUpstream`）：點「學習中/需複習」節點 → 沿 prerequisite 回溯，每步挑掌握度最低先修（未測驗視為 0），上游已掌握即停；詳情卡顯示「最可能的根因：『X』（掌握度 n%）——先回去補它」+ 鏈路。與路徑模式共用 dim/highlight。
- **驗證：** 後端 pytest 32 passed（新增 2）+ ruff 乾淨；前端 `npm run build` 零錯誤；`computeDagLayers`/`traceWeakestUpstream` 用 esbuild 打包跑 6 案例斷言全過（鏈式分層、孤立節點、環切斷、菱形最長路徑、歸因上溯、路徑回歸）。**尚欠實機驗收**（本機連不上 Render DB）：重新 ingest 教材看邊數增加＋技能樹渲染。
- 既有環境問題（非本次引入）：`test_unit.py::test_scanned_pdf_uses_configurable_ocr_page_limit` 直連 Render 正式 DB 且繞過 db_guard 白名單，本機 SSL 失敗。

---

## 2026-07-06 — Fable 5 全 repo 審查 + 圖譜「技能樹」規劃 📋

- **深度審查**（`6652ee1`）：Fable 5 退場前逐檔精讀全後端 + 前端關鍵檔，報告存 `docs/fable5.1-review.md`。三個高優先 bug：(1) ChromaDB 用 L2 距離但跨課程相似度按 cosine 換算（Module D 可能整個不觸發）；(2) 知識圖譜先修邊「向後引用」被 `_clean_prerequisites` 濾掉（邊系統性偏少）；(3) `review_scheduler` 拿 naive 本地時間當 UTC（台灣時區 FSRS 偏移 +8h）。另有中低優先 7 項與「審過沒問題」清單，修前先讀報告。
- **比賽簡報包**（同 commit）：`docs/demo-pack.md` —— 5 分鐘講稿（含備援劇本）、評審 Q&A 8 題、海報文案、demo 前檢查清單。
- **決策：圖譜從心智圖轉向技能樹**（plan.md 待辦 E）。診斷：放射狀佈局編碼「隸屬關係」（XMind 主場），獨有資料（先修方向/掌握度）被畫成橫跨曲線雜訊。方案：左→右分層 DAG 佈局 + frontier 三態（已掌握/可以學了/還鎖著）+ 卡關歸因回溯，前置修 bug (2)。不動後端 API、不加套件。
- **待辦：** push 被拒（前一 commit `935026f` 動過 workflow 檔，OAuth 缺 `workflow` scope）→ 需 `gh auth refresh -s workflow` 後 `git push origin main`。

- **E1 測試 DB 隔離**（`9eb641e`）：新增 `tests/conftest.py`（最頂部覆寫 `DATABASE_URL`）、`tests/db_guard.py`（白名單邏輯：只允許 localhost/127.0.0.1/adaptlearn_test，其餘 SkipTest）、四個 DB 測試檔各加 `require_safe_db()` guard。驗收：28 個 DB 測試全 SKIP，27 pass。
- **E2 API_ACCESS_KEY 守門**（`c20eabf`）：`useApi.ts` fetch wrapper 用 `new Headers()` 注入 `X-API-Key`（localStorage）；`App.tsx` mount 時讀 `?key=xxx` 存 localStorage 後清 URL，`apiKey` state lazy init 同步。**手動步驟（尚未做）：** 需在 Render 設 `API_ACCESS_KEY` env var 並 redeploy。
- **E4 OCR 結果快取**（`aac9cbd`）：`pipeline.ingest_material` 在 OCR 前算 `sha256(file_bytes)`，命中 `data/ocr_cache/{hash}.json` 跳過 OCR；成功後寫入；`data/ocr_cache/` 進 `.gitignore`。
- **E3 逐頁 OCR 進度**（`0894880`）：`OllamaClient.transcribe_images` 加 `on_progress` callback 逐頁觸發；`pdf_parser._extract_pdf_material` Ollama 路徑直接呼叫（繞過 wrapper 避免 Chandra/Gemini signature 衝突）；`pipeline.ingest_material` 傳 `lambda i, n: _stage(f"OCR 辨識第 {i}/{n} 頁")`；新增 `tests/test_ocr_progress.py` 驗證逐頁 callback。
- **E5 首頁空狀態引導**（`40c1283`）：新增 `EmptyStateOnboarding.tsx`（三步驟：上傳→quiz→graph，PixelIcons + `.card` 設計語言）；`App.tsx` 加 `useCourses()` + `showEmptyState` 條件渲染，取代 stat cards + workflow sections。
- **分支：** `demo/sprint-pack`，已 push。尚未 merge main → Render 尚未更新。
- **E6 全離線 LLM fallback** 待下次實作（需半天，最大項）。

---

## 2026-06-10 — 比賽前衝刺包決策（待辦 E，6 項）📋

- **起點：** 使用者請 Claude 做專案健檢。健檢發現兩個真實風險：(1) `conftest.py` 只修 import path，pytest 的 DB 測試仍直連 Render 正式庫；(2) `API_ACCESS_KEY` 守門做好了但 Render 沒設，公網任何人可刪課程/換金鑰/燒額度。
- **決策（使用者選定 6 項）：** E1 測試 DB 隔離、E2 API key 守門啟用（前端 fetch wrapper 注入 + `?key=` URL 解鎖）、E3 逐頁 OCR 進度（= 待辦 D 階段二）、E4 OCR 結果快取（sha256 → data/ocr_cache）、E5 首頁空狀態三步驟引導、E6 全離線 LLM fallback（`OLLAMA_LLM_MODEL` 文字模型接建圖譜/出題/批改，海報級賣點）。備用 Gemini 金鑰（原項 3）為使用者手動任務，不入計畫。
- **分工：** Opus/Fable 出架構（plan.md 待辦 E，含影響檔案/步驟/驗收/風險），Sonnet 實作。建議順序 E1→E2→E4→E3→E5→E6。

## 2026-06-10 — 心智圖排版：力導向 → 確定性扇區排版 ✅

- **症狀：** glm-ocr 驗收時發現心智圖仍是毛球——pill 不重疊（碰撞分離有效）但邊線交錯、章節圓點混在概念堆裡、概念被推進別章地盤、分支線橫跨整張圖。
- **根因（兩層）：** (1) `buildLayout` 把 59 條跨概念邊全當彈簧、目標長度僅 36px（pill 寬 100–160px），把放射狀扇區互相拉爛；(2) 碰撞分離只保證「不疊」、不保證「歸屬」——物理模擬治不了章節聚類，這是架構問題。
- **修法（分兩刀）：**
  1. 第一刀（過渡）：彈簧只留章節↔概念、REST 36→110；邊線預設只畫先修/進展、新增「全部關聯」開關；章節碰撞箱含文字標籤。有改善但仍不夠。
  2. 第二刀（根治）：**整個丟掉物理模擬**，`buildLayout` 重寫為確定性扇區排版——每章節按 pill 總寬比例分角度扇區、概念沿扇區內同心弧排列（弧長精確累加、放不下換外圈）、橢圓放射配合寬扁畫布（KX=1.42、間距用 ry 算保守值故必不重疊）、超出畫布自動等比 fit、小章節排成輻條。
- **效益：** 章節聚類 100% 保證、零重疊、佈局完全確定性（demo 重整不抽卡）、O(n) 取代 500 次迭代、程式碼更短。渲染端（路徑模式/縮放/選取）零改動。
- **驗證：** `npm run build` 零錯誤；使用者以真實 23 節點/59 邊圖譜人工驗收通過（「好很多」）。

## 2026-06-10 — 手寫 OCR 升級：qwen2.5vl:7b → GLM-OCR ✅（階段一驗收通過）

- **驗收（2026-06-10 下午）：** 28 頁手寫線性代數 PDF 本地 ingest 端對端成功——glm-ocr 辨識出真實內容，知識圖譜 23 節點 / 59 邊（內積空間、正交投影、行列式等真實概念，非模板）。首次執行含 2.2GB 模型冷啟動載入較慢；模型留駐記憶體後，後續上傳預期顯著加快。煙霧測試確認 `/api/generate` 端點相容、不需改走 `/api/chat`。實作 commit `8a2be62`（OCR 特化模型短 prompt 分支 + .env 換模型）。
- **附帶發現（驗收時）：** 心智圖排版仍不佳——pill 不重疊（碰撞分離有效），但邊線交錯成毛球、章節圓點混在概念堆裡，視覺結構不清。另開計畫處理。
- **起點（使用者回報）：** 20+ 頁手寫 PDF 本地 ingest 跑 4–5 分鐘以上仍抽不出有用資訊。
- **診斷：** (1) Ollama 逐頁序列推論，7B 模型每頁 30–60 秒，28 頁遠超前端 12 分鐘輪詢上限；(2) qwen2.5vl:7b 是通用 VLM 非 OCR 特化，中文手寫＋數學式弱；(3) fallback 鏈全有或全無，部分成功的頁也被 ValueError 丟掉。另注意 `MAX_OCR_PAGES` 預設 12，沒調高時 20+ 頁根本沒走本地、直接掉到 Gemini（額度 20/天常已用盡 → 回空）。
- **調研（GitHub / Ollama 官方庫）：** 2025 底起出現一批 OCR 特化小模型。**GLM-OCR**（智譜，0.9B、2.2GB）OmniDocBench v1.5 排名第一（94.62 分），官方主打手寫、雜訊掃描、中文、LaTeX 公式，速度開源最快一檔，已進 Ollama 官方庫 → 對現有 `OllamaClient` 幾乎零改動（換 `OLLAMA_OCR_MODEL` 即可）。備選：deepseek-ocr（Ollama 官方庫，3B/6.7GB，91 分）、PaddleOCR-VL（MLX 移植）、deepseek-ocr.rs（Rust + Metal）。
  - 來源：ollama.com/library/glm-ocr、ollama.com/library/deepseek-ocr、huggingface.co/zai-org/GLM-OCR、github.com/opendatalab/OmniDocBench
- **決策：** 三階段計畫寫入 plan.md「待辦 D」：(一) 換 glm-ocr 零碼驗證（留意 prompt 敏感與 /api/chat vs /api/generate）；(二) 部分成功保留＋逐頁真實進度；(三) 大檔 Gemini 整份路由＋demo 檔案 hash 快取（選配保險絲）。
- **順手：** plan.md 移除已完成的「ingest 速度 + 真實進度條」段（2026-06-09 已 merge，commit 7e2806f）。

## 2026-06-09 — 朋友試用回饋 4 項改善 ✅

- **起點（朋友試用回饋）：** (1) 心智圖節點黏在一起；(2) 概念清單要一直下滑、想點進去看詳解；(3) 重點只有一句話、跟測驗難度落差大、看了答不出來；(4) 想要學習內容能切中文／英文／中英（通用需求，朋友讀生物但考英文只是舉例）。
- **設計（brainstorming → spec → plan）：** 文件見 `docs/superpowers/specs|plans/2026-06-09-trial-feedback-improvements*`。關鍵決策：
  - **深度詳解採 lazy 生成**：ingest 不預生（維持原速，瓶頸是 OCR），改在使用者點開概念卡時才生成「該一個概念 × 當下語言」的定義/重點/範例/誤區，存進新表快取。
  - **語言只影響學習內容**（概念詳解＋測驗），UI 維持中文；概念頁與測驗頁各自獨立切換（中/EN/中英）。
  - **心智圖自寫力導向佈局**（不加 npm 套件）取代固定半徑放射，解節點重疊。
  - **概念清單改卡片網格＋右側抽屜**，抽屜走 spring 回彈、酪梨 logo 蓋章進場、區塊接力浮現、Esc 可關＋提示。
- **實作（14 tasks，subagent-driven，Sonnet 執行）：**
  - 後端：`models.ConceptDetail`；`database` migration 002 `concept_details` 表（PK concept_id+language）＋ get/save；`gemini_client.generate_concept_detail`（含降級）＋ `generate_questions` 加 `language`(zh/en/both)；`pipeline.get_or_generate_concept_detail`（lazy 快取）＋ `generate_diagnostics` 加 language；`main.py` 新增 `GET /api/concepts/{id}/detail?lang=` ＋ diagnostics 接 language。
  - 前端：`useConceptDetail` hook；`index.css` 抽屜動畫；新 `ConceptDrawer.tsx`（Esc／中英堆疊／KaTeX）；`ConceptSection.tsx` 改卡片網格＋語言切換＋掌握度狀態色；`SetupPanel` 接 `useConceptMastery`；`QuizPanel` 測驗語言切換；`MindMapCanvas.buildLayout` 改力導向。
- **驗證：** 新增 9 個後端測試全通過（含真實 DB 的 concept_details get/save）；`npm run build` 全程零錯誤。完整套件 **56 passed / 4 failed**，4 個 failed 皆為 plan.md 記載之 pre-existing（3× integration async ingest 行為、1× OCR 頁數上限訊息），與本次無關。
- **待人工驗收：** 力導向佈局與抽屜動畫屬視覺品質，需在 graph/概念頁實際操作確認（節點不重疊、抽屜流暢、語言切換正確、中英對照堆疊）。

## 2026-06-09 — ingest 速度 + 真實進度條 ✅

- **起點（使用者回報）：** async ingest 已不再 502，但 28 頁手寫教材處理逾 210 秒卡在第三階段「建立圖譜與向量索引」，體驗差。
- **診斷：**
  1. **向量索引慢（真兇）：** `vector_store.py` 沒指定 embedding function → ChromaDB 用預設本地 ONNX 模型（all-MiniLM ~80MB）。Render free tier 下載 + 載入 + 慢 CPU 推論、加上 P6 每次 redeploy 磁碟歸零要重下載 → 卡數分鐘近 OOM。
  2. **進度條是假的：** `SetupPanel.tsx` 用 `elapsedSec`（>5s / >15s）硬切步驟打勾，完全沒用後端真實 `stage`（輪詢回應其實有帶，前端丟掉）。截圖的「前兩步打勾、卡第三步」只是「已過 15 秒」假象。
- **決策（OCR 不動）：** OCR 早在 141a6bd 改為「Gemini 原生 PDF 一次送」，且那正是當初 502 元兇（DEVLOG 2026-06-03），已用 timeout + async 壓下；不可再回頭加速 OCR。本次只動：(1) 向量 embedding 改 Gemini API（有金鑰時）繞過本地模型、無金鑰回退；(2) 前端進度接後端真實 stage + 第三階段細分。
- **影響範圍：** `gemini_client.py`（新增 `embed_texts`）、`vector_store.py`（可選 embedder + collection 依 backend 命名避維度衝突）、`pipeline.py`（傳 embedder + 細分 stage）、`useApi.ts`（回拋 stage）、`SetupPanel.tsx`（真實 stage 驅動）。詳見 plan.md「進行中」。
- **實作完成（ded28ee, feec804）：**
  - `embed_texts()` 用 text-embedding-004，錯誤一律回 None 優雅降級。
  - `vector_store` 有金鑰 → `adaptlearn_concepts_gemini` collection、自算 768 維向量傳 Chroma 繞過本地模型；無金鑰 → 原 `adaptlearn_concepts`（本地 384 維）；embedding 失敗 → 跳過向量寫入不中斷 ingest。三條路徑以暫存 Chroma + fake embedder 驗過。
  - 第三階段細分為「儲存概念與章節 / 建立向量索引 / 尋找跨課程關聯」；前端 `SetupPanel` 進度改由後端真實 `stage` 驅動（取代假的 `elapsedSec` 計時），第三步顯示精確子階段。
  - `npm run build` 零錯誤；react-doctor diff 由 75→81、「No issues found」。
- **驗證：** `pytest` 47 passed / 4 failed，4 個失敗皆 pre-existing（3 個 integration 測試假設同步 ingest、在 main 即壞；1 個 OCR 頁數訊息），本分支零新增失敗（已 checkout main 對照確認）。
- **驗收（2026-06-09）：** Render 正式站端對端驗收通過。28 頁手寫上傳不再卡在第三階段，進度條顯示真實後端 stage。merge 到 main 並 push（commit 7e2806f）。

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

## 2026-09-02 — 決賽前網站三修（分支 `fix/demo-site-polish`）

決賽走查時發現三個評審會看到的畫面問題，全部修掉：

1. **首頁／教材頁重整後歸零（待辦 M 問題①）**：`sessionUploaded` 是 `useState(false)`，重整即重置。
   照 plan.md 決定的做法改存 `sessionStorage`（重整保留、關分頁清空），無痕模式拋錯就退回記憶體。
   驗收：切課 → F5 → 首頁仍顯示 13／75%／13。
2. **複習頁「目前通過率 61.3% → 預估通過率 91.3%」**：來自 `_estimate_pass_probability` 未驗證佔位公式（待辦 L5）。
   三個大數字格子和每項的「預估提升 +x%」一起從 UI 拿掉，只留優先度；後端欄位保留不動。
3. **熱力圖「本週優先加強」印出 `c-884f…` 這種 ID**：`/api/heatmap/{id}/weak` 從沒回過名字。
   `get_weak_concepts` 補 `concept_name`；前端改印名字，「補強可提升 +23%」（封頂常數）換成真的「N 次作答」；
   課程分頁預設跳到目前課程而不是清單第一門。新增 `tests/test_class_heatmap_weak.py`。

測試 113 通過／5 失敗（同一批 ingest 改非同步後未更新的舊測試）。
另注意：**後端重啟後「目前課程」會掉回最新上傳的那門**（機率），上台前開完後端要先到教材頁點一次「線性代數的正交性」。

## 2026-09-02 — 決賽前網站再修五處（同分支 `fix/demo-site-polish`）

1. **跨課程標籤降級**：「等價概念／一般化／類比／語義相關」改成「高度相似／相似／可能相關／弱相關」，
   面板底部加註「標籤只代表有多像，不代表數學上等價」。後端 `link_type` 不動。
   起因：「正交集合 ↔ 單範正交集」被判 equivalent，數學上是特例不是等價，餘弦距離管線不懂數學。
2. **目前課程改記在資料庫**（migration 004：`courses.activated_at`）。以前只在記憶體，後端一重啟就掉回最新上傳的那門。
   `get_active_course_id` 改 `ORDER BY activated_at DESC NULLS LAST, uploaded_at DESC`。新增 `tests/test_active_course_persists.py`。
3. **複習排程沒作答的概念顯示「尚未測驗」**，不再顯示 100%（那是 priority，不是記憶率）。
4. **Landing 看過一次就記在 sessionStorage**，重整不再跳回開場畫面。
5. **技能樹滾輪錯誤**：React 的 `onWheel` 是 passive，`preventDefault()` 被拒絕並印錯誤。改用 `addEventListener("wheel", …, { passive: false })`。
   驗證：派發 cancelable WheelEvent 後 `defaultPrevented === true`。

測試 114 通過／5 失敗（同一批舊測試）。
