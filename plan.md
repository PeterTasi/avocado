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