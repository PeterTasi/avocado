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
          {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}%
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
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-slate-800/40" />}>
            <ModuleSparkline id={item.id} data={item.trend} trendColor={trendColor} />
          </Suspense>
        ) : (
          <div className="h-full w-full animate-pulse rounded-lg bg-slate-800/40" />
        )}
      </div>
    </article>
  );
}
