# 知識圖譜路徑尋找模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在知識圖譜上點兩個概念，用前端 BFS 找最短學習路徑並高亮「從 A 到 B 要先學哪幾個概念」。

**Architecture:** 純前端。`utils/graphUtils.ts` 加一支純函式 `findLearningPath`（只走 prerequisite/progression 順向邊的 BFS）；`MindMapCanvas.tsx` 加路徑模式 state、點擊分流、SVG 高亮與控制列。後端、DB、API 不動。

**Tech Stack:** React 18 + TypeScript + 既有 SVG 渲染。測試用 Node v26 原生 TS 執行 + `node:assert`（不新增任何 npm 套件）。

**Spec:** `docs/superpowers/specs/2026-06-05-graph-path-finding-design.md`

---

## 前置：開分支

```bash
git checkout -b feat/graph-path-finding
```

## 檔案結構

| 檔案 | 責任 | 動作 |
|---|---|---|
| `webapp/frontend/src/utils/graphUtils.ts` | `PathResult` 型別 + `findLearningPath` 純函式 | Modify（檔尾新增） |
| `webapp/frontend/src/utils/graphUtils.path.test.ts` | BFS 單元測試（Node 執行，不被 vite 打包） | Create |
| `webapp/frontend/src/components/MindMapCanvas.tsx` | 路徑模式 state、點擊分流、高亮、控制列 | Modify |

> **測試執行方式說明：** 本專案前端沒有測試框架且禁止新增套件。Node v26 可直接執行 `.ts`（type-stripping），故測試檔用 `import assert from "node:assert"` 並以 `node <檔案>` 執行。該檔不被任何模組 import，vite build 不會打包它。

---

## Task 1: BFS 純函式 `findLearningPath`

**Files:**
- Create: `webapp/frontend/src/utils/graphUtils.path.test.ts`
- Modify: `webapp/frontend/src/utils/graphUtils.ts`（檔尾，line 141 之後新增）

- [ ] **Step 1: 寫失敗測試**

Create `webapp/frontend/src/utils/graphUtils.path.test.ts`:

```ts
import assert from "node:assert";
import { findLearningPath } from "./graphUtils.ts";
import type { ParsedGraph, GraphEdge } from "./graphUtils.ts";

// 用一串 id 與 edges 組出最小 ParsedGraph
function makeGraph(ids: string[], edges: GraphEdge[]): ParsedGraph {
  return {
    nodes: ids.map((id) => ({ id, name: id, chapter: "ch" })),
    edges,
    chapters: ["ch"],
  };
}
const e = (source: string, target: string, relation: string): GraphEdge => ({
  source,
  target,
  relation,
});

// 1. 直線路徑 A→B→C
{
  const g = makeGraph(
    ["A", "B", "C"],
    [e("A", "B", "prerequisite"), e("B", "C", "prerequisite")],
  );
  const r = findLearningPath(g, "A", "C");
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.nodeIds, ["A", "B", "C"]);
  assert.strictEqual(r.steps, 2);
  assert.ok(r.edgeKeys.has("A|B") && r.edgeKeys.has("B|C"));
}

// 2. 多分支取最短（A→D 直達優於 A→B→C→D）
{
  const g = makeGraph(
    ["A", "B", "C", "D"],
    [
      e("A", "B", "prerequisite"),
      e("B", "C", "prerequisite"),
      e("C", "D", "prerequisite"),
      e("A", "D", "progression"),
    ],
  );
  const r = findLearningPath(g, "A", "D");
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.nodeIds, ["A", "D"]);
  assert.strictEqual(r.steps, 1);
}

// 3. 無路徑（方向不通）→ found:false
{
  const g = makeGraph(["A", "B"], [e("A", "B", "prerequisite")]);
  const r = findLearningPath(g, "B", "A");
  assert.strictEqual(r.found, false);
  assert.deepStrictEqual(r.nodeIds, []);
}

// 4. 起點 = 終點 → found:false
{
  const g = makeGraph(["A", "B"], [e("A", "B", "prerequisite")]);
  const r = findLearningPath(g, "A", "A");
  assert.strictEqual(r.found, false);
}

// 5. 只有 related 邊（無向、忽略）→ found:false
{
  const g = makeGraph(["A", "B"], [e("A", "B", "related")]);
  const r = findLearningPath(g, "A", "B");
  assert.strictEqual(r.found, false);
}

// 6. null 參數 → found:false（不丟例外）
{
  const g = makeGraph(["A"], []);
  assert.strictEqual(findLearningPath(g, null, "A").found, false);
  assert.strictEqual(findLearningPath(g, "A", null).found, false);
}

console.log("ALL PATH TESTS PASSED");
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node webapp/frontend/src/utils/graphUtils.path.test.ts`
Expected: FAIL — `SyntaxError`/`does not provide an export named 'findLearningPath'`

