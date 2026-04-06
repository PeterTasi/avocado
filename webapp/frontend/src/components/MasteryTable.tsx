import { useRecalculateReview } from "../hooks/useApi";
import type { ConceptMastery } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";

interface Props {
  conceptMastery: ConceptMastery[];
}

export function MasteryTable({ conceptMastery }: Props) {
  const recalculate = useRecalculateReview();

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">掌握度熱力摘要</h2>
          <p className="text-xs text-slate-400">紅黃綠分級，快速定位弱點概念。</p>
        </div>
        <button
          type="button"
          onClick={() => recalculate.mutate()}
          disabled={recalculate.isPending}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 transition hover:border-indigo-500/40 disabled:opacity-60"
        >
          {recalculate.isPending ? "計算中..." : "重算複習排程"}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {recalculate.isPending ? "正在重新計算..." : ""}
      </p>

      <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/50">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-900/90 text-slate-300">
            <tr>
              <th className="px-3 py-2">概念</th>
              <th className="px-3 py-2">章節</th>
              <th className="px-3 py-2">掌握度</th>
              <th className="px-3 py-2">作答次數</th>
            </tr>
          </thead>
          <tbody>
            {conceptMastery.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-slate-400">
                  尚無掌握度資料。
                </td>
              </tr>
            ) : (
              conceptMastery.map((row) => {
                const mastery = safeNumber(row.mastery);
                const statusClass =
                  mastery >= 0.75
                    ? "text-emerald-400"
                    : mastery >= 0.5
                    ? "text-amber-300"
                    : "text-rose-300";
                return (
                  <tr key={row.concept_id} className="border-t border-slate-800/70">
                    <td className="px-3 py-2 text-slate-100">{row.name}</td>
                    <td className="px-3 py-2 text-slate-400">{row.chapter}</td>
                    <td className={`px-3 py-2 font-semibold ${statusClass}`}>
                      {(mastery * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.attempts}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}
