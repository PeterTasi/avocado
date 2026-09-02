import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConceptMastery } from "../hooks/useApi";
import { computeDagLayers, findLearningPath, traceWeakestUpstream } from "../utils/graphUtils";
import type { ParsedGraph, GraphNode, PathResult, TraceResult } from "../utils/graphUtils";

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

// 後端 _mastery_band 回傳 green/yellow/red；未作答視為「未測驗」。
// （舊版直接拿後端字串查 STATUS_COLORS，key 對不上 → 全部 fallback 成未測驗色。）
function normalizeStatus(m?: ConceptMastery): string {
  if (!m || m.attempts === 0) return "new";
  if (m.status === "green") return "mastered";
  if (m.status === "yellow") return "learning";
  if (m.status === "red") return "needs_review";
  return STATUS_COLORS[m.status] ? m.status : "new";
}

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

const READY_RING = "#4f46e5"; // indigo accent — 可以學了

// ── Types ────────────────────────────────────────────────────────────────────

type GateState = "mastered" | "ready" | "locked";

interface ConceptNode {
  id: string;
  name: string;
  chapter: string;
  x: number;
  y: number;
  w: number; // pill width（邊線起訖點要貼齊 pill 邊緣）
  status: string;
  mastery: number;
  gate: GateState;
  chapterColor: string;
}

interface Layout {
  concepts: ConceptNode[];
  maxLayer: number;
}

interface Props {
  graph: ParsedGraph;
  masteryItems: ConceptMastery[];
  courseName?: string; // 保留介面相容；技能樹佈局不再畫中心節點
}

// ── Layout constants ─────────────────────────────────────────────────────────

const SVG_W = 1000;
const SVG_H = 700;
const CY = SVG_H / 2;
const PILL_H = 30;
const MIN_PILL_W = 100;
const CHAR_W = 7.5;       // approximate px per character at font-size 11
const X_PAD = 120;        // 首末欄中心到畫布邊的距離（容納半個 pill）
const Y_PAD = 60;

function pillWidth(name: string): number {
  return Math.max(MIN_PILL_W, name.length * CHAR_W + 32);
}

function displayName(name: string): string {
  return name.length > 22 ? name.slice(0, 21) + "…" : name;
}

// ── Build layered skill-tree layout（左→右分層 DAG）─────────────────────────
// x = 先修深度（computeDagLayers）：越左越基礎，所有先修箭頭一律指右。
// 章節改用顏色表達（pill 邊框），不再佔據版面位置。

