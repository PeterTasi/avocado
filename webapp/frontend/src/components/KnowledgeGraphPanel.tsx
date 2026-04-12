import { useCallback, useMemo, useState } from "react";
import { Network } from "lucide-react";
import { parseDotGraph } from "../utils/graphUtils";
import { ForceGraphCanvas, MasteryLegend } from "./ForceGraphCanvas";
import type { ConceptMastery } from "../hooks/useApi";

interface Props {
  dotSource: string;
  isLoading: boolean;
  masteryItems?: ConceptMastery[];
}

export function KnowledgeGraphPanel({ dotSource, isLoading, masteryItems = [] }: Props) {
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
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-cyan-100" />
          <div>
            <p className="section-eyebrow">關聯視圖</p>
            <h2 className="mt-1 text-lg font-semibold text-white">知識圖譜</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawDot((prev) => !prev)}
            className="glass-button rounded-full px-3 py-1.5 text-xs"
          >
            {showRawDot ? "隱藏 DOT" : "顯示 DOT"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!dotSource}
            className="glass-button rounded-full px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {copied ? "已複製" : "複製 DOT"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-white/62">
        <span>節點 {graph.nodes.length}</span>
        <span>關係 {graph.edges.length}</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-cyan-300" /> 先修關係</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-300" /> 進展順序</span>
        <span className="inline-flex items-center gap-1 border-l border-white/12 pl-3"><i className="h-2 w-2 rounded-full bg-pink-300" /> 跨課等價</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-300" /> 跨課泛化</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-lime-300" /> 跨課類比</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-white/62">載入圖譜中...</p>
      ) : (
        <div className="space-y-3">
          <ForceGraphCanvas graph={graph} masteryItems={masteryItems} />
          <MasteryLegend />
          {showRawDot ? (
            <pre className="max-h-64 overflow-auto rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-3 text-[11px] leading-relaxed text-white/78">
              {dotSource || 'digraph ConceptGraph { empty [label="尚無概念"]; }'}
            </pre>
          ) : null}
        </div>
      )}
    </article>
  );
}
