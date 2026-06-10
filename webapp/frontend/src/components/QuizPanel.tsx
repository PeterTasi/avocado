import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useGenerateDiagnostics, useGradeQuestion } from "../hooks/useApi";
import type { Question } from "../hooks/useApi";
import { safeNumber } from "../utils/helpers";
import { MathRenderer } from "./MathRenderer";

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
  sessionUploaded?: boolean;
}

function formatDifficulty(value: string): string {
  switch (value.toLowerCase()) {
    case "easy":   return "基礎";
    case "medium": return "進階";
    case "hard":   return "挑戰";
    default:       return value;
  }
}

function difficultyClass(value: string): string {
  switch (value.toLowerCase()) {
    case "easy":   return "tag-high";
    case "medium": return "tag-medium";
    case "hard":   return "tag-low";
    default:       return "pill";
  }
}

/** SVG arc showing N / total progress */
function QuizArc({ current, total }: { current: number; total: number }) {
  const r = 34;
  const cx = 44;
  const cy = 44;
  const circumference = Math.PI * r; // half-circle (180°)
  const fraction = total > 0 ? current / total : 0;
  const offset = circumference * (1 - fraction);

  return (
    <svg width="88" height="50" viewBox="0 0 88 50" aria-label={`第 ${current} 題，共 ${total} 題`}>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        className="quiz-arc-track"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        className="quiz-arc-fill"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text-primary)" fontFamily="'DM Mono', monospace">
        {current}/{total}
      </text>
    </svg>
  );
}

/** 像素風空箱插圖 */
function PixelEmptyBox() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Box body */}
      <rect x="8"  y="24" width="48" height="32" fill="var(--bg-sunken)" />
      <rect x="8"  y="24" width="48" height="4"  fill="var(--border-strong)" opacity="0.5" />
      {/* Box flaps */}
      <rect x="8"  y="16" width="20" height="8"  fill="var(--bg-sunken)" />
      <rect x="36" y="16" width="20" height="8"  fill="var(--bg-sunken)" />
      {/* Question marks */}
      <rect x="28" y="32" width="4"  height="8"  fill="var(--border-strong)" opacity="0.4" />
      <rect x="28" y="44" width="4"  height="4"  fill="var(--border-strong)" opacity="0.4" />
      <rect x="24" y="28" width="4"  height="4"  fill="var(--border-strong)" opacity="0.4" />
      <rect x="32" y="28" width="4"  height="4"  fill="var(--border-strong)" opacity="0.4" />
      <rect x="32" y="32" width="4"  height="4"  fill="var(--border-strong)" opacity="0.4" />
    </svg>
  );
}

/** 答對時噴出像素方塊粒子 (6–8 顆，角度分散) */
function PixelParticles({ active }: { active: boolean }) {
  if (!active) return null;
  const colors = ["var(--high)", "var(--accent)", "var(--medium)", "var(--high)", "var(--accent)", "var(--high)", "var(--medium)", "var(--accent)"];
  const positions = ["18%", "28%", "38%", "50%", "62%", "72%", "80%", "88%"];
  return (
    <>
      {positions.map((left, i) => (
        <span
          key={i}
          className="pixel-particle"
          style={{ left, bottom: "100%", background: colors[i % colors.length], animationDelay: `${i * 40}ms` }}
        />
      ))}
    </>
  );
}

