import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// For GitHub Pages deployments, set VITE_API_BASE_URL to the Render backend URL.
// Leave empty (default) when frontend and backend are served from the same origin.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function apiFetch(path: string, options?: RequestInit): Promise<unknown> {
  const apiKey = localStorage.getItem("adaptlearn_api_key") ?? "";
  const headers = new Headers(options?.headers);
  if (apiKey) headers.set("X-API-Key", apiKey);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(errorMessage(response.status, payload));
  }
  return payload;
}

// Build a clean, user-facing error message. JSON `detail` is trusted; any non-JSON
// body (e.g. a proxy's 502 HTML page) is ignored in favour of a status-based message
// so raw HTML never leaks into the UI.
function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = String((payload as { detail: unknown }).detail).trim();
    if (detail) return detail;
  }
  switch (status) {
    case 502:
    case 503:
    case 504:
      return `伺服器忙線或處理逾時（${status}）。教材可能過大或辨識太久，請稍後再試。`;
    case 413:
      return "上傳檔案過大，請改用較小的檔案。";
    case 429:
      return "請求過於頻繁，請稍候再試。";
    default:
      return status >= 500
        ? `伺服器發生錯誤（${status}），請稍後再試。`
        : `請求失敗（${status}），請稍後再試。`;
  }
}

export interface HealthResponse {
  status: string;
  llm_enabled: boolean;
  metrics: {
    concept_count: number;
    attempt_count: number;
    accuracy: number;
  };
}

export interface Concept {
  id: string;
  name: string;
  chapter: string;
  description: string;
  prerequisites: string[];
}

export interface ConceptDetail {
  concept_id: string;
  language: string;
  definition: string;
  key_points: string[];
  example: string;
  common_mistakes: string;
  has_formula: boolean;
  degraded?: boolean;
}

export interface Question {
  id: string;
  concept_id: string;
  concept_name: string;
  difficulty: string;
  question_text: string;
  answer_text: string;
  rationale: string;
}

export interface ReviewItem {
  concept_id: string;
  concept_name: string;
  priority: number;
  next_review_at: string;
  suggested_slot: string;
  reason: string;
  retention: number;
  stability: number;
}

export interface ConceptMastery {
  concept_id: string;
  name: string;
  chapter: string;
  mastery: number;
  attempts: number;
  status: string;
}

export interface ChapterMastery {
  chapter: string;
  avg_mastery: number;
  concept_count: number;
  attempted_concepts: number;
  status: string;
}

export interface TonightDashboard {
  before: number;
  uplift: number;
  after: number;
  chapters: string[];
  has_data?: boolean;
  focus_items: Array<{
    concept: string;
    chapter: string;
    slot: string;
    priority: number;
    estimated_gain: number;
  }>;
}

export interface KnowledgeGraphResponse {
  dot: string;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch("/api/health") as Promise<HealthResponse>,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useConcepts() {
  return useQuery({
    queryKey: ["concepts"],
    queryFn: () => apiFetch("/api/concepts") as Promise<{ items: Concept[] }>,
    staleTime: 60000,
  });
}

export function useConceptDetail(conceptId: string | null, lang: "zh" | "en") {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["concept-detail", conceptId, lang],
    enabled: !!conceptId,
    staleTime: Infinity, // 後端已快取，不需重抓
    queryFn: async () => {
      return apiFetch(`/api/concepts/${conceptId}/detail?lang=${lang}`) as Promise<ConceptDetail>;
    },
  });

  const forceRefetch = () => {
    if (!conceptId) return;
    queryClient.removeQueries({ queryKey: ["concept-detail", conceptId, lang] });
    return apiFetch(`/api/concepts/${conceptId}/detail?lang=${lang}&force=true`).then((data) => {
      queryClient.setQueryData(["concept-detail", conceptId, lang], data);
    });
  };

  return { ...query, forceRefetch };
}

export function useConceptMastery() {
  return useQuery({
    queryKey: ["mastery", "concepts"],
    queryFn: () => apiFetch("/api/mastery/concepts") as Promise<{ items: ConceptMastery[] }>,
    staleTime: 30000,
  });
}

export function useChapterMastery() {
  return useQuery({
    queryKey: ["mastery", "chapters"],
    queryFn: () => apiFetch("/api/mastery/chapters") as Promise<{ items: ChapterMastery[] }>,
    staleTime: 30000,
  });
}

