import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConceptMastery } from "../hooks/useApi";
import type { ParsedGraph, GraphNode } from "../utils/graphUtils";

// ── Colour palettes ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  mastered: "#22c55e",
  learning: "#f59e0b",
  needs_review: "#ef4444",
  new: "#60a5fa",
};

const STATUS_LABELS: Record<string, string> = {
  mastered: "已掌握",
  learning: "學習中",
  needs_review: "需複習",
  new: "未測驗",
};

// 10 distinct hues for chapter branches
const CHAPTER_PALETTE = [
  "#818cf8", "#f472b6", "#34d399", "#fbbf24",
  "#60a5fa", "#a78bfa", "#fb7185", "#4ade80",
  "#facc15", "#38bdf8",
];

const RELATION_COLORS: Record<string, string> = {
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

interface ConceptNode {
  id: string;
  name: string;
  chapter: string;
  x: number;
  y: number;
  status: string;
  mastery: number;
  chapterColor: string;
  description?: string;
}

interface ChapterNode {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
}

interface Layout {
  concepts: ConceptNode[];
  chapters: ChapterNode[];
}

interface Props {
  graph: ParsedGraph;
  masteryItems: ConceptMastery[];
  courseName?: string;
}

// ── Layout constants ─────────────────────────────────────────────────────────

const SVG_W = 1000;
const SVG_H = 700;
const CX = SVG_W / 2;
const CY = SVG_H / 2;
const R_CHAPTER = 170;    // chapter node ring radius
const R_CONCEPT  = 340;   // concept node ring radius
const PILL_H = 30;
const MIN_PILL_W = 100;
const CHAR_W = 7.5;       // approximate px per character at font-size 11

function pillWidth(name: string): number {
  return Math.max(MIN_PILL_W, name.length * CHAR_W + 32);
}

function displayName(name: string): string {
  return name.length > 22 ? name.slice(0, 21) + "…" : name;
}

// ── Build radial mind-map layout ─────────────────────────────────────────────

function buildLayout(graph: ParsedGraph, masteryByName: Map<string, ConceptMastery>): Layout {
  const byChapter = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const ch = node.chapter || "核心概念";
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(node);
  }

  const chapterNames = Array.from(byChapter.keys());
  const N = chapterNames.length;
  const concepts: ConceptNode[] = [];
  const chapters: ChapterNode[] = [];

  chapterNames.forEach((chapter, i) => {
    const baseAngle = (2 * Math.PI * i) / N - Math.PI / 2;
    const color = CHAPTER_PALETTE[i % CHAPTER_PALETTE.length];

    // Chapter node
    chapters.push({
      id: `__ch__${chapter}`,
      name: chapter,
      x: CX + R_CHAPTER * Math.cos(baseAngle),
      y: CY + R_CHAPTER * Math.sin(baseAngle),
      color,
    });

    // Concepts
    const nodes = byChapter.get(chapter)!;
    const M = nodes.length;
    // Fan arc: grows with M but stays within ±75°
    const fanHalf = Math.min((Math.PI / 3) * (M / 4 + 0.4), Math.PI * 0.6);

    nodes.forEach((node, j) => {
      const angle =
        M === 1
          ? baseAngle
          : baseAngle + fanHalf * ((j / (M - 1)) * 2 - 1);

      const m = masteryByName.get(node.name.toLowerCase());
      concepts.push({
        id: node.id,
        name: node.name,
        chapter,
        x: CX + R_CONCEPT * Math.cos(angle),
        y: CY + R_CONCEPT * Math.sin(angle),
        status: m?.status ?? "new",
        mastery: m?.mastery ?? 0,
        chapterColor: color,
      });
    });
  });

  return { concepts, chapters };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MindMapCanvas({ graph, masteryItems, courseName = "課程" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(700);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.0);
  const [selected, setSelected] = useState<string | null>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Responsive container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    setContainerW(el.offsetWidth || 700);
    return () => ro.disconnect();
  }, []);

  const masteryByName = useMemo(() => {
    const m = new Map<string, ConceptMastery>();
    for (const item of masteryItems) m.set(item.name.toLowerCase(), item);
    return m;
  }, [masteryItems]);

  const layout = useMemo(() => buildLayout(graph, masteryByName), [graph, masteryByName]);

  // Position lookup for edge rendering
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.concepts) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [layout]);

  // ── Pan & zoom ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(".mm-node")) return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx / zoom, y: p.y + dy / zoom }));
  }, [zoom]);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.88;
    setZoom(z => Math.min(3, Math.max(0.25, z * factor)));
  }, []);

  const resetView = useCallback(() => { setPan({ x: 0, y: 0 }); setZoom(1); }, []);

  // ── Selected node info ────────────────────────────────────────────────────
  const selectedConcept = useMemo(
    () => layout.concepts.find(n => n.id === selected),
    [layout, selected],
  );

  if (!graph.nodes.length) {
    return (
      <div className="rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-4 text-xs text-white/62">
        目前沒有可視化的圖譜節點。
      </div>
    );
  }

  // Fit SVG to container width
  const scale = containerW / SVG_W;

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden rounded-[24px] border border-white/12"
      style={{
        background: "rgba(6,12,28,0.7)",
        height: Math.round(SVG_H * scale),
        cursor: dragging.current ? "grabbing" : "grab",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <svg
        width={containerW}
        height={Math.round(SVG_H * scale)}
        viewBox={`${-pan.x} ${-pan.y} ${SVG_W / zoom} ${SVG_H / zoom}`}
        style={{ display: "block" }}
      >
        <defs>
          {/* Center gradient */}
          <radialGradient id="mm-cg">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#4338ca" />
          </radialGradient>
          {/* Glow filter */}
          <filter id="mm-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Arrow markers per relation */}
          {Object.entries(RELATION_COLORS).map(([rel, color]) => (
            <marker
              key={rel}
              id={`arr-${rel}`}
              markerWidth="7" markerHeight="7"
              refX="6" refY="3.5"
              orient="auto"
            >
              <path d="M0,0 L0,7 L7,3.5 z" fill={color} fillOpacity="0.75" />
            </marker>
          ))}
        </defs>

        {/* ── Trunk lines: center → chapter ── */}
        {layout.chapters.map(ch => (
          <line
            key={`trunk-${ch.id}`}
            x1={CX} y1={CY} x2={ch.x} y2={ch.y}
            stroke={ch.color} strokeWidth="3" strokeOpacity="0.35"
            strokeLinecap="round"
          />
        ))}

        {/* ── Branch lines: chapter → concept ── */}
        {layout.concepts.map(node => {
          const ch = layout.chapters.find(c => c.name === node.chapter);
          if (!ch) return null;
          return (
            <line
              key={`branch-${node.id}`}
              x1={ch.x} y1={ch.y} x2={node.x} y2={node.y}
              stroke={node.chapterColor} strokeWidth="1.5" strokeOpacity="0.25"
              strokeLinecap="round"
            />
          );
        })}

        {/* ── Cross-concept edges (prerequisite / progression) ── */}
        {graph.edges.map((edge, i) => {
          const src = posById.get(edge.source);
          const tgt = posById.get(edge.target);
          if (!src || !tgt) return null;

          const key = edge.relation.split(" ")[0].toLowerCase();
          const color = RELATION_COLORS[key] ?? "#a78bfa";
          const isDashed = edge.style === "dashed" || key === "related" || key === "semantic";

          // Quadratic bezier curved away from center
          const mx = (src.x + tgt.x) / 2;
          const my = (src.y + tgt.y) / 2;
          const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
          // Push control point away from canvas center
          const perpX = (-(tgt.y - src.y) / dist) * 40;
          const perpY = ((tgt.x - src.x) / dist) * 40;

          return (
            <path
              key={`edge-${i}`}
              d={`M${src.x},${src.y} Q${mx + perpX},${my + perpY} ${tgt.x},${tgt.y}`}
              fill="none"
              stroke={color}
              strokeWidth="1.8"
              strokeOpacity="0.6"
              strokeDasharray={isDashed ? "5,3" : undefined}
              markerEnd={
                key === "prerequisite" || key === "progression" || key === "next"
                  ? `url(#arr-${key})`
                  : undefined
              }
            />
          );
        })}

        {/* ── Center node ── */}
        <circle cx={CX} cy={CY} r={30} fill="rgba(67,56,202,0.2)" filter="url(#mm-glow)" />
        <circle cx={CX} cy={CY} r={24} fill="url(#mm-cg)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="12" fontWeight="700">
          {courseName.length > 5 ? courseName.slice(0, 5) : courseName}
        </text>

        {/* ── Chapter nodes ── */}
        {layout.chapters.map(ch => (
          <g key={ch.id} className="mm-node" style={{ cursor: "default" }}>
            {/* Halo */}
            <circle cx={ch.x} cy={ch.y} r={22} fill={`${ch.color}20`} />
            {/* Circle */}
            <circle
              cx={ch.x} cy={ch.y} r={17}
              fill={`${ch.color}bb`}
              stroke="rgba(255,255,255,0.25)" strokeWidth="1.2"
            />
            {/* Label below circle */}
            <text
              x={ch.x}
              y={ch.y + 25}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill={ch.color}
              fontSize="10"
              fontWeight="600"
              style={{ maxWidth: 100 }}
            >
              {ch.name.length > 12 ? ch.name.slice(0, 11) + "…" : ch.name}
            </text>
          </g>
        ))}

        {/* ── Concept nodes (pill shaped) ── */}
        {layout.concepts.map(node => {
          const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.new;
          const isSelected = node.id === selected;
          const pW = pillWidth(displayName(node.name));
          const label = displayName(node.name);

          return (
            <g
              key={node.id}
              className="mm-node"
              style={{ cursor: "pointer" }}
              onClick={() => setSelected(node.id === selected ? null : node.id)}
            >
              {/* Mastered glow */}
              {node.status === "mastered" && (
                <rect
                  x={node.x - pW / 2 - 4}
                  y={node.y - PILL_H / 2 - 4}
                  width={pW + 8}
                  height={PILL_H + 8}
                  rx="20"
                  fill={`${color}18`}
                  filter="url(#mm-glow)"
                />
              )}
              {/* Pill background */}
              <rect
                x={node.x - pW / 2}
                y={node.y - PILL_H / 2}
                width={pW}
                height={PILL_H}
                rx="15"
                fill={isSelected ? `${color}40` : "rgba(12,20,44,0.82)"}
                stroke={isSelected ? color : `${node.chapterColor}70`}
                strokeWidth={isSelected ? 1.8 : 1}
              />
              {/* Mastery dot */}
              <circle
                cx={node.x - pW / 2 + 14}
                cy={node.y}
                r="4.5"
                fill={color}
              />
              {/* Concept label */}
              <text
                x={node.x - pW / 2 + 25}
                y={node.y}
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.92)"
                fontSize="11"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Zoom controls ─────────────────────────────────────────── */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        {[
          { label: "+", action: () => setZoom(z => Math.min(3, z * 1.2)) },
          { label: "−", action: () => setZoom(z => Math.max(0.25, z / 1.2)) },
          { label: "⟳", action: resetView },
        ].map(({ label, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm text-white hover:bg-white/20 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Selected node detail panel ─────────────────────────────── */}
      {selectedConcept && (
        <div className="absolute bottom-3 left-3 right-14 rounded-[14px] border border-white/15 bg-[rgba(8,14,36,0.92)] px-4 py-2.5 text-xs backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-white">{selectedConcept.name}</p>
              <p className="mt-0.5 text-white/50">{selectedConcept.chapter}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: STATUS_COLORS[selectedConcept.status] ?? STATUS_COLORS.new }}
              />
              <span className="text-white/70">
                {STATUS_LABELS[selectedConcept.status] ?? selectedConcept.status}
                　{Math.round(selectedConcept.mastery * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mastery legend ─────────────────────────────────────────────────────────

export function MindMapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-2 text-[11px] text-white/62">
      <span className="text-white/40">掌握度：</span>
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[key] }} />
          {label}
        </span>
      ))}
      <span className="border-l border-white/12 pl-3 text-white/40">邊線：</span>
      {[
        { color: RELATION_COLORS.prerequisite, label: "先修" },
        { color: RELATION_COLORS.progression,  label: "進展" },
        { color: RELATION_COLORS.related,       label: "相關" },
      ].map(({ color, label }) => (
        <span key={label} className="inline-flex items-center gap-1">
          <i className="inline-block h-0 w-5 border-t-2" style={{ borderColor: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
