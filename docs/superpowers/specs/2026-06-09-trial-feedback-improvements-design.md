# AdaptLearn — 朋友試用回饋改善設計（Spec）

> 日期：2026-06-09
> 來源：`plan.md`「朋友試用過後想增加或更改的功能」4 條回饋
> 狀態：設計定案，待實作

## 背景與目標

朋友實際試用後給了 4 條回饋。本 spec 把它們轉成可實作的設計：

| # | 朋友的話 | 根因 | 本 spec 的解法 |
|---|---|---|---|
| 1 | 心智圖黏在一起 | `MindMapCanvas` 固定半徑放射狀，≤24 概念全擠同圈 → pill 重疊 | 自寫力導向佈局（不加套件），節點互斥、邊吸引、收斂後定住 |
| 2 | 概念清單要一直下滑、想點進去看詳解 | `ConceptSection` 是扁平捲動清單，每概念只一行 | 卡片網格 ＋ 右側滑出抽屜（Grid + Drawer） |
| 3 | 重點太沒用、跟測驗難度落差大 | 概念只有一句話 `description` | 結構化深度詳解（定義/重點/範例/誤區＋公式），**點開才生成（lazy）** |
| 4 | 想要中文/英文/中英語言選項 | prompt 寫死繁中輸出 | 學習內容支援 中/EN/中英對照；概念與測驗各自獨立切換；UI 維持中文 |

**設計總原則（使用者拍板）：**
- 語言只影響「學習內容」（概念詳解＋測驗題），**UI 一律維持中文**。語言切換是**通用功能**（任何科目），非生物專屬。
- 深度詳解**不在 ingest 預生**，採 **lazy**：使用者點開概念卡才生成那一個概念、用當下選的語言，並快取。→ **ingest 時間幾乎不變**（瓶頸是 1~2 分鐘的 OCR，與本案無關）。
- 不新增 npm 套件（沿用 `plan.md` 執行規則）。

---

## 功能一：心智圖力導向佈局（#1）

### 現況
`MindMapCanvas.tsx` 的 `buildLayout()`：章節節點放在 `R_CHAPTER=170` 的圈、概念節點全放在 `R_CONCEPT=340` 的同一圈，用 fan arc 分角度。概念多時角度被壓縮 → pill 重疊「黏在一起」。

### 設計
以**自寫的簡易力導向模擬**取代固定半徑放射，僅改 `buildLayout()`（及其回傳的座標），其餘渲染（章節色、邊、path-finding 高亮、pan/zoom）不動。

- **模型**：中心節點固定在 `(CX, CY)`；章節節點與概念節點為可動點。
- **三種力**：
  1. **斥力**（所有節點兩兩）：反平方排斥，把重疊的節點推開 — 解「黏在一起」的核心。
  2. **吸引力**（沿 edge）：連線的節點互相拉近，讓同章節概念群聚、prerequisite 連線變短。
  3. **向心力**（弱）：把整張圖輕拉回畫布中心，避免飄出邊界。
- **收斂**：固定迭代（約 200~300 次）後**定住座標**（不做持續動畫），確保 path-finding 高亮時節點不亂飄。以 `useMemo([graph])` 計算，graph 不變不重算。
- **初始化**：用現有放射狀座標當起始點（收斂快、結果穩定、避免每次 random 抖動）。
- **防出界**：座標 clamp 在 SVG viewBox 內留邊距；pill 寬度納入斥力半徑估算，避免長標籤仍重疊。

### 影響檔案
- `webapp/frontend/src/components/MindMapCanvas.tsx`：改寫 `buildLayout()` 為力導向（約 +70 行模擬迴圈）；座標型別與回傳介面維持，下游不受影響。

### 風險
- 自寫物理需調參（斥力強度、迭代次數）。節點數少（≤24）收斂穩定，風險可控。
- 若 graph 很大（理論上限 24 概念）效能仍 OK（一次性、非每幀）。

---

## 功能二：概念卡片網格 ＋ 抽屜詳解（#2）

