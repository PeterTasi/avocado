import { Clock3, CalendarClock } from "lucide-react";
import type { ReviewItem, TonightDashboard } from "../hooks/useApi";
import { formatPercent, safeNumber } from "../utils/helpers";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

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
  return (
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 size={16} className="text-emerald-100" />
        <div>
          <p className="section-eyebrow">今晚安排</p>
          <h2 className="mt-1 text-lg font-semibold text-white">今晚衝刺計畫</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[20px] border border-white/10 bg-[rgba(8,15,32,0.12)] p-3">
          <p className="text-[11px] text-white/55">目前通過率</p>
          <p className="text-sm font-semibold text-white">{formatPercent(tonight.before)}</p>
        </div>
        <div className="rounded-[20px] border border-white/10 bg-[rgba(8,15,32,0.12)] p-3">
          <p className="text-[11px] text-white/55">預估提升</p>
          <p className="text-sm font-semibold text-emerald-100">
            +{(safeNumber(tonight.uplift) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-[20px] border border-white/10 bg-[rgba(8,15,32,0.12)] p-3">
          <p className="text-[11px] text-white/55">預估通過率</p>
          <p className="text-sm font-semibold text-white">{formatPercent(tonight.after)}</p>
        </div>
      </div>

      {tonight.chapters.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tonight.chapters.map((chapter) => (
            <span key={chapter} className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/72">
              {chapter}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {(tonight.focus_items || []).length === 0 ? (
          <p className="text-xs text-white/62">目前尚無今晚計畫。</p>
        ) : (
          tonight.focus_items.map((item, index) => (
            <article
              key={`${item.concept}-${index}`}
              className="rounded-[20px] border border-white/10 bg-[rgba(8,15,32,0.12)] p-3"
            >
              <p className="text-sm text-white">
                {index + 1}. {item.concept}
              </p>
              <p className="text-xs text-cyan-100/78">
                {item.chapter} · {item.slot}
              </p>
              <p className="mt-1 text-xs text-white/62">
                優先度 {safeNumber(item.priority).toFixed(2)} · 預估提升 +
                {(safeNumber(item.estimated_gain) * 100).toFixed(1)}%
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
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={16} className="text-emerald-100" />
        <div>
          <p className="section-eyebrow">複習節奏</p>
          <h2 className="mt-1 text-lg font-semibold text-white">複習排程</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-white/62">載入複習計畫中...</p>
      ) : reviewItems.length === 0 ? (
        <p className="text-xs text-white/62">目前尚無排程，先上傳教材並產生測驗即可建立計畫。</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-auto">
          {reviewItems.slice(0, 8).map((item) => (
            <article
              key={item.concept_id}
              className="rounded-[20px] border border-white/10 bg-[rgba(8,15,32,0.12)] p-3"
            >
              <p className="text-sm text-white">{item.concept_name}</p>
              <p className="text-xs text-cyan-100/78">{item.suggested_slot}</p>
              <p className="mt-1 text-xs text-white/62">
                優先度 {safeNumber(item.priority).toFixed(2)} · 下次複習 {formatTimestamp(item.next_review_at)}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/52">{item.reason}</p>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}
