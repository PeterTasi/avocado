import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConceptMastery } from "../hooks/useApi";
import { findLearningPath } from "../utils/graphUtils";
import type { ParsedGraph, GraphNode, PathResult } from "../utils/graphUtils";

// ── Colour palettes ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  mastered:     "#2a8c35",   // var(--high) — forest green
  learning:     "#b07828",   // var(--medium) — warm amber-brown
  needs_review: "#c44040",   // var(--low) — warm red
  new:          "#3d6b28",   // var(--accent) — deep avocado green
};

const STATUS_LABELS: Record<string, string> = {
  mastered: "已掌握",
  learning: "學習中",
  needs_review: "需複習",
  new: "未測驗",
};

// 10 distinct hues — avocado-harmonious palette
const CHAPTER_PALETTE = [
  "#3d6b28", "#7ab030", "#b07828", "#c44040",
  "#5a8f3a", "#8b5e1a", "#2a7a42", "#9e3a3a",
  "#6b8c30", "#4a6e50",
];

const RELATION_COLORS: Record<string, string> = {
  prerequisite:   "#2a8c35",   // forest green — must-know first
  progression:    "#b07828",   // warm amber — sequence
  related:        "#5a8f3a",   // medium avocado — related
  equivalent:     "#7ab030",   // yellow-green — equivalent
  generalization: "#3d6b28",   // deep avocado
  analogy:        "#8b5e1a",   // warm brown
  semantic:       "#a8a090",   // warm muted
  next:           "#a8a090",
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
const PILL_H = 30;
const MIN_PILL_W = 100;
const CHAR_W = 7.5;       // approximate px per character at font-size 11

function pillWidth(name: string): number {
  return Math.max(MIN_PILL_W, name.length * CHAR_W + 32);
}

function displayName(name: string): string {
  return name.length > 22 ? name.slice(0, 21) + "…" : name;
}

// ── Build radial mind-map layout（確定性扇區排版） ──────────────────────────
// 心智圖是樹（中心→章節→概念），所以用算術直接排：每個章節分到一個角度
// 扇區，概念沿扇區內的同心弧排列、弧長按 pill 寬度累加。這保證三件事：
// 章節聚類 100%、零重疊（不靠碰撞分離）、每次重整結果相同（demo 安全）。
// 之前的力導向版本會讓碰撞分離把概念推進別章的地盤、分支線橫跨整張圖。

function buildLayout(graph: ParsedGraph, masteryByName: Map<string, ConceptMastery>): Layout {
  const byChapter = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const ch = node.chapter || "核心概念";
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(node);
  }
  const chapterNames = Array.from(byChapter.keys());
  const N = Math.max(1, chapterNames.length);

  // 畫布寬扁（1000×700）→ 放射用橢圓（x 半徑 = y 半徑 × KX）。
  // 弧長間距一律以 y 半徑計算：橢圓上的局部弧長速度 ≥ ry（因 rx ≥ ry），
  // 所以用 ry 算出來的角距是保守值，必不重疊。
  const KX = 1.42;
  const RY_FIRST = 235;    // 概念第一圈 y 半徑
  const RING_DY = 62;      // 每往外一圈遞增
  const RY_CHAPTER = 155;  // 章節圓點的 y 半徑
  const ARC_GAP = 16;      // 同圈相鄰 pill 的弧長間距
  const GUTTER = 0.1;      // 扇區之間的角度間隙（rad）
  const SECTOR_PAD = 0.04; // 扇區內側留白（rad）

  // 1) 角度扇區：寬度按各章 pill 總寬比例分配（概念多/名字長的章節分更寬）
  const weights = chapterNames.map((ch) =>
    byChapter.get(ch)!.reduce((acc, n) => acc + pillWidth(displayName(n.name)) + ARC_GAP, 0),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = 2 * Math.PI - N * GUTTER;

  // 2) 逐章節排概念：弧上放不下就往外一圈；單顆 pill 比扇區還寬時置中成「輻條」
  type Placement = { node: GraphNode; chapter: string; angle: number; ring: number };
  const placements: Placement[] = [];
  const chapterMid = new Map<string, number>();
  const colorByChapter = new Map<string, string>();
  let maxRing = 0;
  let maxHw = 0;
  let angleStart = -Math.PI / 2; // 第一個扇區從正上方開始

  chapterNames.forEach((chapter, i) => {
    colorByChapter.set(chapter, CHAPTER_PALETTE[i % CHAPTER_PALETTE.length]);
    const span = usable * (weights[i] / totalWeight);
    const a0 = angleStart + GUTTER / 2 + SECTOR_PAD;
    const a1 = angleStart + GUTTER / 2 + span - SECTOR_PAD;
    const mid = (a0 + a1) / 2;
    chapterMid.set(chapter, mid);

    let ring = 0;
    let cursor = a0;
    for (const node of byChapter.get(chapter)!) {
      const w = pillWidth(displayName(node.name)) + ARC_GAP;
      maxHw = Math.max(maxHw, w / 2);
      let ry = RY_FIRST + ring * RING_DY;
      let da = w / ry;
      if (cursor + da > a1 && cursor > a0) {
        ring += 1;
        ry = RY_FIRST + ring * RING_DY;
        da = w / ry;
        cursor = a0;
      }
      const angle = da >= a1 - a0 ? mid : cursor + da / 2;
      placements.push({ node, chapter, angle, ring });
      cursor += da;
      maxRing = Math.max(maxRing, ring);
    }
    angleStart += span + GUTTER;
  });

  // 3) 自動 fit：外圈超出畫布時等比例縮小所有半徑（兩軸都檢查）
  const maxRy = RY_FIRST + maxRing * RING_DY;
  const fitY = (CY - 24 - PILL_H / 2) / (maxRy + PILL_H / 2);
  const fitX = (CX - 24) / (maxRy * KX + maxHw);
  const fit = Math.min(1, fitY, fitX);

  const concepts: ConceptNode[] = placements.map(({ node, chapter, angle, ring }) => {
    const ry = (RY_FIRST + ring * RING_DY) * fit;
    const m = masteryByName.get(node.name.toLowerCase());
    return {
      id: node.id, name: node.name, chapter,
      x: CX + ry * KX * Math.cos(angle),
      y: CY + ry * Math.sin(angle),
      status: m?.status ?? "new", mastery: m?.mastery ?? 0,
      chapterColor: colorByChapter.get(chapter)!,
    };
  });

  const chapters: ChapterNode[] = chapterNames.map((chapter) => {
    const mid = chapterMid.get(chapter)!;
    return {
      id: `__ch__${chapter}`, name: chapter,
      x: CX + RY_CHAPTER * fit * KX * Math.cos(mid),
      y: CY + RY_CHAPTER * fit * Math.sin(mid),
      color: colorByChapter.get(chapter)!,
    };
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
  const [showAllEdges, setShowAllEdges] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [startId, setStartId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);

  const pathResult: PathResult = useMemo(
    () => findLearningPath(graph, startId, endId),
    [graph, startId, endId],
  );

  const highlightActive = pathMode && pathResult.found;
  const pathNodeSet = useMemo(() => new Set(pathResult.nodeIds), [pathResult]);

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

  const clearPath = useCallback(() => {
    setStartId(null);
    setEndId(null);
  }, []);

  // ── Pan & zoom ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(".mm-node")) return;
    if (pathMode) clearPath();
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  }, [pathMode, clearPath]);

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
    if (e.ctrlKey) {
      // Mac pinch-to-zoom (ctrlKey=true on trackpad pinch) — slow factor
      const factor = e.deltaY < 0 ? 1.04 : 0.96;
      setZoom(z => Math.min(3, Math.max(0.25, z * factor)));
    } else {
      // Two-finger scroll → pan the canvas
      setPan(p => ({ x: p.x - e.deltaX / zoom, y: p.y - e.deltaY / zoom }));
    }
  }, [zoom]);

  const resetView = useCallback(() => { setPan({ x: 0, y: 0 }); setZoom(1); }, []);

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

  // ── Selected node info ────────────────────────────────────────────────────
  const selectedConcept = useMemo(
    () => layout.concepts.find(n => n.id === selected),
    [layout, selected],
  );

  if (!graph.nodes.length) {
    return (
      <div className="card-subtle rounded-xl p-4 text-xs text-[color:var(--text-muted)]">
        目前沒有可視化的圖譜節點。先匯入教材後系統會自動建立知識圖譜。
      </div>
    );
  }

  // Fit SVG to container width
  const scale = containerW / SVG_W;

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden rounded-2xl border border-[color:var(--border)]"
      style={{
        background: "var(--bg-subtle)",
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
          {/* Center gradient — avocado flesh to deep green */}
          <radialGradient id="mm-cg">
            <stop offset="0%" stopColor="#7ab030" />
            <stop offset="100%" stopColor="#2d5219" />
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
          const isCore = key === "prerequisite" || key === "progression" || key === "next";
          const onPathEdge = pathResult.edgeKeys.has(`${edge.source}|${edge.target}`);
          // 預設只畫先修/進展（路徑 demo 的主角）；弱關聯（related/semantic…）
          // 是視覺噪音大宗，由「全部關聯」開關控制。路徑上的邊永遠顯示。
          if (!showAllEdges && !isCore && !onPathEdge) return null;

          const color = RELATION_COLORS[key] ?? "#a78bfa";
          const isDashed = edge.style === "dashed" || key === "related" || key === "semantic";

          // Quadratic bezier curved away from center
          const mx = (src.x + tgt.x) / 2;
          const my = (src.y + tgt.y) / 2;
          const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
          // Push control point away from canvas center
          const perpX = (-(tgt.y - src.y) / dist) * 40;
          const perpY = ((tgt.x - src.x) / dist) * 40;

          const onPath = onPathEdge;
          const dimmed = highlightActive && !onPath;
          return (
            <path
              key={`edge-${i}`}
              d={`M${src.x},${src.y} Q${mx + perpX},${my + perpY} ${tgt.x},${tgt.y}`}
              fill="none"
              stroke={onPath ? "#4f46e5" : color}
              strokeWidth={onPath ? 2.6 : 1.8}
              strokeOpacity={dimmed ? 0.12 : onPath ? 0.95 : 0.6}
              strokeDasharray={isDashed ? "5,3" : undefined}
              markerEnd={
                key === "prerequisite" || key === "progression" || key === "next"
                  ? `url(#arr-${key})`
                  : undefined
              }
            />
          );
        })}

        {/* ── Center node (pixel-border square, 🎮) ── */}
        {/* Pixel staircase border offset rects */}
        <rect x={CX-26+2} y={CY-26}   width={52} height={52} rx="0" fill="none" stroke="#3d6b28" strokeWidth="2" strokeOpacity="0.3" />
        <rect x={CX-26}   y={CY-26+2} width={52} height={52} rx="0" fill="none" stroke="#3d6b28" strokeWidth="2" strokeOpacity="0.3" />
        {/* Center square body */}
        <rect x={CX-22} y={CY-22} width={44} height={44} rx="2" fill="#3d6b28" />
        <rect x={CX-22} y={CY-22} width={44} height={44} rx="2" fill="url(#mm-cg)" />
        <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontWeight="700">
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
          const isStart = node.id === startId;
          const isEnd = node.id === endId;
          const onPath = pathNodeSet.has(node.id);
          const dimmed = highlightActive && !onPath;
          const ringColor = isStart ? "#0ea472" : isEnd ? "#e11d48" : "#4f46e5";

          return (
            <g
              key={node.id}
              className="mm-node"
              style={{ cursor: "pointer", opacity: dimmed ? 0.2 : 1, transition: "opacity 160ms var(--ease-out)" }}
              onClick={() => handleNodeClick(node.id)}
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
              {/* Pill background — white surface on light bg */}
              <rect
                x={node.x - pW / 2}
                y={node.y - PILL_H / 2}
                width={pW}
                height={PILL_H}
                rx="10"
                fill={isSelected ? `${color}18` : "#ffffff"}
                stroke={highlightActive && onPath ? ringColor : isSelected ? color : node.chapterColor}
                strokeWidth={highlightActive && onPath ? 2.6 : isSelected ? 2 : 1.2}
                strokeOpacity={highlightActive && onPath ? 1 : isSelected ? 1 : 0.65}
              />
              {/* Mastery dot */}
              <circle
                cx={node.x - pW / 2 + 14}
                cy={node.y}
                r="4.5"
                fill={color}
              />
              {/* Concept label — dark text for light bg */}
              <text
                x={node.x - pW / 2 + 25}
                y={node.y}
                dominantBaseline="middle"
                fill="#16181d"
                fontSize="11"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {label}
              </text>
              {/* 起/終點標記 */}
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
            </g>
          );
        })}
      </svg>

      {/* ── 路徑模式工具列 ── */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={togglePathMode}
          className={pathMode ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
        >
          {pathMode ? "路徑模式：開" : "路徑模式"}
        </button>
        <button
          type="button"
          onClick={() => setShowAllEdges(v => !v)}
          className={showAllEdges ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
        >
          {showAllEdges ? "全部關聯：開" : "全部關聯"}
        </button>
        {pathMode && (startId || endId) && (
          <button type="button" onClick={clearPath} className="btn-secondary px-3 py-1.5 text-xs">
            清除
          </button>
        )}
      </div>

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
            className="btn-secondary flex h-7 w-7 items-center justify-center rounded-lg text-sm"
          >
            {label}
          </button>
        ))}
      </div>

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
        <div className="absolute bottom-3 left-3 right-14 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-xs shadow-[var(--shadow-pop)]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-[color:var(--text-primary)]">{selectedConcept.name}</p>
              <p className="mt-0.5 text-[color:var(--text-muted)]">{selectedConcept.chapter}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: STATUS_COLORS[selectedConcept.status] ?? STATUS_COLORS.new }}
              />
              <span className="text-[color:var(--text-secondary)]">
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
    <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--border)] pt-2 text-[11px] text-[color:var(--text-muted)]">
      <span>掌握度：</span>
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <i className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[key] }} />
          <span className="text-[color:var(--text-secondary)]">{label}</span>
        </span>
      ))}
      <span className="border-l border-[color:var(--border)] pl-3">邊線：</span>
      {[
        { color: RELATION_COLORS.prerequisite, label: "先修" },
        { color: RELATION_COLORS.progression,  label: "進展" },
        { color: RELATION_COLORS.related,       label: "相關" },
      ].map(({ color, label }) => (
        <span key={label} className="inline-flex items-center gap-1">
          <i className="inline-block h-0 w-5 border-t-2" style={{ borderColor: color }} />
          <span className="text-[color:var(--text-secondary)]">{label}</span>
        </span>
      ))}
    </div>
  );
}
