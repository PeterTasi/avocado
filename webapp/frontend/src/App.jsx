import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  CardSkeleton,
  ListItemSkeleton,
  MetricCardSkeleton,
  TableRowSkeleton,
} from "./components/LoadingSkeleton";
import {
  useHealth,
  useConcepts,
  useConceptMastery,
  useChapterMastery,
  useTonightDashboard,
  useIngestMaterial,
  useGenerateDiagnostics,
  useGradeQuestion,
  useKnowledgeGraph,
  useRecalculateReview,
  useReviewPlan,
  useSaveApiKey,
} from "./hooks/useApi";
import {
  Activity,
  BookCheck,
  Brain,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  Network,
  Search,
  Sparkles,
  Target,
  UserCircle2,
} from "lucide-react";

const ModuleSparkline = lazy(() => import("./components/ModuleSparkline"));

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "study", label: "Study Plans", icon: CalendarClock },
  { key: "graph", label: "Knowledge Graph", icon: Network },
];

const FALLBACK_INSIGHTS = [
  {
    id: "fallback-1",
    title: "AI 建議：安排下一次複習",
    description: "依忘記曲線，2 小時內安排一次短複習可明顯提升保留率。",
    impact: "預估保留率 +3.8%",
    level: "high",
  },
  {
    id: "fallback-2",
    title: "AI 建議：切換題型",
    description: "先做 2 題基礎題再做 1 題進階題，能降低認知負荷。",
    impact: "預估答對率 +2.4%",
    level: "medium",
  },
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  const n = Number(value || 0);
  return `${(n * 100).toFixed(1)}%`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildTrend(progress, seed = 1) {
  const p = clamp(progress);
  const base = Math.max(8, p - 18);
  const wave = [0, 4, -3, 6, -2, 7, 3, 9];
  return wave.map((offset, index) => ({
    v: clamp(base + offset + seed * (index % 2 === 0 ? 1 : -1)),
  }));
}

const EDGE_COLORS = {
  prerequisite: "#22d3ee",
  progression: "#f59e0b",
  related: "#a78bfa",
  next: "#64748b",
};

function shortLabel(value, max = 30) {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function decodeDotText(value = "") {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

function parseDotGraph(dotSource) {
  const emptyGraph = { nodes: [], edges: [], chapters: [] };
  if (!dotSource || typeof dotSource !== "string") {
    return emptyGraph;
  }

  const nodeMap = new Map();
  const edges = [];
  const edgeSeen = new Set();

  const lines = dotSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const nodeMatch = line.match(/^"([^"]+)"\s+\[(.*)\];?$/);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const attrs = nodeMatch[2] || "";
      const labelMatch = attrs.match(/label="((?:[^"\\]|\\.)*)"/);
      const decodedLabel = decodeDotText(labelMatch ? labelMatch[1] : nodeId);

      let name = decodedLabel || nodeId;
      let chapter = "Core Concepts";
      const chapterMatch = decodedLabel.match(/^(.*)\n\[(.*)\]$/s);
      if (chapterMatch) {
        name = chapterMatch[1].trim() || nodeId;
        chapter = chapterMatch[2].trim() || "Core Concepts";
      }

      nodeMap.set(nodeId, {
        id: nodeId,
        name,
        chapter,
      });
      continue;
    }

    const edgeMatch = line.match(/^"([^"]+)"\s*->\s*"([^"]+)"(?:\s+\[(.*)\])?;?$/);
    if (edgeMatch) {
      const source = edgeMatch[1];
      const target = edgeMatch[2];
      const attrs = edgeMatch[3] || "";
      const relationMatch = attrs.match(/label="((?:[^"\\]|\\.)*)"/);
      const relation = decodeDotText(relationMatch ? relationMatch[1] : "related") || "related";

      const dedupeKey = `${source}|${target}|${relation}`;
      if (!edgeSeen.has(dedupeKey)) {
        edgeSeen.add(dedupeKey);
        edges.push({ source, target, relation });
      }
    }
  }

  const nodes = Array.from(nodeMap.values());
  const chapters = Array.from(new Set(nodes.map((node) => node.chapter || "Core Concepts")));

  return { nodes, edges, chapters };
}

