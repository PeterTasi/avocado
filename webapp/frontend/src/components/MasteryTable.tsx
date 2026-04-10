import { useRecalculateReview } from "../hooks/useApi";
import type { ConceptMastery } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";

interface Props {
  conceptMastery: ConceptMastery[];
}

export function MasteryTable({ conceptMastery }: Props) {
  const recalculate = useRecalculateReview();

  return (
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-eyebrow">掌握度矩陣</p>
          <h2 className="mt-1 text-lg font-semibold text-white">掌握度熱力摘要</h2>
          <p className="text-xs text-white/62">紅黃綠分級，快速定位弱點概念。</p>
        </div>
        <button
          type="button"
          onClick={() => recalculate.mutate()}
          disabled={recalculate.isPending}
          className="glass-button rounded-full px-4 py-2 text-xs transition disabled:opacity-60"
        >
          {recalculate.isPending ? "計算中..." : "重算複習排程"}
        </button>
      </div>

      <p className="mt-2 text-xs text-white/62">
        {recalculate.isPending ? "正在重新計算..." : ""}
      </p>

      <div className="mt-4 max-h-64 overflow-auto rounded-[24px] border border-white/12 bg-[rgba(8,15,32,0.12)]">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-[rgba(9,16,34,0.52)] text-white/78 backdrop-blur-xl">
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
                <td colSpan={4} className="px-3 py-3 text-white/62">
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
                  <tr key={row.concept_id} className="border-t border-white/10">
                    <td className="px-3 py-2 text-white">{row.name}</td>
                    <td className="px-3 py-2 text-white/62">{row.chapter}</td>
                    <td className={`px-3 py-2 font-semibold ${statusClass}`}>
                      {(mastery * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-white/75">{row.attempts}</td>
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
