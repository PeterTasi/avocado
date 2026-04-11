import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  ChevronLeft,
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
import { ListItemSkeleton, Skeleton } from "./components/LoadingSkeleton";
import { MasteryTable } from "./components/MasteryTable";
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

const VIEW_ITEMS = [
  { key: "home", label: "首頁", icon: LayoutDashboard },
  { key: "setup", label: "教材", icon: Activity },
  { key: "quiz", label: "測驗", icon: Sparkles },
  { key: "review", label: "複習", icon: CalendarClock },
  { key: "graph", label: "圖譜", icon: Network },
] as const;

type ViewKey = (typeof VIEW_ITEMS)[number]["key"];

const VIEW_PATHS: Record<ViewKey, string> = {
  home: "/",
  setup: "/setup",
  quiz: "/quiz",
  review: "/review",
  graph: "/graph",
};

function getViewFromPathname(pathname: string): ViewKey {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const matchingEntry = Object.entries(VIEW_PATHS).find(([, path]) => path === normalizedPath);
  return (matchingEntry?.[0] as ViewKey | undefined) ?? "home";
}

const PAGE_META: Record<Exclude<ViewKey, "home">, { title: string; description: string }> = {
  setup: {
    title: "教材與課程設定",
    description: "上傳教材、設定課程與模板，讓系統建立概念與知識圖譜。",
  },
  quiz: {
    title: "自適應測驗",
    description: "由 AI 依弱點概念出題、評分，快速確認哪裡還沒懂。",
  },
  review: {
    title: "複習節奏",
    description: "集中看今晚先攻、下次複習與掌握度，直接知道下一步。",
  },
  graph: {
    title: "知識圖譜與班級熱點",
    description: "看概念關聯、先修順序與班級共同卡關的位置。",
  },
};

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
  const [activeView, setActiveView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") {
      return "home";
    }
    return getViewFromPathname(window.location.pathname);
  });
  const [search, setSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [courseName, setCourseName] = useState("通用課程");
  const [templateMode, setTemplateMode] = useState("generic");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);

  const { data: healthData } = useHealth();
  const { data: conceptsData, isLoading: conceptsLoading } = useConcepts();
  const { data: masteryData, isLoading: masteryLoading } = useConceptMastery();
  const { data: chapterData } = useChapterMastery();
  const { data: tonightData, isLoading: tonightLoading } = useTonightDashboard();
  const { data: reviewPlanData, isLoading: reviewPlanLoading } = useReviewPlan();
  const { data: graphData, isLoading: graphLoading } = useKnowledgeGraph();

  const metrics = {
    concept_count: healthData?.metrics?.concept_count ?? 0,
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

  const runtimeLabel = metrics.llm_enabled ? "Gemini 已啟用" : "備援模式";
  const runtimeHint = metrics.llm_enabled ? "可使用生成式診斷、摘要與評分" : "目前以規則與既有資料回應";
  const activeCourseName = courseName.trim() || "通用課程";
  const selectedFileLabel = materialFile?.name ?? "尚未選擇教材檔案";
  const topChapter = chapterMastery[0]?.chapter ?? "等待教材建立章節";
  const topFocus = tonight.focus_items[0]?.concept ?? "尚未產生今晚優先概念";

  const overviewCards = [
    {
      label: "概念節點",
      value: `${Math.round(metrics.concept_count)}`,
      hint: "教材已整理出的知識概念數",
    },
    {
      label: "作答完成率",
      value: `${Math.round(safeNumber(metrics.accuracy) * 100)}%`,
      hint: "依目前測驗紀錄即時更新",
    },
    {
      label: "待排複習",
      value: `${reviewItems.length}`,
      hint: reviewPlanLoading ? "複習資料同步中" : "已進入複習節奏的項目數",
    },
  ];

  const homeActions: Array<{
    key: Exclude<ViewKey, "home">;
    step: string;
    title: string;
    description: string;
    status: string;
    icon: (typeof VIEW_ITEMS)[number]["icon"];
  }> = [
    {
      key: "setup",
      step: "Step 1",
      title: "匯入教材",
      description: "上傳 PDF / TXT / 圖片，建立概念、章節與課程基礎。",
      status: selectedFileLabel === "尚未選擇教材檔案" ? `${concepts.length} 個概念已同步` : selectedFileLabel,
      icon: Activity,
    },
    {
      key: "quiz",
      step: "Step 2",
      title: "產生測驗",
      description: "用自適應題目快速找出不熟的概念與理解落差。",
      status: questions.length > 0 ? `已產生 ${questions.length} 題測驗` : "尚未產生診斷題目",
      icon: Sparkles,
    },
    {
      key: "review",
      step: "Step 3",
      title: "查看複習",
      description: "直接看到今晚先攻內容與下次複習的排程。",
      status: reviewItems.length > 0 ? `下一個重點：${topFocus}` : "先完成測驗後會自動排程",
      icon: CalendarClock,
    },
    {
      key: "graph",
      step: "Step 4",
      title: "理解圖譜",
      description: "檢視概念的先修關係、進展順序與班級熱點。",
      status: graphLoading ? "圖譜載入中" : `主要章節：${topChapter}`,
      icon: Network,
    },
  ];

  const navigateTo = useCallback((view: ViewKey) => {
    setActiveView(view);
    if (typeof window !== "undefined") {
      const targetPath = VIEW_PATHS[view];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, "", targetPath);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncViewFromLocation = () => {
      setActiveView(getViewFromPathname(window.location.pathname));
    };

    window.addEventListener("popstate", syncViewFromLocation);
    return () => {
      window.removeEventListener("popstate", syncViewFromLocation);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.title = activeView === "home"
      ? "AdaptLearn 自適應學習儀表板"
      : `AdaptLearn｜${VIEW_ITEMS.find((item) => item.key === activeView)?.label ?? "儀表板"}`;
  }, [activeView]);

  const pageMeta = activeView === "home" ? null : PAGE_META[activeView];

  const renderPageContent = () => {
    if (activeView === "setup") {
      return (
        <div className="space-y-6">
          <div className="glass-subpanel rounded-[26px] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                      <p className="mt-2 text-sm leading-6 text-white/72">{runtimeHint}</p>
                <p className="mt-1 text-xs text-white/65">這裡是整個流程的起點，完成後其他頁面資料才會完整。</p>
              </div>
              <label className="relative block md:w-[320px]">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-white/55" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="篩選概念、章節或摘要"
                  className="glass-input h-11 w-full rounded-2xl pl-11 pr-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
                />
              </label>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),340px]">
            <ErrorBoundary>
              {conceptsLoading ? (
                <div className="glass-panel rounded-[28px] p-6">
                  <Skeleton className="mb-2 h-5 w-32" />
                  <Skeleton className="h-3 w-56" />
                  <div className="mt-4 space-y-2">
                    {[...Array(3)].map((_, index) => (
                      <ListItemSkeleton key={index} />
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

            <div className="space-y-6">
              <div className="glass-panel-strong rounded-[28px] p-5">
                <p className="section-eyebrow">目前狀態</p>
                <div className="mt-4 space-y-3 text-sm text-white/78">
                  <div className="glass-subpanel rounded-[22px] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/55">系統模式</p>
                    <p className="mt-2 text-base font-semibold text-white">{runtimeLabel}</p>
                  </div>
                  <div className="glass-subpanel rounded-[22px] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/55">當前課程</p>
                    <p className="mt-2 text-base font-semibold text-white">{activeCourseName}</p>
                  </div>
                  <div className="glass-subpanel rounded-[22px] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/55">教材摘要</p>
                    <p className="mt-2 text-sm leading-6 text-white/78">{selectedFileLabel}</p>
                  </div>
                </div>
              </div>
              <InsightFeed insights={insights.slice(0, 3)} />
            </div>
          </div>
        </div>
      );
    }

    if (activeView === "quiz") {
      return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr),340px]">
          <ErrorBoundary>
            <QuizPanel
              questions={questions}
              setQuestions={setQuestions}
              questionIndex={questionIndex}
              setQuestionIndex={setQuestionIndex}
            />
          </ErrorBoundary>

          <div className="space-y-6">
            <div className="glass-panel-strong rounded-[28px] p-5">
              <p className="section-eyebrow">測驗前提醒</p>
              <div className="mt-4 space-y-3 text-sm text-white/78">
                <div className="glass-subpanel rounded-[22px] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/55">最佳用法</p>
                  <p className="mt-2 leading-6 text-white/78">先匯入教材，再用 6 到 9 題快速找出弱點，測完再看複習頁。</p>
                </div>
                <div className="glass-subpanel rounded-[22px] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/55">目前題目</p>
                  <p className="mt-2 text-base font-semibold text-white">{questions.length > 0 ? `${questions.length} 題已產生` : "尚未產生題目"}</p>
                </div>
                <div className="glass-subpanel rounded-[22px] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/55">作答完成率</p>
                  <p className="mt-2 text-base font-semibold text-white">{Math.round(safeNumber(metrics.accuracy) * 100)}%</p>
                </div>
              </div>
            </div>
            <InsightFeed insights={insights.slice(0, 3)} />
          </div>
        </div>
      );
    }

    if (activeView === "review") {
      return (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr),minmax(0,1.15fr)]">
            <ErrorBoundary>
              {tonightLoading ? (
                <div className="glass-panel rounded-[28px] p-6">
                  <Skeleton className="mb-3 h-5 w-32" />
                  <div className="grid grid-cols-3 gap-2">
                    {[...Array(3)].map((_, index) => (
                      <Skeleton key={index} className="h-16 w-full rounded-xl" />
                    ))}
                  </div>
                </div>
              ) : (
                <TonightPanel tonight={tonight} />
              )}
            </ErrorBoundary>

            <ErrorBoundary>
              <StudyPlansPanel reviewItems={reviewItems} isLoading={reviewPlanLoading} />
            </ErrorBoundary>
          </div>

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
      );
    }

    return (
      <div className="space-y-6">
        <ErrorBoundary>
          <KnowledgeGraphPanel dotSource={knowledgeGraphDot} isLoading={graphLoading} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ClassHeatmapPanel />
        </ErrorBoundary>
      </div>
    );
  };

  return (
    <div className="min-h-screen text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="floating-orb left-[4%] top-20 h-72 w-72 bg-rose-400/55" />
        <div className="floating-orb right-[7%] top-28 h-80 w-80 bg-sky-300/45 [animation-delay:1.2s]" />
        <div className="floating-orb bottom-16 left-[38%] h-72 w-72 bg-emerald-300/35 [animation-delay:2.4s]" />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-4 pb-10 pt-4 md:px-6 lg:px-8">
        <nav className="glass-panel sticky top-4 z-40 rounded-[28px] px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)]">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-base font-semibold text-white">AdaptLearn</p>
                <p className="text-xs text-white/65">把教材變成測驗、複習與知識圖譜</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {VIEW_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigateTo(item.key)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                      activeView === item.key
                        ? "border-white/16 bg-white/10 text-white shadow-[0_10px_28px_rgba(15,23,42,0.16)]"
                        : "glass-button border-white/10 text-white/72"
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
              <div className="glass-button inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/85">
                <UserCircle2 size={17} className="text-white/70" />
                <span>學生模式</span>
              </div>
            </div>
          </div>
        </nav>

        <main className="mt-6">
          {activeView === "home" ? (
            <section className="demo-home-shell glass-panel overflow-hidden rounded-[36px] p-6 md:p-8 xl:min-h-[calc(100vh-8.75rem)]">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.06fr),minmax(420px,0.94fr)] xl:items-stretch">
                <div className="flex flex-col justify-between gap-8">
                  <div>
                    <div className="demo-badge inline-flex items-center gap-2">
                      <Sparkles size={14} className="text-amber-300" />
                      <span>Competition Demo · AI Learning Copilot</span>
                    </div>
                    <p className="section-eyebrow mt-6">像產品首頁，不像管理後台</p>
                    <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.04] text-white md:text-6xl">
                      用一個畫面說清楚<span className="gradient-text">教材如何變成測驗、複習與知識圖譜</span>
                    </h1>
                    <p className="mt-5 max-w-2xl text-sm leading-8 text-white/70 md:text-base">
                      AdaptLearn 把教材解析、弱點診斷與複習策略壓成一條可展示的學習流程，讓評審不用往下捲很多頁，就能理解產品價值與操作順序。
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => navigateTo("setup")}
                      className="demo-primary-button inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
                    >
                      <Activity size={16} />
                      <span>開始匯入教材</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo("graph")}
                      className="demo-secondary-button inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold"
                    >
                      <Network size={16} />
                      <span>直接看知識圖譜</span>
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {overviewCards.map((card) => (
                      <div key={card.label} className="demo-stat-card glass-subpanel rounded-[24px] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-white/48">{card.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-white">{card.value}</p>
                        <p className="mt-2 text-xs leading-5 text-white/62">{card.hint}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="demo-preview glass-panel-strong rounded-[32px] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-white/45">Product Preview</p>
                      <h2 className="mt-3 text-2xl font-semibold text-white">評審 15 秒可理解的操作流程</h2>
                    </div>
                    <div className="hidden sm:block">
                      <DailyProgressRing value={safeNumber(metrics.accuracy) * 100} />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.12fr),minmax(180px,0.88fr)]">
                    <div className="glass-subpanel rounded-[24px] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/45">核心承諾</p>
                      <p className="mt-3 text-lg font-semibold leading-8 text-white">
                        上傳教材後，系統會自動建立概念、生成題目，並安排下一輪最值得讀的複習節奏。
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="demo-chip">教材抽取</span>
                        <span className="demo-chip">弱點診斷</span>
                        <span className="demo-chip">SM-2 排程</span>
                        <span className="demo-chip">Graph 視覺化</span>
                      </div>
                    </div>

                    <div className="glass-subpanel rounded-[24px] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/45">即時資訊</p>
                      <div className="mt-4 space-y-3 text-sm text-white/74">
                        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">系統模式</p>
                          <p className="mt-2 font-semibold text-white">{runtimeLabel}</p>
                          <p className="mt-2 text-xs leading-5 text-white/58">{runtimeHint}</p>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">目前課程</p>
                          <p className="mt-2 font-semibold text-white">{activeCourseName}</p>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">下一步</p>
                          <p className="mt-2 leading-6 text-white/74">
                            {reviewItems.length > 0
                              ? `先處理 ${reviewItems[0]?.concept_name ?? "高優先概念"}`
                              : "先進入教材頁上傳講義"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {homeActions.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => navigateTo(item.key)}
                          className="demo-action-card group rounded-[24px] p-4 text-left transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="rounded-2xl border border-white/14 bg-white/[0.06] p-3 text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
                              <Icon size={18} />
                            </div>
                            <ArrowRight size={18} className="text-white/45 transition group-hover:translate-x-1 group-hover:text-white/72" />
                          </div>
                          <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-white/42">{item.step}</p>
                          <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
                          <p className="mt-2 text-sm leading-6 text-white/64">{item.description}</p>
                          <p className="mt-4 text-xs text-cyan-100/78">{item.status}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="glass-panel rounded-[36px] p-6 md:p-8">
              <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => navigateTo("home")}
                    className="glass-button inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/82"
                  >
                    <ChevronLeft size={16} />
                    <span>回首頁</span>
                  </button>
                  <div>
                    <p className="section-eyebrow">功能頁</p>
                    <h1 className="mt-2 text-3xl font-semibold text-white">{pageMeta?.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/72">{pageMeta?.description}</p>
                  </div>
                </div>

                <div className="glass-subpanel rounded-[24px] px-4 py-3 text-sm text-white/78 md:min-w-[240px]">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/55">目前課程</p>
                  <p className="mt-2 text-base font-semibold text-white">{activeCourseName}</p>
                  <p className="mt-1 text-xs text-white/65">{runtimeLabel}</p>
                </div>
              </div>

              {renderPageContent()}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