- [ ] **Step 3: 實作 `findLearningPath`（最小實作）**

在 `webapp/frontend/src/utils/graphUtils.ts` 檔尾（line 141 `buildGraphLayout` 之後）新增：

```ts
// ── Learning-path BFS ────────────────────────────────────────────────────────

// 只有這兩種 relation 有明確「先學→後學」方向語意；其餘（related/semantic…）忽略。
const DIRECTED_RELATIONS = new Set(["prerequisite", "progression"]);

export interface PathResult {
  found: boolean;
  nodeIds: string[]; // 起點…終點的有序節點 id（含頭尾）
  edgeKeys: Set<string>; // "src|tgt"，用於高亮路徑邊
  steps: number; // nodeIds.length - 1
}

const EMPTY_PATH: PathResult = { found: false, nodeIds: [], edgeKeys: new Set(), steps: 0 };

/**
 * 用 prerequisite/progression 順向邊跑 BFS，找 startId→endId 的最短（邊數最少）學習路徑。
 * 邊 source→target 語意：source 是先修概念，順著方向就是學習順序。
 */
export function findLearningPath(
  graph: ParsedGraph,
  startId: string | null,
  endId: string | null,
): PathResult {
  if (!startId || !endId || startId === endId) return { ...EMPTY_PATH, edgeKeys: new Set() };

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(startId) || !nodeIds.has(endId)) return { ...EMPTY_PATH, edgeKeys: new Set() };

  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const rel = edge.relation.split(" ")[0].toLowerCase();
    if (!DIRECTED_RELATIONS.has(rel)) continue;
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  const parent = new Map<string, string>();
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  let reached = false;
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === endId) {
      reached = true;
      break;
    }
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!reached) return { ...EMPTY_PATH, edgeKeys: new Set() };

  const path: string[] = [];
  let node: string | undefined = endId;
  while (node !== undefined) {
    path.unshift(node);
    node = parent.get(node);
  }

  const edgeKeys = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    edgeKeys.add(`${path[i]}|${path[i + 1]}`);
  }

  return { found: true, nodeIds: path, edgeKeys, steps: path.length - 1 };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node webapp/frontend/src/utils/graphUtils.path.test.ts`
Expected: `ALL PATH TESTS PASSED`

- [ ] **Step 5: build 確認零錯誤**

Run: `cd webapp/frontend && npm run build`
Expected: build 成功、無 TS 錯誤

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/utils/graphUtils.ts webapp/frontend/src/utils/graphUtils.path.test.ts
git commit -m "feat(graph): findLearningPath BFS 純函式 + 單元測試"
```

---

## Task 2: 路徑模式 state 與點擊分流（MindMapCanvas）

**Files:**
- Modify: `webapp/frontend/src/components/MindMapCanvas.tsx`

> 此任務與 Task 3/4 動同一檔案；本任務先把 state 與互動接好，視覺高亮留給 Task 3。UI 無自動化測試，靠 `npm run build` + 手動驗證。

- [ ] **Step 1: import 路徑工具**

`MindMapCanvas.tsx` line 3 改為：

```ts
import { findLearningPath } from "../utils/graphUtils";
import type { ParsedGraph, GraphNode, PathResult } from "../utils/graphUtils";
```

- [ ] **Step 2: 新增 state**

在現有 `const [selected, setSelected] = useState<string | null>(null);`（line 156）之後新增：

```ts
  const [pathMode, setPathMode] = useState(false);
  const [startId, setStartId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);

  const pathResult: PathResult = useMemo(
    () => findLearningPath(graph, startId, endId),
    [graph, startId, endId],
  );
