# AdaptLearn 開發與除錯紀錄(DevLog)

> 本檔記錄專案的開發過程與除錯歷程,供日後製作海報與報告使用。
> 條目由新到舊,每段標註日期、症狀、根因、修法、驗證。

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

## 待辦(clear 後再處理)
- [ ] **安全**:debug 過程中金鑰曾在對話明文出現,建議事後更換或對金鑰加上 API 限制。
- [ ] **最終 end-to-end 驗證**:Render 換上新金鑰 + 設 `GEMINI_MODEL` + 重新部署後,
      重新上傳手寫 PDF 確認跑出真實概念。
- [ ] **UI/UX 重設計**:待匯入流程穩定後再做(優先序最低)。
