import { useMemo, useState } from "react";
import type { Concept, ConceptMastery } from "../hooks/useApi";
import { ConceptDrawer } from "./ConceptDrawer";

type Lang = "zh" | "en" | "both";

interface Props {
  concepts: Concept[];
  search: string;
  sessionUploaded: boolean;
  isError: boolean;
  masteryItems?: ConceptMastery[];
}

const STATUS_COLOR: Record<string, string> = {
  high: "var(--high)", medium: "var(--medium)", low: "var(--low)", new: "var(--text-muted)",
};

export function ConceptSection({ concepts, search, sessionUploaded, isError, masteryItems = [] }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("zh");

  const statusByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of masteryItems) m.set(it.name.toLowerCase(), it.status);
    return m;
  }, [masteryItems]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return concepts;
    return concepts.filter((c) =>
      `${c.name} ${c.chapter} ${c.description}`.toLowerCase().includes(keyword));
  }, [concepts, search]);

  const openConcept = useMemo(
    () => filtered.find((c) => c.id === openId) ?? null, [filtered, openId]);
  const openStatus = openConcept ? (statusByName.get(openConcept.name.toLowerCase()) ?? "new") : "new";

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">已抽取概念</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">點概念卡查看深度詳解</p>
        </div>
        <div className="inline-flex rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-sunken)] p-0.5 text-[11px]">
          {(["zh", "en", "both"] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${lang === l ? "bg-white text-[color:var(--accent)] shadow-sm" : "text-[color:var(--text-secondary)]"}`}>
              {l === "zh" ? "中文" : l === "en" ? "EN" : "中英"}
            </button>
          ))}
        </div>
      </div>

      <div className={`concept-stage relative min-h-[440px] ${openId ? "open" : ""}`}>
        {isError ? (
          <p className="rounded-xl border border-[color:var(--low)] px-4 py-3 text-xs text-[color:var(--low)]" style={{ background: "var(--low-soft)" }}>
            ⚠ 無法讀取概念資料，請確認後端連線後重試。
          </p>
        ) : !sessionUploaded ? (
          <p className="text-xs text-[color:var(--text-muted)]">尚未上傳教材。匯入講義後，這裡會顯示自動抽取的概念。</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">目前沒有可顯示的概念。</p>
        ) : (
          <div className="concept-grid grid grid-cols-2 gap-2 md:grid-cols-3">
            {filtered.map((c) => {
              const status = statusByName.get(c.name.toLowerCase()) ?? "new";
              return (
                <button key={c.id} onClick={() => setOpenId(c.id)}
                  className="card-interactive relative overflow-hidden rounded-xl p-3 text-left">
                  <span className="absolute right-3 top-3 h-2 w-2 rounded-full"
                        style={{ background: STATUS_COLOR[status] }} />
                  <p className="pr-4 text-sm font-medium text-[color:var(--text-primary)]">{c.name}</p>
                  <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{c.chapter}</p>
                </button>
              );
            })}
          </div>
        )}

        <ConceptDrawer
          concept={openConcept}
          lang={lang}
          statusColor={STATUS_COLOR[openStatus]}
          onClose={() => setOpenId(null)}
        />
      </div>
    </div>
  );
}
