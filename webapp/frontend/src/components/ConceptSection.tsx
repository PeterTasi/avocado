import { useMemo } from "react";
import type { Concept } from "../hooks/useApi";

interface Props {
  concepts: Concept[];
  search: string;
}

export function ConceptSection({ concepts, search }: Props) {
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return concepts;
    return concepts.filter((item) =>
      `${item.name} ${item.chapter} ${item.description}`.toLowerCase().includes(keyword)
    );
  }, [concepts, search]);

  return (
    <div className="mt-4 max-h-52 space-y-2 overflow-auto rounded-xl border border-slate-800/70 bg-slate-950/50 p-3">
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400">目前沒有可顯示的概念。</p>
      ) : (
        filtered.map((item) => (
          <article key={item.id} className="rounded-lg border border-slate-800/70 bg-slate-900/40 p-3">
            <p className="text-sm font-medium text-slate-100">{item.name}</p>
            <p className="text-xs text-indigo-400">{item.chapter}</p>
            <p className="mt-1 text-xs text-slate-400">{item.description}</p>
          </article>
        ))
      )}
    </div>
  );
}
