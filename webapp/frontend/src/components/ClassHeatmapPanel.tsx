import { useState } from "react";
import { BarChart2 } from "lucide-react";
import { useCourses, useClassHeatmap, useClassWeakConcepts } from "../hooks/useApi";

/** 把 error_rate 0–1 對應到顏色（綠→琥珀→玫紅）*/
function errorRateColor(rate: number): string {
  if (rate < 0.25) return "var(--high)";
  if (rate < 0.5)  return "var(--medium)";
  return "var(--low)";
}

/** 半透明填色（低錯誤率 = 淺綠，高 = 深紅）*/
function errorRateFill(rate: number): string {
  if (rate < 0.25) return "var(--high-soft)";
  if (rate < 0.5)  return "var(--medium-soft)";
  return "var(--low-soft)";
}

export function ClassHeatmapPanel() {
  const { data: coursesData, isLoading: coursesLoading } = useCourses();
  const allCourses = coursesData?.items ?? [];
  // 同名課程可能因多次上傳產生多筆，以 subject 去重，保留最新（API 已按 uploaded_at DESC）
  const seenSubjects = new Set<string>();
  const courses = allCourses.filter(c => {
    if (seenSubjects.has(c.subject)) return false;
    seenSubjects.add(c.subject);
    return true;
  });

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeCourseId = selectedCourseId ?? courses.find(c => c.is_active)?.id ?? courses[0]?.id ?? null;

  const { data: heatmapData, isLoading: heatmapLoading } = useClassHeatmap(activeCourseId);
  const { data: weakData } = useClassWeakConcepts(activeCourseId, 3);

  const stats = heatmapData?.items ?? [];
  const weak = weakData?.items ?? [];
  const hoveredRow = stats.find(s => s.concept_id === hoveredId);

  return (
    <section className="card p-6">
      <div className="mb-5 flex items-center gap-3">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--medium-soft)" }}
        >
          <BarChart2 size={15} style={{ color: "var(--medium)" }} />
        </div>
        <div>
          <p className="section-eyebrow">班級視角</p>
          <h2 className="mt-0.5 text-base font-semibold text-[color:var(--text-primary)]">班級知識熱力圖</h2>
          {/* ponytail: 誠實標示樣本範圍——系統目前是單租戶，寫「全班」是假的 */}
          <p className="text-xs text-[color:var(--text-muted)]">彙整所有使用者的作答，找出共同弱點 · 目前為單一使用者</p>
        </div>
      </div>

      {coursesLoading ? (
        <p className="text-xs text-[color:var(--text-muted)]">載入課程中...</p>
      ) : courses.length === 0 ? (
        <p className="text-xs text-[color:var(--text-muted)]">尚未上傳任何課程教材。</p>
      ) : (
        <>
          {/* Course selector */}
          <div className="mb-5 flex flex-wrap gap-2">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseId(c.id)}
                className={activeCourseId === c.id ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
              >
                {c.subject}
              </button>
            ))}
          </div>

          {/* Weak concepts callout */}
          {weak.length > 0 && (
            <div className="mb-5 rounded-xl border border-[color:var(--low)] bg-[color:var(--low-soft)] px-4 py-3">
              <p className="mb-2 text-xs font-semibold text-[color:var(--low)]">建議：本週優先加強</p>
              <ul className="space-y-1.5">
                {weak.map((w) => (
                  <li key={w.concept_id} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[color:var(--text-primary)]">{w.concept_name}</span>
                    {/* ponytail: estimated_uplift 是封頂常數不是實測，不顯示；sample_count 才是真的 */}
                    <span className="text-[color:var(--text-secondary)]">
                      錯誤率 {(w.error_rate * 100).toFixed(0)}% · {w.sample_count} 次作答
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {heatmapLoading ? (
            <p className="text-xs text-[color:var(--text-muted)]">計算中...</p>
          ) : stats.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">此課程尚無作答資料，請先產生並完成測驗。</p>
          ) : (
            <>
              {/* Tooltip */}
              {hoveredRow && (
                <div className="mb-3 card-subtle rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-[color:var(--text-primary)]">{hoveredRow.concept_name}</span>
                  <span className="mx-2 text-[color:var(--text-muted)]">·</span>
                  <span style={{ color: errorRateColor(hoveredRow.error_rate) }}>
                    錯誤率 {(hoveredRow.error_rate * 100).toFixed(0)}%
                  </span>
                  <span className="mx-2 text-[color:var(--text-muted)]">·</span>
                  <span className="text-[color:var(--text-muted)]">{hoveredRow.sample_count} 人次</span>
                </div>
              )}

              {/* 🎮 Heatmap grid — pixel style, 2px gap, no border-radius */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
                  gap: "2px",
                }}
                role="list"
                aria-label="班級掌握度熱力圖"
              >
                {stats.map((row) => (
                  <div
                    key={row.concept_id}
                    role="listitem"
                    style={{
                      height: 36,
                      background: errorRateFill(row.error_rate),
                      borderTop: `3px solid ${errorRateColor(row.error_rate)}`,
                      borderRadius: 0,
                      cursor: "pointer",
                      transition: "opacity 0.12s ease",
                    }}
                    onMouseEnter={() => setHoveredId(row.concept_id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title={`${row.concept_name} — 錯誤率 ${(row.error_rate * 100).toFixed(0)}%`}
                  />
                ))}
              </div>

              {/* Legend */}
              <div className="mt-3 flex items-center gap-4 text-[11px] text-[color:var(--text-muted)]">
                {[
                  { color: "var(--high)",   label: "< 25% 錯誤率（優）" },
                  { color: "var(--medium)", label: "25–50%（待加強）" },
                  { color: "var(--low)",    label: "> 50%（需補強）" },
                ].map(({ color, label }) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span style={{ display: "inline-block", width: 10, height: 10, background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
