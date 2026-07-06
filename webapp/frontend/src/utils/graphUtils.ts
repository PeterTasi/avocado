export const EDGE_COLORS: Record<string, string> = {
  prerequisite: "#22d3ee",
  progression: "#f59e0b",
  related: "#a78bfa",
  next: "#64748b",
  // cross-course bridges
  equivalent: "#f472b6",
  generalization: "#818cf8",
  analogy: "#a3e635",
  semantic: "#94a3b8",
};

export interface GraphNode {
  id: string;
  name: string;
  chapter: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  style?: "dashed";
}

export interface ParsedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  chapters: string[];
}

function decodeDotText(value = ""): string {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

export function parseDotGraph(dotSource: string): ParsedGraph {
  const emptyGraph: ParsedGraph = { nodes: [], edges: [], chapters: [] };
  if (!dotSource || typeof dotSource !== "string") return emptyGraph;

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();

  const lines = dotSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const nodeMatch = line.match(/^"([^"]+)"\s+\[(.*)\];?$/);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const attrs = nodeMatch[2] ?? "";
      const labelMatch = attrs.match(/label="((?:[^"\\]|\\.)*)"/);
      const decodedLabel = decodeDotText(labelMatch ? labelMatch[1] : nodeId);

      let name = decodedLabel || nodeId;
      let chapter = "核心概念";
      const chapterMatch = decodedLabel.match(/^(.*)\n\[(.*)\]$/s);
      if (chapterMatch) {
        name = chapterMatch[1].trim() || nodeId;
        chapter = chapterMatch[2].trim() || "核心概念";
      }

      nodeMap.set(nodeId, { id: nodeId, name, chapter });
      continue;
    }

    const edgeMatch = line.match(/^"([^"]+)"\s*->\s*"([^"]+)"(?:\s+\[(.*)\])?;?$/);
    if (edgeMatch) {
      const source = edgeMatch[1];
      const target = edgeMatch[2];
      const attrs = edgeMatch[3] ?? "";
      const relationMatch = attrs.match(/label="((?:[^"\\]|\\.)*)"/);
      const relation = decodeDotText(relationMatch ? relationMatch[1] : "related") || "related";
      const isDashed = attrs.includes("dashed");

      const dedupeKey = `${source}|${target}|${relation}`;
      if (!edgeSeen.has(dedupeKey)) {
        edgeSeen.add(dedupeKey);
        edges.push({ source, target, relation, ...(isDashed ? { style: "dashed" as const } : {}) });
      }
    }
  }

  const nodes = Array.from(nodeMap.values());
  const chapters = Array.from(new Set(nodes.map((n) => n.chapter ?? "核心概念")));

  return { nodes, edges, chapters };
}

export interface GraphLayout {
  positions: Record<string, { x: number; y: number }>;
  groupedByChapter: Map<string, GraphNode[]>;
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
}

export function buildGraphLayout(graph: ParsedGraph): GraphLayout {
  const groupedByChapter = new Map<string, GraphNode[]>();
  for (const chapter of graph.chapters) groupedByChapter.set(chapter, []);

  for (const node of graph.nodes) {
    const chapter = node.chapter ?? "核心概念";
    if (!groupedByChapter.has(chapter)) groupedByChapter.set(chapter, []);
    groupedByChapter.get(chapter)!.push(node);
  }

  const nodeWidth = 220;
  const nodeHeight = 68;
  const colGap = 86;
  const rowGap = 24;
  const paddingX = 28;
  const paddingTop = 54;
  const paddingBottom = 28;

  const chapters = Array.from(groupedByChapter.keys());
  const maxRows = Math.max(1, ...chapters.map((c) => groupedByChapter.get(c)!.length));

  const width = Math.max(700, paddingX * 2 + chapters.length * nodeWidth + Math.max(0, chapters.length - 1) * colGap);
  const height = Math.max(260, paddingTop + paddingBottom + maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap);

  const positions: Record<string, { x: number; y: number }> = {};
  chapters.forEach((chapter, chapterIndex) => {
    (groupedByChapter.get(chapter) ?? []).forEach((node, rowIndex) => {
      positions[node.id] = {
        x: paddingX + chapterIndex * (nodeWidth + colGap),
        y: paddingTop + rowIndex * (nodeHeight + rowGap),
      };
    });
  });

  return { positions, groupedByChapter, width, height, nodeWidth, nodeHeight };
}

// ── Learning-path BFS ────────────────────────────────────────────────────────

// 只有這兩種 relation 有明確「先學→後學」方向語意；其餘（related/semantic…）忽略。
const DIRECTED_RELATIONS = new Set(["prerequisite", "progression"]);

function relationKey(relation: string): string {
  return relation.split(" ")[0].toLowerCase();
}

// ── Layered DAG（技能樹分層）────────────────────────────────────────────────
// layer = 先修最長路徑深度：沒有先修 = 第 0 層，每往右一層代表「要先會左邊」。
// 先修方向因此變成閱讀方向（左→右），取代放射狀佈局的橫跨曲線。

