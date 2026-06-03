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
    <div className="mt-5 rounded-[26px] border border-white/12 bg-[rgba(8,15,32,0.12)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">已抽取概念</p>
          <p className="mt-1 text-xs text-white/62">
            {search.trim() ? `依「${search.trim()}」篩選結果` : "從教材自動整理的概念與章節摘要"}
          </p>
        </div>
        <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1 text-xs text-white/72">
          共 {filtered.length} 筆
        </span>
      </div>

      <div className="max-h-64 space-y-2 overflow-auto pr-1">
      {isError ? (
        <p className="rounded-[18px] border border-red-400/40 bg-red-500/12 px-4 py-3 text-xs text-red-300">
          ⚠ 無法讀取概念資料，請確認後端連線後重試（避免顯示過期或錯誤的內容）。
        </p>
      ) : !sessionUploaded ? (
        <p className="text-xs text-white/62">尚未上傳教材。匯入講義後，這裡會顯示自動抽取的概念。</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-white/62">目前沒有可顯示的概念。</p>
      ) : (
        filtered.map((item) => (
          <article key={item.id} className="rounded-[20px] border border-white/10 bg-white/8 p-3">
            <p className="text-sm font-medium text-white">{item.name}</p>
            <p className="text-xs text-cyan-100/80">{item.chapter}</p>
            <p className="mt-1 text-xs leading-5 text-white/62">{item.description}</p>
          </article>
        ))
      )}
      </div>
    </div>
  );
}
