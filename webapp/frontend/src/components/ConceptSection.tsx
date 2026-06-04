import { useMemo } from "react";
import type { Concept } from "../hooks/useApi";

interface Props {
  concepts: Concept[];
  search: string;
  sessionUploaded: boolean;
  isError: boolean;
}

export function ConceptSection({ concepts, search, sessionUploaded, isError }: Props) {
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return concepts;
    return concepts.filter((item) =>
      `${item.name} ${item.chapter} ${item.description}`.toLowerCase().includes(keyword)
    );
  }, [concepts, search]);

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">已抽取概念</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
            {search.trim() ? `依「${search.trim()}」篩選結果` : "從教材自動整理的概念與章節摘要"}
          </p>
        </div>
        <span className="pill text-[11px]">共 {filtered.length} 筆</span>
      </div>

      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {isError ? (
          <p className="rounded-xl border border-[color:var(--low)] bg-[color:var(--low-soft)] px-4 py-3 text-xs text-[color:var(--low)]">
            ⚠ 無法讀取概念資料，請確認後端連線後重試（避免顯示過期或錯誤的內容）。
          </p>
        ) : !sessionUploaded ? (
          <p className="text-xs text-[color:var(--text-muted)]">尚未上傳教材。匯入講義後，這裡會顯示自動抽取的概念。</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">目前沒有可顯示的概念。</p>
        ) : (
          filtered.map((item) => (
            <article key={item.id} className="card-subtle rounded-xl p-3">
              <p className="text-sm font-medium text-[color:var(--text-primary)]">{item.name}</p>
              <p className="text-xs text-[color:var(--accent)]">{item.chapter}</p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">{item.description}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
