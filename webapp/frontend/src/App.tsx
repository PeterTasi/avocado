import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  UserCircle2,
} from "lucide-react";
import {
  PixelHome,
  PixelUpload,
  PixelStar,
  PixelCalendar,
  PixelGraph,
  PixelBook,
  PixelChart,
} from "./components/PixelIcons";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DailyProgressRing } from "./components/DailyProgressRing";
import { LandingScreen } from "./components/LandingScreen";
import { PixelAvocadoLogo } from "./components/PixelAvocadoLogo";
import { InsightFeed } from "./components/InsightFeed";
import type { Insight } from "./components/InsightFeed";
import { KnowledgeGraphPanel } from "./components/KnowledgeGraphPanel";
import { ClassHeatmapPanel } from "./components/ClassHeatmapPanel";
import { CrossCourseBridgePanel } from "./components/CrossCourseBridgePanel";
import { ListItemSkeleton, Skeleton } from "./components/LoadingSkeleton";
import { MasteryTable } from "./components/MasteryTable";
import { QuizPanel } from "./components/QuizPanel";
import { SetupPanel } from "./components/SetupPanel";
import { StudyPlansPanel, TonightPanel } from "./components/StudyPanels";
import { ProgressPanel } from "./components/ProgressPanel";
import { EmptyStateOnboarding } from "./components/EmptyStateOnboarding";
import {
  useChapterMastery,
  useConceptMastery,
  useConcepts,
  useCourses,
  useHealth,
  useKnowledgeGraph,
  useReviewPlan,
  useTonightDashboard,
} from "./hooks/useApi";
import type { Question, TonightDashboard } from "./hooks/useApi";
import { safeNumber } from "./utils/helpers";

