import { Sparkles } from "lucide-react";

export interface Insight {
  id: string;
  title: string;
  description: string;
  impact: string;
  level: "high" | "medium";
}

interface Props {
  insights: Insight[];
}

export function InsightFeed({ insights }: Props) {
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
                  item.level === "high" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"
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