export function useTonightDashboard(topN = 5) {
  return useQuery({
    queryKey: ["tonight", topN],
    queryFn: () => apiFetch(`/api/tonight?top_n=${topN}`) as Promise<TonightDashboard>,
    staleTime: 15000,
  });
}

export function useKnowledgeGraph() {
  return useQuery({
    queryKey: ["graph"],
    queryFn: () => apiFetch("/api/graph") as Promise<KnowledgeGraphResponse>,
    staleTime: 60000,
  });
}

export function useQuestions(limit = 100) {
  return useQuery({
    queryKey: ["questions", limit],
    queryFn: () => apiFetch(`/api/questions?limit=${limit}`) as Promise<{ items: Question[] }>,
    staleTime: 60000,
  });
}

export function useReviewPlan() {
  return useQuery({
    queryKey: ["review-plan"],
    queryFn: () => apiFetch("/api/review") as Promise<{ items: ReviewItem[] }>,
    staleTime: 30000,
  });
}

// Poll the async ingest job until it finishes. The POST returns immediately with a
// job_id (so the proxy never sees a long request → no 502); the real work runs in a
// backend thread. Resolves with the final result dict, or throws on error/timeout.
async function pollIngestStatus(
  jobId: string,
  onStage?: (stage: string) => void,
): Promise<unknown> {
  const POLL_INTERVAL_MS = 1500;
  // 逾時看的是「有沒有進展」，不是總時長。14 頁手寫 PDF 本地 OCR 約需 12 分鐘，
  // 舊的 12 分鐘總時長上限會在後端仍正常工作時誤報失敗。後端每頁都會更新 stage
  // （「OCR 辨識第 N/M 頁」），所以 stage 一變就重設計時器。
  //
  // 10 分鐘不能再短：「建立知識圖譜」階段最多切 6 個 chunk、每個一次 Gemini 呼叫，
  // 期間 stage 完全不變。要縮短得先讓後端回報更細的進度。
  const STALL_TIMEOUT_MS = 10 * 60 * 1000;
  const ABSOLUTE_MAX_MS = 90 * 60 * 1000; // 後端回報假進度時的最後防線
  const startedAt = Date.now();
  let lastStage = "";
  let lastProgressAt = Date.now();

  while (Date.now() - startedAt < ABSOLUTE_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const status = (await apiFetch(`/api/material/ingest/status/${jobId}`)) as {
      status: string;
      stage?: string;
      detail?: string;
    } & Record<string, unknown>;
    // Surface the real backend stage so the UI reflects actual progress, not a timer.
    if (status.stage && onStage) onStage(status.stage);
    if (status.status === "done") return status;
    if (status.status === "error") {
      throw new Error(status.detail || "教材處理失敗，請稍後再試。");
    }

    if (status.stage && status.stage !== lastStage) {
      lastStage = status.stage;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      const mins = Math.round(STALL_TIMEOUT_MS / 60000);
      throw new Error(
        `處理似乎停住了（已 ${mins} 分鐘沒有進展）。請重新整理後再試一次。`,
      );
    }
  }
  throw new Error("教材處理時間過長，請改用較小的檔案或分章節上傳。");
}

export function useIngestMaterial(onStage?: (stage: string) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      onStage?.("排隊中");
      const start = (await apiFetch("/api/material/ingest", {
        method: "POST",
        body: formData,
      })) as { job_id?: string };
      // Backward-compat: a server that still answers synchronously returns the result.
      if (!start.job_id) return start;
      return pollIngestStatus(start.job_id, onStage);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["mastery"] });
      queryClient.invalidateQueries({ queryKey: ["tonight"] });
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      queryClient.invalidateQueries({ queryKey: ["review-plan"] });
    },
  });
}

// Topic-only study: no file, just a subject. Shares the ingest job/polling machinery
// because the backend runs it through the same pipeline.
export function useIngestTopic(onStage?: (stage: string) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ topic, apiKey }: { topic: string; apiKey?: string }) => {
      onStage?.("排隊中");
      const start = (await apiFetch("/api/material/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, api_key: apiKey || null }),
      })) as { job_id?: string };
      if (!start.job_id) return start;
      return pollIngestStatus(start.job_id, onStage);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["mastery"] });
      queryClient.invalidateQueries({ queryKey: ["tonight"] });
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["questions"] });
      queryClient.invalidateQueries({ queryKey: ["review-plan"] });
    },
  });
}

