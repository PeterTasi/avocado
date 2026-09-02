# 給下一個模型的交接（Fable 5.1 → Opus，2026-09-02）

> **這一節的目的：** 後面接手的模型要用同一套標準做事。決賽 9/10，時間不多，不要重新發明流程。
> 下面「工作標準」是這兩天實際做出品質的做法，不是理想清單。**每一條都有踩過的坑。**

## 工作標準（照做，不要省略）

1. **任何要講給評審聽的數字，先查資料庫再寫。** 不要信 CLAUDE.md、講稿、海報上的數字，它們會過期。
   查法：`psql postgresql://localhost:5432/adaptlearn`。今天核出來的例子：講稿寫手寫課 3 題，實際 21 題；投影片寫 28 頁，PDF 實際 14 頁；測試寫 105/110，實際 114/119。
2. **改前端一定要看真的畫面，不要只看程式。** 用瀏覽器工具開 `http://localhost:8000`，走一遍首頁→教材→測驗→複習→圖譜，
   看 `get_page_text`／截圖／主控台錯誤。今天三個 bug（首頁歸零、通過率假數字、熱力圖印 ID）程式碼都「看起來對」，是開畫面才看到的。
3. **改前端後必做：** `cd webapp/frontend && npm run build`，產物在 `webapp/static/`，**要一起 commit**（Render 沒有 Node）。
   後端 Python 改了要重啟 uvicorn（沒開 `--reload`）；migration 在啟動時自動套用。
4. **動程式前先講計畫**（目標／影響檔案完整路徑／步驟／風險），使用者說「擬定計畫後開始」才等於同意。
   使用者已決定的事不要重新討論（例如待辦 M 用 sessionStorage、OCR 走 Ollama、第 3 項「最可能的根因」改字他沒選）。
5. **最短的 diff。** 只修使用者點名的問題，順手看到的另外列出來問，不要一起改。今天每個修法都是 5–15 行。
6. **每個非顯而易見的邏輯留一條測試**，跑 `.venv/bin/python3.11 -m pytest tests/ -q`（注意：`.venv/bin/python` 不存在，要用 `python3.11`）。
   測試連 `adaptlearn_test` 資料庫，不會碰 demo 資料。**5 條舊測試本來就失敗，不要去修它們**（見下方）。
7. **做完寫 DEVLOG.md**（日期、症狀、根因、修法、驗證），commit 訊息用繁中 `類型(範圍): 描述`。
   使用者在 `docs/pitch-6min.md` 有未 commit 的改動，**不要把它混進你的 commit**，用 `git add <檔案>` 指名。
8. **回答風格：** ELI5 繁中、短句、做完講三件事（做了什麼／有沒有成功／他接下來要做什麼）、要決定時最多兩個選項並說你選哪個。

## 目前狀態（2026-09-02 中午）

- 分支 `fix/demo-site-polish`（自 `feat/topic-skill-tree` 分出），兩個 commit `0635f04`、`d6ad5bc`，**已推上 GitHub，尚未合併**。
  內容：首頁重整不歸零、拿掉未驗證通過率、熱力圖弱點顯示名字、跨課程標籤降級成相似度、目前課程存資料庫（migration 004）、
  未測驗概念顯示「尚未測驗」、landing 只跳一次、技能樹滾輪 passive 錯誤。全部實機驗收過。
- 測試：**114 通過／5 失敗**（加上今天新增 2 條）。5 條失敗的真相：
  - 3 條在 `tests/test_api_integration.py`：`/api/material/ingest` 改成非同步後回 **202**，舊測試還在等 200／400。
  - 2 條在 `tests/test_unit.py`：OCR 失敗時的行為從「丟 ValueError」改成「回模板＋紅字告警」（待辦 L2），
    以及錯誤訊息文字改了；舊測試斷言的是舊行為。
  - **講稿裡「5 條是改非同步後沒更新」只對了 3 條**，另外 2 條是 OCR 行為改版。答評審時要講對。
