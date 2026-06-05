import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useConceptProgress, type ConceptProgressItem } from "../hooks/useApi";

const TREND_CONFIG = {
  improving: {
    icon: TrendingUp,
    label: "進步中",
    color: "var(--high)",
    bg: "var(--high-soft)",
    symbol: "↑",
  },
  declining: {
    icon: TrendingDown,
    label: "需加強",
    color: "var(--low)",
    bg: "var(--low-soft)",
    symbol: "↓",
  },
  plateaued: {
    icon: Minus,
    label: "穩定",
    color: "var(--text-muted)",
    bg: "var(--bg-subtle)",
    symbol: "→",
  },
} as const;

// 依趨勢分配折線顏色（最多顯示 10 條線）
const LINE_COLORS = [
  "#3d6b28", "#6d9b3a", "#a8c96e",
  "#d98a04", "#e07b54", "#e11d48",
  "#2563eb", "#7c3aed", "#0891b2", "#64748b",
];

function formatDay(dayStr: string): string {
  const d = new Date(dayStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface TrendBadgeProps {
  trend: ConceptProgressItem["trend"];
}
function TrendBadge({ trend }: TrendBadgeProps) {
  const cfg = TREND_CONFIG[trend];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

export function ProgressPanel() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError } = useConceptProgress(days);
  const items = data?.items ?? [];

  // 合併所有日期點成為圖表資料
  const allDays = Array.from(
    new Set(items.flatMap(it => it.daily.map(d => d.day)))
  ).sort();

  const chartData = allDays.map(day => {
    const point: Record<string, string | number> = { day: formatDay(day) };
    for (const item of items) {
      const found = item.daily.find(d => d.day === day);
      if (found) point[item.concept_name] = Math.round(found.avg_score * 100);
    }
    return point;
  });

  return (
    <section className="card p-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="section-eyebrow">學習軌跡</p>
          <h2 className="mt-0.5 text-base font-semibold text-[color:var(--text-primary)]">概念掌握度趨勢</h2>
          <p className="text-xs text-[color:var(--text-muted)]">每日作答平均得分（%）</p>
        </div>
        <div className="flex gap-1.5">
          {([7, 14, 30] as const).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={days === d ? "btn-primary px-3 py-1 text-xs" : "btn-secondary px-3 py-1 text-xs"}
            >
              {d} 天
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="py-12 text-center text-sm text-[color:var(--text-muted)]">載入中...</p>
      )}

      {isError && (
        <p className="py-12 text-center text-sm text-[color:var(--low)]">無法載入進度資料</p>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <TrendingUp size={32} className="mb-3 opacity-20" />
          <p className="text-sm font-medium text-[color:var(--text-secondary)]">尚無作答紀錄</p>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">完成測驗後，這裡會顯示你的學習曲線</p>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <>
          {/* Line chart */}
          <div className="mb-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `${v}%`}
                />
                <Tooltip
                  formatter={(value: number) => [`${value}%`, ""]}
                  contentStyle={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={value => (
                    <span style={{ color: "var(--text-secondary)" }}>{value}</span>
                  )}
                />
                {items.slice(0, 10).map((item, i) => (
                  <Line
                    key={item.concept_id}
                    type="monotone"
                    dataKey={item.concept_name}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Concept list with trend badges */}
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map(item => {
              const latest = item.daily.at(-1);
              return (
                <div
                  key={item.concept_id}
                  className="card-subtle flex items-center justify-between px-3 py-2.5"
                >
                  <span className="truncate text-sm text-[color:var(--text-primary)]">
                    {item.concept_name}
                  </span>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    {latest && (
                      <span className="font-mono text-sm font-semibold text-[color:var(--text-secondary)]">
                        {Math.round(latest.avg_score * 100)}%
                      </span>
                    )}
                    <TrendBadge trend={item.trend} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
