import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = "";

async function apiFetch(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = (payload && typeof payload === "object" && "detail" in payload)
      ? String((payload as { detail: string }).detail)
      : typeof payload === "string" && payload.trim().length > 0
      ? payload
      : response.statusText || "請求失敗";
    throw new Error(message);
  }
  return payload;
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

export function useIngestMaterial() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (formData: FormData) => {
      return apiFetch("/api/material/ingest", {
        method: "POST",
        body: formData,
      });
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
    mutationFn: async (questionCount: number) => {
      return apiFetch("/api/diagnostics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_count: questionCount }),
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
        items: Array<{ concept_id: string; error_rate: number; sample_count: number; estimated_uplift: number }>;
      }>,
    enabled: !!courseId,
    staleTime: 30000,
  });
}
