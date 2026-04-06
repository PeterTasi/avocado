import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  ListItemSkeleton,
  MetricCardSkeleton,
  Skeleton,
} from "./components/LoadingSkeleton";
import { DailyProgressRing } from "./components/DailyProgressRing";
import { InsightFeed } from "./components/InsightFeed";
import type { Insight } from "./components/InsightFeed";
import { KnowledgeGraphPanel } from "./components/KnowledgeGraphPanel";
import { MasteryTable } from "./components/MasteryTable";
import { MetricCardsGrid } from "./components/MetricCardsGrid";
import { QuizPanel } from "./components/QuizPanel";
import { SetupPanel } from "./components/SetupPanel";
import { StudyPlansPanel, TonightPanel } from "./components/StudyPanels";
import {
  useChapterMastery,
  useConceptMastery,
  useConcepts,
  useHealth,
  useKnowledgeGraph,
  useReviewPlan,
  useTonightDashboard,
} from "./hooks/useApi";
import type { Question, TonightDashboard } from "./hooks/useApi";
import { safeNumber } from "./utils/helpers";
import {
  Activity,
  CalendarClock,
  LayoutDashboard,
  Network,
  Search,
  UserCircle2,
} from "lucide-react";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "study", label: "Study Plans", icon: CalendarClock },
  { key: "graph", label: "Knowledge Graph", icon: Network },
];

const FALLBACK_INSIGHTS: Insight[] = [
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

export default function App() {
  const contentRef = useRef<HTMLElement>(null);
  const dashboardRef = useRef<HTMLElement>(null);
  const studyRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  const [activeNav, setActiveNav] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [courseName, setCourseName] = useState("通用課程");
  const [templateMode, setTemplateMode] = useState("generic");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
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
  const tonight: TonightDashboard = {
    before: tonightData?.before ?? 0.55,
    uplift: tonightData?.uplift ?? 0,
    after: tonightData?.after ?? 0.55,
    chapters: tonightData?.chapters ?? [],
    focus_items: tonightData?.focus_items ?? [],
  };

  const insights = useMemo<Insight[]>(() => {
    const aiFocus = (tonight.focus_items ?? []).slice(0, 4).map((item, index) => ({
      id: `focus-${index}`,
      title: `優先複習：${item.concept}`,
      description: `${item.chapter} · 建議時段 ${item.slot}。優先度 ${safeNumber(item.priority).toFixed(2)}。`,
      impact: `預估提升 +${(safeNumber(item.estimated_gain) * 100).toFixed(1)}%`,
      level: (index < 2 ? "high" : "medium") as "high" | "medium",
    }));
    return aiFocus.length > 0 ? aiFocus : FALLBACK_INSIGHTS;
  }, [tonight.focus_items]);

  const isLoading = healthLoading || conceptsLoading || masteryLoading || chapterLoading || tonightLoading;

  const scrollToSection = useCallback((key: string) => {
    setActiveNav(key);
    const sectionMap: Record<string, React.RefObject<HTMLElement | HTMLDivElement | null>> = {
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
      if (!canceled) setChartsReady(true);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(onIdle, { timeout: 1200 });
      return () => {
        canceled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timerId = setTimeout(onIdle, 350);
    return () => {
      canceled = true;
      clearTimeout(timerId);
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
                    <div className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5">
                      <Skeleton className="mb-2 h-5 w-32" />
                      <Skeleton className="h-3 w-48" />
                      <div className="mt-4 space-y-2">
                        {[...Array(3)].map((_, i) => (
                          <ListItemSkeleton key={i} />
                        ))}
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
