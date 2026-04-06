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
      let chapter = "Core Concepts";
      const chapterMatch = decodedLabel.match(/^(.*)\n\[(.*)\]$/s);
      if (chapterMatch) {
        name = chapterMatch[1].trim() || nodeId;
        chapter = chapterMatch[2].trim() || "Core Concepts";
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
  const chapters = Array.from(new Set(nodes.map((n) => n.chapter ?? "Core Concepts")));

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
    const chapter = node.chapter ?? "Core Concepts";
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
