import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useGenerateDiagnostics, useGradeQuestion } from "../hooks/useApi";
import type { Question } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";

interface GradeResult {
  score: number;
  is_correct: boolean;
  feedback: string;
  expected_answer: string;
}

interface Props {
  questions: Question[];
  setQuestions: (q: Question[]) => void;
  questionIndex: number;
  setQuestionIndex: React.Dispatch<React.SetStateAction<number>>;
}

export function QuizPanel({ questions, setQuestions, questionIndex, setQuestionIndex }: Props) {
  const generateDiagnostics = useGenerateDiagnostics();
  const gradeQuestion = useGradeQuestion();

  const [questionCount, setQuestionCount] = useState(9);
  const [answerText, setAnswerText] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);

  const currentQuestion = questions[questionIndex] ?? null;

  const handleGenerate = useCallback(async () => {
    const result = await generateDiagnostics.mutateAsync(questionCount);
    setQuestions(result.items ?? []);
    setQuestionIndex(0);
    setAnswerText("");
    setGradeResult(null);
  }, [questionCount, generateDiagnostics, setQuestions, setQuestionIndex]);

  const handleGrade = useCallback(async () => {
    if (!currentQuestion || !answerText.trim()) return;
    const result = await gradeQuestion.mutateAsync({
      questionId: currentQuestion.id,
      answer: answerText.trim(),
    });
    setGradeResult(result as GradeResult);
  }, [currentQuestion, answerText, gradeQuestion]);

  const handlePrev = useCallback(() => {
    setQuestionIndex((prev) => Math.max(0, prev - 1));
    setAnswerText("");
    setGradeResult(null);
  }, [setQuestionIndex]);

  const handleNext = useCallback(() => {
    setQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1));
    setAnswerText("");
    setGradeResult(null);
  }, [questions.length, setQuestionIndex]);

  const status = generateDiagnostics.isPending
    ? "正在產生自適應題目..."
    : gradeQuestion.isPending
    ? "正在評分作答..."
    : gradeQuestion.isSuccess
    ? "評分完成。"
    : "";

  return (
    <article className="rounded-2xl border border-slate-800/50 bg-slate-900/60 p-5 backdrop-blur-sm">
      <h2 className="text-base font-semibold text-slate-100">自適應測驗</h2>
      <p className="mt-1 text-xs text-slate-400">系統會優先抽弱點概念，並混合三種難度。</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={3}
          max={30}
          step={3}
          value={questionCount}
          onChange={(event) => setQuestionCount(Number(event.target.value))}
          className="h-10 w-24 rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 text-sm outline-none focus:border-indigo-500/60"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generateDiagnostics.isPending}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {generateDiagnostics.isPending ? "產生中..." : "產生題目"}
        </button>
        <span className="text-xs text-slate-400">{status}</span>
      </div>

      {currentQuestion ? (
        <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4">
          <p className="text-xs text-slate-400">
            題目 {questionIndex + 1}/{questions.length} · {currentQuestion.concept_name} ·{" "}
            {currentQuestion.difficulty}
          </p>
          <p className="mt-2 text-sm text-slate-100">{currentQuestion.question_text}</p>

          <textarea
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            rows={5}
            placeholder="輸入你的作答內容..."
            className="mt-3 w-full rounded-xl border border-slate-800/70 bg-slate-900/70 p-3 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={questionIndex === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              <ChevronLeft size={14} />
              上一題
            </button>

            <button
              type="button"
              onClick={handleGrade}
              disabled={gradeQuestion.isPending || !answerText.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {gradeQuestion.isPending ? "評分中..." : "送出作答"}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={questionIndex >= questions.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            >
              下一題
              <ChevronRight size={14} />
            </button>
          </div>

          {gradeResult ? (
            <div className="mt-3 rounded-lg border border-slate-800/70 bg-slate-900/70 p-3 text-xs text-slate-300">
              <p>
                分數：<span className="text-emerald-400">{(safeNumber(gradeResult.score) * 100).toFixed(1)}%</span> ·
                判定：{gradeResult.is_correct ? "答對" : "待加強"}
              </p>
              <p className="mt-1">回饋：{gradeResult.feedback}</p>
              <p className="mt-1 text-slate-400">參考答案：{gradeResult.expected_answer}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
