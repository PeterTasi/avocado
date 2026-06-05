# 知識圖譜路徑尋找模式 — 設計 Spec

> 日期：2026-06-05 ｜ 規劃：Opus ｜ 實作：Sonnet
> 對應 `plan.md` 的「🔵 知識圖譜路徑尋找模式」

---

## 1. 功能目標

把知識圖譜從「概念圓圈擺放」升級成「可追蹤學習路徑的心智圖」。

**核心體驗：** 使用者在圖上點兩個概念（起點 + 終點），系統用 BFS 找出最短學習路徑，
在圖上高亮「從 A 到 B 需要先學哪幾個概念」，非路徑節點變淡。

---

## 2. 設計決策（已與使用者確認）

| 決策 | 選擇 | 理由 |
|---|---|---|
| 畫布 | **沿用 `MindMapCanvas.tsx`**（放射狀 SVG） | 已上線、已套明亮設計語言、已有 pan/zoom/選取；`ForceGraphCanvas` 未掛 UI 且是舊深色主題，重配色成本高 |
| BFS 邊語意 | **只 `prerequisite` + `progression`（順向）** | 這兩種有明確先後語意；`related`/`semantic` 無嚴格先修，忽略 |
| 互動模式 | **點兩下節點**（第一下=起點、第二下=終點） | 最直覺、不佔版面 |
| 後端 | **零改動** | DOT 的邊方向與 relation 已足夠 |
| 新套件 | **不新增** | BFS 自寫純函式 |

### 關鍵語意確認（`knowledge_graph.py:264-267`）

邊 `source -> target`：**source 是先修概念、target 是需要它的概念**。
→ **順著箭頭方向就是學習順序**。BFS 從起點順向走到終點即可，無需反向。
`progression` 同理（前一章 → 後一章）。

---

## 3. 影響範圍

| 檔案 | 變更 |
|---|---|
| `webapp/frontend/src/utils/graphUtils.ts` | 新增 `findLearningPath()` 純函式 + `PathResult` 型別 |
| `webapp/frontend/src/components/MindMapCanvas.tsx` | 新增路徑模式 state、點擊分流、視覺高亮、控制列 |
| `webapp/frontend/src/components/KnowledgeGraphPanel.tsx` | 視需要傳遞/微調說明文字（最小改動） |

後端、資料庫、API：**不動**。

---

## 4. 元件設計

### 4.1 BFS 演算法（`utils/graphUtils.ts`，純函式可單測）

```ts
export interface PathResult {
  found: boolean;
  nodeIds: string[];      // 起點…終點的有序節點 id（含頭尾）
  edgeKeys: Set<string>;  // "src|tgt" 集合，用於高亮路徑邊
  steps: number;          // nodeIds.length - 1
}

export function findLearningPath(
  graph: ParsedGraph,
  startId: string | null,
  endId: string | null,
): PathResult;
```

行為：
1. 若 `startId`/`endId` 任一為空或相等 → 回傳 `{ found:false, nodeIds:[], edgeKeys:new Set(), steps:0 }`
2. 建 adjacency map：只收 `relation` 第一字（小寫）∈ `{prerequisite, progression}` 的邊，
   方向為 `source → target`（順向）
3. 標準 BFS（佇列 + visited + parent map）找 `startId → endId` 最短路徑（邊數最少）
4. 回溯 parent map 組出 `nodeIds`，產生 `edgeKeys`
5. 找不到 → `found:false`

純函式，不依賴 React，**獨立可測**。

### 4.2 互動狀態（收在 `MindMapCanvas.tsx` 內）

新增 state：
- `pathMode: boolean` — 工具列「路徑模式」按鈕切換
- `startId: string | null`、`endId: string | null`
- `pathResult = useMemo(() => findLearningPath(graph, startId, endId), [graph, startId, endId])`

點擊分流（`onClick` of concept node）：
- **path 模式關**：維持現狀 → 設 `selected`，顯示底部詳情卡
- **path 模式開**：
  - 尚無起點 → 設為起點
  - 有起點、無終點 → 設為終點（自動算路徑）
  - 起終皆有 → 重設為新起點、清空終點
- 空白處點擊 / 「清除」鈕 → 清空 `startId`、`endId`
- 切出 path 模式 → 清空 start/end

### 4.3 視覺高亮（SVG，沿用現有 render loop）

派生集合：
- `pathNodeSet = new Set(pathResult.nodeIds)`
- 高亮僅在 `pathMode && pathResult.found` 時啟用

節點：
- **起點**：綠框（`--high`）粗框 + 「起」標記
- **終點**：紅框（`--low`）粗框 + 「終」標記
- **路徑中間節點**：accent indigo 框、滿 opacity
- **非路徑節點**：`opacity 0.2`

邊：
- **路徑邊**（`edgeKeys` 命中）：粗 2.5px、accent 色、實線
- **非路徑邊**：`opacity 0.15`

未選齊（path 模式開但缺起點或終點）：節點全部正常顯示，不變淡。

### 4.4 控制列與回饋（覆蓋層，沿用現有 zoom 控制區樣式）

- 工具列：「路徑模式」toggle 按鈕 + 「清除」按鈕
- path 模式提示條：`點第一個概念設為起點，再點第二個設為終點`
- **找到路徑** → 頂部資訊條：`從 [A] 到 [B] · 共 N 步`，附有序概念名列（A → C → B）
- **fallback（找不到）**：`找不到先修路徑——可能 LLM 尚未建立完整的 prerequisite 關係，試試其他兩個概念`

---

## 5. 資料流

```
ParsedGraph (已有, 來自 parseDotGraph)
   │
   ├─ buildLayout() ──────────────► 節點座標（已有）
   │
   └─ findLearningPath(start,end) ─► PathResult
                                        │
                                        ├─ pathNodeSet ─► 節點高亮/變淡
                                        └─ edgeKeys ────► 邊高亮/變淡
```

使用者點擊 → 更新 `startId/endId` → `useMemo` 重算 `pathResult` → 重繪。
全程前端、無 API 呼叫。

---

## 6. 邊界情況與錯誤處理

| 情況 | 處理 |
|---|---|
| 起點 = 終點 | `found:false`，提示「請選不同的兩個概念」 |
| 無 prerequisite/progression 邊 | BFS 找不到 → fallback 文案 |
| 路徑不存在（方向不通） | fallback 文案，建議換概念 |
| 圖為空 | 維持現有空狀態（不顯示路徑模式按鈕或停用） |
| 終點在起點「上游」 | 順向 BFS 找不到 → fallback（語意上正確：不能反著學） |

---

## 7. 測試策略

- **`findLearningPath` 單元測試**（純函式，最有價值）：
  - 直線路徑 A→B→C
  - 多分支取最短
  - 無路徑回 `found:false`
  - 起=終回 `found:false`
  - 只含 related 邊時忽略、回 `found:false`
- **手動驗證**：匯入教材後，path 模式點兩節點，確認高亮與步數正確。
- `npm run build` 零錯誤。

---

## 8. 不做（YAGNI）

- 不做加權最短路徑（FSRS 掌握度加權）——競賽用最短邊數即可
- 不做多終點 / 路徑比較
- 不切換到 ForceGraphCanvas
- 不加後端 API 或 DB 欄位
- 不做路徑動畫（流動虛線）——保留為 nice-to-have，非必要

---

## 9. 執行規則（沿用 plan.md）

- 每改完一個檔案 → `npm run build` 零錯誤
- 完成後更新 `CLAUDE.md` 進度 + `DEVLOG.md`
- 分支：`feat/graph-path-finding`
