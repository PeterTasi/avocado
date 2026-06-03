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
  isError?: boolean;
}

export function InsightFeed({ insights, isError = false }: Props) {
  return (
    <section className="glass-panel rounded-[28px] p-6 text-white shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl border border-white/14 bg-white/12 p-2.5 text-white">
          <Sparkles size={17} />
        </div>
        <div>
          <p className="section-eyebrow">AI 洞察</p>
          <h2 className="mt-1 text-lg font-semibold text-white">學習動態摘要</h2>
          <p className="text-xs text-white/62">由作答紀錄、複習節奏與概念圖譜即時生成</p>
        </div>
      </div>

      <div className="space-y-3">
        {isError ? (
          <p className="rounded-[18px] border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-300">
            ⚠ 無法讀取學習動態，請確認後端連線後重試。
          </p>
        ) : insights.length === 0 ? (
          <p className="rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.14)] p-4 text-sm text-white/62">
            尚未有可顯示的學習動態。上傳教材並完成測驗後，這裡會即時更新複習建議。
          </p>
        ) : (
          insights.map((item) => (
          <article
            key={item.id}
            className="rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.14)] p-4 transition-all duration-300 hover:bg-white/12"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-white">{item.title}</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${
                  item.level === "high" ? "bg-rose-200/16 text-rose-100" : "bg-emerald-200/16 text-emerald-100"
                }`}
              >
                {item.level === "high" ? "高優先" : "中優先"}
              </span>
            </div>
            <p className="text-sm leading-6 text-white/68">{item.description}</p>
            <p className="mt-2 text-xs font-medium text-cyan-100/82">{item.impact}</p>
          </article>
          ))
        )}
      </div>
    </section>
  );
}