const VIEW_ITEMS = [
  { key: "home", label: "首頁", icon: PixelHome },
  { key: "setup", label: "教材", icon: PixelUpload },
  { key: "quiz", label: "測驗", icon: PixelStar },
  { key: "review", label: "複習", icon: PixelCalendar },
  { key: "graph", label: "圖譜", icon: PixelGraph },
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

/** Smoothly animates a number from 0 to `value` on mount / value change. */
function CountUp({ value, suffix = "", duration = 800 }: { value: number; suffix?: string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return (
    <span>
      {Math.round(display)}
      {suffix}
    </span>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") {
      return "home";
    }
    return getViewFromPathname(window.location.pathname);
  });
  const [showLanding, setShowLanding] = useState(true);

  // 從 URL ?key=xxx 注入 API key 到 localStorage（一次性，mount 時執行）
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const key = params.get("key");
    if (key) {
      localStorage.setItem("adaptlearn_api_key", key);
      setApiKey(key);
      history.replaceState({}, "", location.pathname);
    }
  }, []);
  const [search, setSearch] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("adaptlearn_api_key") ?? "");
  const [courseName, setCourseName] = useState("通用課程");
  const [templateMode, setTemplateMode] = useState("generic");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  // Session gate: until this session successfully ingests a file, concept &
  // insight panels stay empty so stale DB data from a prior session can't be
  // mistaken for the freshly uploaded material. Resets on page reload.
  const [sessionUploaded, setSessionUploaded] = useState(false);

  const { data: healthData } = useHealth();
  const { data: coursesData, isLoading: coursesLoading } = useCourses();
  const showEmptyState = !coursesLoading && (coursesData?.items?.length ?? 0) === 0;
  const { data: conceptsData, isLoading: conceptsLoading, isError: conceptsError } = useConcepts();
  const { data: masteryData, isLoading: masteryLoading } = useConceptMastery();
  const { data: chapterData } = useChapterMastery();
  const { data: tonightData, isLoading: tonightLoading, isError: tonightError } = useTonightDashboard();
  const { data: reviewPlanData, isLoading: reviewPlanLoading } = useReviewPlan();
  const { data: graphData, isLoading: graphLoading } = useKnowledgeGraph();

  const metrics = {
    concept_count: healthData?.metrics?.concept_count ?? 0,
    accuracy: healthData?.metrics?.accuracy ?? 0,
    llm_enabled: healthData?.llm_enabled ?? false,
  };

  // Only reveal concepts once this session has uploaded material.
  const concepts = sessionUploaded ? (conceptsData?.items ?? []) : [];
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
    if (!sessionUploaded) return [];
    return (tonight.focus_items ?? []).slice(0, 4).map((item, index) => ({
      id: `focus-${index}`,
      title: `優先複習：${item.concept}`,
      description: `${item.chapter} · 建議時段 ${item.slot}。優先度 ${safeNumber(item.priority).toFixed(2)}。`,
      impact: `預估提升 +${(safeNumber(item.estimated_gain) * 100).toFixed(1)}%`,
      level: (index < 2 ? "high" : "medium") as "high" | "medium",
    }));
  }, [tonight.focus_items, sessionUploaded]);

  const runtimeLabel = metrics.llm_enabled ? "Gemini 已啟用" : "備援模式";
  const runtimeHint = metrics.llm_enabled ? "可使用生成式診斷、摘要與評分" : "目前以規則與既有資料回應";
  const activeCourseName = courseName.trim() || "通用課程";
  const selectedFileLabel = materialFile?.name ?? "尚未選擇教材檔案";
  const topChapter = sessionUploaded ? (chapterMastery[0]?.chapter ?? "等待教材建立章節") : "等待教材建立章節";
  const topFocus = sessionUploaded ? (tonight.focus_items[0]?.concept ?? "尚未產生今晚優先概念") : "尚未產生今晚優先概念";

  const accuracyPct = sessionUploaded ? Math.round(safeNumber(metrics.accuracy) * 100) : 0;
  const sessionConceptCount = sessionUploaded ? Math.round(metrics.concept_count) : 0;
  const sessionReviewCount = sessionUploaded ? reviewItems.length : 0;
  const statCards = [
    {
      label: "概念節點",
      value: sessionConceptCount,
      suffix: "",
      hint: "從教材中萃取的知識概念總數",
      trend: sessionConceptCount > 0 ? "up" : "flat",
      trendLabel: sessionConceptCount > 0 ? "已建立圖譜" : "等待上傳",
      icon: PixelBook,
      accentColor: "var(--accent)",
    },
    {
      label: "作答完成率",
      value: accuracyPct,
      suffix: "%",
      hint: "本次作答的即時正確率",
      trend: accuracyPct >= 70 ? "up" : accuracyPct >= 40 ? "flat" : "down",
      trendLabel: accuracyPct >= 70 ? "表現良好" : accuracyPct >= 40 ? "持續進步" : "需要補強",
      icon: PixelChart,
      accentColor: accuracyPct >= 70 ? "var(--high)" : accuracyPct >= 40 ? "var(--medium)" : "var(--low)",
    },
    {
      label: "待排複習",
      value: sessionReviewCount,
      suffix: "",
      hint: reviewPlanLoading ? "複習資料同步中…" : "間隔重複排入的複習項目數",
      trend: sessionReviewCount > 0 ? "up" : "flat",
      trendLabel: sessionReviewCount > 0 ? `${sessionReviewCount} 項待複習` : "完成測驗後排程",
      icon: PixelCalendar,
      accentColor: sessionReviewCount > 0 ? "var(--medium)" : "var(--text-muted)",
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
      step: "01",
      title: "匯入教材",
      description: "上傳 PDF / TXT / 圖片，建立概念、章節與課程基礎。",
      status: selectedFileLabel === "尚未選擇教材檔案" ? `${concepts.length} 個概念已同步` : selectedFileLabel,
      icon: PixelUpload,
    },
    {
      key: "quiz",
      step: "02",
      title: "產生測驗",
      description: "用自適應題目快速找出不熟的概念與理解落差。",
      status: questions.length > 0 ? `已產生 ${questions.length} 題測驗` : "尚未產生診斷題目",
      icon: PixelStar,
    },
    {
      key: "review",
      step: "03",
      title: "查看複習",
      description: "直接看到今晚先攻內容與下次複習的排程。",
      status: sessionReviewCount > 0 ? `下一個重點：${topFocus}` : "先完成測驗後會自動排程",
      icon: PixelCalendar,
    },
    {
      key: "graph",
      step: "04",
      title: "理解圖譜",
      description: "檢視概念的先修關係、進展順序與班級熱點。",
      status: graphLoading ? "圖譜載入中" : `主要章節：${topChapter}`,
      icon: PixelGraph,
    },
  ];

  const navigateTo = useCallback((view: ViewKey) => {
    setActiveView(view);
    if (typeof window !== "undefined") {
      const targetPath = VIEW_PATHS[view];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, "", targetPath);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
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
      ? "avocado"
      : `avocado｜${VIEW_ITEMS.find((item) => item.key === activeView)?.label ?? "儀表板"}`;
  }, [activeView]);

  const pageMeta = activeView === "home" ? null : PAGE_META[activeView];

  const renderSubView = () => {
    if (activeView === "setup") {
      return (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),300px]">
            <ErrorBoundary>
              {conceptsLoading ? (
                <div className="card p-6">
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
                  sessionUploaded={sessionUploaded}
                  onIngested={() => setSessionUploaded(true)}
                  conceptsError={conceptsError}
                />
              )}
            </ErrorBoundary>

            <div className="space-y-4">
              <div className="card p-5">
                <p className="section-eyebrow mb-4">目前狀態</p>
                <div className="space-y-3">
                  <div className="card-subtle p-4">
                    <p className="section-eyebrow">當前課程</p>
                    <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">{activeCourseName}</p>
                  </div>
                  <div className="card-subtle p-4">
                    <p className="section-eyebrow">教材摘要</p>
                    <p className="mt-2 truncate text-sm text-[color:var(--text-secondary)]">{selectedFileLabel}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeView === "quiz") {
      return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr),300px]">
          <ErrorBoundary>
            <QuizPanel
              questions={questions}
              setQuestions={setQuestions}
              questionIndex={questionIndex}
              setQuestionIndex={setQuestionIndex}
              sessionUploaded={sessionUploaded}
            />
          </ErrorBoundary>

          <div className="space-y-4">
            <div className="card p-5">
              <p className="section-eyebrow mb-4">測驗前提醒</p>
              <div className="space-y-3">
                <div className="card-subtle p-4">
                  <p className="section-eyebrow">最佳用法</p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">先匯入教材，再用 6 到 9 題快速找出弱點，測完再看複習頁。</p>
                </div>
                <div className="card-subtle p-4">
                  <p className="section-eyebrow">目前題目</p>
                  <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">
                    {questions.length > 0 ? `${questions.length} 題已產生` : "尚未產生題目"}
                  </p>
                </div>
              </div>
            </div>
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
                <div className="card p-6">
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
              <div className="card p-6">
                <Skeleton className="mb-2 h-5 w-40" />
                <Skeleton className="h-48 w-full rounded-xl" />
              </div>
            ) : (
              <MasteryTable conceptMastery={conceptMastery} />
            )}
          </ErrorBoundary>

          <ErrorBoundary>
            <ProgressPanel />
          </ErrorBoundary>
        </div>
      );
    }

    // graph
    return (
      <div className="space-y-6">
        <ErrorBoundary>
          <KnowledgeGraphPanel dotSource={knowledgeGraphDot} isLoading={graphLoading} masteryItems={conceptMastery} courseName={activeCourseName} />
        </ErrorBoundary>
        <ErrorBoundary>
          <CrossCourseBridgePanel />
        </ErrorBoundary>
        <ErrorBoundary>
          <ClassHeatmapPanel />
        </ErrorBoundary>
      </div>
    );
  };

  if (showLanding) {
    return <LandingScreen onEnter={() => { setShowLanding(false); navigateTo("home"); }} />;
  }

  return (
    <div className="min-h-screen">
      {/* ─── Anchored top navigation ─────────────────────────── */}
      <header className="top-nav">
        <div className="mx-auto flex h-full max-w-[var(--container)] items-center gap-6 px-4 md:px-6">
          {/* Brand */}
          <button
            type="button"
            onClick={() => navigateTo("home")}
            className="flex items-center gap-2.5"
          >
            <PixelAvocadoLogo size={30} />
            <span className="font-display text-[17px] font-extrabold text-[color:var(--text-primary)]">avocado</span>
          </button>

          {/* Nav tabs */}
          <nav className="hidden items-center gap-1 md:flex">
            {VIEW_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigateTo(item.key)}
                  className={`nav-tab ${activeView === item.key ? "active" : ""}`}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-3">
            <DailyProgressRing value={safeNumber(metrics.accuracy) * 100} />
            <span className="btn-secondary hidden items-center gap-2 rounded-xl px-3 py-1.5 text-sm lg:inline-flex">
              <UserCircle2 size={16} className="text-[color:var(--text-muted)]" />
              學生模式
            </span>
          </div>
        </div>
      </header>

      {/* Mobile nav tabs */}
      <div className="border-b border-[color:var(--border)] bg-white md:hidden">
        <div className="mx-auto flex max-w-[var(--container)] items-center gap-1 overflow-x-auto px-3 py-2">
          {VIEW_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigateTo(item.key)}
                className={`nav-tab shrink-0 ${activeView === item.key ? "active" : ""}`}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Main content ────────────────────────────────────── */}
      <main className="mx-auto max-w-[var(--container)] px-4 py-8 md:px-6">
        {activeView === "home" ? (
          <div key="home" className="view-enter space-y-8">
            {/* Greeting + CTAs */}
            <section className="relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
              {/* Decorative blobs — subtle, low-opacity */}
              <div
                className="greeting-blob"
                style={{
                  width: 320,
                  height: 320,
                  top: -100,
                  right: -60,
                  background: "radial-gradient(circle, rgba(61,107,40,0.08) 0%, transparent 70%)",
                }}
              />
              <div
                className="greeting-blob"
                style={{
                  width: 200,
                  height: 200,
                  bottom: -80,
                  right: 160,
                  background: "radial-gradient(circle, rgba(122,176,48,0.06) 0%, transparent 70%)",
                }}
              />

              <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="max-w-xl">
                  {/* Date + badge row */}
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="date-pill">
                      <PixelCalendar size={11} />
                      {new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "short" })}
                    </span>
                    <span className="pill">
                      <PixelStar size={12} className="text-[color:var(--accent)]" />
                      AI 學習助理
                    </span>
                  </div>

                  <h1 className="font-display text-2xl font-extrabold leading-tight text-[color:var(--text-primary)] md:text-3xl">
                    把教材變成
                    <span className="gradient-text"> 測驗、複習</span>
                    <br className="hidden sm:block" />
                    與<span className="gradient-text"> 知識圖譜</span>
                  </h1>
                  <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">
                    上傳 PDF、圖片或手寫筆記，系統自動抽取概念、生成自適應題目，
                    <br className="hidden md:block" />
                    並依間隔重複安排最值得讀的複習節奏。
                  </p>
                </div>

                {/* CTA group — vertical stack, primary + ghost */}
                <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col md:min-w-[160px]">
                  <button
                    type="button"
                    onClick={() => navigateTo("setup")}
                    className="btn-primary gap-2 px-5 py-2.5 text-sm shadow-md"
                    style={{ boxShadow: "0 4px 14px rgba(61,107,40,0.28)" }}
                  >
                    <PixelUpload size={16} />
                    匯入教材
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo("quiz")}
                    className="btn-secondary gap-2 px-5 py-2.5 text-sm"
                  >
                    <PixelStar size={15} />
                    開始測驗
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTo("graph")}
                    className="btn-ghost gap-1.5 px-3 py-2 text-xs"
                  >
                    <PixelGraph size={13} />
                    知識圖譜
                    <ChevronRight size={12} className="opacity-60" />
                  </button>
                </div>
              </div>
            </section>

            {showEmptyState ? (
              <EmptyStateOnboarding onNavigate={navigateTo as (view: "setup" | "quiz" | "graph" | "review") => void} />
            ) : (
            <>
            {/* Stat cards */}
            <section className="grid gap-4 sm:grid-cols-3">
              {statCards.map((card, index) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className="stat-card stat-animate-in p-5"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Coloured left accent bar — dynamic colour per card */}
                    <span
                      className="accent-bar"
                      style={{ background: card.accentColor }}
                    />

                    {/* Top row: label + icon */}
                    <div className="mb-3 flex items-center justify-between">
                      <p className="section-eyebrow">{card.label}</p>
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg"
                        style={{ background: `color-mix(in srgb, ${card.accentColor} 12%, transparent)` }}
                      >
                        <Icon size={14} style={{ color: card.accentColor }} />
                      </span>
                    </div>

                    {/* Main number */}
                    <p className="stat-value text-5xl font-semibold text-[color:var(--text-primary)]">
                      <CountUp value={card.value} suffix={card.suffix} />
                    </p>

                    {/* Bottom: hint + trend badge */}
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <p className="text-xs leading-5 text-[color:var(--text-muted)]">{card.hint}</p>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          card.trend === "up"   ? "trend-up" :
                          card.trend === "down" ? "trend-down" : "trend-flat"
                        }`}
                      >
                        {card.trend === "up" ? "↑" : card.trend === "down" ? "↓" : "—"}
                        {card.trendLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* Workflow + side column */}
            <section className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr),minmax(320px,1fr)]">
              {/* Workflow card with vertical timeline */}
              <div className="card p-6">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="section-eyebrow">學習流程</p>
                    <h2 className="mt-1 text-lg font-bold text-[color:var(--text-primary)]">四步驟完成一輪學習</h2>
                  </div>
                </div>

                {/* Timeline container */}
                <div className="workflow-timeline space-y-2">
                  {homeActions.map((item, idx) => {
                    const Icon = item.icon;
                    const isFirst = idx === 0;
                    // Step is "active" if it's the first uncompleted step
                    const isActive = idx === 0;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => navigateTo(item.key)}
                        className="group relative flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all duration-150 hover:bg-[color:var(--bg-subtle)]"
                        style={{ borderRadius: 12 }}
                      >
                        {/* Step badge — solid accent for step 01, outline for rest */}
                        <span
                          className="font-mono-data relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-semibold transition-all duration-150"
                          style={
                            isFirst
                              ? { background: "var(--accent)", color: "#fff", boxShadow: "0 2px 8px rgba(61,107,40,0.28)" }
                              : { background: "var(--bg-sunken)", color: "var(--text-secondary)", border: "1px solid var(--border-strong)" }
                          }
                        >
                          {item.step}
                        </span>

                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-center gap-2">
                            <Icon
                              size={14}
                              style={{ color: isFirst ? "var(--accent)" : "var(--text-muted)" }}
                            />
                            <h3
                              className="text-[15px] font-semibold"
                              style={{ color: isFirst ? "var(--text-primary)" : "var(--text-secondary)" }}
                            >
                              {item.title}
                            </h3>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">{item.description}</p>
                          <p
                            className="mt-1 truncate text-xs font-medium"
                            style={{ color: isFirst ? "var(--accent)" : "var(--text-muted)" }}
                          >
                            {item.status}
                          </p>
                        </div>

                        <ArrowRight
                          size={16}
                          className="mt-1 shrink-0 transition-all duration-150 group-hover:translate-x-1"
                          style={{ color: isFirst ? "var(--accent)" : "var(--text-muted)", opacity: isFirst ? 1 : 0.6 }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right sidebar */}
              <div className="space-y-5">
                {/* Next-up action — prominent */}
                <div className="next-up-card p-5">
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="section-eyebrow" style={{ color: "var(--accent)" }}>今晚優先</p>
                      <p className="mt-1.5 text-[15px] font-bold text-[color:var(--text-primary)]">
                        {reviewItems.length > 0
                          ? reviewItems[0]?.concept_name ?? "高優先概念"
                          : "先上傳教材開始學習"}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                        {reviewItems.length > 0
                          ? `共 ${reviewItems.length} 項待複習，立即進入複習頁`
                          : runtimeHint}
                      </p>
                    </div>
                    <div
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                      style={{ background: "var(--accent)", boxShadow: "0 2px 8px rgba(61,107,40,0.25)" }}
                    >
                      <PixelCalendar size={16} style={{ color: "#fff" }} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateTo(reviewItems.length > 0 ? "review" : "setup")}
                    className="relative mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "var(--accent)" }}
                  >
                    {reviewItems.length > 0 ? "進入複習" : "匯入教材"}
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* System status */}
                <div className="card p-5">
                  <p className="section-eyebrow mb-3">系統狀態</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[color:var(--text-secondary)]">目前課程</span>
                      <span className="max-w-[120px] truncate text-sm font-semibold text-[color:var(--text-primary)]">
                        {activeCourseName}
                      </span>
                    </div>
                    <div className="h-px bg-[color:var(--border)]" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[color:var(--text-secondary)]">概念數量</span>
                      <span className="font-mono-data text-sm font-semibold text-[color:var(--text-primary)]">
                        {Math.round(metrics.concept_count)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* InsightFeed */}
                <InsightFeed insights={insights.slice(0, 3)} isError={tonightError} />
              </div>
            </section>
            </>
            )}
          </div>
        ) : (
          <div key={activeView} className="view-enter">
            {/* Page header */}
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => navigateTo("home")} className="btn-secondary mt-0.5 rounded-xl px-3 py-2 text-sm">
                  <ChevronLeft size={16} />
                  首頁
                </button>
                <div>
                  <p className="section-eyebrow">功能頁</p>
                  <h1 className="mt-1 text-2xl font-bold text-[color:var(--text-primary)]">{pageMeta?.title}</h1>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">{pageMeta?.description}</p>
                </div>
              </div>
              <div className="card-subtle px-4 py-3 md:min-w-[220px]">
                <p className="section-eyebrow">目前課程</p>
                <p className="mt-1.5 text-base font-bold text-[color:var(--text-primary)]">{activeCourseName}</p>
              </div>
            </div>

            {renderSubView()}
          </div>
        )}
      </main>
    </div>
  );
}
