# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 完成的功能記錄在 `DEVLOG.md`，從這裡刪除。
> 更新於 2026-06-06。

---

# 🟢 進行中 — ingest 速度 + 真實進度條（分支 `fix/ingest-speed-progress`，2026-06-09）

> **狀態：程式已完成並 push 到 `origin/fix/ingest-speed-progress`，尚未 merge 到 main、尚未在 Render 驗收。**
> 實作細節見 DEVLOG 2026-06-09。下面是明天接續的待辦。

## ⏭️ 明天接續（按順序）

- [ ] **1. （可選）本地先驗一次：** `.env` 設好 `GEMINI_API_KEY` → `uvicorn webapp.main:app --reload` → 上傳那份 28 頁手寫，確認①第三階段不再卡數分鐘、②進度條顯示真實階段（解析→抽取→儲存概念→建立向量索引→尋找跨課程關聯）。
- [ ] **2. 確認 Render 有設 `GEMINI_API_KEY`（關鍵！）：** `render.yaml` 裡這把 key 是 `sync: false`，要在 Render Dashboard → Environment 手動填。**沒設的話會回退本地模型 → 一樣慢**，這次加速等於沒生效。
- [ ] **3. merge 到 main 觸發部署：** `git checkout main && git merge fix/ingest-speed-progress && git push origin main`。Render 從 main 自動部署。
- [ ] **4. Render 端對端驗收：** redeploy 完成後上正式站傳 28 頁手寫，確認不再卡、進度真實、知識圖譜涵蓋整份。
- [ ] **5. 驗收通過後：** 把本段從 plan.md 移除，DEVLOG 那筆「待辦」打勾標記完成。

> **注意：** 這個分支沒有 `.github/workflows/react-doctor.yml`（那是 session 開始時就存在的未追蹤檔，與本任務無關，刻意不納入；目前 OAuth token 也無 `workflow` scope 可推送 workflow 檔）。

---

> **背景：** async ingest 已根治 502，但 28 頁手寫教材處理仍卡在第三階段（「建立圖譜與向量索引」）逾 210 秒，使用體驗差。診斷後鎖定兩個問題。

## 問題 1：向量索引慢（第三階段真兇）

- **成因：** `vector_store.py` 未指定 embedding function → ChromaDB 用預設本地 ONNX 模型（all-MiniLM，~80MB）。Render free tier（512MB RAM、慢 CPU、P6 每次 redeploy 磁碟歸零要重下載）下，首次 ingest 要「下載模型 + 載入 + CPU 推論」→ 卡數分鐘、近 OOM。
- **方案：** 有 Gemini 金鑰時改用 Gemini embedding API（text-embedding-004）自算向量傳給 Chroma，繞過本地模型；無金鑰回退原本地模型。
- **與 P6 關係：** 此改動讓向量計算不再依賴本地模型下載，順手減輕 P6 的 redeploy 重載痛點（但 Chroma 持久化本身仍是 P6 範疇）。

## 問題 2：進度條是假的

- **成因：** `SetupPanel.tsx` 進度純看 `elapsedSec`（>5 打勾步驟1、>15 打勾步驟2），**完全沒用後端真實 `stage`**。後端輪詢回應其實有帶 `stage`，但前端丟掉。
- **方案：** 輪詢時把真實 `stage` 透過 callback 拋回元件，步驟改由真實 stage 驅動；第三階段在 `pipeline.py` 細分多個 `_stage`；文案改成手寫較慢的合理預期。

## 影響範圍

| 檔案 | 改動 |
|---|---|
| `src/adaptlearn/gemini_client.py` | 新增 `embed_texts()`（google-genai `embed_content`，含錯誤降級） |
| `src/adaptlearn/vector_store.py` | 可選 embedder：有金鑰自算向量傳 Chroma、繞過本地模型；collection 依 backend 命名避免維度衝突（ONNX 384 vs Gemini 768）；查詢同 embedder |
| `src/adaptlearn/pipeline.py` | 傳 `self.gemini` 當 embedder；第三階段細分 `_stage` |
| `webapp/frontend/src/hooks/useApi.ts` | 輪詢回拋真實 `stage` |
| `webapp/frontend/src/components/SetupPanel.tsx` | 步驟由真實 stage 驅動 + 文案 |
| `webapp/static/*` | `npm run build` 重建並 commit |

## 風險
- 維度衝突 → collection 名稱帶 backend 自動隔離（本地舊 `data/chroma` 不受影響；Render P6 反正歸零）。
- 金鑰缺失 → Gemini embedding 失敗要優雅回退本地模型，不可讓 ingest 崩。
- 無 DB schema migration，不動 PostgreSQL。

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



# 朋友試用過後想增加或更改的功能

- 心智圖那邊不完整 整個黏在一起
- 抽取概念那邊 不太好看 要一直下滑 而且如果要看重點 感覺不太有用 並且感覺可以設定成是 一個重點 點進去在詳細講解
- 並且給的重點跟測驗題目難度差很多 不是在說測驗題目不好 反而我覺得測驗題目不錯 而是重點太沒用 看了也答不出來
- 要新增功能可以選是中文或是英文選項或是中文英文一起的 我朋友要讀生物學 但考試都會是英文所以想要有英文功能 