```

- [ ] **Step 3: 路徑模式控制函式**

在 `resetView`（line 217）之後新增：

```ts
  const clearPath = useCallback(() => {
    setStartId(null);
    setEndId(null);
  }, []);

  const togglePathMode = useCallback(() => {
    setPathMode((on) => {
      if (on) clearPath();
      return !on;
    });
    setSelected(null);
  }, [clearPath]);

  const handleNodeClick = useCallback(
    (id: string) => {
      if (!pathMode) {
        setSelected((cur) => (cur === id ? null : id));
        return;
      }
      // 路徑模式：第一下=起點、第二下=終點、第三下=重設新起點
      if (!startId || (startId && endId)) {
        setStartId(id);
        setEndId(null);
      } else if (id !== startId) {
        setEndId(id);
      }
    },
    [pathMode, startId, endId],
  );
```

- [ ] **Step 4: 概念節點 onClick 改用 `handleNodeClick`**

line 392 的 `onClick={() => setSelected(node.id === selected ? null : node.id)}`
改為：

```ts
              onClick={() => handleNodeClick(node.id)}
```

- [ ] **Step 5: 空白處點擊在路徑模式清空選取**

`onMouseDown`（line 189-193）改為：

```ts
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(".mm-node")) return;
    if (pathMode) clearPath();
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  }, [pathMode, clearPath]);
```

- [ ] **Step 6: build 確認零錯誤**

Run: `cd webapp/frontend && npm run build`
Expected: build 成功（此時 UI 尚無視覺變化，但不應有未使用變數錯誤——`pathResult`/`togglePathMode` 會在 Task 3/4 使用；若 build 因 unused 失敗，先在 Task 3/4 接上後再 build。可先跳到 Task 3 一起 build）

> 註：若 `npm run build` 因 `pathResult`/`togglePathMode` 暫時未使用而報錯，**不要 commit**，直接接續 Task 3，待視覺與控制列接上後一次 build。vite/esbuild 預設不因 unused 變數失敗，通常可通過。

- [ ] **Step 7: Commit**

```bash
git add webapp/frontend/src/components/MindMapCanvas.tsx
git commit -m "feat(graph): MindMapCanvas 路徑模式 state 與點擊分流"
```

---

## Task 3: 路徑視覺高亮（節點 + 邊）

**Files:**
- Modify: `webapp/frontend/src/components/MindMapCanvas.tsx`

- [ ] **Step 1: 派生高亮集合**

在 `pathResult` 的 useMemo 之後新增：

```ts
  const highlightActive = pathMode && pathResult.found;
  const pathNodeSet = useMemo(() => new Set(pathResult.nodeIds), [pathResult]);