- 資料庫：4 門課／63 概念／44 跨課程連結／7 筆作答。目前課程已設成「線性代數的正交性」（存在 `courses.activated_at`）。
- 後端重啟後不用再手動切課。Ollama 開著，`.env` 指定的 `qwen2.5vl:7b` 已安裝（另有 qwen3-vl:8b、glm-ocr，都是淘汰掉的，別換回去）。

## 還沒做的（依優先序）

1. **投影片 `~/Documents/avocado-修正版.pptx` 六處過期**（第 10 頁「12 條」應為 37、第 10 頁備忘稿 87% 那條、第 11 頁小標題「這是不是 AI 隨便生成的」要刪、第 11／17 頁「28 頁」應為 14、第 11 頁 105/110 應為 114/119、第 15 頁改「主張版」）。
2. **講稿 `docs/pitch-6min.md` 三處自相矛盾**（數字速查 87%、「海報 v2 對齊」那張表、「只上傳第五章」那題的例子）＋ 實際字數 1,386 字約 6:27 會超時。
3. 第 3 項：技能樹「最可能的根因」→「建議的補強起點」（使用者未選，別主動做）。
4. 本表下方的 #5、#7、#8、#9 賽後再說。#6 `avg_attempts` 仍是假數字，但今天起前端已不顯示它。

---

# 全 repo 深度審查報告（Fable 5, 2026-07-06；交接段 Fable 5.1, 2026-09-02）

> 賽前最後一次高強度審查。逐檔精讀了 `src/adaptlearn/` 全部模組、`webapp/main.py`、`useApi.ts`、`App.tsx`。
> 依「影響 demo 的程度」排序。每項附檔案位置與修法，之後可用 Sonnet 照著修。
> **修之前先跑 `python -m pytest tests/` 建基準線。**

## 修復狀態（更新於 2026-08-15）

| 項 | 狀態 | 備註 |
|---|------|------|
| #1 跨課程相似度計算 | ✅ 已修 | commit `9ddffc4`。實際不只這一個 bug——另有 embedding 模型下架（404）與「先取 top-N 再過濾」兩個問題疊在一起，三個都修了並重新校準門檻。詳見 DEVLOG 2026-08-15 |
| #2 先修邊向後引用 | ✅ 已修 | commit `30692ef`（待辦 E 步驟 0）。改兩段式收集，新增 `tests/test_knowledge_graph_prereqs.py` |
| #3 複習排程時區 | ✅ 已修 | commit `1263693`。一行，`datetime.now(timezone.utc)` |
| #4 `review_plan` 全域 | ✅ 已修 | 8/18 commit `da926a4`：整張表刪掉，複習計畫改即時計算（待辦 G） |
| #5 PDF OCR 記憶體 | ❌ 未修 | Render 已停用，暫時無 OOM 風險；恢復雲端部署前要修 |
| #6 熱力圖 `avg_attempts` | ❌ 未修 | 沉睡 bug。**別在報告／海報引用這個數字**。9/2 起前端弱點清單改顯示 `sample_count`，不再印它 |
| #7 模板題永遠英文 | ❌ 未修 | |
| #8 `llm_degraded` 漏報 | ❌ 未修 | 8/15 遇到相關情境：主模型 504、備援全 404 時降級判斷仍正確，但同批「先失敗後成功」仍會被蓋掉 |
| #9 API key 全域競態 | ❌ 未修 | A1 單人假設的一部分 |
| #10 死碼 | ✅ 已清 | commit `30692ef` 順手刪掉 `_slugify`/`_unique_id`/`used_ids` |

---

## 🔴 高優先（會影響比賽 demo 的正確性）

### 1. 跨課程語義橋的相似度計算是錯的（Module D 可能整個不會觸發）

**位置：** `src/adaptlearn/vector_store.py:86`（collection 建立）+ `:187-189`（相似度換算）

