# AdaptLearn — 下一批任務計畫（給 Sonnet 執行）

> **這份文件是給下一個 session 用的執行計畫。**
> 目前 UI 全站亮色主題遷移已完成（第一批 + 第二批），所有 legacy-surface 已移除。
> 以下三個任務是使用者看到成果後提出的新需求（2026-06-04）。
>
> 設計總規範在 `CLAUDE.md`「UI/UX Redesign」章節，先讀那段。

---

# 🟢 第三批任務（優先順序由高到低）

## 任務 1：測驗題目 LaTeX 渲染（`QuizPanel.tsx`）

**問題：** 數學式如 `a_1, a_2, ..., a_n`、`C = AB + 3A - I` 目前以純文字顯示，在數學課程下不易閱讀。

**目標：** 用 KaTeX 把題目中的 LaTeX 語法（`$...$` 或 `\(...\)`）轉換成正確的數學符號。

**技術方案：**
1. 安裝 KaTeX：`npm install katex` + `import 'katex/dist/katex.min.css'`（frontend-only，符合 Render 不需 Node.js 的部署方式，因為靜態資源 build 後 commit）
2. 建立 `components/MathRenderer.tsx`：接收 `text: string`，用 regex 切出 `$...$` 區段，分別呼叫 `katex.renderToString()`，危險 HTML 用 `dangerouslySetInnerHTML`
3. `QuizPanel.tsx` 的題目文字 `currentQuestion.question_text` 換成 `<MathRenderer text={...} />`；grade result 的 `feedback` 和 `expected_answer` 也套用
4. 後端 `quiz_engine.py` prompt 可補充「數學式請以 $...$ 包住」，但前端 fallback（無 $ 時原樣顯示）已足夠
5. `npm run build` 零錯誤，目視確認矩陣式/特徵值式正確渲染

**注意：**
- KaTeX 是 Render build 前 npm install，產物 commit 到 `webapp/static/`，不違反「Render 無 Node.js」限制
- 若 quiz_engine 生成的題目沒有 $ 符號，MathRenderer 直接原樣顯示，不會壞

---

## 任務 2：跨 Session 資料庫概念殘留問題

**問題描述：** 使用者重新整理頁面後，產生測驗時仍使用前次 session 上傳教材所建立的概念（資料庫內有舊資料）。`sessionUploaded` gate 只保護首頁 stat cards 的顯示，但「產生題目」API 直接從 DB 撈所有概念，無法感知「這次 session 有沒有上傳」。

**根因：** 後端 `/api/diagnostics/generate` 從 DB 取全部 concepts 出題，不區分 session。前端 QuizPanel 的「產生題目」按鈕在任何時機都可觸發。

**修法選項（Opus 先決定方案再實作）：**

- **方案 A（推薦）：** 在「產生題目」按鈕旁加一個目前使用課程的提示（顯示 `activeCourseId`、上傳時間），讓使用者知道題目基於哪份教材。前端 `handleGenerate` 若 `!sessionUploaded` 先跳出確認 modal（「目前將使用上次上傳的教材產生題目，確認繼續？」）。這是非破壞性修法，不動資料庫。
- **方案 B：** 後端新增 `session_id` 欄位，每次 ingest 產生一個 session，quiz generation 只取最新 session 的 concepts。需要 DB schema migration。
- **方案 C：** 提供「清除課程」按鈕，讓使用者主動清除舊資料。

**建議先讀：** `webapp/main.py` 的 `/api/diagnostics/generate`、`src/adaptlearn/quiz_engine.py`

---

## 任務 3：Emil 動效升級 + 像素風格強化

**使用者回饋（2026-06-04）：** 按按鈕產生的轉場可以多一點，或像素風格更強烈。

**參考：** `.agents/skills/emil-design-eng/SKILL.md`（Emil Kowalski 設計工程哲學）

### 3-A：按鈕/互動轉場強化

