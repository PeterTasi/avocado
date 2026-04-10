import { lazy, Suspense, type ComponentType } from "react";
import { clamp } from "../utils/helpers";

const ModuleSparkline = lazy(() => import("./ModuleSparkline"));

export interface ModuleCardItem {
  id: string;
  name: string;
  valueLabel: string;
  progress: number;
  delta: number;
  icon: ComponentType<{ size?: number }>;
  trend: { v: number }[];
}

interface Props {
  item: ModuleCardItem;
  chartsReady: boolean;
}

export function ModuleCard({ item, chartsReady }: Props) {
  const Icon = item.icon;
  const trendColor = item.delta >= 0 ? "#34d399" : "#fb7185";

  return (
    <article className="glass-panel rounded-[26px] p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-white/18">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-white/14 bg-white/12 p-2.5 text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
            <Icon size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{item.name}</p>
            <p className="text-xs text-white/62">{item.valueLabel}</p>
          </div>
        </div>
        <p className={`text-xs font-semibold ${item.delta >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
          {item.delta >= 0 ? "+" : ""}
          {item.delta.toFixed(1)}% 較基準
        </p>
      </div>

      <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/12">
        <div
          className="h-full rounded-full bg-gradient-to-r from-white to-cyan-200 shadow-[0_0_18px_rgba(191,219,254,0.36)] transition-all duration-700"
          style={{ width: `${clamp(item.progress)}%` }}
        />
      </div>

      <div className="h-14 w-full">
        {chartsReady ? (
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-2xl bg-white/10" />}>
            <ModuleSparkline id={item.id} data={item.trend} trendColor={trendColor} />
          </Suspense>
        ) : (
          <div className="h-full w-full animate-pulse rounded-2xl bg-white/10" />
        )}
      </div>
    </article>
  );
}