export function useGenerateDiagnostics() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ questionCount, language }: { questionCount: number; language: "zh" | "en" | "both" }) => {
      return apiFetch("/api/diagnostics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_count: questionCount, language }),
      }) as Promise<{ items: Question[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
    },
  });
}

export function useGradeQuestion() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ questionId, answer }: { questionId: string; answer: string }) => {
      return apiFetch(`/api/questions/${questionId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["mastery"] });
      queryClient.invalidateQueries({ queryKey: ["tonight"] });
    },
  });
}

export function useRecalculateReview() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      return apiFetch("/api/review/recalculate", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tonight"] });
      queryClient.invalidateQueries({ queryKey: ["review-plan"] });
    },
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (apiKey: string) => {
      return apiFetch("/api/config/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

// ── Module D & E ───────────────────────────────────────────────

export interface Course {
  id: string;
  subject: string;
  filename: string;
  uploaded_at: string;
  /** 由伺服器決定，不要用前端自己記的狀態推——重整後前端的猜測會掉。 */
  is_active?: boolean;
}

export interface ClassNodeStat {
  concept_id: string;
  concept_name: string;
  error_rate: number;
  sample_count: number;
  status: "red" | "yellow" | "green";
}

export function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: () => apiFetch("/api/courses") as Promise<{ items: Course[] }>,
    staleTime: 60000,
  });
}

export interface CrossCourseLink {
  from_concept_id: string;
  to_concept_id: string;
  from_concept_name: string;
  to_concept_name: string;
  from_course_id: string;
  to_course_id: string;
  from_course_name: string;
  to_course_name: string;
  similarity: number;
  link_type: string;
}

// detailed=true is required: without it the API returns bare concept IDs, and the
// far end of a bridge belongs to another course, so /api/concepts can't resolve it.
export function useCrossCourseLinks() {
  return useQuery({
    queryKey: ["cross-course-links"],
    queryFn: () =>
      apiFetch("/api/cross-course-edges?detailed=true") as Promise<{ items: CrossCourseLink[] }>,
    staleTime: 60000,
  });
}

// 切回先前上傳過的課程。概念／圖譜／掌握度／複習全部 scope 到 active course，
// 所以切換後這些 query 都要重抓。
export function useActivateCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (courseId: string) =>
      apiFetch(`/api/courses/${courseId}/activate`, { method: "POST" }) as Promise<{
        course_id: string;
        subject: string;
      }>,
    onSuccess: () => {
      for (const key of [
        "health", "concepts", "mastery", "mastery-chapters", "tonight",
        "graph", "questions", "review-plan", "cross-course-links", "courses",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useDeleteCourse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (courseId: string) => {
      return apiFetch(`/api/courses/${courseId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      queryClient.invalidateQueries({ queryKey: ["concepts"] });
      queryClient.invalidateQueries({ queryKey: ["mastery"] });
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["heatmap"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useClassHeatmap(courseId: string | null) {
  return useQuery({
    queryKey: ["heatmap", courseId],
    queryFn: () => apiFetch(`/api/heatmap/${courseId}`) as Promise<{ items: ClassNodeStat[] }>,
    enabled: !!courseId,
    staleTime: 30000,
  });
}

export function useClassWeakConcepts(courseId: string | null, topN = 3) {
  return useQuery({
    queryKey: ["heatmap-weak", courseId, topN],
    queryFn: () =>
      apiFetch(`/api/heatmap/${courseId}/weak?top_n=${topN}`) as Promise<{
        items: Array<{ concept_id: string; concept_name: string; error_rate: number; sample_count: number; estimated_uplift: number }>;
      }>,
    enabled: !!courseId,
    staleTime: 30000,
  });
}

export interface ConceptDailyPoint {
  day: string;
  avg_score: number;
  n: number;
}

export interface ConceptProgressItem {
  concept_id: string;
  concept_name: string;
  daily: ConceptDailyPoint[];
  trend: "improving" | "declining" | "plateaued";
}

export function useConceptProgress(days = 30) {
  return useQuery({
    queryKey: ["concept-progress", days],
    queryFn: () =>
      apiFetch(`/api/progress/concepts?days=${days}`) as Promise<{ items: ConceptProgressItem[] }>,
    staleTime: 60000,
  });
}
