import { useCallback, useMemo, useState } from "react";
import { Network } from "lucide-react";
import { parseDotGraph } from "../utils/graphUtils";
import { GraphCanvas } from "./GraphCanvas";

interface Props {
  dotSource: string;
  isLoading: boolean;
}

export function KnowledgeGraphPanel({ dotSource, isLoading }: Props) {
  const [copied, setCopied] = useState(false);
  const [showRawDot, setShowRawDot] = useState(false);
  const graph = useMemo(() => parseDotGraph(dotSource), [dotSource]);

  const handleCopy = useCallback(async () => {
    if (!dotSource) return;
    try {
      await navigator.clipboard.writeText(dotSource);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [dotSource]);

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">Knowledge Graph</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawDot((prev) => !prev)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300"
          >
            {showRawDot ? "隱藏 DOT" : "顯示 DOT"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!dotSource}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-50"
          >
            {copied ? "已複製" : "複製 DOT"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <span>節點 {graph.nodes.length}</span>
        <span>關係 {graph.edges.length}</span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-cyan-400" /> prerequisite
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-amber-400" /> progression
        </span>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">載入圖譜中...</p>
      ) : (
        <div className="space-y-3">
          <GraphCanvas graph={graph} />
          {showRawDot ? (
            <pre className="max-h-64 overflow-auto rounded-lg border border-slate-800/70 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-300">
              {dotSource || 'digraph ConceptGraph { empty [label="No concepts yet"]; }'}
            </pre>
          ) : null}
        </div>
      )}
    </article>
  );
}
