# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 更新於 2026-06-05。

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

# 執行規則

- 每改完一個檔案 → `npm run build` 零錯誤
- 不新增 npm 套件（**例外：KaTeX 已加**）
- 完成後更新 `CLAUDE.md` 進度追蹤 + `DEVLOG.md`
