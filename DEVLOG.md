# AdaptLearn 開發與除錯紀錄(DevLog)

> 本檔記錄專案的開發過程與除錯歷程,供日後製作海報與報告使用。
> 條目由新到舊,每段標註日期、症狀、根因、修法、驗證。

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

## 待辦(clear 後再處理)

- [ ] **Bug 4**:既有壞測試 `tests/test_unit.py::test_scanned_pdf_uses_configurable_ocr_page_limit`
      使用已移除的 `Settings(database_path=...)` 欄位(SQLite→PostgreSQL 遷移後改名 `database_url`),
      且需真實 PostgreSQL 才能跑。修法:更新為 `database_url`。
- [ ] **安全**:debug 過程中金鑰曾在對話明文出現,建議事後更換或對金鑰加上 API 限制。
- [ ] **最終 end-to-end 驗證**:Render 換上新金鑰 + 設 `GEMINI_MODEL` + 重新部署後,
      重新上傳手寫 PDF 確認跑出真實概念。
- [ ] **UI/UX 重設計**:待匯入流程穩定後再做(優先序最低)。
