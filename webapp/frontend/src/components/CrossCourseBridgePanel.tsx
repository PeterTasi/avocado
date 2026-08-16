import { Waypoints } from "lucide-react";
import { useCourses, useCrossCourseLinks } from "../hooks/useApi";
import type { CrossCourseLink } from "../hooks/useApi";

/** 關係分級的中文與色彩。
 *
 * 門檻定義在 cross_course_linker._infer_link_type，依 gemini-embedding-001 校準：
 * equivalent ≥0.84、generalization ≥0.76、analogy ≥0.71、semantic ≥0.68。
 *
 * `analogy` 必須譯成「類比」而非「相似」——跨領域學習最有價值的正是這一級
 * （線代的特徵向量 ↔ ML 的主成分分析就落在這裡）。譯成「相似」會把它講小。
 */
const LINK_META: Record<string, { label: string; hint: string; color: string; soft: string }> = {
  equivalent:     { label: "等價概念", hint: "兩門課在講同一件事", color: "var(--high)",   soft: "var(--high-soft)" },
  generalization: { label: "一般化",   hint: "一個是另一個的特例", color: "var(--accent)", soft: "var(--accent-soft)" },
  analogy:        { label: "類比",     hint: "結構相同、領域不同", color: "var(--medium)", soft: "var(--medium-soft)" },
  semantic:       { label: "語義相關", hint: "主題上有關聯",       color: "var(--text-muted)", soft: "var(--bg-sunken)" },
};

function meta(linkType: string) {
  return LINK_META[linkType] ?? LINK_META.semantic;
}

function LinkRow({ link }: { link: CrossCourseLink }) {
  const m = meta(link.link_type);
  return (
    <li className="card-subtle flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
            {link.from_concept_name}
          </p>
          <p className="truncate text-xs text-[color:var(--text-muted)]">{link.from_course_name}</p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1 px-1">
          <span
            className="pill whitespace-nowrap text-[11px] font-medium"
            style={{ background: m.soft, color: m.color }}
            title={m.hint}
          >
            {m.label}
          </span>
          <span aria-hidden="true" className="text-[color:var(--border-hover)]">↔</span>
        </div>

        <div className="min-w-0 flex-1 text-right md:text-left">
          <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
            {link.to_concept_name}
          </p>
          <p className="truncate text-xs text-[color:var(--text-muted)]">{link.to_course_name}</p>
        </div>
      </div>

      <div className="shrink-0 text-right md:w-20">
        <p className="stat-value text-sm" style={{ color: m.color }}>
          {(link.similarity * 100).toFixed(0)}%
        </p>
        <p className="text-[10px] text-[color:var(--text-muted)]">相似度</p>
      </div>
    </li>
  );
}

export function CrossCourseBridgePanel() {
  const { data, isLoading, isError } = useCrossCourseLinks();
  const { data: coursesData } = useCourses();

  const links = data?.items ?? [];
  const courseCount = new Set((coursesData?.items ?? []).map((c) => c.subject)).size;

  return (
    <section className="card p-6">
      <div className="mb-5 flex items-center gap-3">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: "var(--accent-soft)" }}
        >
          <Waypoints size={16} style={{ color: "var(--accent)" }} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="section-eyebrow">跨課程關聯</p>
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            這個主題與你其他課程的連結
          </h2>
        </div>
        {links.length > 0 && (
          <span className="ml-auto shrink-0 text-xs text-[color:var(--text-muted)]">
            {links.length} 條
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-[color:var(--text-muted)]">尋找關聯中...</p>
      ) : isError ? (
        <p className="text-sm text-[color:var(--low)]">跨課程關聯讀取失敗，請稍後再試。</p>
      ) : links.length === 0 ? (
        <div className="card-subtle px-4 py-6 text-center">
          <p className="text-sm text-[color:var(--text-secondary)]">
            {courseCount < 2
              ? "目前只有一門課程。"
              : "目前這門課還沒有找到與其他課程的關聯。"}
          </p>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            {courseCount < 2
              ? "上傳第二份教材或輸入第二個主題後，系統會自動尋找關聯。"
              : "換一門課程，或加入主題更相近的教材再試一次。"}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {links.map((link) => (
              <LinkRow key={`${link.from_concept_id}-${link.to_concept_id}`} link={link} />
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-[color:var(--text-muted)]">
            由概念向量的語義相似度自動比對而來，只列出與目前課程相關的連結。
            相似度為概念嵌入的餘弦相似度，非人工標註。
          </p>
        </>
      )}
    </section>
  );
}
