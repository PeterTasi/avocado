import { useCallback } from "react";
import { useIngestMaterial, useSaveApiKey } from "../hooks/useApi";
import type { Concept } from "../hooks/useApi";
import { ConceptSection } from "./ConceptSection";

interface Props {
  apiKey: string;
  setApiKey: (v: string) => void;
  courseName: string;
  setCourseName: (v: string) => void;
  templateMode: string;
  setTemplateMode: (v: string) => void;
  materialFile: File | null;
  setMaterialFile: (f: File | null) => void;
  concepts: Concept[];
  search: string;
  setSearch: (s: string) => void;
}

export function SetupPanel({
  apiKey,
  setApiKey,
  courseName,
  setCourseName,
  templateMode,
  setTemplateMode,
  materialFile,
  setMaterialFile,
  concepts,
  search,
}: Props) {
  const saveApiKey = useSaveApiKey();
  const ingestMaterial = useIngestMaterial();

  const handleSaveApiKey = useCallback(async () => {
    await saveApiKey.mutateAsync(apiKey.trim());
  }, [apiKey, saveApiKey]);

  const handleIngest = useCallback(async () => {
    if (!materialFile) return;
    const formData = new FormData();
    formData.append("file", materialFile);
    formData.append("course_name", courseName.trim() || "通用課程");
    formData.append("template_mode", templateMode);
    if (apiKey.trim()) {
      formData.append("api_key", apiKey.trim());
    }
    await ingestMaterial.mutateAsync(formData);
  }, [materialFile, courseName, templateMode, apiKey, ingestMaterial]);

  const status = ingestMaterial.isPending
    ? "正在解析教材並建立知識圖譜..."
    : ingestMaterial.isSuccess
    ? "建立完成。"
    : ingestMaterial.error instanceof Error
    ? ingestMaterial.error.message
    : "";

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <h2 className="text-base font-semibold text-slate-100">設定與教材</h2>
      <p className="mt-1 text-xs text-slate-400">上傳教材後會重建概念圖譜，並清空舊教材的狀態。</p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-400">Gemini API 金鑰</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="選填金鑰"
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">課程名稱</span>
          <input
            type="text"
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">課程模板</span>
          <select
            value={templateMode}
            onChange={(event) => setTemplateMode(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
          >
            <option value="generic">通用模式（依講義抽取）</option>
            <option value="linear-algebra">線性代數模板</option>
            <option value="auto">自動偵測模板</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-400">教材檔案（PDF/TXT）</span>
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(event) => setMaterialFile(event.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSaveApiKey}
          disabled={saveApiKey.isPending}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-indigo-500/40 disabled:opacity-60"
        >
          {saveApiKey.isPending ? "儲存中..." : "儲存金鑰"}
        </button>
        <button
          type="button"
          onClick={handleIngest}
          disabled={ingestMaterial.isPending || !materialFile}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_15px_rgba(99,102,241,0.2)] transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {ingestMaterial.isPending ? "建立中..." : "建立知識圖譜"}
        </button>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      <ConceptSection concepts={concepts} search={search} />
    </article>
  );
}