```

- [ ] **Step 2: 邊的高亮/變淡**

在 cross-concept edges 區塊（line 307-340）內，`return` 的 `<path>` 之前計算高亮，並套用到 `strokeWidth`/`stroke`/`strokeOpacity`：

找到：

```ts
          return (
            <path
              key={`edge-${i}`}
              d={`M${src.x},${src.y} Q${mx + perpX},${my + perpY} ${tgt.x},${tgt.y}`}
              fill="none"
              stroke={color}
              strokeWidth="1.8"
              strokeOpacity="0.6"
```

改為：

```ts
          const onPath = pathResult.edgeKeys.has(`${edge.source}|${edge.target}`);
          const dimmed = highlightActive && !onPath;
          return (
            <path
              key={`edge-${i}`}
              d={`M${src.x},${src.y} Q${mx + perpX},${my + perpY} ${tgt.x},${tgt.y}`}
              fill="none"
              stroke={onPath ? "#4f46e5" : color}
              strokeWidth={onPath ? 2.6 : 1.8}
              strokeOpacity={dimmed ? 0.12 : onPath ? 0.95 : 0.6}
```

- [ ] **Step 3: 概念節點的高亮/變淡**

在概念節點 `.map`（line 381 起）的 `const color = ...` 之後新增：

```ts
          const isStart = node.id === startId;
          const isEnd = node.id === endId;
          const onPath = pathNodeSet.has(node.id);
          const dimmed = highlightActive && !onPath;
          const ringColor = isStart ? "#0ea472" : isEnd ? "#e11d48" : "#4f46e5";
```

接著把外層 `<g>` 加 opacity，並把 pill 的 `stroke`/`strokeWidth` 在路徑節點時覆蓋。

`<g>` 開頭（line 388-393）改為：

```ts
            <g
              key={node.id}
              className="mm-node"
              style={{ cursor: "pointer", opacity: dimmed ? 0.2 : 1, transition: "opacity 160ms var(--ease-out)" }}
              onClick={() => handleNodeClick(node.id)}
            >
```

pill `<rect>`（line 407-417）的 `stroke`/`strokeWidth`/`strokeOpacity` 改為：

```ts
                fill={isSelected ? `${color}18` : "#ffffff"}
                stroke={highlightActive && onPath ? ringColor : isSelected ? color : node.chapterColor}
                strokeWidth={highlightActive && onPath ? 2.6 : isSelected ? 2 : 1.2}
                strokeOpacity={highlightActive && onPath ? 1 : isSelected ? 1 : 0.65}
```

- [ ] **Step 4: 起/終點像素標記**

在概念節點 `<g>` 內、label `<text>`（line 426-435）之後、`</g>` 之前新增：

```ts
              {pathMode && (isStart || isEnd) && (
                <text
                  x={node.x - pW / 2 - 6}
                  y={node.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill={isStart ? "#0ea472" : "#e11d48"}
                >
                  {isStart ? "起" : "終"}
                </text>
              )}
```

- [ ] **Step 5: build 確認零錯誤**

Run: `cd webapp/frontend && npm run build`
Expected: build 成功、無 TS 錯誤

- [ ] **Step 6: Commit**

```bash
git add webapp/frontend/src/components/MindMapCanvas.tsx
git commit -m "feat(graph): 路徑節點/邊高亮、非路徑變淡、起終點標記"
```

---

## Task 4: 控制列與回饋（toggle / 清除 / 資訊條 / fallback）

**Files:**
- Modify: `webapp/frontend/src/components/MindMapCanvas.tsx`

- [ ] **Step 1: 路徑模式工具列（左上）**

在 zoom 控制 `<div className="absolute right-3 top-3 ...">`（line 442）之前新增左上工具列：

```tsx
      {/* ── 路徑模式工具列 ── */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={togglePathMode}
          className={pathMode ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
        >
          {pathMode ? "路徑模式：開" : "路徑模式"}
        </button>
        {pathMode && (startId || endId) && (
          <button type="button" onClick={clearPath} className="btn-secondary px-3 py-1.5 text-xs">
            清除
          </button>
        )}
      </div>
```

- [ ] **Step 2: 提示條 / 資訊條 / fallback（底部，與詳情卡互斥）**

把現有 selected 詳情卡區塊（line 460-479）整段，改為以下「路徑模式優先」的條件渲染。將：

```tsx
      {/* ── Selected node detail panel ─────────────────────────────── */}
      {selectedConcept && (
```

之前插入路徑回饋區塊，並讓詳情卡只在「非路徑模式」顯示：

```tsx
      {/* ── 路徑模式回饋（取代詳情卡） ── */}
      {pathMode && (
        <div className="absolute bottom-3 left-3 right-14 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-xs shadow-[var(--shadow-pop)]">
          {!startId || !endId ? (
            <p className="text-[color:var(--text-secondary)]">
              點第一個概念設為<span className="font-semibold text-[color:var(--high)]">起點</span>，再點第二個設為<span className="font-semibold text-[color:var(--low)]">終點</span>。
            </p>
          ) : pathResult.found ? (
            <div>
              <p className="font-semibold text-[color:var(--text-primary)]">
                共 {pathResult.steps} 步
              </p>
              <p className="mt-1 text-[color:var(--text-secondary)]">
                {pathResult.nodeIds
                  .map((id) => layout.concepts.find((c) => c.id === id)?.name ?? id)
                  .join(" → ")}
              </p>
            </div>
          ) : (
            <p className="text-[color:var(--text-secondary)]">
              找不到先修路徑——可能 LLM 尚未建立完整的 prerequisite 關係，試試其他兩個概念。
            </p>
          )}
        </div>
      )}

      {/* ── Selected node detail panel（僅非路徑模式） ── */}
      {!pathMode && selectedConcept && (
```

> 注意：原本 `{selectedConcept && (` 的條件改成 `{!pathMode && selectedConcept && (`，其餘詳情卡內容不變。

- [ ] **Step 3: build 確認零錯誤**

Run: `cd webapp/frontend && npm run build`
Expected: build 成功、無 TS 錯誤

- [ ] **Step 4: 手動驗證（啟動 dev）**

Run: `cd webapp/frontend && npm run dev`
手動檢查清單：
1. 預設（路徑模式關）：點節點仍顯示底部詳情卡 ✓
2. 點「路徑模式」→ 出現提示條 ✓
3. 點一個概念 → 出現「起」綠標 ✓
4. 點第二個概念 → 出現「終」紅標、路徑邊與節點高亮成 indigo、其餘變淡、底部顯示「共 N 步」與概念名列 ✓
5. 選兩個不連通的概念 → 顯示 fallback 文案 ✓
6. 點「清除」或空白處 → 重置 ✓
7. 再點「路徑模式：開」→ 關閉、回到一般模式 ✓

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/MindMapCanvas.tsx
git commit -m "feat(graph): 路徑模式控制列、步數資訊條與找不到路徑 fallback"
```

---

## Task 5: 文件更新與分支收尾

**Files:**
- Modify: `DEVLOG.md`、`CLAUDE.md`、`plan.md`

- [ ] **Step 1: DEVLOG.md 追加當日條目**

在 `DEVLOG.md` 適當位置（最新日期區塊）追加：

```markdown
## 2026-06-05 — 知識圖譜路徑尋找模式

- 新增 `findLearningPath`（`graphUtils.ts`）：prerequisite/progression 順向 BFS 找最短學習路徑，附 Node 原生 TS 單元測試（6 案例）。
- `MindMapCanvas` 加「路徑模式」：點兩下節點選起/終點，路徑節點與邊高亮 indigo、起綠終紅，非路徑變淡 opacity 0.2，底部顯示步數與概念順序，找不到路徑顯示 fallback。
- 後端、DB、API 零改動；未新增 npm 套件。
```

- [ ] **Step 2: CLAUDE.md 標記完成、plan.md 移除已完成項**

- `CLAUDE.md`「本日完成」區塊加一條：`✅ 知識圖譜路徑尋找模式（點兩節點 BFS 高亮學習路徑）`
- `plan.md` 刪除「🔵 待規劃：知識圖譜路徑尋找模式」整段（已完成移交 DEVLOG）

- [ ] **Step 3: Commit**

```bash
git add DEVLOG.md CLAUDE.md plan.md
git commit -m "docs: 知識圖譜路徑尋找模式完成，更新 DEVLOG/CLAUDE/plan"
```

- [ ] **Step 4: 合併回 main（待使用者說「可以合併」再執行）**

```bash
git checkout main
git merge --no-ff feat/graph-path-finding
git push origin main
```

---

## Self-Review 紀錄

- **Spec 覆蓋：** §4.1 BFS→Task1；§4.2 互動 state→Task2；§4.3 視覺高亮→Task3；§4.4 控制列/回饋→Task4；§7 測試→Task1 單元測試 + Task4 手動清單；§9 文件→Task5。全部對應。
- **型別一致：** `PathResult`/`findLearningPath` 在 Task1 定義，Task2-4 沿用相同 `nodeIds`/`edgeKeys`/`steps`/`found` 欄位名。
- **無 placeholder：** 各步驟含實際程式碼與可執行指令。
- **已知風險：** Task2 Step6 註明 unused 變數暫時性；esbuild 預設不因 unused 失敗，實務可通過，否則接 Task3 後一次 build。