function buildGraphLayout(graph) {
  const groupedByChapter = new Map();
  for (const chapter of graph.chapters) {
    groupedByChapter.set(chapter, []);
  }

  for (const node of graph.nodes) {
    const chapter = node.chapter || "Core Concepts";
    if (!groupedByChapter.has(chapter)) {
      groupedByChapter.set(chapter, []);
    }
    groupedByChapter.get(chapter).push(node);
  }

  const nodeWidth = 220;
  const nodeHeight = 68;
  const colGap = 86;
  const rowGap = 24;
  const paddingX = 28;
  const paddingTop = 54;
  const paddingBottom = 28;

  const chapters = Array.from(groupedByChapter.keys());
  const maxRows = Math.max(1, ...chapters.map((chapter) => groupedByChapter.get(chapter).length));

  const width = Math.max(
    700,
    paddingX * 2 + chapters.length * nodeWidth + Math.max(0, chapters.length - 1) * colGap
  );
  const height = Math.max(
    260,
    paddingTop + paddingBottom + maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap
  );

  const positions = {};
  chapters.forEach((chapter, chapterIndex) => {
    const nodes = groupedByChapter.get(chapter) || [];
    nodes.forEach((node, rowIndex) => {
      positions[node.id] = {
        x: paddingX + chapterIndex * (nodeWidth + colGap),
        y: paddingTop + rowIndex * (nodeHeight + rowGap),
      };
    });
  });

  return {
    positions,
    groupedByChapter,
    width,
    height,
    nodeWidth,
    nodeHeight,
  };
}

