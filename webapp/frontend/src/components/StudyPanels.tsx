import { Clock3, CalendarClock } from "lucide-react";
import type { ReviewItem, TonightDashboard } from "../hooks/useApi";
import { formatPercent, safeNumber } from "../utils/helpers";

// --- TonightPanel ---

interface TonightProps {
  tonight: TonightDashboard;
}

export function TonightPanel({ tonight }: TonightProps) {
  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock3 size={16} className="text-emerald-400" />
        <h2 className="text-base font-semibold text-slate-100">今晚衝刺計畫</h2>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">目前通過率</p>
          <p className="text-sm font-semibold text-slate-100">{formatPercent(tonight.before)}</p>
        </div>
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">預估提升</p>
          <p className="text-sm font-semibold text-emerald-400">
            +{(safeNumber(tonight.uplift) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">預估通過率</p>
          <p className="text-sm font-semibold text-slate-100">{formatPercent(tonight.after)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {(tonight.focus_items || []).length === 0 ? (
          <p className="text-xs text-slate-400">目前尚無今晚計畫。</p>
        ) : (
          tonight.focus_items.map((item, index) => (
            <article
              key={`${item.concept}-${index}`}
              className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-3"
            >
              <p className="text-sm text-slate-100">
                {index + 1}. {item.concept}
              </p>
              <p className="text-xs text-indigo-400">
                {item.chapter} · {item.slot}
              </p>
              <p className="mt-1 text-xs text-slate-400">
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
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={16} className="text-emerald-400" />
        <h2 className="text-base font-semibold text-slate-100">Study Plans</h2>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">載入複習計畫中...</p>
      ) : reviewItems.length === 0 ? (
        <p className="text-xs text-slate-400">目前尚無排程，先上傳教材並產生測驗即可建立計畫。</p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-auto">
          {reviewItems.slice(0, 8).map((item) => (
            <article
              key={item.concept_id}
              className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-3"
            >
              <p className="text-sm text-slate-100">{item.concept_name}</p>
              <p className="text-xs text-indigo-400">{item.suggested_slot}</p>
              <p className="mt-1 text-xs text-slate-400">
                優先度 {safeNumber(item.priority).toFixed(2)} · 下次複習 {item.next_review_at}
              </p>
              <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}
