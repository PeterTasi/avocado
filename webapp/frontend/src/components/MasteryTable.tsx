import { useEffect, useState } from "react";
import { useRecalculateReview } from "../hooks/useApi";
import type { ConceptMastery } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";

interface Props {
  conceptMastery: ConceptMastery[];
}

function masteryClass(mastery: number): string {
  if (mastery >= 0.75) return "mastery-high";
  if (mastery >= 0.5)  return "mastery-medium";
  return "mastery-low";
}

function masteryTagClass(mastery: number): string {
  if (mastery >= 0.75) return "tag-high";
  if (mastery >= 0.5)  return "tag-medium";
  return "tag-low";
}

export function MasteryTable({ conceptMastery }: Props) {
  const recalculate = useRecalculateReview();
  const [barsMounted, setBarsMounted] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setBarsMounted(true)); }, []);

  return (
    <article className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-eyebrow">掌握度矩陣</p>
          <h2 className="mt-1 text-lg font-semibold text-[color:var(--text-primary)]">掌握度熱力摘要</h2>
          <p className="text-xs text-[color:var(--text-muted)]">紅→黃→綠分級，快速定位弱點概念。</p>
        </div>
        <button
          type="button"
          onClick={() => recalculate.mutate()}
          disabled={recalculate.isPending}
          className="btn-secondary px-4 py-2 text-xs disabled:opacity-50"
        >
          {recalculate.isPending ? "計算中..." : "重算複習排程"}
        </button>
      </div>

      {recalculate.isPending && (
        <p className="mt-2 text-xs text-[color:var(--text-muted)]">正在重新計算複習排程...</p>
      )}

      {/* Mastery list with gradient bars */}
      <div className="mt-5 max-h-72 space-y-2.5 overflow-auto pr-1">
        {conceptMastery.length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">尚無掌握度資料，先完成測驗後系統會分析掌握狀況。</p>
        ) : (
          conceptMastery.map((row) => {
            const mastery = safeNumber(row.mastery);
            const pct = mastery * 100;
            const isPerfect = mastery >= 1.0;

            return (
              <div key={row.concept_id} className="group flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">
                      {row.name}
                      {/* 🎮 100% 星星彩蛋 */}
                      {isPerfect && (
                        <span
                          className="ml-1.5 inline-block text-[13px]"
                          title="完全掌握！"
                          aria-label="完全掌握"
                        >
                          ★
                        </span>
                      )}
                    </p>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${masteryTagClass(mastery)}`}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                    {row.chapter} · {row.attempts} 次作答
                  </p>
                  <div className="mastery-bar-track mt-1.5">
                    <div
                      className="mastery-bar-fill"
                      style={{ width: barsMounted ? `${Math.min(pct, 100)}%` : "0%" }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
