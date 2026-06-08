import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useCourses, useDeleteCourse, useIngestMaterial, useSaveApiKey } from "../hooks/useApi";
import type { Concept, Course } from "../hooks/useApi";
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
  sessionUploaded: boolean;
  onIngested: () => void;
  conceptsError: boolean;
}

function PixelUploadIllustration() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Document */}
      <rect x="10" y="6"  width="28" height="36" fill="var(--bg-sunken)" />
      <rect x="30" y="6"  width="8"  height="8"  fill="var(--bg-app)" />
      <rect x="30" y="6"  width="8"  height="8"  fill="var(--border-strong)" opacity="0.4" />
      <rect x="14" y="16" width="14" height="2"   fill="var(--border-strong)" />
      <rect x="14" y="20" width="20" height="2"   fill="var(--border-strong)" />
      <rect x="14" y="24" width="16" height="2"   fill="var(--border-strong)" />
      {/* Upload arrow — pixel staircase */}
      <rect x="26" y="32" width="4" height="10"  fill="var(--accent)" />
      <rect x="22" y="32" width="4" height="4"   fill="var(--accent)" />
      <rect x="30" y="32" width="4" height="4"   fill="var(--accent)" />
      <rect x="18" y="28" width="4" height="4"   fill="var(--accent)" />
      <rect x="34" y="28" width="4" height="4"   fill="var(--accent)" />
      <rect x="26" y="24" width="4" height="4"   fill="var(--accent)" />
      {/* Cloud base line */}
      <rect x="18" y="46" width="20" height="4"  fill="var(--accent-soft)" />
    </svg>
  );
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
  sessionUploaded,
  onIngested,
  conceptsError,
}: Props) {
  const saveApiKey = useSaveApiKey();
  const ingestMaterial = useIngestMaterial();
  const { data: coursesData } = useCourses();
  const deleteCourse = useDeleteCourse();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const courses = coursesData?.items ?? [];

  const handleDeleteCourse = useCallback(async () => {
    if (!courseToDelete) return;
    await deleteCourse.mutateAsync(courseToDelete.id);
    setCourseToDelete(null);
  }, [courseToDelete, deleteCourse]);

  useEffect(() => {
    if (!ingestMaterial.isPending) { setElapsedSec(0); return; }
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [ingestMaterial.isPending]);

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
    onIngested();
  }, [materialFile, courseName, templateMode, apiKey, ingestMaterial, onIngested]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setMaterialFile(file);
  }, [setMaterialFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

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

  const step1Done = elapsedSec > 5;
  const step2Done = elapsedSec > 15;

  return (
    <>
    {/* Delete-course confirmation modal (Bug 5 方案 C) */}
    {courseToDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
        <div className="card mx-4 max-w-sm p-6 shadow-xl">
          <p className="text-base font-semibold text-[color:var(--text-primary)]">清除「{courseToDelete.subject}」的所有資料？</p>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            將永久刪除此課程的概念、題目、作答紀錄、複習計畫與知識圖譜向量索引，且無法復原。
          </p>
          {deleteCourse.isError && (
            <p className="mt-2 text-xs text-[color:var(--low)]">
              {deleteCourse.error instanceof Error ? deleteCourse.error.message : "刪除失敗，請稍後再試。"}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setCourseToDelete(null)}
              disabled={deleteCourse.isPending}
              className="btn-ghost px-4 py-2 text-sm disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDeleteCourse}
              disabled={deleteCourse.isPending}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              style={{ background: "var(--low)" }}
            >
              {deleteCourse.isPending ? "刪除中..." : "永久刪除"}
            </button>
          </div>
        </div>
      </div>
    )}
    <article className="card p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="section-eyebrow">教材設定</p>
          <h2 className="mt-2 text-xl font-semibold text-[color:var(--text-primary)]">匯入教材與課程配置</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
            上傳 PDF、TXT 或圖片後，系統會重建概念、知識圖譜與後續複習節奏。
            手寫筆記優先本地 OCR 辨識，無需額外 API。新教材會覆寫目前的課程狀態。
          </p>
        </div>
        <div className="card-subtle shrink-0 px-4 py-3 text-right md:min-w-[180px]">
          <p className="section-eyebrow">目前配置</p>
          <p className="mt-2 text-base font-semibold text-[color:var(--text-primary)]">
            {templateMode === "generic" ? "通用抽取" : templateMode === "auto" ? "自動偵測" : "線性代數"}
          </p>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">
            {conceptsError ? "概念讀取失敗" : `已抽取概念 ${concepts.length} 筆`}
          </p>
        </div>
      </div>

      {/* Upload zone */}
      <div
        className={`upload-zone mt-6 flex cursor-pointer flex-col items-center justify-center px-6 py-10 text-center${isDragging ? " drag-over" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
      >
        {ingestMaterial.isPending && (
          <div className="scan-line" />
        )}

        {materialFile ? (
          <>
            <div
              className="mb-3 grid h-12 w-12 place-items-center rounded-xl"
              style={{ background: "var(--accent-soft)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="2"  width="12" height="16" rx="1" fill="var(--accent)" opacity="0.15" />
                <rect x="4" y="2"  width="12" height="16" rx="1" stroke="var(--accent)" strokeWidth="1.5" />
                <rect x="13" y="2" width="3"  height="3"  rx="0" fill="var(--accent-soft)" />
                <path d="M7 8h6M7 11h4" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">{materialFile.name}</p>
            <p className="mt-1 text-xs text-[color:var(--accent)]">點擊更換檔案</p>
          </>
        ) : (
          <>
            <PixelUploadIllustration />
            <p className="mt-4 text-sm font-semibold text-[color:var(--text-primary)]">拖曳檔案至此，或點擊選擇</p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">PDF・TXT・PNG / JPG / TIFF・手寫圖片</p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,image/*,.tif,.tiff"
          onChange={(e) => setMaterialFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
      </div>

      {/* Config fields */}
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-[color:var(--text-secondary)]">課程名稱</span>
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            className="input h-10 w-full px-3 text-sm"
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-[color:var(--text-secondary)]">課程模板</span>
          <select
            value={templateMode}
            onChange={(e) => setTemplateMode(e.target.value)}
            className="input h-10 w-full px-3 text-sm"
          >
            <option value="generic">通用模式（依講義抽取）</option>
            <option value="linear-algebra">線性代數模板</option>
            <option value="auto">自動偵測模板</option>
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-[color:var(--text-secondary)]">Gemini API 金鑰（選填）</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="選填，無金鑰仍可使用本地 OCR"
            className="input h-10 w-full px-3 text-sm"
          />
        </label>
      </div>

      {/* Actions row */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleIngest}
          disabled={ingestMaterial.isPending || !materialFile}
          className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {ingestMaterial.isPending && <Loader2 size={14} className="animate-spin" />}
          {ingestMaterial.isPending ? "建立中..." : "建立知識圖譜"}
        </button>
        <button
          type="button"
          onClick={handleSaveApiKey}
          disabled={saveApiKey.isPending}
          className="btn-secondary px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {saveApiKey.isPending ? "儲存中..." : "儲存金鑰"}
        </button>
        {status && (
          <span className={`text-xs ${ocrFailed || ingestMaterial.error ? "text-[color:var(--low)]" : "text-[color:var(--text-muted)]"}`}>
            {status}
          </span>
        )}
      </div>

      {/* Ingesting progress steps */}
      {ingestMaterial.isPending && (
        <div className="mt-4 card-subtle flex flex-col gap-2.5 px-4 py-3">
          <div className={`progress-step ${step1Done ? "done" : "active"}`}>
            <span className="progress-step-dot" />
            解析文件與頁面
            {step1Done && <span className="ml-auto text-[10px] text-[color:var(--high)]">✓</span>}
          </div>
          <div className={`progress-step ${step2Done ? "done" : step1Done ? "active" : ""}`}>
            <span className="progress-step-dot" />
            抽取概念與章節
            {step2Done && <span className="ml-auto text-[10px] text-[color:var(--high)]">✓</span>}
          </div>
          <div className={`progress-step ${step2Done ? "active" : ""}`}>
            <span className="progress-step-dot" />
            建立圖譜與向量索引
          </div>
          <p className="text-right text-[11px] tabular-nums text-[color:var(--text-muted)]">
            已等待 {elapsedSec} 秒，掃描 PDF 通常需要 1–2 分鐘
          </p>
        </div>
      )}

      {/* OCR failed warning */}
      {ocrFailed && (
        <div className="mt-4 rounded-xl border border-[color:var(--low)] bg-[color:var(--low-soft)] px-4 py-3 text-sm text-[color:var(--low)]">
          <span className="font-semibold">⚠ 未能轉寫教材：</span>
          {ingestData?.ocr_message ?? "未能轉寫手寫／掃描內容，目前顯示的是課程模板概念，並非你上傳教材的實際內容。"}
          {ingestData?.llm_last_error && (
            <span className="mt-1 block text-xs opacity-75">原因：{ingestData.llm_last_error}</span>
          )}
        </div>
      )}

      {/* LLM degraded warning */}
      {llmDegraded && !ocrFailed && (
        <div className="mt-4 rounded-xl border border-[color:var(--medium)] bg-[color:var(--medium-soft)] px-4 py-3 text-sm text-[color:var(--medium)]">
          <span className="font-semibold">⚠ AI 降級警告：</span>
          Gemini API 呼叫失敗，概念圖譜已改用啟發式規則建立，品質可能較低。請確認 API 金鑰是否正確並重新匯入。
          {ingestData?.llm_last_error && (
            <span className="mt-1 block text-xs opacity-75">原因：{ingestData.llm_last_error}</span>
          )}
        </div>
      )}

      <ConceptSection
        concepts={concepts}
        search={search}
        sessionUploaded={sessionUploaded}
        isError={conceptsError}
      />

      {/* Course management — Bug 5 方案 C: 清除課程資料 */}
      {courses.length > 0 && (
        <div className="mt-6">
          <p className="section-eyebrow">已上傳課程</p>
          <ul className="mt-3 flex flex-col gap-2">
            {courses.map((course) => (
              <li
                key={course.id}
                className="card-subtle flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">{course.subject}</p>
                  <p className="truncate text-xs text-[color:var(--text-muted)]">
                    {course.filename} · {new Date(course.uploaded_at).toLocaleString("zh-TW")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCourseToDelete(course)}
                  title="清除此課程的所有資料"
                  aria-label={`清除課程「${course.subject}」`}
                  className="btn-ghost shrink-0 grid h-8 w-8 place-items-center p-0 text-[color:var(--text-muted)] hover:text-[color:var(--low)]"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
    </>
  );
}