### 設計
`ConceptSection` 由「扁平捲動清單」改為**卡片網格**：每個概念一張卡（名稱＋章節＋狀態色點），一眼掃完。點任一張 → 右側**滑出抽屜**顯示該概念的深度詳解（內容見功能三）。

### 抽屜互動與動畫（「活潑記憶點」風格，使用者選定）
- **背景退後＋模糊**：開抽屜時網格 `scale(.985)` ＋ `blur(2px)` ＋ 變淡，聚焦詳解。
- **抽屜滑入**：`translateX(100%)→0`，spring easing `cubic-bezier(.34,1.56,.64,1)`（尾端輕微回彈）。
- **酪梨 logo 蓋章進場**：抽屜標題列放**現有酪梨 logo**（重用 `PixelAvocadoLogo` / `assets/bibilavocado.png`），進場 `scale(0) rotate(-18deg)` → 過衝 `scale(1.12) rotate(4deg)` → 落定，像蓋章。
- **強調色光暈**：抽屜標題用該概念的**掌握度狀態色**（綠/琥珀/紅）暈開一道漸層。
- **區塊接力浮現**（stagger）：詳解 4 區塊依序 `translateY(8px)+fade` 浮上（延遲 .16/.23/.30/.37s）。
- **關閉**：點關閉鈕、點背景 scrim、或**按 Esc** 皆可關。關閉鈕旁附**淡淡一行「Esc 關閉」**提示讓使用者知道。

### 影響檔案
- `webapp/frontend/src/components/ConceptSection.tsx`：改為卡片網格 ＋ 觸發抽屜。
- 新增 `webapp/frontend/src/components/ConceptDrawer.tsx`：抽屜容器、動畫、Esc 監聽、載入詳解、概念語言切換。
- `webapp/frontend/src/index.css`：新增 spring easing、抽屜/scrim/stagger/酪梨蓋章等 class。

---

## 功能三：結構化深度詳解（lazy 生成）（#3）

### 內容結構（使用者選定 A/B/C/E ＋ D 自動）
每個概念詳解包含：
- **A 核心定義**：2-3 句完整定義（比現有一句深）。
- **B 關鍵重點**：條列 3-5 點考試必記要點。
- **C 範例 / 應用**：一個具體例子。
- **E 常見誤區**：容易答錯的地方。
- **D 公式 / 術語**：偵測到數學/公式時自動帶，沿用現有 KaTeX（`MathRenderer`）渲染（`$...$`）。

### Lazy 生成 ＋ 快取流程
1. **ingest 維持現狀**：只抽概念名稱／章節／短描述，**ingest 時間不變**。
2. **點開抽屜時**：前端呼叫 `GET /api/concepts/{id}/detail?lang=<zh|en>`。
3. 後端先查快取（`concept_details` 表）：
   - 命中 → 直接回。
   - 未命中 → 呼叫 Gemini 生成該語言詳解（單一概念，約 2~5 秒）→ 寫入快取 → 回。
4. **中英對照模式**：分別取 zh 與 en（各自 lazy／快取），抽屜內**上下堆疊**呈現（每區塊先英後中）。

### 資料模型（需 DB schema migration）
新增表 `concept_details`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| concept_id | text | FK → concepts.id |
| language | text | `'zh'` 或 `'en'` |
| definition | text | A 核心定義 |
| key_points | jsonb | B 重點陣列 |
| example | text | C 範例 |
| common_mistakes | text | E 常見誤區 |
| has_formula | boolean | D 是否含公式（前端決定是否走 KaTeX） |
| created_at | timestamptz | |

主鍵 `(concept_id, language)`。透過 `database.py` 的 `_run_migrations()` 自動建立（**append-only migration，不動既有表**）。

### 影響檔案
- `src/adaptlearn/gemini_client.py`：新增 `generate_concept_detail(concept, language)` → 回結構化 JSON（含降級：API 失敗回最小可用詳解，不讓抽屜空白）。
- `src/adaptlearn/models.py`：新增 `ConceptDetail` dataclass。
- `src/adaptlearn/database.py`：`concept_details` 表 migration ＋ get/save 查詢。
- `src/adaptlearn/pipeline.py`：`get_or_generate_concept_detail(concept_id, language)`（lazy＋快取邏輯）。
- `webapp/main.py`：新增 `GET /api/concepts/{id}/detail?lang=`（沿用 `@cached`/`@limiter` 模式）。
- `webapp/frontend/src/hooks/useApi.ts`：新增 `useConceptDetail(id, lang)`。

