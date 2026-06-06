# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 更新於 2026-06-05。

---

# 🔮 P2 — 遺忘曲線預測顯示（2026-06-06）

> 分支：`feat/graph-path-finding`（沿用現有分支）
> 目標：Review 頁每個複習概念畫一條 FSRS-5 迷你遺忘曲線，視覺化「記憶隨時間衰減」+ 標出「現在」與「該複習」點。差異化賣點，ThetaWave 沒有。
> 視覺方向已用 brainstorm companion 確認 = **B 迷你遺忘曲線**。

## 關鍵發現
遺忘預測需要的數字 FSRS **已經算出來了**，目前藏在 `reason` 除錯字串裡：
- `retrievability`（現在記得的機率）＝ `_build_fsrs_card` 已算
- `card.stability`（穩定度，畫未來曲線用）＝ 已算
- `next_review_at`（FSRS 決定的該複習時間）＝ 已有獨立欄位

→ 只要把 `retrievability`、`stability` 從字串**提升成獨立欄位**，前端就能畫曲線。

## 影響範圍

| 檔案 | 變更 |
|---|---|
| `src/adaptlearn/models.py` | `ReviewItem` 加 `retention: float = 0.0`、`stability: float = 0.0`（有預設值，放欄位最後） |
| `src/adaptlearn/review_scheduler.py` | `build_review_plan` 把 retrievability→retention、card.stability→stability 塞進 ReviewItem |
| `src/adaptlearn/database.py` | `review_plan` 表加 `retention REAL`、`stability REAL` 欄位 + migration（ADD COLUMN IF NOT EXISTS 手法）；`save_review_plan`/`list_review_plan` 讀寫兩欄 |
| `webapp/main.py` | `_serialize_review_item` 加 `retention`、`stability` |
| `webapp/frontend/src/hooks/useApi.ts` | `ReviewItem` interface 加 `retention`、`stability` |
| `webapp/frontend/src/components/ForgettingCurve.tsx` | **新建**：吃 retention + stability + nextReviewAt，畫 SVG 衰減曲線 |
| `webapp/frontend/src/components/StudyPanels.tsx` | `StudyPlansPanel` 整合 ForgettingCurve + 記憶徽章 +「N 天後複習」；收掉醜的 reason 除錯字串 |
| `tests/test_unit.py` | 更新 `test_save_and_list_review_plan` 加 retention/stability round-trip；新增 build_review_plan retention 範圍測試 |

## 實作步驟（TDD where possible）

### Step 1 — 後端資料欄位（TDD）
1. `models.py`：ReviewItem 加 `retention`、`stability`（預設 0.0）
2. **先寫測試**（`test_unit.py`）：
   - `test_save_and_list_review_plan` 補 retention/stability round-trip 斷言
   - 新測試 `test_build_review_plan_populates_retention`：有作答歷史的概念 → retention∈(0,1]、stability>0；無歷史 → retention=0
3. `review_scheduler.py`：build_review_plan 塞值（讓測試綠）
4. `database.py`：migration + save/list 讀寫兩欄（讓 round-trip 測試綠）

### Step 2 — API 序列化
`main.py` `_serialize_review_item` 加 retention、stability 兩個 float 欄位。

### Step 3 — 前端型別 + 曲線元件
1. `useApi.ts`：ReviewItem 加 retention、stability
2. 新建 `ForgettingCurve.tsx`：
   - FSRS-5 公式：`R(t) = (1 + FACTOR·t/S)^DECAY`，`DECAY=-0.5`、`FACTOR=19/81`
   - 從 retention 反推目前 elapsed：`elapsed = (R^(-2)-1)·S/FACTOR`
   - 畫未來 N 天的 R(elapsed+Δ) 曲線（SVG path）
   - 標「現在」點（綠）+「該複習」虛線（用 nextReviewAt 換算天數，琥珀色）
   - stability=0（無歷史）→ 不畫曲線，顯示「尚無資料」

### Step 4 — 整合進 Review 頁
`StudyPanels.tsx` StudyPlansPanel：每個 item 加 ForgettingCurve + 「🧠 記憶 N%」徽章 + 「⏰ N 天後複習」；移除原本顯示的 reason 除錯字串。

## 品質要求 / 風險
- **DB migration**：review_plan 加兩個 nullable REAL 欄位，低風險（同 `concepts.course_id` 手法）
- **stale trade-off**：retention 存的是重算當下值；「N 天後複習」用 nextReviewAt 即時換算，永遠準確
- 不新增 npm 套件（SVG 純手刻）
- 後端 `python -m pytest tests/test_unit.py` 全綠；前端 `npm run build` 零錯誤

---

# ✅ 已完成（待移入 DEVLOG）

- **UI 動畫升級（A+C）** 2026-06-06 已推送：比比拉布 logo idle 動畫、DailyProgressRing 弧形+數字 count-up、掌握度條/進度條 mount 填充。commit `1c746d4`
- **A2 釘版本** 2026-06-06 已推送：requirements.txt 全改 `==`。commit `31e12f0`
- **A1 短期解（session_id scope）決策：不做。** 競賽為單人輪流 demo，現有 `course_id` active scoping（ingest 時 `set_active_course`+`reset_course_state`，出題只取 active course）已完整解決 Bug 5。session 隔離只在「多人同時連同一部署」才需要，對單人 demo 是過度工程。完整多租戶仍屬賽後 A1。