**問題：** `get_or_create_collection(name)` 沒指定距離空間，ChromaDB 預設是 **L2（平方歐氏距離）**，但 `query_cross_course` 用 `similarity = 1 - distance` 換算——這只對 cosine distance 成立。後果分兩種：

- Gemini 768 維向量若未正規化：L2 距離普遍 > 1 → similarity 被 clamp 成 0 → **跨課程連結永遠達不到 0.82 門檻，一條都不會出現**。
- 若向量恰好已正規化：平方 L2 = 2(1−cos)，門檻 0.82 實際上等於要求 cos ≈ 0.91，遠比設計意圖嚴格；`link_type` 分級（0.95 equivalent / 0.90 generalization…）也全部失真。

**驗證方法：** 上傳兩份有明顯重疊概念的課程（例如線代 + 機器學習），看 `/api/cross-course-edges` 是否為空。若 demo 中「跨課程語義橋」曾正常出現過，代表向量已正規化，只是門檻失真（症狀：連結比預期少、link_type 幾乎都是 semantic）。

**修法：**
```python
# _get_collection 裡：
return client.get_or_create_collection(name, metadata={"hnsw:space": "cosine"})
```
注意：**既有 collection 的距離空間不會被改變**，要刪掉 `data/chroma/` 重建（或 `client.delete_collection`）。改完後 `1 - distance` 的換算才正確（cosine distance = 1 − cos similarity）。

---

### 2. 知識圖譜先修邊會丟掉「向後引用」的先修關係

**位置：** `src/adaptlearn/knowledge_graph.py:189-201`（`_records_to_concepts` 迴圈）+ `:327`（`_clean_prerequisites` 的 `normalized not in used_names` 過濾）

**問題：** `used_names` 是邊處理邊累積的，處理第 N 個概念時只包含前 N 個名字。所以概念 A 的 prerequisites 若指向「列表中排在 A 後面」的概念 B，會被當成不存在而濾掉。LLM 輸出順序不保證拓撲序 → **圖譜的 prerequisite 邊被系統性砍掉一部分**，圖看起來稀疏、路徑尋找 demo 效果打折。

**修法：** 改兩段式——第一遍先把所有合法概念名收進 `used_names`，第二遍再對每個概念呼叫 `_clean_prerequisites`。約 10 行改動，不動資料庫。

---

### 3. 複習排程用「本地 naive 時間」冒充 UTC（在台灣時區偏移 8 小時）

**位置：** `src/adaptlearn/review_scheduler.py:22-23`

**問題：** `build_review_plan(now=None)` 用 `datetime.now()`（本地 naive），`_to_utc` 把 naive 一律當 UTC。在 UTC+8 的 Mac 上 demo 時，「現在」被推到未來 8 小時 → FSRS retrievability 被低估、priority 全體虛高、`next_review_at` 顯示偏移。部署在 Render（UTC）看不出來，**本地 demo 看得出來**。

**修法：** 一行——`now = datetime.now(timezone.utc)`。

---

## 🟡 中優先（demo 單一課程時無感，多課程才爆）

### 4. `review_plan` 表是全域的，其他資料都已 course-scoped

**位置：** `src/adaptlearn/database.py:616-618`（`save_review_plan` 開頭 `DELETE FROM review_plan` 全刪）；`pipeline.py:293-300`

**問題:** 重算複習計畫時只用「當前課程」的概念建計畫，但把**所有課程**的舊計畫刪光。切換課程 → 上一個課程的複習計畫消失；`get_tonight_study_dashboard` 讀到殘留他課 item 時 chapter 顯示 "Unknown"。這其實是已知 Bug 5 B 的另一個面向。**Demo 只用一門課就完全無感**——賽前不用修，但 Q&A 被問到多課程要心裡有數。

### 5. PDF OCR 路徑會把整份 PDF 每頁先渲染成 2x PNG 塞進記憶體

**位置：** `src/adaptlearn/pdf_parser.py:119`

