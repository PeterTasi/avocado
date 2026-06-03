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

  const ingestData = ingestMaterial.data as
    | { llm_degraded?: boolean; ocr_failed?: boolean; ocr_message?: string; llm_last_error?: string }
    | undefined;
  const llmDegraded = ingestMaterial.isSuccess && ingestData?.llm_degraded === true;
  const ocrFailed = ingestMaterial.isSuccess && ingestData?.ocr_failed === true;

  const status = ingestMaterial.isPending
    ? "正在解析教材並建立知識圖譜..."
    : ocrFailed
    ? "已建立，但未能轉寫你的教材內容（見下方警告）。"
    : ingestMaterial.isSuccess
    ? "建立完成。"
    : ingestMaterial.error instanceof Error
    ? ingestMaterial.error.message
    : "";

  const templateLabel =
    templateMode === "generic" ? "通用抽取" : templateMode === "auto" ? "自動偵測" : "線性代數";

  return (
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="section-eyebrow">教材設定</p>
          <h2 className="mt-2 text-xl font-semibold text-white">匯入教材與課程配置</h2>
          <p className="mt-2 text-sm leading-6 text-white/72">
            上傳 PDF、TXT 或圖片後，系統會重建概念、知識圖譜與後續複習節奏。手寫/掃描筆記會優先使用 Gemini 視覺轉寫。新教材會覆寫目前的課程狀態。
          </p>
        </div>

        <div className="glass-subpanel rounded-[22px] px-4 py-3 text-right md:min-w-48">
          <p className="text-xs uppercase tracking-[0.18em] text-white/55">目前配置</p>
          <p className="mt-2 text-base font-semibold text-white">{templateLabel}</p>
          <p className="mt-1 text-xs text-white/65">已抽取概念 {concepts.length} 筆</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-white/72">Gemini API 金鑰</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="選填金鑰"
            className="glass-input h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-white/72">課程名稱</span>
          <input
            type="text"
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
            className="glass-input h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-white/72">課程模板</span>
          <select
            value={templateMode}
            onChange={(event) => setTemplateMode(event.target.value)}
            className="glass-input h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
          >
            <option value="generic">通用模式（依講義抽取）</option>
            <option value="linear-algebra">線性代數模板</option>
            <option value="auto">自動偵測模板</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-white/72">教材檔案（PDF / TXT / 圖片）</span>
          <input
            type="file"
            accept=".pdf,.txt,image/*,.tif,.tiff"
            onChange={(event) => setMaterialFile(event.target.files?.[0] ?? null)}
            className="block w-full text-xs text-white/68 file:mr-3 file:rounded-xl file:border-0 file:bg-white/18 file:px-4 file:py-2.5 file:text-white"
          />
        </label>
      </div>

      <div className="mt-4 rounded-[24px] border border-white/12 bg-[rgba(8,15,32,0.12)] px-4 py-3 text-sm text-white/72">
        <p className="font-medium text-white">目前教材</p>
        <p className="mt-1 truncate text-xs text-white/62">
          {materialFile?.name ?? "尚未選擇檔案，可先匯入講義再產生圖譜與測驗。"}
        </p>
        <p className="mt-2 text-xs text-white/55">
          手寫圖片與掃描 PDF 需要可用的 Gemini API 金鑰，否則請先做 OCR。
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSaveApiKey}
          disabled={saveApiKey.isPending}
          className="glass-button rounded-full px-5 py-2.5 text-sm transition disabled:opacity-60"
        >
          {saveApiKey.isPending ? "儲存中..." : "儲存金鑰"}
        </button>
        <button
          type="button"
          onClick={handleIngest}
          disabled={ingestMaterial.isPending || !materialFile}
          className="glass-button-primary rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
        >
          {ingestMaterial.isPending ? "建立中..." : "建立知識圖譜"}
        </button>
        <span className="text-xs text-white/68">{status}</span>
      </div>

      {ocrFailed && (
        <div className="mt-3 rounded-[18px] border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold">⚠ 未能轉寫教材：</span>
          {ingestData?.ocr_message ??
            "未能轉寫手寫／掃描內容，目前顯示的是課程模板概念，並非你上傳教材的實際內容。"}
          {ingestData?.llm_last_error ? (
            <span className="mt-1 block text-xs text-red-300/70">原因：{ingestData.llm_last_error}</span>
          ) : null}
        </div>
      )}

      {llmDegraded && !ocrFailed && (
        <div className="mt-3 rounded-[18px] border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <span className="font-semibold">⚠ AI 降級警告：</span>
          Gemini API 呼叫失敗，概念圖譜已改用啟發式規則建立，品質可能較低。請確認 API 金鑰是否正確並重新匯入。
          {ingestData?.llm_last_error ? (
            <span className="mt-1 block text-xs text-amber-300/70">原因：{ingestData.llm_last_error}</span>
          ) : null}
        </div>
      )}

      <ConceptSection concepts={concepts} search={search} />
    </article>
  );
}
