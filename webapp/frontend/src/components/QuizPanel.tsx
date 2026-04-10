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

function formatDifficulty(value: string): string {
  switch (value.toLowerCase()) {
    case "easy":
      return "基礎";
    case "medium":
      return "進階";
    case "hard":
      return "挑戰";
    default:
      return value;
  }
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
    <article className="glass-panel rounded-[28px] p-6 text-white">
      <p className="section-eyebrow">診斷測驗</p>
      <h2 className="mt-2 text-lg font-semibold text-white">自適應測驗</h2>
      <p className="mt-1 text-xs text-white/62">系統會優先抽弱點概念，並混合三種難度。</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="number"
          min={3}
          max={30}
          step={3}
          value={questionCount}
          onChange={(event) => setQuestionCount(Number(event.target.value))}
          className="glass-input h-11 w-24 rounded-2xl px-4 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generateDiagnostics.isPending}
          className="glass-button-primary rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
        >
          {generateDiagnostics.isPending ? "產生中..." : "產生題目"}
        </button>
        <span className="text-xs text-white/62">{status}</span>
      </div>

      {currentQuestion ? (
        <div className="mt-4 rounded-[24px] border border-white/12 bg-[rgba(8,15,32,0.12)] p-4">
          <p className="text-xs text-white/62">
            題目 {questionIndex + 1}/{questions.length} · {currentQuestion.concept_name} ·{" "}
            {formatDifficulty(currentQuestion.difficulty)}
          </p>
          <p className="mt-2 text-sm leading-6 text-white">{currentQuestion.question_text}</p>

          <textarea
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            rows={5}
            placeholder="輸入你的作答內容..."
            className="glass-input mt-3 w-full rounded-[22px] p-3 text-sm outline-none transition focus:border-white/30 focus:ring-2 focus:ring-white/15"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePrev}
              disabled={questionIndex === 0}
              className="glass-button inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs disabled:opacity-50"
            >
              <ChevronLeft size={14} />
              上一題
            </button>

            <button
              type="button"
              onClick={handleGrade}
              disabled={gradeQuestion.isPending || !answerText.trim()}
              className="glass-button-primary rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-60"
            >
              {gradeQuestion.isPending ? "評分中..." : "送出作答"}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={questionIndex >= questions.length - 1}
              className="glass-button inline-flex items-center gap-1 rounded-full px-4 py-2 text-xs disabled:opacity-50"
            >
              下一題
              <ChevronRight size={14} />
            </button>
          </div>

          {gradeResult ? (
            <div className="mt-3 rounded-[20px] border border-white/12 bg-white/8 p-3 text-xs text-white/72">
              <p>
                分數：<span className="text-emerald-100">{(safeNumber(gradeResult.score) * 100).toFixed(1)}%</span> ·
                判定：{gradeResult.is_correct ? "答對" : "待加強"}
              </p>
              <p className="mt-1">回饋：{gradeResult.feedback}</p>
              <p className="mt-1 text-white/58">參考答案：{gradeResult.expected_answer}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