export interface DagLayerResult {
  layerOf: Map<string, number>;
  maxLayer: number;
  /** 因環狀先修被切斷的回邊數（LLM 抽取偶爾成環；切斷後仍是 DAG） */
  droppedBackEdges: number;
}

export function computeDagLayers(graph: ParsedGraph): DagLayerResult {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const preds = new Map<string, string[]>();
  const touched = new Set<string>();

  for (const e of graph.edges) {
    if (!DIRECTED_RELATIONS.has(relationKey(e.relation))) continue;
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    if (!preds.has(e.target)) preds.set(e.target, []);
    preds.get(e.target)!.push(e.source);
    touched.add(e.source);
    touched.add(e.target);
  }

  const layerOf = new Map<string, number>();
  const onStack = new Set<string>();
  let droppedBackEdges = 0;

  const depth = (id: string): number => {
    const memo = layerOf.get(id);
    if (memo !== undefined) return memo;
    if (onStack.has(id)) {
      // 環：把回邊當不存在（記數），避免無限遞迴
      droppedBackEdges += 1;
      return 0;
    }
    onStack.add(id);
    let d = 0;
    for (const p of preds.get(id) ?? []) d = Math.max(d, depth(p) + 1);
    onStack.delete(id);
    layerOf.set(id, d);
    return d;
  };

  for (const id of touched) depth(id);

  let maxLayer = 0;
  for (const d of layerOf.values()) maxLayer = Math.max(maxLayer, d);

  // 孤立節點（沒有任何方向邊）：跟著同章節已分層節點的平均層，避免全部堆在第 0 層
  const chapterLayers = new Map<string, number[]>();
  for (const n of graph.nodes) {
    const d = layerOf.get(n.id);
    if (d === undefined) continue;
    if (!chapterLayers.has(n.chapter)) chapterLayers.set(n.chapter, []);
    chapterLayers.get(n.chapter)!.push(d);
  }
  for (const n of graph.nodes) {
    if (layerOf.has(n.id)) continue;
    const siblings = chapterLayers.get(n.chapter);
    const avg = siblings?.length
      ? Math.round(siblings.reduce((a, b) => a + b, 0) / siblings.length)
      : 0;
    layerOf.set(n.id, avg);
  }

  if (droppedBackEdges > 0) {
    console.warn(`[skill-tree] 偵測到環狀先修，切斷 ${droppedBackEdges} 條回邊後分層`);
  }
  return { layerOf, maxLayer, droppedBackEdges };
}

// ── 卡關歸因（weakest upstream chain）──────────────────────────────────────
// 從卡住的節點沿 prerequisite 邊回溯，每步挑掌握度最低的先修（未測驗視為 0），
// 直到遇到已掌握的先修或沒有先修為止。回傳「最上游弱點 → … → 目標」鏈。

export interface TraceResult {
  found: boolean;
  nodeIds: string[]; // 上游弱點在前、目標在後
  edgeKeys: Set<string>;
  weakestId: string | null; // 鏈上（不含目標）掌握度最低的節點
}

const EMPTY_TRACE: TraceResult = {
  found: false,
  nodeIds: [],
  edgeKeys: new Set(),
  weakestId: null,
};

export function traceWeakestUpstream(
  graph: ParsedGraph,
  targetId: string | null,
  masteryOf: (id: string) => number | null, // null = 未測驗
  masteredThreshold = 0.75,
  maxSteps = 6,
): TraceResult {
  if (!targetId) return { ...EMPTY_TRACE, edgeKeys: new Set() };

  const preds = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (relationKey(e.relation) !== "prerequisite") continue;
    if (e.source === e.target) continue;
    if (!preds.has(e.target)) preds.set(e.target, []);
    preds.get(e.target)!.push(e.source);
  }

  const chain: string[] = [targetId];
  const visited = new Set<string>([targetId]);
  let cur = targetId;

  for (let step = 0; step < maxSteps; step++) {
    const candidates = (preds.get(cur) ?? []).filter((p) => !visited.has(p));
    if (!candidates.length) break;
    // 掌握度最低者最可疑；未測驗（null）視為 0
    let culprit = candidates[0];
    let culpritScore = masteryOf(culprit) ?? 0;
    for (const c of candidates.slice(1)) {
      const s = masteryOf(c) ?? 0;
      if (s < culpritScore) {
        culprit = c;
        culpritScore = s;
      }
    }
    if (culpritScore >= masteredThreshold) break; // 上游都會了，兇手不在更上面
    chain.unshift(culprit);
    visited.add(culprit);
    cur = culprit;
  }

  if (chain.length < 2) return { ...EMPTY_TRACE, edgeKeys: new Set() };

  const edgeKeys = new Set<string>();
  for (let i = 0; i < chain.length - 1; i++) edgeKeys.add(`${chain[i]}|${chain[i + 1]}`);

  let weakestId = chain[0];
  let weakest = masteryOf(weakestId) ?? 0;
  for (const id of chain.slice(0, -1)) {
    const s = masteryOf(id) ?? 0;
    if (s < weakest) {
      weakestId = id;
      weakest = s;
    }
  }

  return { found: true, nodeIds: chain, edgeKeys, weakestId };
}

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
