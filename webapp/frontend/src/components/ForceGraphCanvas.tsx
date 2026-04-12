import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ConceptMastery } from "../hooks/useApi";
import type { ParsedGraph } from "../utils/graphUtils";

// ── Colour palettes ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  mastered: "#22c55e",    // green
  learning: "#f59e0b",    // amber
  needs_review: "#ef4444", // red
  new: "#60a5fa",         // blue (not yet tested)
};

const LINK_COLORS: Record<string, string> = {
  prerequisite:   "#22d3ee",
  progression:    "#f59e0b",
  related:        "#a78bfa",
  equivalent:     "#f472b6",
  generalization: "#818cf8",
  analogy:        "#a3e635",
  semantic:       "#94a3b8",
  next:           "#64748b",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface FGNode {
  id: string;
  name: string;
  chapter: string;
  mastery: number;
  status: string;
  color: string;
  // injected at runtime by force-graph
  x?: number;
  y?: number;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  relation: string;
  isDashed: boolean;
  color: string;
}

interface Props {
  graph: ParsedGraph;
  masteryItems: ConceptMastery[];
}

const HEIGHT = 440;

// ── Component ─────────────────────────────────────────────────────────────────

export function ForceGraphCanvas({ graph, masteryItems }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);

  // Build lookup: lowercase name → mastery record
  const masteryByName = useMemo(() => {
    const m = new Map<string, ConceptMastery>();
    for (const item of masteryItems) m.set(item.name.toLowerCase(), item);
    return m;
  }, [masteryItems]);

  // Convert ParsedGraph → force-graph data format
  const graphData = useMemo(() => {
    const nodes: FGNode[] = graph.nodes.map((node) => {
      const m = masteryByName.get(node.name.toLowerCase());
      const status = m?.status ?? "new";
      return {
        id: node.id,
        name: node.name,
        chapter: node.chapter,
        mastery: m?.mastery ?? 0,
        status,
        color: STATUS_COLORS[status] ?? STATUS_COLORS.new,
      };
    });

    const links: FGLink[] = graph.edges.map((edge) => {
      const key = edge.relation.split(" ")[0].toLowerCase();
      return {
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        isDashed: edge.style === "dashed",
        color: LINK_COLORS[key] ?? "#a78bfa",
      };
    });

    return { nodes, links };
  }, [graph, masteryByName]);

  // Track container width for responsive canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.offsetWidth || 700);
    return () => ro.disconnect();
  }, []);

  // ── Canvas draw: nodes ─────────────────────────────────────────────────────

  const nodeCanvasObject = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = 5 + node.mastery * 5; // radius scales with mastery

      // Glow ring when mastered
      if (node.status === "mastered") {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(34,197,94,0.15)";
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.2 / globalScale;
      ctx.stroke();

      // Label (hides when too zoomed out)
      if (globalScale >= 0.4) {
        const fontSize = 12 / globalScale;
        const label = node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fillText(label, x, y + r + 2 / globalScale);
      }
    },
    [],
  );

  const nodePointerAreaPaint = useCallback(
    (node: FGNode, paintColor: string, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.fillStyle = paintColor;
      ctx.beginPath();
      ctx.arc(x, y, 5 + node.mastery * 5 + 4, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  // ── Canvas draw: links ─────────────────────────────────────────────────────

  const linkCanvasObject = useCallback((link: FGLink, ctx: CanvasRenderingContext2D) => {
    const src = link.source as FGNode;
    const tgt = link.target as FGNode;
    const sx = src.x ?? 0;
    const sy = src.y ?? 0;
    const tx = tgt.x ?? 0;
    const ty = tgt.y ?? 0;

    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const nr = 5 + ((src.mastery ?? 0) * 5); // shrink line to node edge
    const startX = sx + (dx / dist) * nr;
    const startY = sy + (dy / dist) * nr;
    const endX = tx - (dx / dist) * (nr + 6); // leave room for arrow
    const endY = ty - (dy / dist) * (nr + 6);

    ctx.beginPath();
    ctx.setLineDash(link.isDashed ? [5, 3] : []);
    ctx.strokeStyle = link.color;
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    const arrowLen = 7;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowLen * Math.cos(angle - Math.PI / 6),
      endY - arrowLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      endX - arrowLen * Math.cos(angle + Math.PI / 6),
      endY - arrowLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fillStyle = link.color;
    ctx.fill();
  }, []);

  // ── Tooltip ───────────────────────────────────────────────────────────────

  const nodeLabel = useCallback((node: FGNode) => {
    const pct = Math.round(node.mastery * 100);
    const statusLabel: Record<string, string> = {
      mastered: "已掌握",
      learning: "學習中",
      needs_review: "需複習",
      new: "未測驗",
    };
    return `<div style="background:rgba(10,18,40,0.92);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;font-size:13px;color:#fff;line-height:1.5">
      <strong>${node.name}</strong><br/>
      <span style="color:#94a3b8">${node.chapter}</span><br/>
      掌握度：${pct}%　${statusLabel[node.status] ?? ""}
    </div>`;
  }, []);

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!graph.nodes.length) {
    return (
      <div className="rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-4 text-xs text-white/62">
        目前沒有可視化的圖譜節點。
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-[24px] border border-white/12"
      style={{ background: "rgba(8,15,32,0.55)", height: HEIGHT }}
    >
      <ForceGraph2D<FGNode, FGLink>
        graphData={graphData as never}
        width={width}
        height={HEIGHT}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => "replace"}
        nodePointerAreaPaint={nodePointerAreaPaint as never}
        linkCanvasObject={linkCanvasObject as never}
        linkCanvasObjectMode={() => "replace"}
        nodeLabel={nodeLabel as never}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        cooldownTicks={80}
      />
    </div>
  );
}

// ── Mastery legend (exported for use in panel) ─────────────────────────────

export function MasteryLegend() {
  const items = [
    { color: STATUS_COLORS.mastered, label: "已掌握" },
    { color: STATUS_COLORS.learning, label: "學習中" },
    { color: STATUS_COLORS.needs_review, label: "需複習" },
    { color: STATUS_COLORS.new, label: "未測驗" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/62 border-t border-white/10 pt-2 mt-1">
      <span className="text-white/40">節點掌握度：</span>
      {items.map(({ color, label }) => (
        <span key={label} className="inline-flex items-center gap-1">
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
