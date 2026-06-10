import { PixelUpload, PixelStar, PixelGraph } from "./PixelIcons";

interface Props {
  onNavigate: (view: "setup" | "quiz" | "graph" | "review") => void;
}

export function EmptyStateOnboarding({ onNavigate }: Props) {
  const steps = [
    {
      num: 1,
      icon: PixelUpload,
      title: "上傳教材",
      description: "上傳 PDF、圖片或手寫筆記，AI 自動建立知識圖譜",
      btnLabel: "開始上傳",
      btnClass: "btn-primary text-sm",
      view: "setup" as const,
    },
    {
      num: 2,
      icon: PixelStar,
      title: "做診斷測驗",
      description: "針對弱點概念出題，找出你還不熟的地方",
      btnLabel: "開始測驗",
      btnClass: "btn-secondary text-sm",
      view: "quiz" as const,
    },
    {
      num: 3,
      icon: PixelGraph,
      title: "查看圖譜與複習計畫",
      description: "互動式知識圖譜 + FSRS-5 科學排程，確保長期記憶",
      btnLabel: "查看圖譜",
      btnClass: "btn-secondary text-sm",
      view: "graph" as const,
    },
  ];

  return (
    <div className="card p-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-[color:var(--text-primary)]">從這裡開始</h2>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          上傳你的第一份教材，完成三個步驟開啟 AI 學習體驗
        </p>
      </div>

      {/* Steps grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.num} className="card-subtle flex flex-col gap-3 p-5">
              {/* Step number badge */}
              <div className="flex items-center gap-3">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold"
                  style={{
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                >
                  {step.num}
                </span>
                <Icon size={20} style={{ color: "var(--accent)" }} />
              </div>

              {/* Title */}
              <h3 className="font-semibold text-[color:var(--text-primary)]">{step.title}</h3>

              {/* Description */}
              <p className="text-sm text-[color:var(--text-secondary)]">{step.description}</p>

              {/* CTA button — pushed to bottom */}
              <button
                type="button"
                onClick={() => onNavigate(step.view)}
                className={`${step.btnClass} mt-auto`}
              >
                {step.btnLabel}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
