import { useState } from "react";
import { BarChart2 } from "lucide-react";
import { useCourses, useClassHeatmap, useClassWeakConcepts } from "../hooks/useApi";

function StatusDot({ status }: { status: "red" | "yellow" | "green" }) {
  const cls =
    status === "green"
      ? "bg-emerald-400"
      : status === "yellow"
      ? "bg-amber-400"
      : "bg-rose-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export function ClassHeatmapPanel() {
  const { data: coursesData, isLoading: coursesLoading } = useCourses();
  const courses = coursesData?.items ?? [];

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const activeCourseId = selectedCourseId ?? courses[0]?.id ?? null;

  const { data: heatmapData, isLoading: heatmapLoading } = useClassHeatmap(activeCourseId);
  const { data: weakData } = useClassWeakConcepts(activeCourseId, 3);

  const stats = heatmapData?.items ?? [];
  const weak = weakData?.items ?? [];

  return (
    <section className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl border border-orange-500/20 bg-slate-900 p-2 text-orange-400">
          <BarChart2 size={17} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-100">班級知識熱力圖</h2>
          <p className="text-xs text-slate-400">彙整全班作答，找出共同弱點</p>
        </div>
      </div>

      {/* Course selector */}
      {coursesLoading ? (
        <p className="text-xs text-slate-400">載入課程中...</p>
      ) : courses.length === 0 ? (
        <p className="text-xs text-slate-400">尚未上傳任何課程教材。</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseId(c.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  activeCourseId === c.id
                    ? "border-orange-500/60 bg-orange-500/10 text-orange-300 font-semibold"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                }`}
              >
                {c.subject}
              </button>
            ))}
          </div>

          {/* Weak concepts callout */}
          {weak.length > 0 && (
            <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <p className="mb-2 text-xs font-semibold text-rose-300">教師建議 — 本週優先加強：</p>
              <ul className="space-y-1">
                {weak.map((w) => (
                  <li key={w.concept_id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-200">{w.concept_id}</span>
                    <span className="text-rose-400">錯誤率 {(w.error_rate * 100).toFixed(0)}% · 若補強預估提升 +{(w.estimated_uplift * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Heatmap table */}
          {heatmapLoading ? (
            <p className="text-xs text-slate-400">計算中...</p>
          ) : stats.length === 0 ? (
            <p className="text-xs text-slate-400">此課程尚無作答資料，請先產生並完成測驗。</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/50">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900/90 text-slate-300">
                  <tr>
                    <th className="px-3 py-2">概念</th>
                    <th className="px-3 py-2">班級錯誤率</th>
                    <th className="px-3 py-2">作答人次</th>
                    <th className="px-3 py-2">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={row.concept_id} className="border-t border-slate-800/70">
                      <td className="px-3 py-2 text-slate-100">{row.concept_name}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                row.status === "green"
                                  ? "bg-emerald-500"
                                  : row.status === "yellow"
                                  ? "bg-amber-500"
                                  : "bg-rose-500"
                              }`}
                              style={{ width: `${Math.round(row.error_rate * 100)}%` }}
                            />
                          </div>
                          <span
                            className={
                              row.status === "green"
                                ? "text-emerald-400"
                                : row.status === "yellow"
                                ? "text-amber-400"
                                : "text-rose-400"
                            }
                          >
                            {(row.error_rate * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{row.sample_count}</td>
                      <td className="px-3 py-2">
                        <StatusDot status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
