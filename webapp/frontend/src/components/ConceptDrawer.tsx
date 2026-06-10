import { useEffect } from "react";
import type { Concept, ConceptDetail } from "../hooks/useApi";
import { useConceptDetail } from "../hooks/useApi";
import { PixelAvocadoLogo } from "./PixelAvocadoLogo";
import { MathRenderer } from "./MathRenderer";

type Lang = "zh" | "en" | "both";

interface Props {
  concept: Concept | null;
  lang: Lang;
  statusColor: string; // 該概念掌握度狀態色（綠/琥珀/紅）
  onClose: () => void;
}

const LABELS = {
  zh: { def: "核心定義", points: "關鍵重點", example: "範例", mistakes: "常見誤區" },
  en: { def: "Definition", points: "Key Points", example: "Example", mistakes: "Common Mistakes" },
};

// module-scope pure renderer（不用元件 state）
function renderDetail(d: ConceptDetail | undefined, l: "zh" | "en") {
  if (!d) return null;
  const t = LABELS[l];
  const text = (s: string) => (d.has_formula ? <MathRenderer text={s} /> : <>{s}</>);
  return (
    <>
      <div className="concept-block">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.def}</p>
        <p className="text-sm leading-6 text-[color:var(--text-secondary)]">{text(d.definition)}</p>
      </div>
      {d.key_points.length > 0 && (
        <div className="concept-block">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.points}</p>
          <ul className="list-disc pl-5 text-sm leading-7 text-[color:var(--text-secondary)]">
            {d.key_points.map((p, i) => <li key={`${l}:${i}:${p}`}>{text(p)}</li>)}
          </ul>
        </div>
      )}
      {d.example && (
        <div className="concept-block">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.example}</p>
          <p className="text-sm leading-6 text-[color:var(--text-secondary)]">{text(d.example)}</p>
        </div>
      )}
      {d.common_mistakes && (
        <div className="concept-block rounded-lg border border-[color:var(--low)] px-3 py-2" style={{ background: "var(--low-soft)" }}>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--low)]">{t.mistakes}</p>
          <p className="text-sm leading-6 text-[color:var(--low)]">{text(d.common_mistakes)}</p>
        </div>
      )}
    </>
  );
}

export function ConceptDrawer({ concept, lang, statusColor, onClose }: Props) {
  // Esc 關閉
  useEffect(() => {
    if (!concept) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [concept, onClose]);

  // 中英對照分別抓 zh / en（後端各自快取）
  const wantZh = lang === "zh" || lang === "both";
  const wantEn = lang === "en" || lang === "both";
  const zh = useConceptDetail(wantZh && concept ? concept.id : null, "zh");
  const en = useConceptDetail(wantEn && concept ? concept.id : null, "en");

  const loading = (wantZh && zh.isLoading) || (wantEn && en.isLoading);
  const busy = (wantZh && zh.isFetching) || (wantEn && en.isFetching);
  const degraded = (wantEn && en.data?.degraded) || (wantZh && zh.data?.degraded);
  const retry = () => {
    if (wantEn) en.refetch();
    if (wantZh) zh.refetch();
  };

  return (
    <>
      {/* 純裝飾遮罩：鍵盤關閉走 Esc（見標頭提示），點擊只是冗餘捷徑 */}
      <div className="concept-scrim" onClick={onClose} role="presentation" aria-hidden="true" />
      <aside className="concept-drawer" aria-hidden={!concept}>
        <div className="relative border-b border-[color:var(--border)] px-4 py-4"
             style={{ background: `linear-gradient(120deg, ${statusColor}22, transparent 70%)` }}>
          <button type="button" onClick={onClose}
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--bg-sunken)] text-[color:var(--text-secondary)]">✕</button>
          <div className="flex items-center gap-2">
            <span className="concept-drawer-avo inline-flex"><PixelAvocadoLogo size={30} /></span>
            <span className="font-display text-base font-bold">{concept?.name}</span>
          </div>
          <p className="mt-1 text-xs text-[color:var(--accent)]">{concept?.chapter}</p>
          <p className="absolute right-3 top-9 text-[10px] text-[color:var(--text-muted)]">Esc 關閉</p>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent" />
              AI 生成中…（首次約數秒）
            </p>
          )}
          {!loading && degraded && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--medium)] px-3 py-2 text-xs text-[color:var(--medium)]"
                 style={{ background: "var(--medium-soft, #fdf3e0)" }}>
              <span>⚠ AI 生成失敗（可能 Gemini 額度用盡），暫顯示原文。</span>
              <button type="button" onClick={retry} disabled={busy}
                className="shrink-0 rounded-md border border-[color:var(--medium)] px-2 py-0.5 font-semibold disabled:opacity-50">
                {busy ? "重試中…" : "重試"}
              </button>
            </div>
          )}
          {!loading && busy && !degraded && (
            <p className="text-[11px] text-[color:var(--text-muted)]">更新中…</p>
          )}
          {!loading && wantEn && renderDetail(en.data, "en")}
          {!loading && wantEn && wantZh && <hr className="border-[color:var(--border)]" />}
          {!loading && wantZh && renderDetail(zh.data, "zh")}
        </div>
      </aside>
    </>
  );
}
