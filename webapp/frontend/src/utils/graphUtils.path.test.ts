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
