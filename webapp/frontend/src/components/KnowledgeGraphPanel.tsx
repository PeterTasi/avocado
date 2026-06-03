import { useCallback, useMemo, useState } from "react";
import { Network } from "lucide-react";
import { parseDotGraph } from "../utils/graphUtils";
import { MindMapCanvas, MindMapLegend } from "./MindMapCanvas";
import type { ConceptMastery } from "../hooks/useApi";

interface Props {
  dotSource: string;
  isLoading: boolean;
  masteryItems?: ConceptMastery[];
  courseName?: string;
}

export function KnowledgeGraphPanel({ dotSource, isLoading, masteryItems = [], courseName }: Props) {
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
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-cyan-100" />
          <div>
            <p className="section-eyebrow">觀念心智圖</p>
            <h2 className="mt-1 text-lg font-semibold text-white">知識圖譜</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/50">
          <span>節點 {graph.nodes.length}</span>
          <span>·</span>
          <span>邊 {graph.edges.length}</span>
          <button
            type="button"
            onClick={() => setShowRawDot(prev => !prev)}
            className="glass-button ml-2 rounded-full px-3 py-1.5"
          >
            {showRawDot ? "隱藏 DOT" : "DOT"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!dotSource}
            className="glass-button rounded-full px-3 py-1.5 disabled:opacity-50"
          >
            {copied ? "已複製" : "複製"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-sm text-white/50">
          載入圖譜中…
        </div>
      ) : (
        <div className="space-y-3">
          <MindMapCanvas graph={graph} masteryItems={masteryItems} courseName={courseName} />
          <MindMapLegend />
          {showRawDot && (
            <pre className="max-h-64 overflow-auto rounded-[22px] border border-white/12 bg-[rgba(8,15,32,0.16)] p-3 text-[11px] leading-relaxed text-white/78">
              {dotSource || 'digraph ConceptGraph { empty [label="尚無概念"]; }'}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}