export function QuizPanel({ questions, setQuestions, questionIndex, setQuestionIndex, sessionUploaded }: Props) {
  const generateDiagnostics = useGenerateDiagnostics();
  const gradeQuestion = useGradeQuestion();

  const [questionCount, setQuestionCount] = useState(9);
  const [quizLang, setQuizLang] = useState<"zh" | "en" | "both">("zh");
  const [answerText, setAnswerText] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [showParticles, setShowParticles] = useState(false);
  const [showStaleModal, setShowStaleModal] = useState(false);
  const particleTimer = useRef<ReturnType<typeof setTimeout>>();

  const currentQuestion = questions[questionIndex] ?? null;

  const doGenerate = useCallback(async (lang?: "zh" | "en" | "both") => {
    const result = await generateDiagnostics.mutateAsync({ questionCount, language: lang ?? quizLang });
    setQuestions(result.items ?? []);
    setQuestionIndex(0);
    setAnswerText("");
    setGradeResult(null);
  }, [questionCount, quizLang, generateDiagnostics, setQuestions, setQuestionIndex]);

  const handleGenerate = useCallback(() => {
    if (!sessionUploaded) {
      setShowStaleModal(true);
      return;
    }
    doGenerate();
  }, [sessionUploaded, doGenerate]);

  const handleLangChange = useCallback((newLang: "zh" | "en" | "both") => {
    setQuizLang(newLang);
    if (questions.length > 0 && !generateDiagnostics.isPending) {
      doGenerate(newLang);
    }
  }, [questions.length, generateDiagnostics.isPending, doGenerate]);

  const handleGrade = useCallback(async () => {
    if (!currentQuestion || !answerText.trim()) return;
    const result = await gradeQuestion.mutateAsync({
      questionId: currentQuestion.id,
      answer: answerText.trim(),
    });
    const graded = result as GradeResult;
    setGradeResult(graded);
    if (graded.is_correct) {
      setShowParticles(true);
      clearTimeout(particleTimer.current);
      particleTimer.current = setTimeout(() => setShowParticles(false), 1000);
    }
  }, [currentQuestion, answerText, gradeQuestion]);

  useEffect(() => () => clearTimeout(particleTimer.current), []);

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

  const statusText = generateDiagnostics.isPending
    ? "正在產生自適應題目..."
    : gradeQuestion.isPending
    ? "正在評分作答..."
    : gradeQuestion.isSuccess
    ? "評分完成。"
    : "";

  return (
    <>
    {/* Stale-data confirmation modal */}
    {showStaleModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
        <div className="card mx-4 max-w-sm p-6 shadow-xl">
          <p className="text-base font-semibold text-[color:var(--text-primary)]">使用舊教材出題？</p>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            本次 session 尚未上傳新教材，題目將根據上次上傳的課程概念產生。
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowStaleModal(false)}
              className="btn-ghost px-4 py-2 text-sm"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => { setShowStaleModal(false); doGenerate(); }}
              className="btn-primary px-4 py-2 text-sm"
            >
              確認繼續
            </button>
          </div>
        </div>
      </div>
    )}
    <article className="card p-6">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="section-eyebrow">診斷測驗</p>
          <h2 className="mt-2 text-lg font-semibold text-[color:var(--text-primary)]">自適應測驗</h2>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">系統會優先抽弱點概念，並混合三種難度。</p>
        </div>

        {questions.length > 0 && (
          <QuizArc current={questionIndex + 1} total={questions.length} />
        )}
      </div>

      {/* Generate controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[color:var(--text-secondary)]">題數</span>
          <input
            type="number"
            min={3}
            max={30}
            step={3}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            className="input h-10 w-20 px-3 text-sm"
          />
        </div>
        <div className="inline-flex rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-sunken)] p-0.5 text-[11px]">
          {(["zh", "en", "both"] as const).map((l) => (
            <button key={l} type="button"
              onClick={() => handleLangChange(l)}
              disabled={generateDiagnostics.isPending}
              className={`rounded-md px-2.5 py-1 font-semibold transition disabled:opacity-50 ${quizLang === l ? "bg-white text-[color:var(--accent)] shadow-sm" : "text-[color:var(--text-secondary)]"}`}>
              {l === "zh" ? "中文" : l === "en" ? "EN" : "中英"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generateDiagnostics.isPending}
          className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {generateDiagnostics.isPending ? "產生中..." : "產生題目"}
        </button>
        {statusText && (
          <span className="text-xs text-[color:var(--text-muted)]">{statusText}</span>
        )}
      </div>

      {/* Empty state */}
      {!currentQuestion && (
        <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
          <PixelEmptyBox />
          <p className="text-sm font-medium text-[color:var(--text-secondary)]">尚未產生題目</p>
          <p className="text-xs text-[color:var(--text-muted)]">先匯入教材，再點「產生題目」開始診斷測驗</p>
        </div>
      )}

      {/* Question card */}
      {currentQuestion && (
        <div key={questionIndex} className="mt-5 card-subtle rounded-2xl p-5 question-enter">
          {/* Meta row */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-mono-data text-xs text-[color:var(--text-muted)]">
              {questionIndex + 1} / {questions.length}
            </span>
            <span className="pill text-[11px]">{currentQuestion.concept_name}</span>
            <span className={`pill text-[11px] ${difficultyClass(currentQuestion.difficulty)}`}>
              {formatDifficulty(currentQuestion.difficulty)}
            </span>
          </div>

          {/* Question text */}
          <p className="text-[15px] font-medium leading-7 text-[color:var(--text-primary)]">
            <MathRenderer text={currentQuestion.question_text} />
          </p>

          {/* Answer textarea */}
          <textarea
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            rows={4}
            placeholder="輸入你的作答內容..."
            className="input mt-4 w-full rounded-xl p-3 text-sm"
          />

          {/* Action buttons */}
          <div className="relative mt-4 flex flex-wrap items-center gap-3">
            <PixelParticles active={showParticles} />

            <button
              type="button"
              onClick={handlePrev}
              disabled={questionIndex === 0}
              className="btn-secondary gap-1 px-4 py-2 text-xs disabled:opacity-50"
            >
              <ChevronLeft size={14} />
              上一題
            </button>

            <button
              type="button"
              onClick={handleGrade}
              disabled={gradeQuestion.isPending || !answerText.trim()}
              className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
            >
              {gradeQuestion.isPending ? "評分中..." : "送出作答"}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={questionIndex >= questions.length - 1}
              className="btn-secondary gap-1 px-4 py-2 text-xs disabled:opacity-50"
            >
              下一題
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Grade result */}
          {gradeResult && (
            <div
              className={`mt-4 rounded-xl border p-4 text-sm grade-enter ${gradeResult.is_correct ? "correct" : ""} ${
                gradeResult.is_correct
                  ? "border-[color:var(--high)] bg-[color:var(--high-soft)]"
                  : "border-[color:var(--low)] bg-[color:var(--low-soft)]"
              }`}
            >
              <p className="font-semibold" style={{ color: gradeResult.is_correct ? "var(--high)" : "var(--low)" }}>
                {gradeResult.is_correct ? "✓ 答對了！" : "✗ 需要加強"}
                <span className="ml-2 font-mono-data text-[13px]">
                  {(safeNumber(gradeResult.score) * 100).toFixed(1)}%
                </span>
              </p>
              <p className="mt-2 text-[color:var(--text-secondary)]">
                <MathRenderer text={gradeResult.feedback} />
              </p>
              <p className="mt-1.5 text-xs text-[color:var(--text-muted)]">
                參考答案：<MathRenderer text={gradeResult.expected_answer} />
              </p>
            </div>
          )}
        </div>
      )}
    </article>
    </>
  );
}