---

## 功能四：語言選項（#4）

### 範圍（使用者拍板）
- 只影響**學習內容**：概念詳解（功能三）＋測驗題目／參考答案。
- **UI 文字維持中文**，不做整站國際化。
- **概念頁與測驗頁各自獨立的語言切換**（互不連動）。
- 三段模式：`中文 / EN / 中英對照`。

### 概念詳解語言
由功能三的 lazy＋快取機制天然支援：切到哪個語言就取／生那個語言的快取；中英對照取兩種堆疊顯示。

### 測驗語言
- 測驗為 on-demand 生成（`POST /api/diagnostics/generate`），**新增 `language` 參數**，生成時用該語言出題。
- 切換測驗語言＝重新生成（測驗本來就是明確動作，無需額外快取表）。
- 中英對照：題目／答案雙語並陳（題幹下方附對照）。

### 切換鈕擺放
位置與視覺由實作時的設計判斷決定（沿用設計語言），不在本 spec 鎖死。原則：概念頁、測驗頁各一個三段切換，明顯但不搶戲。

### 影響檔案
- `src/adaptlearn/gemini_client.py`：`generate_questions(..., language)`；`generate_concept_detail(..., language)`（同功能三）。prompt 依語言切換輸出語言。
- `webapp/main.py`：`/api/diagnostics/generate` 接受 `language`。
- `webapp/frontend/src/hooks/useApi.ts`：quiz 生成帶 `language`。
- `webapp/frontend/src/components/QuizPanel.tsx`：測驗頁語言切換。
- 概念頁語言切換：在 `ConceptDrawer.tsx` / 概念頁容器。

---

## 整體影響檔案彙總

**後端**
- `src/adaptlearn/gemini_client.py` — 新增 `generate_concept_detail`、`generate_questions` 加 `language`
- `src/adaptlearn/models.py` — `ConceptDetail` dataclass
- `src/adaptlearn/database.py` — `concept_details` 表 migration ＋ 查詢
- `src/adaptlearn/pipeline.py` — lazy 詳解取／生
- `webapp/main.py` — `GET /api/concepts/{id}/detail`、`/api/diagnostics/generate` 加 `language`

**前端**
- `webapp/frontend/src/components/MindMapCanvas.tsx` — 力導向佈局
- `webapp/frontend/src/components/ConceptSection.tsx` — 卡片網格
- `webapp/frontend/src/components/ConceptDrawer.tsx`（新）— 抽屜＋動畫＋詳解＋語言切換
- `webapp/frontend/src/components/QuizPanel.tsx` — 測驗語言切換
- `webapp/frontend/src/hooks/useApi.ts` — `useConceptDetail`、quiz language
- `webapp/frontend/src/index.css` — 動畫 class、spring easing
- `webapp/static/*` — `npm run build` 重建並 commit

## 風險與注意

- **DB schema migration**（`concept_details`）：append-only、不動既有表，透過既有 `_run_migrations()` 流程。為本案唯一 schema 變更。
- **Gemini 降級**：詳解／測驗生成失敗要優雅降級（回最小可用內容或既有短描述），不可讓抽屜空白或測驗崩。
- **lazy 首開延遲**：點開概念首次約 2~5 秒，抽屜需有載入骨架（沿用 `LoadingSkeleton`），讓等待有回饋。
- **不加 npm 套件**：力導向自寫；前端須本機 build 後 commit `webapp/static/`。
- **既有失敗測試**（plan.md 記錄的 OCR 頁數訊息、integration async）與本案無關，不在本案範圍。

## 不做（YAGNI）

- UI 介面文字國際化。
- 概念詳解在 ingest 時預生（改用 lazy）。
- 測驗詳解的 per-language 快取表（測驗本就 on-demand 重生）。
- 心智圖持續動畫（收斂後定住即可）。
