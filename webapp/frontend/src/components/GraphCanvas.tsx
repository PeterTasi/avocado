import { useMemo } from "react";
import { EDGE_COLORS, ParsedGraph, buildGraphLayout } from "../utils/graphUtils";

function shortLabel(value: string, max = 30): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

interface Props {
  graph: ParsedGraph;
}

export function GraphCanvas({ graph }: Props) {
  const layout = useMemo(() => buildGraphLayout(graph), [graph]);

  if (!graph.nodes.length) {
    return (
      <div className="rounded-lg border border-slate-800/70 bg-slate-950/70 p-4 text-xs text-slate-400">
        目前沒有可視化的圖譜節點。
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/70">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-[360px] w-full min-w-[680px]"
        role="img"
        aria-label="Knowledge graph visualization"
      >
        <defs>
          <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
        </defs>

        {Array.from(layout.groupedByChapter.entries()).map(([chapter], index) => (
          <text key={`chapter-${chapter}`} x={28 + index * (layout.nodeWidth + 86)} y={28} fill="#94a3b8" fontSize="11" letterSpacing="1.1">
            {chapter}
          </text>
        ))}

        {graph.edges.map((edge, index) => {
          const sourcePos = layout.positions[edge.source];
          const targetPos = layout.positions[edge.target];
          if (!sourcePos || !targetPos) return null;

          const startX = sourcePos.x + layout.nodeWidth;
          const startY = sourcePos.y + layout.nodeHeight / 2;
          const endX = targetPos.x;
          const endY = targetPos.y + layout.nodeHeight / 2;

          const direction = endX >= startX ? 1 : -1;
          const controlOffset = Math.max(52, Math.abs(endX - startX) * 0.45);
          const sameColumn = Math.abs(endX - startX) < 4;
          const bend = sameColumn ? 92 : controlOffset;
          const path = `M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;

          // Cross-course labels look like "equivalent (0.94)" — extract just the type word
          const relationKey = edge.relation.split(" ")[0].toLowerCase();
          const color = EDGE_COLORS[relationKey] ?? EDGE_COLORS[edge.relation] ?? EDGE_COLORS.related;
          const isCross = edge.style === "dashed";
          return (
            <path
              key={`edge-${edge.source}-${edge.target}-${index}`}
              d={path}
              fill="none"
              stroke={color}
              strokeOpacity="0.85"
              strokeWidth="1.8"
              markerEnd="url(#graph-arrow)"
              strokeDasharray={isCross || edge.relation === "progression" ? "5 4" : undefined}
            />
          );
        })}

        {graph.nodes.map((node) => {
          const pos = layout.positions[node.id];
          if (!pos) return null;
          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <rect width={layout.nodeWidth} height={layout.nodeHeight} rx="12" fill="#0f172a" stroke="#334155" />
              <text x="12" y="28" fill="#e2e8f0" fontSize="12" fontWeight="600">{shortLabel(node.name, 32)}</text>
              <text x="12" y="48" fill="#94a3b8" fontSize="11">{shortLabel(node.chapter, 28)}</text>
              <title>{`${node.name} [${node.chapter}]`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
