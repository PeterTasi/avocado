# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 完成的功能記錄在 `DEVLOG.md`，從這裡刪除。
> 更新於 2026-06-06。

---

# 🟡 選配待辦（競賽後可做）

## Bug 5 方案 B/C — 跨 Session 概念殘留（後端根本解）

**現況：** 前端方案 A（確認 modal）已完成，競賽夠用。A1 決策已定：單人輪流 demo 用現有 `course_id` active scoping 即可，session 隔離屬賽後。

**若之後要更根本的解法：**

- **方案 B（需 DB schema migration）：** 後端新增 `session_id` 欄位，每次 ingest 產生一個 session；`/api/diagnostics/generate` 只取最新 session 的 concepts。
  - 需改 `database.py`（schema + query）、`pipeline.py`（ingest 寫入 session_id）、`main.py`（quiz generation 過濾）
- **方案 C：** 前端提供「清除課程資料」按鈕，呼叫新後端 DELETE endpoint 清空 concepts/questions。

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
