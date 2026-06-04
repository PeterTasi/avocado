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
    <article className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 place-items-center rounded-lg"
            style={{ background: "var(--accent-soft)" }}
          >
            <Network size={15} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="section-eyebrow">觀念心智圖</p>
            <h2 className="mt-0.5 text-base font-semibold text-[color:var(--text-primary)]">知識圖譜</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
          <span>{graph.nodes.length} 節點</span>
          <span>·</span>
          <span>{graph.edges.length} 邊</span>
          <button
            type="button"
            onClick={() => setShowRawDot(prev => !prev)}
            className="btn-secondary ml-2 px-3 py-1.5 text-xs"
          >
            {showRawDot ? "隱藏 DOT" : "DOT"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!dotSource}
            className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {copied ? "已複製" : "複製"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-sm text-[color:var(--text-muted)]">
          載入圖譜中…
        </div>
      ) : (
        <div className="space-y-3">
          <MindMapCanvas graph={graph} masteryItems={masteryItems} courseName={courseName} />
          <MindMapLegend />
          {showRawDot && (
            <pre className="card-subtle max-h-64 overflow-auto rounded-xl p-3 text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
              {dotSource || 'digraph ConceptGraph { empty [label="尚無概念"]; }'}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}
