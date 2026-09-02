import { Clock3, CalendarClock } from "lucide-react";
import type { ReviewItem, TonightDashboard } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";
import { ForgettingCurve } from "./ForgettingCurve";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// --- TonightPanel ---

interface TonightProps {
  tonight: TonightDashboard;
}

export function TonightPanel({ tonight }: TonightProps) {
  const hasData = tonight.has_data !== false && (tonight.before > 0 || tonight.after > 0);

  return (
    <article className="card p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--accent-soft)" }}
        >
          <Clock3 size={15} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <p className="section-eyebrow">今晚安排</p>
          <h2 className="mt-0.5 text-base font-semibold text-[color:var(--text-primary)]">今晚衝刺計畫</h2>
        </div>
      </div>

      {/* ponytail: 通過率 before/after 是未驗證的佔位公式（pipeline._estimate_pass_probability），不給人看 */}
      {!hasData && (
        <p className="text-xs text-[color:var(--text-muted)]">尚無作答記錄。先上傳教材並完成測驗，今晚清單才會出現。</p>
      )}

      {/* Chapter tags */}
      {tonight.chapters.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tonight.chapters.map((chapter) => (
            <span key={chapter} className="pill text-[11px]">{chapter}</span>
          ))}
        </div>
      )}

      {/* Focus items */}
      <div className="mt-4 space-y-2">
        {(tonight.focus_items || []).length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">目前尚無今晚計畫。先上傳教材並完成測驗。</p>
        ) : (
          tonight.focus_items.map((item, index) => (
            <article
              key={`${item.concept}-${index}`}
              className="card-subtle rounded-xl p-3"
            >
              <p className="text-sm font-medium text-[color:var(--text-primary)]">
                <span className="font-mono-data mr-2 text-[11px] text-[color:var(--text-muted)]">{String(index + 1).padStart(2, "0")}</span>
                {item.concept}
              </p>
              <p className="mt-0.5 text-xs text-[color:var(--accent)]">{item.chapter} · {item.slot}</p>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                優先度 {safeNumber(item.priority).toFixed(2)}
              </p>
            </article>
          ))
        )}
      </div>
    </article>
  );
}

// --- StudyPlansPanel ---

interface StudyPlansProps {
  reviewItems: ReviewItem[];
  isLoading: boolean;
}

export function StudyPlansPanel({ reviewItems, isLoading }: StudyPlansProps) {
  return (
    <article className="card p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--accent-soft)" }}
        >
          <CalendarClock size={15} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <p className="section-eyebrow">複習節奏</p>
          <h2 className="mt-0.5 text-base font-semibold text-[color:var(--text-primary)]">複習排程</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-[color:var(--text-muted)]">載入複習計畫中...</p>
      ) : reviewItems.length === 0 ? (
        <p className="text-xs text-[color:var(--text-muted)]">目前尚無排程，先上傳教材並產生測驗即可建立計畫。</p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-auto pr-1">
          {reviewItems.slice(0, 8).map((item) => {
            const priority = safeNumber(item.priority);
            return (
              <article key={item.concept_id} className="card-subtle rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[color:var(--text-primary)]">{item.concept_name}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.retention > 0 && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        🧠 {Math.round(item.retention * 100)}%
                      </span>
                    )}
                    <span className="font-mono-data text-[11px] text-[color:var(--text-muted)]">
                      {(priority * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                {/* Priority bar */}
                <div className="mastery-bar-track mt-2">
                  <div
                    className="mastery-bar-fill"
                    style={{ width: `${Math.min(priority * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[color:var(--text-muted)]">
                  <span>{item.suggested_slot}</span>
                  <span>{formatTimestamp(item.next_review_at)}</span>
                </div>
                {/* Forgetting curve */}
                <ForgettingCurve
                  retention={item.retention}
                  stability={item.stability}
                  nextReviewAt={item.next_review_at}
                />
              </article>
            );
          })}
        </div>
      )}
    </article>
  );
}