function GraphCanvas({ graph }) {
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

        {Array.from(layout.groupedByChapter.entries()).map(([chapter], index) => {
          const x = 28 + index * (layout.nodeWidth + 86);
          return (
            <text
              key={`chapter-${chapter}`}
              x={x}
              y={28}
              fill="#94a3b8"
              fontSize="11"
              letterSpacing="1.1"
            >
              {chapter}
            </text>
          );
        })}

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

          const c1x = startX + direction * bend;
          const c1y = startY;
          const c2x = endX - direction * bend;
          const c2y = endY;
          const path = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

          const color = EDGE_COLORS[edge.relation] || EDGE_COLORS.related;
          return (
            <path
              key={`edge-${edge.source}-${edge.target}-${index}`}
              d={path}
              fill="none"
              stroke={color}
              strokeOpacity="0.85"
              strokeWidth="1.8"
              markerEnd="url(#graph-arrow)"
              strokeDasharray={edge.relation === "progression" ? "5 4" : undefined}
            />
          );
        })}

        {graph.nodes.map((node) => {
          const pos = layout.positions[node.id];
          if (!pos) return null;

          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <rect
                width={layout.nodeWidth}
                height={layout.nodeHeight}
                rx="12"
                fill="#0f172a"
                stroke="#334155"
              />
              <text x="12" y="28" fill="#e2e8f0" fontSize="12" fontWeight="600">
                {shortLabel(node.name, 32)}
              </text>
              <text x="12" y="48" fill="#94a3b8" fontSize="11">
                {shortLabel(node.chapter, 28)}
              </text>
              <title>{`${node.name} [${node.chapter}]`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DailyProgressRing({ value = 0 }) {
  const clamped = clamp(value);
  const angle = Math.round((clamped / 100) * 360);

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-12 w-12 rounded-full"
        style={{
          background: `conic-gradient(rgb(129 140 248) ${angle}deg, rgb(30 41 59) ${angle}deg 360deg)`,
        }}
      >
        <div className="absolute inset-[5px] rounded-full bg-slate-950" />
        <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-slate-100">
          {Math.round(clamped)}%
        </div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Daily Goal</p>
        <p className="text-sm font-medium text-emerald-400">{clamped >= 70 ? "On Track" : "Needs Boost"}</p>
      </div>
    </div>
  );
}

function ModuleCard({ item, chartsReady }) {
  const Icon = item.icon;
  const trendColor = item.delta >= 0 ? "#34d399" : "#fb7185";

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-4 backdrop-blur-sm transition-all duration-300 hover:bg-slate-800/80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-700/60 bg-slate-900 p-2 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
            <Icon size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">{item.name}</p>
            <p className="text-xs text-slate-400">{item.valueLabel}</p>
          </div>
        </div>
        <p className={`text-xs font-semibold ${item.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {item.delta >= 0 ? "+" : ""}
          {item.delta.toFixed(1)}%
        </p>
      </div>

      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-indigo-600 shadow-[0_0_16px_rgba(79,70,229,0.45)] transition-all duration-700"
          style={{ width: `${clamp(item.progress)}%` }}
        />
      </div>

      <div className="h-14 w-full">
        {chartsReady ? (
          <Suspense
            fallback={
              <div className="h-full w-full animate-pulse rounded-lg bg-slate-800/40" />
            }
          >
            <ModuleSparkline id={item.id} data={item.trend} trendColor={trendColor} />
          </Suspense>
        ) : (
          <div className="h-full w-full animate-pulse rounded-lg bg-slate-800/40" />
        )}
      </div>
    </article>
  );
}

function InsightFeed({ insights }) {
  return (
    <section className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm shadow-[0_0_15px_rgba(99,102,241,0.2)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl border border-indigo-500/20 bg-slate-900 p-2 text-indigo-400">
          <Sparkles size={17} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-100">AI Insight Feed</h2>
          <p className="text-xs text-slate-400">由你的作答紀錄與概念圖譜即時生成</p>
        </div>
      </div>

      <div className="space-y-3">
        {insights.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-4 transition-all duration-300 hover:border-indigo-500/40"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-slate-100">{item.title}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  item.level === "high"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-emerald-500/15 text-emerald-300"
                }`}
              >
                {item.level === "high" ? "High" : "Medium"}
              </span>
            </div>
            <p className="text-sm text-slate-400">{item.description}</p>
            <p className="mt-2 text-xs font-medium text-indigo-400">{item.impact}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConceptSection({ concepts, search, setSearch }) {
  const filteredConcepts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return concepts;
    return concepts.filter((item) => {
      return `${item.name} ${item.chapter} ${item.description}`.toLowerCase().includes(keyword);
    });
  }, [concepts, search]);

  return (
    <div className="mt-4 max-h-52 space-y-2 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/50 p-3">
      {filteredConcepts.length === 0 ? (
        <p className="text-xs text-slate-400">目前沒有可顯示的概念。</p>
      ) : (
        filteredConcepts.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-800/70 bg-slate-900/40 p-3">
            <p className="text-sm font-medium text-slate-100">{item.name}</p>
            <p className="text-xs text-indigo-400">{item.chapter}</p>
            <p className="mt-1 text-xs text-slate-400">{item.description}</p>
          </article>
        ))
      )}
    </div>
  );
}