---

# 🩺 架構健檢結果（2026-06-05，Opus review）

> 總評分 **8 / 10**（以大二競賽標準屬高於平均）。模組化、migration、測試、降級策略都有；
> 真正的天花板只有一個 —— **全域單例 = 單租戶**。下表依嚴重度排序，並標註競賽優先級。

| # | 嚴重度 | 問題 | 證據 | 競賽優先級 |
|---|---|---|---|---|
| A1 | 🔴 致命 | 全域可變單例 → 整個 App 單租戶 | `webapp/main.py:45` `_service = AdaptLearnService(...)` | P2（短期解） |
| A2 | 🟠 高 | 依賴全用 `>=` 沒釘版本，redeploy 可能無預警壞掉 | `requirements.txt` | **P1（先做）** |
| ~~A3~~ | ✅ 已完成 | ~~圖譜死碼~~ → 已刪 `ForceGraphCanvas`/`GraphCanvas` + `react-force-graph-2d` 依賴（見 DEVLOG 2026-06-05） | — | — |
| A4 | 🟡 中 | God object：`database.py` 806 行、`pipeline.py` 628、`App.tsx` 803 | — | 賽後 |
| ~~A5~~ | ✅ 已完成 | ~~repo 雜物~~ → 已加進 `.gitignore`（見 DEVLOG 2026-06-05） | — | — |
| A6 | 🟢 低 | ChromaDB 本地碟在 Render free redeploy 後歸零（已知 P6） | `vector_store.py` | 賽後 |

### 細節與具體作法

**A1 — 全域單例（最致命）**
- 所有請求共用同一份 service / 知識圖譜 / mastery 狀態，沒有 user 概念。
- `_get_service()` 的 `set_api_key()` 改動共享全域 → 併發請求 race condition。
- **plan 既有的 Bug 5「跨 Session 概念殘留」其實就是這個的症狀，不是獨立 bug。**
- 短期解（demo 夠用）＝ 下方「Bug 5 方案 B」加 `session_id` scope。
- 中期解（賽後）：加 `users` 表 + token，service 改成 per-request 由 `user_id` 決定 scope，`set_api_key` 改傳參數、不 mutate 全域。

**A2 — 釘版本（5 分鐘保命）**
- 競賽前 `pip freeze > requirements.lock`，或把現在能跑的版本改成 `==`。

### 競賽建議執行順序
1. **A2** 釘 requirements 版本（防爆，最快）
2. **A1 短期解** `session_id` scope（解掉 Bug 5 的根，多人試不穿幫）
3. ~~A5 `.gitignore` 清乾淨~~ ✅ 已完成
4. ~~A3 刪死碼~~ ✅ 已完成
5. A1 完整多租戶、A4 拆 God object → **賽後**

> ⚠️ 注意：A4（拆檔）競賽期間**不要動**，風險高於收益。

---

# 🟡 選配待辦（競賽後可做）

## Bug 5 方案 B/C — 跨 Session 概念殘留（後端根本解）

**現況：** 前端方案 A（確認 modal）已完成，競賽夠用。

**若之後要更根本的解法：**

- **方案 B（需 DB schema migration）：** 後端新增 `session_id` 欄位，每次 ingest 產生一個 session；`/api/diagnostics/generate` 只取最新 session 的 concepts。
  - 需改 `database.py`（schema + query）、`pipeline.py`（ingest 寫入 session_id）、`main.py`（quiz generation 過濾）
- **方案 C：** 前端提供「清除課程資料」按鈕，呼叫新後端 DELETE endpoint 清空 concepts/questions。

---

## P6 ChromaDB 持久化（賽後處理）

- **問題：** ChromaDB 存本地磁碟（`data/chroma`），Render free redeploy 後向量庫歸零，跨課程語意連結失效。
- **建議（擇一）：** (a) 跨課程連結改用 PG `pgvector` 取代 Chroma；(b) 接受「重啟後首次查詢重建」並在 ingest 時重算。
- **影響範圍：** `vector_store.py`、`cross_course_linker.py`、`requirements.txt`。

---

# 🏆 競品分析與差異化策略（2026-06-05）

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

## 差異化強化待辦（競賽 Demo 優先）

| 優先度 | 項目 | 說明 | 狀態 |
|---|---|---|---|
| 🔴 P1 | **知識圖譜路徑尋找** | 選一個概念，高亮「你必須先學哪些 prerequisites」。`feat/graph-path-finding` 分支進行中，是最強 Demo 亮點。 | 🔄 進行中 |
| 🟠 P2 | **遺忘曲線預測顯示** | Review 頁加「預計 N 天後遺忘」提示，視覺化 FSRS-5 的科學排程優勢。ThetaWave 完全沒有。 | ⬜ 待做 |
| 🟡 P3 | **掌握度時間折線圖** | ProgressPanel 已有，加強「這週進步 X%」的量化成效呈現。 | ✅ 已完成 |
| 🟢 P4 | **手寫筆記 OCR → 圖譜** | Ollama OCR 已支援，Demo 時主打「連手寫都能分析」。 | ✅ 技術就緒 |

---

# 執行規則

- 每改完一個檔案 → `npm run build` 零錯誤
- 不新增 npm 套件（**例外：KaTeX 已加**）
- 完成後更新 `CLAUDE.md` 進度追蹤 + `DEVLOG.md`
