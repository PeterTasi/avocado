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

/** Simple SVG illustration for empty state — no external deps */
function EmptyIllustration() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      className="empty-illustration mx-auto mb-3"
      aria-hidden="true"
    >
      {/* Notebook pages */}
      <rect x="10" y="14" width="36" height="38" rx="4" fill="var(--bg-sunken)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="14" y="10" width="36" height="38" rx="4" fill="var(--bg-subtle)" stroke="var(--border-strong)" strokeWidth="1.5" />
      {/* Lines */}
      <line x1="20" y1="22" x2="44" y2="22" stroke="var(--border-hover)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20" y1="29" x2="40" y2="29" stroke="var(--border-hover)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20" y1="36" x2="34" y2="36" stroke="var(--border-hover)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Sparkle */}
      <circle cx="46" cy="18" r="8" fill="var(--accent-soft)" />
      <path
        d="M46 12.5v11M40.5 18h11M42.6 14.1l6.8 6.8M49.4 14.1l-6.8 6.8"
        stroke="var(--accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

export function InsightFeed({ insights, isError = false }: Props) {
  return (
    <section className="card p-5">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--accent-soft)] text-[color:var(--accent)]">
          <Sparkles size={16} />
        </div>
        <div>
          <p className="section-eyebrow">AI 洞察</p>
          <h2 className="text-base font-semibold text-[color:var(--text-primary)]">學習動態摘要</h2>
        </div>
      </div>

      <div className="space-y-2">
        {isError ? (
          <div className="rounded-xl border border-[color:var(--low)] bg-[color:var(--low-soft)] px-4 py-3">
            <p className="text-sm font-medium text-[color:var(--low)]">無法讀取學習動態</p>
            <p className="mt-0.5 text-xs text-[color:var(--low)] opacity-80">請確認後端連線後重試。</p>
          </div>
        ) : insights.length === 0 ? (
          /* Empty state with SVG illustration */
          <div className="py-4 text-center">
            <EmptyIllustration />
            <p className="text-sm font-medium text-[color:var(--text-secondary)]">尚無學習動態</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
              上傳教材並完成測驗後，
              <br />
              AI 會即時生成個人化複習建議。
            </p>
          </div>
        ) : (
          insights.map((item) => (
            <article
              key={item.id}
              className={`rounded-xl bg-[color:var(--bg-subtle)] p-3.5 transition-colors duration-150 hover:bg-[color:var(--bg-sunken)] ${
                item.level === "high" ? "insight-item-high" : "insight-item-medium"
              }`}
              style={{
                borderTop: "1px solid var(--border)",
                borderRight: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {/* Title row */}
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-5 text-[color:var(--text-primary)]">
                  {item.title}
                </h3>
                <span
                  className={`pill mt-0.5 shrink-0 text-[10px] ${
                    item.level === "high" ? "tag-low" : "tag-medium"
                  }`}
                >
                  {item.level === "high" ? "高優先" : "中優先"}
                </span>
              </div>

              {/* Description */}
              <p className="text-xs leading-5 text-[color:var(--text-secondary)]">{item.description}</p>

              {/* Impact badge */}
              <p className="mt-2 text-[11px] font-semibold text-[color:var(--accent)]">{item.impact}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