function SetupPanel({
  apiKey,
  setApiKey,
  courseName,
  setCourseName,
  templateMode,
  setTemplateMode,
  materialFile,
  setMaterialFile,
  concepts,
  search,
  setSearch,
}) {
  const saveApiKey = useSaveApiKey();
  const ingestMaterial = useIngestMaterial();

  const handleSaveApiKey = useCallback(async () => {
    await saveApiKey.mutateAsync(apiKey.trim());
  }, [apiKey, saveApiKey]);

  const handleIngest = useCallback(async () => {
    if (!materialFile) return;
    const formData = new FormData();
    formData.append("file", materialFile);
    formData.append("course_name", courseName.trim() || "通用課程");
    formData.append("template_mode", templateMode);
    if (apiKey.trim()) {
      formData.append("api_key", apiKey.trim());
    }
    await ingestMaterial.mutateAsync(formData);
  }, [materialFile, courseName, templateMode, apiKey, ingestMaterial]);

  const status = ingestMaterial.isPending
    ? "正在解析教材並建立知識圖譜..."
    : ingestMaterial.isSuccess
    ? "建立完成。"
    : ingestMaterial.error?.message || "";

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <h2 className="text-base font-semibold text-slate-100">設定與教材</h2>
      <p className="mt-1 text-xs text-slate-400">上傳教材後會重建概念圖譜，並清空舊教材的狀態。</p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Gemini API 金鑰</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="選填金鑰"
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">課程名稱</span>
          <input
            type="text"
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">課程模板</span>
          <select
            value={templateMode}
            onChange={(event) => setTemplateMode(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          >
            <option value="generic">通用模式（依講義抽取）</option>
            <option value="linear-algebra">線性代數模板</option>
            <option value="auto">自動偵測模板</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">教材檔案（PDF/TXT）</span>
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(event) => setMaterialFile(event.target.files?.[0] || null)}
            className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSaveApiKey}
          disabled={saveApiKey.isPending}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-indigo-500/40 disabled:opacity-60"
        >
          {saveApiKey.isPending ? "儲存中..." : "儲存金鑰"}
        </button>
        <button
          type="button"
          onClick={handleIngest}
          disabled={ingestMaterial.isPending || !materialFile}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_15px_rgba(99,102,241,0.2)] transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {ingestMaterial.isPending ? "建立中..." : "建立知識圖譜"}
        </button>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      <ConceptSection concepts={concepts} search={search} setSearch={setSearch} />
    </article>
  );
}

