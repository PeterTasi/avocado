import { useMemo } from "react";
import { Activity, BookCheck, Brain, Network, Target } from "lucide-react";
import type { ChapterMastery, TonightDashboard } from "../hooks/useApi";
import { ModuleCard } from "./ModuleCard";
import type { ModuleCardItem } from "./ModuleCard";
import { buildTrend, clamp, safeNumber } from "../utils/helpers";

interface Props {
  chapterMastery: ChapterMastery[];
  accuracy: number;
  tonight: TonightDashboard;
  chartsReady: boolean;
}

export function MetricCardsGrid({ chapterMastery, accuracy, tonight, chartsReady }: Props) {
  const metricCards = useMemo<ModuleCardItem[]>(() => {
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
      } satisfies ModuleCardItem;
    });

    const focusScore = clamp(Math.round(safeNumber(accuracy) * 100 + safeNumber(tonight.uplift) * 80));
    const retention = clamp(Math.round(safeNumber(tonight.after) * 100));

    const dynamicCards: ModuleCardItem[] = [
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

    const cards: ModuleCardItem[] = [...topChapters, ...dynamicCards];
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