function buildLayout(graph: ParsedGraph, masteryById: Map<string, ConceptMastery>): Layout {
  const { layerOf, maxLayer } = computeDagLayers(graph);

  const chapterColor = new Map<string, string>();
  graph.chapters.forEach((ch, i) => chapterColor.set(ch, CHAPTER_PALETTE[i % CHAPTER_PALETTE.length]));
  const chapterIndex = new Map<string, number>();
  graph.chapters.forEach((ch, i) => chapterIndex.set(ch, i));

  // 掌握狀態 + 先修 gate（frontier 三態）
  const statusOf = new Map<string, string>();
  for (const node of graph.nodes) statusOf.set(node.id, normalizeStatus(masteryById.get(node.id)));

  const prereqPreds = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.relation.split(" ")[0].toLowerCase() !== "prerequisite") continue;
    if (e.source === e.target) continue;
    if (!prereqPreds.has(e.target)) prereqPreds.set(e.target, []);
    prereqPreds.get(e.target)!.push(e.source);
  }
  const gateOf = (id: string): GateState => {
    if (statusOf.get(id) === "mastered") return "mastered";
    const preds = prereqPreds.get(id) ?? [];
    return preds.every((p) => statusOf.get(p) === "mastered") ? "ready" : "locked";
  };

  // 分欄：x 按層等距；欄內按章節分組排序、y 等距置中
  const byLayer = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const layer = layerOf.get(node.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(node);
  }

  const xStep = maxLayer > 0 ? (SVG_W - 2 * X_PAD) / maxLayer : 0;
  const concepts: ConceptNode[] = [];

  for (const [layer, nodes] of byLayer) {
    nodes.sort((a, b) => {
      const ci = (chapterIndex.get(a.chapter) ?? 0) - (chapterIndex.get(b.chapter) ?? 0);
      return ci !== 0 ? ci : a.name.localeCompare(b.name, "zh-Hant");
    });
    const x = maxLayer > 0 ? X_PAD + layer * xStep : SVG_W / 2;
    const n = nodes.length;
    const yStep = n > 1 ? Math.max(PILL_H + 8, Math.min(64, (SVG_H - 2 * Y_PAD) / (n - 1))) : 0;
    const startY = CY - ((n - 1) * yStep) / 2;

    nodes.forEach((node, row) => {
      const m = masteryById.get(node.id);
      concepts.push({
        id: node.id,
        name: node.name,
        chapter: node.chapter,
        x,
        y: n > 1 ? startY + row * yStep : CY,
        w: pillWidth(displayName(node.name)),
        status: statusOf.get(node.id) ?? "new",
        mastery: m?.mastery ?? 0,
        gate: gateOf(node.id),
        chapterColor: chapterColor.get(node.chapter) ?? CHAPTER_PALETTE[0],
      });
    });
  }

  return { concepts, maxLayer };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MindMapCanvas({ graph, masteryItems }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(700);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [startId, setStartId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);

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

  // DOT 節點 id 就是後端 concept.id → 直接用 id 對掌握度，比名稱比對可靠
  const masteryById = useMemo(() => {
    const m = new Map<string, ConceptMastery>();
    for (const item of masteryItems) m.set(item.concept_id, item);
    return m;
  }, [masteryItems]);

  const layout = useMemo(() => buildLayout(graph, masteryById), [graph, masteryById]);

  // Position + pill width lookup for edge rendering
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number }>();
    for (const n of layout.concepts) m.set(n.id, { x: n.x, y: n.y, w: n.w });
    return m;
  }, [layout]);

  const pathResult: PathResult = useMemo(
    () => findLearningPath(graph, startId, endId),
    [graph, startId, endId],
  );

  // 卡關歸因：非路徑模式下點選「學習中/需複習」節點 → 回溯最弱先修鏈
  const traceResult: TraceResult = useMemo(() => {
    if (pathMode || !selected) {
      return { found: false, nodeIds: [], edgeKeys: new Set<string>(), weakestId: null };
    }
    const node = layout.concepts.find((c) => c.id === selected);
    if (!node || (node.status !== "needs_review" && node.status !== "learning")) {
      return { found: false, nodeIds: [], edgeKeys: new Set<string>(), weakestId: null };
    }
    return traceWeakestUpstream(graph, selected, (id) => {
      const m = masteryById.get(id);
      return m && m.attempts > 0 ? m.mastery : null;
    });
  }, [pathMode, selected, layout, graph, masteryById]);

  // 統一高亮：路徑模式用 BFS 路徑，一般模式用歸因鏈
  const highlight = pathMode
    ? (pathResult.found ? pathResult : null)
    : (traceResult.found ? traceResult : null);
  const highlightActive = highlight !== null;
  const hlNodeSet = useMemo(() => new Set(highlight?.nodeIds ?? []), [highlight]);
  const hlEdgeKeys = highlight?.edgeKeys ?? new Set<string>();

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

  // React 的 onWheel 是 passive listener，preventDefault() 會被瀏覽器拒絕並印錯誤；
  // 要擋掉整頁捲動只能自己用 { passive: false } 掛原生事件。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Mac pinch-to-zoom (ctrlKey=true on trackpad pinch) — slow factor
        const factor = e.deltaY < 0 ? 1.04 : 0.96;
        setZoom(z => Math.min(3, Math.max(0.25, z * factor)));
      } else {
        // Two-finger scroll → pan the canvas
        setPan(p => ({ x: p.x - e.deltaX / zoom, y: p.y - e.deltaY / zoom }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
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
  const weakestConcept = useMemo(
    () => layout.concepts.find(n => n.id === traceResult.weakestId),
    [layout, traceResult],
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of layout.concepts) m.set(n.id, n.name);
    return m;
  }, [layout]);

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
    >
      <svg
        width={containerW}
        height={Math.round(SVG_H * scale)}
        viewBox={`${-pan.x} ${-pan.y} ${SVG_W / zoom} ${SVG_H / zoom}`}
        style={{ display: "block" }}
      >
        <defs>
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
          <marker id="arr-axis" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill="#8b929c" />
          </marker>
        </defs>

        {/* ── 進度軸：越左越基礎 ── */}
        {layout.maxLayer > 0 && (
          <g>
            <text x={X_PAD - 60} y={26} fontSize="11" fontWeight="600" fill="#8b929c">基礎</text>
            <line
              x1={X_PAD - 24} y1={22} x2={SVG_W - X_PAD + 24} y2={22}
              stroke="#8b929c" strokeWidth="1.2" strokeDasharray="2,4" markerEnd="url(#arr-axis)"
            />
            <text x={SVG_W - X_PAD + 34} y={26} fontSize="11" fontWeight="600" fill="#8b929c">進階</text>
          </g>
        )}

        {/* ── Edges ── */}
        {graph.edges.map((edge, i) => {
          const src = posById.get(edge.source);
          const tgt = posById.get(edge.target);
          if (!src || !tgt) return null;

          const key = edge.relation.split(" ")[0].toLowerCase();
          // 「next」是後端人工章節串鏈（非語意關係）→ 歸入「全部關聯」開關
          const isCore = key === "prerequisite" || key === "progression";
          const onPathEdge = hlEdgeKeys.has(`${edge.source}|${edge.target}`);
          if (!showAllEdges && !isCore && !onPathEdge) return null;

          const color = RELATION_COLORS[key] ?? "#a78bfa";
          const isDashed = edge.style === "dashed" || key === "related" || key === "semantic" || key === "next";

          // 分層佈局：先修一律向右 → 水平三次貝茲（pill 右緣 → pill 左緣）
          const sxr = src.x + src.w / 2;
          const txl = tgt.x - tgt.w / 2;
          let d: string;
          if (txl - sxr > 12) {
            const mx = (sxr + txl) / 2;
            d = `M${sxr},${src.y} C${mx},${src.y} ${mx},${tgt.y} ${txl},${tgt.y}`;
          } else {
            // 同欄/回向邊（弱關聯、跨課程、被切斷的環）→ 側向弧線
            const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y) || 1;
            const perpX = (-(tgt.y - src.y) / dist) * 40;
            const perpY = ((tgt.x - src.x) / dist) * 40;
            const mx = (src.x + tgt.x) / 2;
            const my = (src.y + tgt.y) / 2;
            d = `M${src.x},${src.y} Q${mx + perpX},${my + perpY} ${tgt.x},${tgt.y}`;
          }

          const dimmed = highlightActive && !onPathEdge;
          return (
            <path
              key={`edge-${i}`}
              d={d}
              fill="none"
              stroke={onPathEdge ? READY_RING : color}
              strokeWidth={onPathEdge ? 2.6 : 1.8}
              strokeOpacity={dimmed ? 0.1 : onPathEdge ? 0.95 : 0.55}
              strokeDasharray={isDashed ? "5,3" : undefined}
              markerEnd={isCore ? `url(#arr-${key})` : undefined}
            />
          );
        })}

        {/* ── Concept nodes (pill shaped) ── */}
        {layout.concepts.map(node => {
          const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.new;
          const isSelected = node.id === selected;
          const pW = node.w;
          const label = displayName(node.name);
          const isStart = node.id === startId;
          const isEnd = node.id === endId;
          const onPath = hlNodeSet.has(node.id);
          const dimmed = highlightActive && !onPath;
          const lockedDim = node.gate === "locked" && !onPath && !isSelected;
          const ringColor = isStart ? "#0ea472" : isEnd ? "#e11d48" : READY_RING;

          return (
            <g
              key={node.id}
              className="mm-node"
              style={{
                cursor: "pointer",
                opacity: dimmed ? 0.2 : lockedDim ? 0.45 : 1,
                transition: "opacity 160ms var(--ease-out)",
              }}
              onClick={() => handleNodeClick(node.id)}
            >
              {/* Mastered glow */}
              {node.gate === "mastered" && (
                <rect
                  x={node.x - pW / 2 - 4}
                  y={node.y - PILL_H / 2 - 4}
                  width={pW + 8}
                  height={PILL_H + 8}
                  rx="20"
                  fill={`${STATUS_COLORS.mastered}18`}
                  filter="url(#mm-glow)"
                />
              )}
              {/* 可以學了：indigo 光環（今天該點開的節點） */}
              {node.gate === "ready" && (
                <rect
                  x={node.x - pW / 2 - 4}
                  y={node.y - PILL_H / 2 - 4}
                  width={pW + 8}
                  height={PILL_H + 8}
                  rx="20"
                  fill="none"
                  stroke={READY_RING}
                  strokeWidth="1.6"
                  strokeOpacity="0.55"
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
              {/* 先修未完成 → 小鎖 */}
              {node.gate === "locked" && (
                <text
                  x={node.x + pW / 2 - 13}
                  y={node.y + 0.5}
                  dominantBaseline="middle"
                  fontSize="10"
                >
                  🔒
                </text>
              )}
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

      {/* ── 路徑模式回饋 ── */}
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
                {pathResult.nodeIds.map((id) => nameById.get(id) ?? id).join(" → ")}
              </p>
            </div>
          ) : (
            <p className="text-[color:var(--text-secondary)]">
              找不到先修路徑——可能 LLM 尚未建立完整的 prerequisite 關係，試試其他兩個概念。
            </p>
          )}
        </div>
      )}

      {/* ── Selected node detail panel（非路徑模式；含卡關歸因） ── */}
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
          {traceResult.found && weakestConcept && (
            <div className="mt-2 border-t border-[color:var(--border)] pt-2">
              <p className="text-[color:var(--text-secondary)]">
                最可能的根因：
                <span className="font-semibold text-[color:var(--low)]">『{weakestConcept.name}』</span>
                {weakestConcept.status === "new"
                  ? "（還沒測驗過）"
                  : `（掌握度 ${Math.round(weakestConcept.mastery * 100)}%）`}
                ——先回去補它。
              </p>
              <p className="mt-1 text-[color:var(--text-muted)]">
                {traceResult.nodeIds.map((id) => nameById.get(id) ?? id).join(" → ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Legend ──────────────────────────────────────────────────────────────────

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
      <span className="border-l border-[color:var(--border)] pl-3">技能樹：</span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: READY_RING }} />
        <span className="text-[color:var(--text-secondary)]">可以學了</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span>🔒</span>
        <span className="text-[color:var(--text-secondary)]">先修未完成</span>
      </span>
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