function QuizPanel({ questions, setQuestions, questionIndex, setQuestionIndex }) {
  const generateDiagnostics = useGenerateDiagnostics();
  const gradeQuestion = useGradeQuestion();

  const [questionCount, setQuestionCount] = useState(9);
  const [answerText, setAnswerText] = useState("");
  const [gradeResult, setGradeResult] = useState(null);

  const currentQuestion = questions[questionIndex] || null;

  const handleGenerate = useCallback(async () => {
    const result = await generateDiagnostics.mutateAsync(questionCount);
    setQuestions(result.items || []);
    setQuestionIndex(0);
    setAnswerText("");
    setGradeResult(null);
  }, [questionCount, generateDiagnostics, setQuestions, setQuestionIndex]);

  const handleGrade = useCallback(async () => {
    if (!currentQuestion || !answerText.trim()) return;
    const result = await gradeQuestion.mutateAsync({
      questionId: currentQuestion.id,
      answer: answerText.trim(),
    });
    setGradeResult(result);
  }, [currentQuestion, answerText, gradeQuestion]);

  const handlePrev = useCallback(() => {
    setQuestionIndex((prev) => Math.max(0, prev - 1));
    setAnswerText("");
    setGradeResult(null);
  }, [setQuestionIndex]);

  const handleNext = useCallback(() => {
    setQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1));
    setAnswerText("");
    setGradeResult(null);
  }, [questions.length, setQuestionIndex]);

  const status = generateDiagnostics.isPending
    ? "正在產生自適應題目..."
    : gradeQuestion.isPending
    ? "正在評分作答..."
    : gradeQuestion.isSuccess
    ? "評分完成。"
    : "";

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <h2 className="text-base font-semibold text-slate-100">自適應測驗</h2>
      <p className="mt-1 text-xs text-slate-400">系統會優先抽弱點概念，並混合三種難度。</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={3}
          max={30}
          step={3}
          value={questionCount}
          onChange={(event) => setQuestionCount(Number(event.target.value))}
          className="h-10 w-24 rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generateDiagnostics.isPending}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {generateDiagnostics.isPending ? "產生中..." : "產生題目"}
        </button>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      {currentQuestion ? (
        <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4">
          <p className="text-xs text-slate-400">
            題目 {questionIndex + 1}/{questions.length} · {currentQuestion.concept_name} ·{" "}
            {currentQuestion.difficulty}
          </p>
          <p className="mt-2 text-sm text-slate-100">{currentQuestion.question_text}</p>

          <textarea
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            rows={5}
            placeholder="輸入你的作答內容..."
            className="mt-3 w-full rounded-xl border border-slate-800/70 bg-slate-900/70 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={questionIndex === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              <ChevronLeft size={14} />
              上一題
            </button>

            <button
              type="button"
              onClick={handleGrade}
              disabled={gradeQuestion.isPending || !answerText.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {gradeQuestion.isPending ? "評分中..." : "送出作答"}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={questionIndex >= questions.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              下一題
              <ChevronRight size={14} />
            </button>
          </div>

          {gradeResult ? (
            <div className="mt-3 rounded-lg border border-slate-800/70 bg-slate-900/70 p-3 text-xs text-slate-300">
              <p>
                分數：<span className="text-emerald-400">{(safeNumber(gradeResult.score) * 100).toFixed(1)}%</span> ·
                判定：{gradeResult.is_correct ? "答對" : "待加強"}
              </p>
              <p className="mt-1">回饋：{gradeResult.feedback}</p>
              <p className="mt-1 text-slate-400">參考答案：{gradeResult.expected_answer}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function MasteryTable({ conceptMastery }) {
  const recalculate = useRecalculateReview();

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">掌握度熱力摘要</h2>
          <p className="text-xs text-slate-400">紅黃綠分級，快速定位弱點概念。</p>
        </div>
        <button
          type="button"
          onClick={() => recalculate.mutate()}
          disabled={recalculate.isPending}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 transition hover:border-indigo-500/40 disabled:opacity-60"
        >
          {recalculate.isPending ? "計算中..." : "重算複習排程"}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {recalculate.isPending ? "正在重新計算..." : ""}
      </p>

      <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/50">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-900/90 text-slate-300">
            <tr>
              <th className="px-3 py-2">概念</th>
              <th className="px-3 py-2">章節</th>
              <th className="px-3 py-2">掌握度</th>
              <th className="px-3 py-2">作答次數</th>
            </tr>
          </thead>
          <tbody>
            {conceptMastery.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-slate-400">
                  尚無掌握度資料。
                </td>
              </tr>
            ) : (
              conceptMastery.map((row) => {
                const mastery = safeNumber(row.mastery);
                const statusClass =
                  mastery >= 0.75 ? "text-emerald-400" : mastery >= 0.5 ? "text-amber-300" : "text-rose-300";
                return (
                  <tr key={row.concept_id} className="border-t border-slate-800/70">
                    <td className="px-3 py-2 text-slate-100">{row.name}</td>
                    <td className="px-3 py-2 text-slate-400">{row.chapter}</td>
                    <td className={`px-3 py-2 font-semibold ${statusClass}`}>
                      {(mastery * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.attempts}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function TonightPanel({ tonight }) {
  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 size={16} className="text-emerald-400" />
        <h2 className="text-base font-semibold text-slate-100">今晚衝刺計畫</h2>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">目前通過率</p>
          <p className="text-sm font-semibold text-slate-100">{formatPercent(tonight.before)}</p>
        </div>
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">預估提升</p>
          <p className="text-sm font-semibold text-emerald-400">
            +{(safeNumber(tonight.uplift) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">預估通過率</p>
          <p className="text-sm font-semibold text-slate-100">{formatPercent(tonight.after)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {(tonight.focus_items || []).length === 0 ? (
          <p className="text-xs text-slate-400">目前尚無今晚計畫。</p>
        ) : (
          tonight.focus_items.map((item, index) => (
            <article
              key={`${item.concept}-${index}`}
              className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-3"
            >
              <p className="text-sm text-slate-100">
                {index + 1}. {item.concept}
              </p>
              <p className="text-xs text-indigo-400">
                {item.chapter} · {item.slot}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                優先度 {safeNumber(item.priority).toFixed(2)} · 預估提升 +
                {(safeNumber(item.estimated_gain) * 100).toFixed(1)}%
              </p>
            </article>
          ))
        )}
      </div>
    </article>
  );
}

function StudyPlansPanel({ reviewItems, isLoading }) {
  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={16} className="text-emerald-400" />
        <h2 className="text-base font-semibold text-slate-100">Study Plans</h2>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">載入複習計畫中...</p>
      ) : reviewItems.length === 0 ? (
        <p className="text-xs text-slate-400">目前尚無排程，先上傳教材並產生測驗即可建立計畫。</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-auto">
          {reviewItems.slice(0, 8).map((item) => (
            <article
              key={item.concept_id}
              className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-3"
            >
              <p className="text-sm text-slate-100">{item.concept_name}</p>
              <p className="text-xs text-indigo-400">{item.suggested_slot}</p>
              <p className="mt-1 text-xs text-slate-400">
                優先度 {safeNumber(item.priority).toFixed(2)} · 下次複習 {item.next_review_at}
              </p>
              <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

function KnowledgeGraphPanel({ dotSource, isLoading }) {
  const [copied, setCopied] = useState(false);
  const [showRawDot, setShowRawDot] = useState(false);
  const graph = useMemo(() => parseDotGraph(dotSource), [dotSource]);

  const handleCopy = useCallback(async () => {
    if (!dotSource) {
      return;
    }
    try {
      await navigator.clipboard.writeText(dotSource);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [dotSource]);

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">Knowledge Graph</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawDot((prev) => !prev)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300"
          >
            {showRawDot ? "隱藏 DOT" : "顯示 DOT"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!dotSource}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-50"
          >
            {copied ? "已複製" : "複製 DOT"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <span>節點 {graph.nodes.length}</span>
        <span>關係 {graph.edges.length}</span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-cyan-400" /> prerequisite
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-amber-400" /> progression
        </span>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">載入圖譜中...</p>
      ) : (
        <div className="space-y-3">
          <GraphCanvas graph={graph} />
          {showRawDot ? (
            <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800/70 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-300">
              {dotSource || "digraph ConceptGraph { empty [label=\"No concepts yet\"]; }"}
            </pre>
          ) : null}
        </div>
      )}
    </article>
  );
}

function MetricCardsGrid({ chapterMastery, accuracy, tonight, chartsReady }) {
  const metricCards = useMemo(() => {
    const topChapters = chapterMastery.slice(0, 2).map((row, index) => {
      const progress = Math.round(safeNumber(row.avg_mastery) * 100);
      const baseline = index === 0 ? 58 : 54;
      return {
        id: `chapter-${index}`,
        name: row.chapter,
        valueLabel: `掌握度 ${progress}%`,
        progress,
        delta: progress - baseline,
        icon: index === 0 ? BookCheck : Network,
        trend: buildTrend(progress, index + 1),
      };
    });

    const focusScore = clamp(Math.round(safeNumber(accuracy) * 100 + safeNumber(tonight.uplift) * 80));
    const retention = clamp(Math.round(safeNumber(tonight.after) * 100));

    const dynamicCards = [
      {
        id: "focus-score",
        name: "Focus Score",
        valueLabel: `${focusScore} / 100`,
        progress: focusScore,
        delta: focusScore - 70,
        icon: Target,
        trend: buildTrend(focusScore, 2),
      },
      {
        id: "retention-rate",
        name: "Retention Rate",
        valueLabel: `${retention}% retained`,
        progress: retention,
        delta: retention - 66,
        icon: Brain,
        trend: buildTrend(retention, 3),
      },
    ];

    const cards = [...topChapters, ...dynamicCards];
    while (cards.length < 4) {
      const idx = cards.length + 1;
      cards.push({
        id: `fallback-${idx}`,
        name: `Learning Module ${idx}`,
        valueLabel: "等待資料",
        progress: 45 + idx * 5,
        delta: 2 + idx,
        icon: Activity,
        trend: buildTrend(45 + idx * 5, idx),
      });
    }

    return cards.slice(0, 4);
  }, [chapterMastery, accuracy, tonight.uplift, tonight.after]);

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metricCards.map((item) => (
        <ModuleCard key={item.id} item={item} chartsReady={chartsReady} />
      ))}
    </section>
  );
}

export default function App() {
  const contentRef = useRef(null);
  const dashboardRef = useRef(null);
  const studyRef = useRef(null);
  const graphRef = useRef(null);

  const [activeNav, setActiveNav] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [courseName, setCourseName] = useState("通用課程");
  const [templateMode, setTemplateMode] = useState("generic");
  const [materialFile, setMaterialFile] = useState(null);
  const [chartsReady, setChartsReady] = useState(false);

  const [questions, setQuestions] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);

  const { data: healthData, isLoading: healthLoading } = useHealth();
  const { data: conceptsData, isLoading: conceptsLoading } = useConcepts();
  const { data: masteryData, isLoading: masteryLoading } = useConceptMastery();
  const { data: chapterData, isLoading: chapterLoading } = useChapterMastery();
  const { data: tonightData, isLoading: tonightLoading } = useTonightDashboard();
  const { data: reviewPlanData, isLoading: reviewPlanLoading } = useReviewPlan();
  const { data: graphData, isLoading: graphLoading } = useKnowledgeGraph();

  const metrics = {
    concept_count: healthData?.metrics?.concept_count ?? 0,
    attempt_count: healthData?.metrics?.attempt_count ?? 0,
    accuracy: healthData?.metrics?.accuracy ?? 0,
    llm_enabled: healthData?.llm_enabled ?? false,
  };

  const concepts = conceptsData?.items ?? [];
  const conceptMastery = masteryData?.items ?? [];
  const chapterMastery = chapterData?.items ?? [];
  const reviewItems = reviewPlanData?.items ?? [];
  const knowledgeGraphDot = graphData?.dot ?? "";
  const tonight = {
    before: tonightData?.before ?? 0.55,
    uplift: tonightData?.uplift ?? 0,
    after: tonightData?.after ?? 0.55,
    focus_items: tonightData?.focus_items ?? [],
  };

  const insights = useMemo(() => {
    const aiFocus = (tonight.focus_items || []).slice(0, 4).map((item, index) => ({
      id: `focus-${index}`,
      title: `優先複習：${item.concept}`,
      description: `${item.chapter} · 建議時段 ${item.slot}。優先度 ${safeNumber(item.priority).toFixed(2)}。`,
      impact: `預估提升 +${(safeNumber(item.estimated_gain) * 100).toFixed(1)}%`,
      level: index < 2 ? "high" : "medium",
    }));
    return aiFocus.length > 0 ? aiFocus : FALLBACK_INSIGHTS;
  }, [tonight.focus_items]);

  const isLoading = healthLoading || conceptsLoading || masteryLoading || chapterLoading || tonightLoading;

  const scrollToSection = useCallback((key) => {
    setActiveNav(key);
    const sectionMap = {
      dashboard: dashboardRef,
      study: studyRef,
      graph: graphRef,
    };
    const target = sectionMap[key]?.current;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    const onIdle = () => {
      if (!canceled) {
        setChartsReady(true);
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(onIdle, { timeout: 1200 });
      return () => {
        canceled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timerId = window.setTimeout(onIdle, 350);
    return () => {
      canceled = true;
      window.clearTimeout(timerId);
    };
  }, []);

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-100">
      <div className="flex h-full w-full overflow-hidden">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/50 bg-slate-950/95 p-5 lg:flex">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/20 p-2 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <Activity size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">AdaptLearn</p>
              <p className="text-xs text-slate-400">AI-Assisted Learning Platform</p>
            </div>
          </div>

          <nav className="space-y-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => scrollToSection(item.key)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    activeNav === item.key
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-xl border border-slate-800/60 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Runtime</p>
            <p className="mt-1 text-sm text-slate-200">LLM: {metrics.llm_enabled ? "Enabled" : "Fallback"}</p>
            <p className="mt-2 text-xs text-emerald-400">
              Active concepts: {Math.round(metrics.concept_count)}
            </p>
          </div>
        </aside>

        <main ref={contentRef} className="flex-1 overflow-y-auto">
          <header className="sticky top-0 z-20 border-b border-slate-800/50 bg-slate-950/75 px-5 py-4 backdrop-blur-sm md:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full max-w-xl">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜尋概念、章節或描述..."
                  className="h-11 w-full rounded-xl border border-slate-800/70 bg-slate-900/70 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center gap-4">
                <DailyProgressRing value={safeNumber(metrics.accuracy) * 100} />
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-800/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 transition hover:border-indigo-500/40"
                >
                  <UserCircle2 size={17} className="text-slate-400" />
                  <span>Student</span>
                </button>
              </div>
            </div>
          </header>

          <section ref={dashboardRef} id="section-dashboard" className="px-5 py-6 md:px-8">
            <div className="mb-6">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Learning Operations</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-100 md:text-3xl">AI 學習診斷總覽</h1>
              <p className="mt-2 text-sm text-slate-400">
                追蹤掌握度、執行自適應測驗、生成今日最有效率的複習策略。
              </p>
            </div>

            {isLoading ? (
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                  <MetricCardSkeleton key={i} />
                ))}
              </section>
            ) : (
              <MetricCardsGrid
                chapterMastery={chapterMastery}
                accuracy={metrics.accuracy}
                tonight={tonight}
                chartsReady={chartsReady}
              />
            )}

            <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="space-y-6 xl:col-span-2">
                <ErrorBoundary>
                  {conceptsLoading ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5">
                        <Skeleton className="mb-2 h-5 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <div className="mt-4 space-y-2">
                          {[...Array(3)].map((_, i) => (
                            <ListItemSkeleton key={i} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <SetupPanel
                      apiKey={apiKey}
                      setApiKey={setApiKey}
                      courseName={courseName}
                      setCourseName={setCourseName}
                      templateMode={templateMode}
                      setTemplateMode={setTemplateMode}
                      materialFile={materialFile}
                      setMaterialFile={setMaterialFile}
                      concepts={concepts}
                      search={search}
                      setSearch={setSearch}
                    />
                  )}
                </ErrorBoundary>

                <ErrorBoundary>
                  <QuizPanel
                    questions={questions}
                    setQuestions={setQuestions}
                    questionIndex={questionIndex}
                    setQuestionIndex={setQuestionIndex}
                  />
                </ErrorBoundary>

                <ErrorBoundary>
                  {masteryLoading ? (
                    <div className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5">
                      <Skeleton className="mb-2 h-5 w-40" />
                      <Skeleton className="h-48 w-full rounded-xl" />
                    </div>
                  ) : (
                    <MasteryTable conceptMastery={conceptMastery} />
                  )}
                </ErrorBoundary>
              </div>

              <div className="space-y-6">
                <InsightFeed insights={insights} />

                <div ref={studyRef} id="section-study">
                  <ErrorBoundary>
                    <StudyPlansPanel reviewItems={reviewItems} isLoading={reviewPlanLoading} />
                  </ErrorBoundary>
                </div>

                <ErrorBoundary>
                  {tonightLoading ? (
                    <div className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5">
                      <Skeleton className="mb-3 h-5 w-32" />
                      <div className="grid grid-cols-3 gap-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full rounded-xl" />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <TonightPanel tonight={tonight} />
                  )}
                </ErrorBoundary>

                <div ref={graphRef} id="section-graph">
                  <ErrorBoundary>
                    <KnowledgeGraphPanel dotSource={knowledgeGraphDot} isLoading={graphLoading} />
                  </ErrorBoundary>
                </div>
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-lg bg-slate-800/50 ${className}`} />;
}