**問題：** 文字稀疏且 Gemini 可用時，`gemini_vision_images = _pdf_pages_to_images(doc)` **無條件先渲染全部頁面**，即使第 3 步（Gemini 原生 PDF，一次呼叫）通常就成功、根本用不到這些圖。30+ 頁掃描檔 ≈ 100 MB+ RAM，Render free tier 只有 512 MB → OOM 風險。

**修法：** 把渲染延後到真的走到第 4 步（page-by-page vision）才做。需要注意 `doc` 已在 `with` 區塊外關閉——把第 4 步的渲染移進 with 區塊尾端做 lazy 閉包，或重新 `fitz.open`。

### 6. 熱力圖的 `avg_attempts` 是恆等於 1 的假數字

**位置：** `src/adaptlearn/database.py:800`

**問題：** `AVG(CASE WHEN a.id IS NOT NULL THEN 1.0 ELSE 0.0 END)` 對有作答的概念永遠是 1.0，不是「平均作答次數」。目前前端熱力圖只用 error_rate，所以是**沉睡 bug**——但別在報告/海報裡引用 avg_attempts 這個數字。正確算法是 `COUNT(a.id)::float / COUNT(DISTINCT a.question_id)` 或直接用 total。

---

## 🟢 低優先（記錄在案即可）

7. **模板備援題目永遠是英文**（`quiz_engine.py:92-104` `_template_question`）——Gemini 失敗降級時，就算 UI 選繁中，出來的題目是英文。降級路徑本來就少見，但 demo 現場若 API 掛了會很顯眼。
8. **`llm_degraded` 會漏報**（`gemini_client.py:121`）——`_generate_content` 任何一次成功都會清掉 `last_error`，同一次 ingest 內「前面失敗、後面成功」的情況會被蓋掉。
9. **API key 全域競態**（`webapp/main.py:208-213`）——`_get_service` 直接改全域 service 的 key，兩個分頁用不同 key 會互相蓋。已知 A1 單人假設的一部分。
10. **死碼**：`knowledge_graph.py` 的 `_slugify`+`base_id`（`:203-205` 算了沒用）、`_unique_id`（`:488`）、兩處 `used_ids`。順手清掉即可。

---

## ✅ 審過且沒問題的部分（未來 session 不用重查）

- **SQL 注入**：所有查詢都用參數化，`concept_progress` 的 interval 拼接也是參數化的（`(%s || ' days')::interval`），安全。
- **`_connect` 交易管理**：commit/rollback/putconn 正確；`save_review_plan` 空清單早退仍會 commit（context manager 收尾），沒有連線洩漏。
- **ingest 非同步**：thread + job store + 前端輪詢的設計完整，25 MB 上限、job TTL、鎖都有。`run_in_threadpool` 讓 health check 不被擋。
- **OCR fallback 鏈**：Ollama → Chandra → Gemini native PDF → Gemini page vision 的判斷邏輯正確（除了第 5 點的記憶體問題）。
- **`_concept_id` 用 uuid5(course:chapter:name)**：跨課程同名概念不會撞 PK，設計正確。
- **App.tsx**：`?key=` 注入、popstate 路由同步、session gate 都正確；TDZ 疑慮不成立（effect 在 render 後才執行）。
- **auth middleware**：`secrets.compare_digest` 防 timing attack，health 豁免合理。
- **快取失效**：`invalidate_cache` 的 pattern 匹配涵蓋所有寫入路徑（含 `delete_course` 靠 "course" 子字串同時打中 cross_course_edges）。

---

## 給接手模型的修復順序建議

1. 先修 #3（一行）→ 跑測試。
2. 修 #2（兩段式收集，約 10 行）→ 重新 ingest 一份教材，肉眼比對圖譜邊數變多。
3. 修 #1（一行 + 刪 `data/chroma/` 重建向量庫）→ 用兩門重疊課程驗證 cross-course edges 出現。
4. #5 只在要上 Render demo 大檔時修；#4、#6 賽後再說。
