# AdaptLearn — 任務計畫

> **這份文件只保留尚未完成的事項。**
> 更新於 2026-06-05。

---

# 🎬 UI 動畫升級：Logo 生命感 + 微互動（2026-06-05）

> 分支：`feat/graph-path-finding`（直接在現有分支追加，不開新分支）
> 目標：不新增 npm 套件、純 CSS animation + 輕量 React hook、尊重 `prefers-reduced-motion`

## 範圍

**A — 比比拉布 Logo 動畫**（`PixelAvocadoLogo.tsx`）
- 登陸頁大圖（size=104）：閒置呼吸 + 輕微上下漂浮，讓吉祥物「活著」
- 頂欄小圖（size=30）：極輕微的漂浮，不搶注意力

**C — 元件微互動**（多個元件）
- 掌握度橫條：mount 時從 0 填充到實際值（動畫填充）
- DailyProgressRing：mount 時弧形從 0 畫到目標值
- MetricCardsGrid 數字：mount 時從 0 count-up 到實際數字
- 答題回饋：答對時 ✓ 圖示加 scale-bounce，答錯時 ✗ 加 shake（已有 keyframe，補齊觸發）

## 影響範圍

| 檔案 | 變更類型 |
|---|---|
| `webapp/frontend/src/components/PixelAvocadoLogo.tsx` | 新增 `animate` prop，加 CSS class |
| `webapp/frontend/src/index.css` | 新增 `@keyframes avocado-breathe`、`avocado-float`、`bar-fill-in`、`count-up`（用 CSS counter trick 或 JS） |
| `webapp/frontend/src/components/DailyProgressRing.tsx` | mount 時 `strokeDashoffset` 從滿值動畫到目標值（useEffect + CSS transition） |
| `webapp/frontend/src/components/MetricCardsGrid.tsx` | 新增 `useCountUp` hook，數字 mount 時 count-up |
| `webapp/frontend/src/components/MasteryTable.tsx` | `.mastery-bar-fill` 寬度從 0 → 目標（透過 CSS class toggle on mount） |

## 實作步驟

### Step 1 — CSS keyframes（`index.css`）
新增以下動畫，放在 `/* ─── Landing screen animations ─────────────────────────── */` 下方：
```css
/* Logo idle */
@keyframes avocado-breathe {
  0%, 100% { transform: scale(1) translateY(0); }
  40%       { transform: scale(1.035) translateY(-3px); }
  70%       { transform: scale(1.02) translateY(-1px); }
}
@keyframes avocado-float-subtle {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-2px); }
}
/* Mastery bar fill-in */
@keyframes bar-fill-in {
  from { width: 0; }
  to   { width: var(--bar-target-width); }
}
.mastery-bar-fill { animation: bar-fill-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both; }
```

### Step 2 — `PixelAvocadoLogo.tsx`
新增 `animate?: "idle" | "subtle" | "none"` prop（預設 `"none"`）：
- `"idle"` → `animation: avocado-breathe 3.6s ease-in-out infinite`（用於 size=104）
- `"subtle"` → `animation: avocado-float-subtle 4s ease-in-out infinite`（用於 size=30 頂欄）
更新 `LandingScreen.tsx` 傳 `animate="idle"`；更新 `App.tsx` 頂欄傳 `animate="subtle"`。

### Step 3 — `DailyProgressRing.tsx`
```tsx
// mount 時 strokeDashoffset 從 circumference → 目標值，利用 useEffect + CSS transition
const [animated, setAnimated] = useState(false);
useEffect(() => { const t = setTimeout(() => setAnimated(true), 80); return () => clearTimeout(t); }, []);
// SVG arc strokeDashoffset: animated ? targetOffset : circumference
// 在 SVG 的 <circle> 加 style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}
```

### Step 4 — `useCountUp` hook（新建 `src/hooks/useCountUp.ts`）
```ts
// 輕量 count-up：mount 後 600ms 線性從 0 → target（requestAnimationFrame）
// 用在 MetricCardsGrid 的數字顯示
// 尊重 prefers-reduced-motion：若 matchMedia 匹配則直接跳到最終值
```

### Step 5 — `MetricCardsGrid.tsx`
把 stat 數字用 `useCountUp(value, { duration: 600 })` 包起來。只處理純數字值（百分比、整數），字串直接顯示。

### Step 6 — `MasteryTable.tsx` / 掌握度橫條
Mount 後加 CSS class，讓 `bar-fill-in` keyframe 執行。用 `useEffect` + `requestAnimationFrame` 在 next tick 加 class（避免 SSR 和初始渲染問題）：
```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => { requestAnimationFrame(() => setMounted(true)); }, []);
// style={{ "--bar-target-width": `${pct}%`, width: mounted ? `${pct}%` : "0" } as React.CSSProperties}
```

## 品質要求
- `prefers-reduced-motion`：已有全域規則，無需額外處理
- 不新增 npm 套件
- 每個 Step 完成後跑 `npm run build` 確認零 TS 錯誤
- Logo 動畫 duration ≥ 3.5s（不能讓人覺得閃爍或焦慮）

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
