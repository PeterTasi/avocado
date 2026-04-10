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
    <section className="glass-panel rounded-[28px] p-6 text-white">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl border border-white/14 bg-white/12 p-2.5 text-orange-100">
          <BarChart2 size={17} />
        </div>
        <div>
          <p className="section-eyebrow">班級視角</p>
          <h2 className="mt-1 text-lg font-semibold text-white">班級知識熱力圖</h2>
          <p className="text-xs text-white/62">彙整全班作答，找出共同弱點</p>
        </div>
      </div>

      {coursesLoading ? (
        <p className="text-xs text-white/62">載入課程中...</p>
      ) : courses.length === 0 ? (
        <p className="text-xs text-white/62">尚未上傳任何課程教材。</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseId(c.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  activeCourseId === c.id
                    ? "border-white/20 bg-white/18 text-white font-semibold"
                    : "glass-button text-white/68"
                }`}
              >
                {c.subject}
              </button>
            ))}
          </div>

          {weak.length > 0 && (
            <div className="mb-4 rounded-[22px] border border-rose-200/18 bg-rose-200/10 p-3">
              <p className="mb-2 text-xs font-semibold text-rose-100">教師建議：本週優先加強</p>
              <ul className="space-y-1">
                {weak.map((w) => (
                  <li key={w.concept_id} className="flex items-center justify-between text-xs">
                    <span className="text-white">{w.concept_id}</span>
                    <span className="text-rose-100/88">錯誤率 {(w.error_rate * 100).toFixed(0)}% · 若補強預估提升 +{(w.estimated_uplift * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {heatmapLoading ? (
            <p className="text-xs text-white/62">計算中...</p>
          ) : stats.length === 0 ? (
            <p className="text-xs text-white/62">此課程尚無作答資料，請先產生並完成測驗。</p>
          ) : (
            <div className="max-h-72 overflow-auto rounded-[24px] border border-white/12 bg-[rgba(8,15,32,0.12)]">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-[rgba(9,16,34,0.52)] text-white/78 backdrop-blur-xl">
                  <tr>
                    <th className="px-3 py-2">概念</th>
                    <th className="px-3 py-2">班級錯誤率</th>
                    <th className="px-3 py-2">作答人次</th>
                    <th className="px-3 py-2">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={row.concept_id} className="border-t border-white/10">
                      <td className="px-3 py-2 text-white">{row.concept_name}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/12">
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
                      <td className="px-3 py-2 text-white/72">{row.sample_count}</td>
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