Emil 原則：決策時慢、回應時快、絕不從 scale(0) 入場、只動 transform/opacity。

- **「產生題目」→ 題目出現**：題目 card 從 `opacity:0 + translateY(12px)` 滑入（240ms ease-out）
- **「送出作答」→ 評分結果**：grade result 區塊 `opacity:0 + scale(0.97)` → 正常（200ms ease-out），correct 時先有個短暫 `scale(1.02)` 彈跳
- **頁面切換 nav tab 點擊**：目前 `.view-enter` 只有 translateY，可加 `scale(0.985→1.0)` 微縮放入場
- **「送出作答」button 本身**：pressed state 加 `scale(0.96)` + 短暫 indigo glow（`box-shadow: 0 0 0 4px var(--accent-ring)`）
- **步驟進度條（Setup progress-step）**：步驟推進時加 `translateX(4px)→0` 的微位移提示

### 3-B：像素風格強化（競賽記憶點）

- **答對粒子**：從 3 顆增加到 6~8 顆，顏色混搭 `--high`/`--accent`/`--medium`，飛散角度分散（-30°~+30°）
- **Setup 掃描線**：`scan-line` 處理中時顏色改為 indigo，並在上傳區加一個 4x4 像素格子浮水印（`.pixel-grid-bg`，低透明度）
- **MindMap 中心節點**：像素邊框改用更明顯的 `box-shadow` 多層偏移（現在只有 1 層，改成 4 層從細到粗）
- **概念 pill hover**：加邊框 pixel-flash（border-color 在 100ms 內閃一下 indigo 再回來，用 keyframe）
- **熱力格子 hover**：格子放大 `scale(1.15)`，邊框變深（現在只有 opacity，可更明顯）

---

## 已完成（不要重做）

- ✅ 全站亮色主題 Light Professional（index.css + 6 個子元件 + App.tsx）
- ✅ LandingScreen + PixelAvocadoLogo
- ✅ Emil 基礎動效（easing token、scale(0.97) 按壓、prefers-reduced-motion）
- ✅ legacy-surface 完全移除

---

## 執行規則（延用）

- 每改完一個檔案 → `npm run build` 零錯誤
- 不新增 npm 套件（**例外：KaTeX 任務 1 可以加**）
- 不動後端 API/hooks（任務 2 除外）
- 完成後更新 `CLAUDE.md` 進度追蹤 + `DEVLOG.md`

---

# 🟢 本回合優先（2026-06-04 第二批）— 登入頁 + 像素酪梨 logo + 首頁/頂欄 Emil 級打磨

> **這是現在要做的。** 下方「子頁面遷移計畫（第一批）」維持不變、之後再做。
> 範圍：① 像素酪梨 logo ② 全螢幕極簡登入入口頁 ③ 首頁/頂欄動效打磨。
> **不動 4 個子頁面、不動後端/API/hooks、不新增 npm 套件。**
> 設計哲學依 Emil Kowalski（`.agents/skills/emil-design-eng/SKILL.md`）：自訂 easing 曲線、按壓 `scale(0.97)`、
> 絕不從 `scale(0)` 入場、進場慢/離場快、stagger 30–80ms、只動 `transform`/`opacity`、補 `prefers-reduced-motion`。

## 已確認的設計決策（使用者拍板，不要再改方向）

- **登入頁版面**：置中極簡 hero（大酪梨 logo → 字標 → tagline → 單一「開始學習 →」按鈕 → 小字「已支援 PDF・手寫・圖片」）。
- **logo 風格**：酪梨 + 脈搏混合 —— 深綠果皮 + 淺綠果肉，**果核位置畫一條 indigo 脈搏線（ECG）**，延續現有「學習脈搏」品牌記憶。
- **登入頁顯示時機**：`showLanding` 預設 `true`，**每次重新整理都會看到入場動畫**（競賽 demo 記憶點；屬「罕見/首次」動效，Emil 框架允許加 delight）。不需 sessionStorage 記憶。

