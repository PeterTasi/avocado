import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarClock,
  LayoutDashboard,
  Network,
  Search,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DailyProgressRing } from "./components/DailyProgressRing";
import { InsightFeed } from "./components/InsightFeed";
import type { Insight } from "./components/InsightFeed";
import { KnowledgeGraphPanel } from "./components/KnowledgeGraphPanel";
import { ClassHeatmapPanel } from "./components/ClassHeatmapPanel";
import { ListItemSkeleton, MetricCardSkeleton, Skeleton } from "./components/LoadingSkeleton";
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

const NAV_ITEMS = [
  { key: "dashboard", label: "總覽", icon: LayoutDashboard },
  { key: "study", label: "複習計畫", icon: CalendarClock },
  { key: "graph", label: "知識圖譜", icon: Network },
] as const;

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
  const runtimeLabel = metrics.llm_enabled ? "Gemini 已啟用" : "備援模式";
  const runtimeHint = metrics.llm_enabled ? "可使用生成式診斷與摘要" : "目前以規則與既有資料回應";
  const activeCourseName = courseName.trim() || "通用課程";
  const selectedFileLabel = materialFile?.name ?? "尚未選擇教材檔案";
  const chapterHighlights = chapterMastery.slice(0, 3);
  const focusHighlights = tonight.focus_items.slice(0, 3);
  const overviewCards = [
    {
      label: "概念節點",
      value: `${Math.round(metrics.concept_count)}`,
      hint: "已建立的知識概念數",
    },
    {
      label: "作答完成率",
      value: `${Math.round(safeNumber(metrics.accuracy) * 100)}%`,
      hint: "依目前診斷題紀錄更新",
    },
    {
      label: "待排複習",
      value: `${reviewItems.length}`,
      hint: reviewPlanLoading ? "複習資料同步中" : "系統已排入的複習項目",
    },
  ];

  const scrollToSection = useCallback((key: (typeof NAV_ITEMS)[number]["key"]) => {
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

    const timerId = globalThis.setTimeout(onIdle, 350);
    return () => {
      canceled = true;
      globalThis.clearTimeout(timerId);
    };
  }, []);

  return (
    <div className="min-h-screen text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="floating-orb left-[4%] top-20 h-72 w-72 bg-rose-400/55" />
        <div className="floating-orb right-[7%] top-28 h-80 w-80 bg-sky-300/45 [animation-delay:1.2s]" />
        <div className="floating-orb bottom-16 left-[38%] h-72 w-72 bg-emerald-300/35 [animation-delay:2.4s]" />
      </div>

      <div className="relative mx-auto max-w-[1560px] px-4 pb-10 pt-4 md:px-6 lg:px-8">
        <nav className="glass-panel sticky top-4 z-40 rounded-[28px] px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)]">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-base font-semibold text-white">AdaptLearn</p>
                <p className="text-xs text-white/65">自適應學習儀表板</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => scrollToSection(item.key)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                      activeNav === item.key
                        ? "bg-white/22 text-white shadow-[0_10px_28px_rgba(15,23,42,0.16)]"
                        : "glass-button text-white/78"
                    }`}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 self-start xl:self-auto">
              <div className="hidden md:block">
                <DailyProgressRing value={safeNumber(metrics.accuracy) * 100} />
              </div>
              <div className="glass-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/85">
                <UserCircle2 size={17} className="text-white/70" />
                <span>學生模式</span>
              </div>
            </div>
          </div>
        </nav>

        <div className="mt-6 grid gap-6 xl:grid-cols-[300px,minmax(0,1fr)]">
          <aside className="glass-panel hidden h-fit flex-col rounded-[32px] p-6 xl:flex xl:sticky xl:top-28">
            <div>
              <p className="section-eyebrow">操作中樞</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">學習節奏總控台</h2>
              <p className="mt-3 text-sm leading-6 text-white/72">
                這個面板整合教材匯入、診斷測驗、知識圖譜與班級熱點，讓你用同一個介面快速調整學習方向。
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <div className="glass-subpanel rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/55">引擎狀態</p>
                <p className="mt-2 text-lg font-semibold text-white">{runtimeLabel}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{runtimeHint}</p>
              </div>

              <div className="glass-subpanel rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/55">目前課程</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeCourseName}</p>
                <p className="mt-1 text-xs text-white/65">
                  模板模式：{templateMode === "generic" ? "通用抽取" : templateMode === "auto" ? "自動偵測" : "線性代數"}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-200" />
                <p className="text-sm font-semibold text-white">重點章節</p>
              </div>
              <div className="mt-3 space-y-2">
                {chapterHighlights.length === 0 ? (
                  <p className="text-xs leading-5 text-white/65">尚未建立章節掌握度，先匯入教材或完成測驗即可更新。</p>
                ) : (
                  chapterHighlights.map((chapter) => (
                    <div key={chapter.chapter} className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-sm font-medium text-white">{chapter.chapter}</p>
                      <p className="mt-1 text-xs text-white/65">
                        平均掌握度 {Math.round(safeNumber(chapter.avg_mastery) * 100)}% · 已作答 {chapter.attempted_concepts}/
                        {chapter.concept_count}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-4">
              <p className="text-sm font-semibold text-white">今晚先攻</p>
              <div className="mt-3 space-y-2">
                {focusHighlights.length === 0 ? (
                  <p className="text-xs leading-5 text-white/65">系統尚未排出今晚優先概念，完成診斷題後會自動補齊。</p>
                ) : (
                  focusHighlights.map((item, index) => (
                    <div key={`${item.concept}-${index}`} className="rounded-2xl border border-white/10 bg-white/8 px-3 py-3">
                      <p className="text-sm text-white">{index + 1}. {item.concept}</p>
                      <p className="mt-1 text-xs text-white/65">{item.chapter} · {item.slot}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          <main className="space-y-6">
            <section ref={dashboardRef} id="section-dashboard" className="glass-panel rounded-[32px] p-6 md:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),320px] lg:items-start">
                <div>
                  <p className="section-eyebrow">適應式學習引擎</p>
                  <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-white md:text-5xl">
                    用玻璃擬態介面掌握<span className="gradient-text">課程脈絡、弱點與複習節奏</span>
                  </h1>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-white/74 md:text-base">
                    依照教材內容、自適應測驗與圖譜關聯，即時整理出今晚該先讀什麼、哪裡需要補強，以及全班共同卡住的概念。
                  </p>

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {overviewCards.map((card) => (
                      <div key={card.label} className="glass-subpanel rounded-[24px] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/55">{card.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-white">{card.value}</p>
                        <p className="mt-2 text-xs leading-5 text-white/65">{card.hint}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr),280px]">
                    <label className="relative block">
                      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/55" />
                      <input
                        type="text"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="搜尋概念、章節或摘要關鍵字"
                        className="glass-input h-12 w-full rounded-2xl pl-11 pr-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
                      />
                    </label>

                    <div className="glass-subpanel rounded-[24px] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/55">教材檔案</p>
                      <p className="mt-2 truncate text-sm font-medium text-white">{selectedFileLabel}</p>
                      <p className="mt-1 text-xs text-white/65">
                        {search.trim() ? `目前篩選：${search.trim()}` : `已同步 ${concepts.length} 個概念`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="glass-panel-strong rounded-[30px] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="section-eyebrow">即時狀態</p>
                      <h2 className="mt-3 text-xl font-semibold text-white">本輪學習摘要</h2>
                    </div>
                    <div className="md:hidden">
                      <DailyProgressRing value={safeNumber(metrics.accuracy) * 100} />
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 text-sm text-white/78">
                    <div className="glass-subpanel rounded-[22px] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/55">系統模式</p>
                      <p className="mt-2 text-base font-semibold text-white">{runtimeLabel}</p>
                    </div>
                    <div className="glass-subpanel rounded-[22px] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/55">當前課程</p>
                      <p className="mt-2 text-base font-semibold text-white">{activeCourseName}</p>
                    </div>
                    <div className="glass-subpanel rounded-[22px] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/55">建議行動</p>
                      <p className="mt-2 leading-6 text-white/78">
                        {reviewItems.length > 0
                          ? `先處理 ${reviewItems[0]?.concept_name ?? "高優先概念"}，再回到自適應測驗驗證理解。`
                          : "先上傳教材並產生測驗，系統才會開始建立複習節奏。"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

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

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr),minmax(360px,0.85fr)]">
              <div className="space-y-6">
                <ErrorBoundary>
                  {conceptsLoading ? (
                    <div className="glass-panel rounded-[28px] p-6">
                      <Skeleton className="mb-2 h-5 w-32" />
                      <Skeleton className="h-3 w-56" />
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
                    <div className="glass-panel rounded-[28px] p-6">
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
                    <div className="glass-panel rounded-[28px] p-6">
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

                <div ref={graphRef} id="section-graph" className="flex flex-col gap-6">
                  <ErrorBoundary>
                    <KnowledgeGraphPanel dotSource={knowledgeGraphDot} isLoading={graphLoading} />
                  </ErrorBoundary>
                  <ErrorBoundary>
                    <ClassHeatmapPanel />
                  </ErrorBoundary>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}