---

## 任務 A：新增自訂 easing token + 按鈕回饋升級（`index.css`）

1. 在 `:root`（檔案最上方 token 區）新增 Emil 推薦的自訂 easing 變數：
   ```css
   --ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* UI 進/出場 */
   --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* 螢幕內移動 */
   --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* iOS 抽屜感 */
   ```
2. **按鈕按壓回饋**（現況 `index.css:167-197`）：
   - `.btn-primary` 的 `transition`（現為 `transform 0.12s ease`）→ 改 `transform 160ms var(--ease-out)`；
     `.btn-primary:active`（現 `translateY(1px)`）→ 改 `transform: scale(0.97);`。
   - `.btn-secondary` / `.btn-ghost` 各補上 `transform 160ms var(--ease-out)` 過渡與 `:active { transform: scale(0.97); }`。
   - 縮放細微（0.95–0.98），讓「介面在聽」。
3. **hover 位移加裝置守門**：帶 `transform`/上浮的 hover（`.card-interactive`、`.stat-card` hover 等）包進
   `@media (hover: hover) and (pointer: fine)`，避免觸控裝置誤觸。
4. **消滅 `transition: all`**：grep `transition: all` 逐一改成明確屬性（只列 `transform`/`opacity`/`background`/`color`/`border-color`）。
5. **補 `prefers-reduced-motion`**（檔案底部）：
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important; }
   }
   ```
6. **像素 token 確認**：確保 `.pixel-border`、`.pixel-grid-bg`、`.pixel-particle` 已存在（第一批有定義），缺則補（登入頁右下角用 `.pixel-grid-bg`）。

## 任務 B：像素酪梨 logo 元件（`components/PixelAvocadoLogo.tsx`）

> **⚠️ 使用者將自行設計 logo（2026-06-04）**。
> 目前 `PixelAvocadoLogo.tsx` 是暫時版本（AI 生成）。
> 使用者想要自己來設計最終版本，設計完成後替換 `PixelAvocadoLogo.tsx` 即可，
> 頂欄（`App.tsx`）和 `LandingScreen.tsx` 已正確引用，改元件內容就全站生效。
>
> **格式需求（保持相容）：**
> - export 名稱維持 `PixelAvocadoLogo`
> - props：`size?: number`（預設 32）、`className?`、`withPulse?: boolean`
> - 頂欄用 `size={30}`，登入頁用 `size={104}`

## 任務 C：全螢幕極簡登入入口頁（`components/LandingScreen.tsx`，新檔）

- props：`onEnter: () => void`。
- 版面：`min-h-screen` 置中（`flex flex-col items-center justify-center`），底色 `var(--bg-app)`，
  右下角放極淡 `.pixel-grid-bg`（低透明度、`pointer-events-none`、絕對定位）當品牌點綴。
- 內容由上而下：① `<PixelAvocadoLogo size={104} />` ② 字標 `AdaptLearn`（`.font-display`，大）
  ③ tagline「把教材變成測驗・複習・圖譜」（`--text-secondary`）④ `.btn-primary`「開始學習 →」⑤ 小字「已支援 PDF・手寫・圖片」（`--text-muted`）。
- **入場（stagger）**：5 元素各 `opacity:0→1` + `translateY(8px)→0` + `scale(0.96)→1`，`~360ms var(--ease-out)`，
  delay `0 / 50 / 100 / 150 / 200ms`。**禁止 `scale(0)`**。可在 `index.css` 加一個 `.landing-item` keyframe + `nth-child` delay。
- **離場（不對稱、要快）**：點按鈕 → 容器加 `data-leaving`（`opacity→0` + `scale(0.98)`，`~240ms var(--ease-out)`）→
  `setTimeout(onEnter, 240)`（或 `transitionend`）。離場比入場快（Emil：決策時慢、回應時快）。
- `prefers-reduced-motion` 由任務 A 全域守門涵蓋，元件內不必重複。

## 任務 D：`App.tsx` 整合 landing gate + 首頁/頂欄打磨

1. **gate state**：`const [showLanding, setShowLanding] = useState(true);`
   - `return (` 之後最前面：`if (showLanding) return <LandingScreen onEnter={() => setShowLanding(false)} />;`
     —— landing 期間**不渲染頂欄**（呼應「不要一進來全部按鈕都出現」）。
   - app shell 在 `showLanding=false` 時照常渲染；既有 `.view-enter` 自然接手，形成「登入頁淡出 → 儀表板淡入」。
2. **頂欄 brand**：依任務 B 換成 `<PixelAvocadoLogo size={30}/>`。
3. **nav active indicator** 過渡補 `var(--ease-out)`（`index.css` 對應 class）。
4. **首頁統計卡 stagger 入場**：首頁三張 `.stat-card` 入場各加 30–60ms 遞延（inline `style={{ animationDelay }}` 配既有 `.stat-animate-in`），保留 `CountUp`。

## 驗證（本回合）

```bash
cd webapp/frontend && npm run build        # 必須零錯誤
npm run dev                                # 看登入頁入場 → 點「開始學習」→ 淡出進首頁 → 頂欄酪梨 logo
grep -rn "transition: all" src/index.css   # 應為空
```
- 慢動作檢查（Emil）：入場 stagger 順、按鈕按壓 `scale(0.97)` 有回饋、離場比入場快、酪梨縮到 30px 可辨識。
- 完成後在 `CLAUDE.md`「實作進度追蹤」勾選本回合項目、`DEVLOG.md` 補 2026-06-04 條目。

## 已修復的 Bug（2026-06-04）

### Bug A：Landing 點「開始學習」跳到教材頁而非首頁
- **根因：** `App.tsx` 的 `onEnter` callback 只有 `setShowLanding(false)`，
  沒有重置路由；`activeView` 仍保留上次的 URL（如 `/setup`）→ 進入後直接顯示教材頁。
- **修法：** `onEnter` 改為 `() => { setShowLanding(false); navigateTo("home"); }`。

### Bug B：首頁 stat cards 顯示前一次 session 的殘留資料
- **根因：** `concept_count`、`reviewItems.length`、`accuracyPct`、`topChapter`、`topFocus`
  直接從 DB 拿，沒有被 `sessionUploaded` gate 保護，頁面重整後仍顯示舊資料。
- **修法：** 加 `sessionConceptCount`、`sessionReviewCount` 等 gated 變數，
  `topChapter`/`topFocus`/`accuracyPct` 都改為 `sessionUploaded ? 真實值 : 預設空值`。

---

## 目前狀態（已完成，不要重做）

- ✅ `index.css` — 已是完整 light 主題（tokens + utility classes + `.legacy-surface` 過渡層）
- ✅ `App.tsx` — 釘住頂欄 + 亮色首頁儀表板 + `CountUp` 計數動畫 + 問候卡裝飾 blob + date pill + 動態 accent bar + 工作流程 timeline + next-up 卡
- ✅ `DailyProgressRing.tsx` — 改為 SVG arc（更平滑，帶 transition 動畫）
- ✅ `InsightFeed.tsx` — 左側 3px 彩色 border + SVG 空狀態插圖

**目前 4 個子頁面（教材/測驗/複習/圖譜）內部仍是舊白字元件，被 `App.tsx` 用 `.legacy-surface` 暗色層包住保持可讀。**
你的工作就是把它們一個個改成亮色，然後拆掉 legacy 包裹。

---

## 🎮 像素風點綴方向（新方向，2026-06-04）

> **核心精神：明亮專業底 + 少量像素風裝飾**
> 不是把整站改成 8-bit 遊戲，而是在「有意義的裝飾位置」放像素元素，
> 讓競賽評審有印象點，同時保持清晰的資訊層次。

### 像素風適用位置

| 位置 | 手法 | 效果 |
|------|------|------|
| 空狀態插圖（空測驗、空圖譜、空複習） | 純 SVG 像素風小圖（2×2 grid 畫法） | 有趣，不枯燥 |
| 測驗答對粒子（`.particle`） | 從圓點改為 4×4 px 方塊飄散 | 像遊戲的答對特效 |
| 成就/里程碑 badge | 像素風星星/旗幟小 icon（SVG） | 學習達標時的小驚喜 |
| 知識圖譜節點（小概念 pill） | 節點邊框用像素 border（box-shadow 模擬，不依賴圖片） | 圖譜有科技+遊戲感 |
| 首頁 greeting 區裝飾 | 右下角 16×16 像素網格圖案（低透明度） | 品牌個性，不干擾閱讀 |

### 技術實作規則（像素風）

```css
/* 像素風邊框（用 box-shadow 模擬 1px 階梯感，不需圖片）*/
.pixel-border {
  box-shadow:
    2px 0 0 var(--border-strong),
    0 2px 0 var(--border-strong),
    -2px 0 0 var(--border-strong),
    0 -2px 0 var(--border-strong);
  border-radius: 0;  /* 像素風無圓角 */
}

/* 像素風裝飾圖案（背景 repeating-pattern） */
.pixel-grid-bg {
  background-image: repeating-conic-gradient(var(--bg-sunken) 0 25%, transparent 0 50%);
  background-size: 8px 8px;
  opacity: 0.4;
}

/* 方塊粒子（替代圓形 .particle）*/
.pixel-particle {
  width: 4px; height: 4px;
  border-radius: 0;  /* 方塊！ */
  background: var(--high);
  animation: float-up 0.8s ease-out forwards;
}
```

- **SVG 像素風插圖**：用 `<rect>` 畫 8×8 或 16×16 的格子圖案，不用圓角，顏色用設計 token
- **字體不改**：Plus Jakarta Sans 保留，像素風只在「裝飾性視覺」不在正文
- **克制原則**：一個頁面最多 1~2 個像素元素，不要搶主要資訊的視線

---

## 設計系統速查（直接用這些 class，不要自己發明）

定義都在 `webapp/frontend/src/index.css`。

**色彩 token（用 Tailwind 任意值語法 `text-[color:var(--xxx)]` 或在 className 套既有 class）：**
```
背景    --bg-app #f5f6f8 / --bg-surface #fff / --bg-subtle #f7f8fa / --bg-sunken #f0f1f4
邊框    --border / --border-strong / --border-hover
文字    --text-primary #16181d / --text-secondary #5a616b / --text-muted #8b929c
強調    --accent #4f46e5 (indigo) / --accent-soft #eef0fe
語意    --high #0ea472(綠) / --medium #d98a04(琥珀) / --low #e11d48(玫紅)  ← 只用在掌握度/難度
```

**現成 class：**
| 用途 | class |
|------|-------|
| 卡片 | `.card` `.card-flat` `.card-subtle` `.card-interactive`(hover上浮) |
| 按鈕 | `.btn-primary`(indigo) `.btn-secondary` `.btn-ghost` |
| 輸入框 | `.input`（focus 有 accent ring） |
| 標籤/狀態 | `.pill` `.tag-high/medium/low` `.status-dot(.live/.signal/.weak/.neural)` |
| 統計卡 | `.stat-card`（左側 accent-bar） |
| 掌握度條 | `.mastery-bar-track` + `.mastery-bar-fill` |
| 小標題 | `.section-eyebrow`（已是亮色 muted） |
| 數字 | `.stat-value` / `.font-mono-data`（DM Mono, tabular-nums） |
| 上傳區 | `.upload-zone`（hover/`.drag-over`）+ `.scan-line` |
| 進度步驟 | `.progress-step(.active/.done)` + `.progress-step-dot` |
| 測驗圓弧 | `.quiz-arc-track` / `.quiz-arc-fill` |
| 答題鈕 | `.answer-btn(.correct/.incorrect)` + `.particle`(答對粒子→改`.pixel-particle`) |
| 圖譜邊線動畫 | `.graph-edge-animated`（stroke-dashoffset 流動） |

---

## ⚠️ 黃金規則（每個檔案都適用）

1. **消滅所有 `text-white` / `text-white/NN`** → 換成 `text-[color:var(--text-primary)]`（主文字）、
   `text-[color:var(--text-secondary)]`（次要）、`text-[color:var(--text-muted)]`（最淡）。
   這是最重要的一條——白字在白底會消失。
2. **`glass-panel` / `glass-panel-strong` → `.card`**；**`glass-subpanel` → `.card-subtle`**；
   **`glass-button` → `.btn-secondary`**；**`glass-input` → `.input`**。
3. **超大圓角收斂**：`rounded-[28px]`/`[26px]`/`[22px]` 之類 → 用 `.card` 內建的 14px，或 `rounded-xl`(12px)。
4. **掌握度/難度顏色用語意 class**（`.tag-high` 等 / `.mastery-high` 等），不要自己調 rgba。
5. **改完一個子頁面，到 `App.tsx` 把該 view 外層的 `<div className="legacy-surface">` 拆掉**
   （改成普通 `<div className="space-y-6">` 或直接 fragment）。同時把該 view 在 `renderSubView()` 裡
   殘留的 `text-white/glass-*` 側欄面板也一併改成亮色（那些側欄 JSX 在 App.tsx 內，不在子元件）。
6. **每改完一個檔案就 `cd webapp/frontend && npm run build`，必須零錯誤**才算完成。
7. **每完成一項，更新 `CLAUDE.md`「實作進度追蹤」清單**把對應項目打勾（使用者明確要求）。

---

## 執行順序與各檔案目標

> 每個檔案動工前先 `Read` 它，看清楚現有 props / 結構，再改。不要憑空改。

### 任務 1：`components/SetupPanel.tsx` + App.tsx setup 側欄（教材頁，最優先）
- 把整個面板改亮色（card / 語意色 / 移除 white）。
- **上傳區**：用 `.upload-zone` 做一個大的拖曳區（icon + 「拖曳檔案至此或點擊選擇」），
  支援 drag-over 狀態（`onDragOver`/`onDrop` 切 `.drag-over`）。
- **處理中狀態**：ingesting 時用 3 步驟進度條（`.progress-step`：解析文件→抽取概念→建立圖譜），
  可在上傳區疊一條 `.scan-line`。現有的 `elapsedSec` 計時可保留顯示。
- **🎮 像素點綴**：上傳空狀態加入小型 SVG 像素風插圖（8×8 grid 資料夾/上傳圖示），
  掃描線（`.scan-line`）處理中時出現。
- 保留所有既有邏輯（`handleIngest`、`ocrFailed` 紅色警告、`llmDegraded` 黃色提示、`ConceptSection`）。
  注意 `ConceptSection.tsx` 也要一起改亮色（它列出已抽取概念）。
- App.tsx 裡 setup 的右側欄（系統模式/當前課程/教材摘要那塊 glass-panel-strong）改成 `.card`。
- 完成後移除 setup 的 `.legacy-surface`。

### 任務 2：`components/QuizPanel.tsx` + App.tsx quiz 側欄（測驗頁）
- 改亮色。題目卡用 `.card` 放大、選項用 `.answer-btn`。
- **圓弧進度**：頂部用 SVG 半圓 `.quiz-arc-track`/`.quiz-arc-fill`（stroke-dasharray 算進度）顯示第 N/總題。
- **答題回饋**：答對 → 選項加 `.correct` + 噴 2~3 個 **`.pixel-particle`**（4×4 方塊，絕對定位、向上飄）；
  答錯 → `.incorrect`（shake）並標出正解。
- **🎮 像素點綴**：答對粒子改為方塊（`.pixel-particle`），空測驗狀態加像素風空箱插圖。
- App.tsx quiz 右側欄（測驗前提醒）改 `.card`。
- 完成後移除 quiz 的 `.legacy-surface`。

### 任務 3：`components/StudyPanels.tsx`（含 `TonightPanel` + `StudyPlansPanel`）+ `components/MasteryTable.tsx`（複習頁）
- 全部改亮色。
- **TonightPanel**：保留率三節點視覺「`before%` → `+uplift%` → `after%`」用大數字 + 箭頭橫排。
- **掌握度列表/表格**：用 `.mastery-bar-track`/`.mastery-bar-fill` 漸層條呈現掌握度，
  狀態文字用 `.mastery-high/medium/low`。
- **🎮 像素點綴**：掌握度達 100% 的概念旁加一個像素風星星（`★` 或小 SVG），作為達成彩蛋。
- 完成後移除 review 的 `.legacy-surface`。

### 任務 4：`components/KnowledgeGraphPanel.tsx` + `components/MindMapCanvas.tsx` + `components/ClassHeatmapPanel.tsx`（圖譜頁）
- **MindMapCanvas**：心智圖配合亮底 —— 畫布背景改淺色（`--bg-subtle`），
  節點/邊線顏色改成在淺底可讀（概念 pill 用語意色、章節用既有調色盤但加深）。
  邊線可加 `.graph-edge-animated` 做訊號流動。
- **🎮 像素點綴**：中心課程節點加 `.pixel-border`（無圓角方塊感），強調為「核心」；
  邊線動畫顏色與 signal flow 保持 indigo 系。
- **ClassHeatmapPanel**：從數字列表改成 **熱力格子**（類似 GitHub contribution）——
  每個概念一格，色塊深淺/紅綠代表錯誤率（用 `--low`→`--high` 插值或分級）。
  **格子本身就是像素風** — 2px gap、無圓角、hover 時顯示 tooltip。
- `KnowledgeGraphPanel` 外框與控制鈕（+/−/⟳）改亮色 `.btn-secondary`。
- 完成後移除 graph 的 `.legacy-surface`。

### 任務 5（收尾）：清理 + 像素風彙整
- 4 個 `.legacy-surface` 都移除後，把 `index.css` 裡的 `.legacy-surface` 整段 CSS 刪掉。
- 確認 `index.css` 已有 `.pixel-border`、`.pixel-grid-bg`、`.pixel-particle` 的定義（若無則補）。
- 全站 grep 確認沒有殘留 `text-white`、`glass-panel`、`glass-subpanel`、`floating-orb`、`demo-` class
  （`grep -rn "text-white\|glass-panel\|glass-subpanel\|floating-orb\|demo-" webapp/frontend/src`）。
- 最終 `npm run build` 零錯誤。
- `DEVLOG.md` 補一則 2026-06-04 的條目記錄這次 UI 改版（給海報/報告用）。

---

## 驗證指令

```bash
cd webapp/frontend
npm run build          # 每改完一個檔案都要跑，必須零錯誤
# 想實際看效果：
npm run dev            # http://localhost:5173（需後端在 :8000，或單看畫面也行）
```

產物會輸出到 `webapp/static/`（Render 部署前要 build 並 commit）。

---

## 注意事項

- **不要新增 npm 套件**（Render 部署限制）。純 React + Tailwind + SVG。
- **不要動後端 / API / hooks 的邏輯**，只改視覺層（className、JSX 結構、必要的 local state 如 drag-over）。
- 中文文案面向使用者、英文面向 log（既有慣例）。
- 改 JSX 時保留所有既有 props 與資料流（concepts、tonight、reviewItems、masteryItems… 照舊傳）。
- 有疑問先 `Read` 該元件 + 對照 `App.tsx` 怎麼呼叫它。
- **像素風是點綴不是主題**：每頁最多 1~2 個像素元素，主要資訊仍用 Plus Jakarta Sans + 明亮主題。

