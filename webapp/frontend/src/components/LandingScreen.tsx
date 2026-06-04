import { useState } from "react";
import { PixelAvocadoLogo } from "./PixelAvocadoLogo";

interface Props {
  onEnter: () => void;
}

export function LandingScreen({ onEnter }: Props) {
  const [leaving, setLeaving] = useState(false);

  const handleEnter = () => {
    setLeaving(true);
    setTimeout(onEnter, 240);
  };

  return (
    <div
      className={`landing-container relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[color:var(--bg-app)]${leaving ? " is-leaving" : ""}`}
    >
      {/* Pixel grid background — bottom-right decoration */}
      <div
        className="pixel-grid-bg pointer-events-none absolute bottom-0 right-0 h-64 w-64 opacity-30"
        aria-hidden="true"
      />
      {/* Pixel grid background — top-left mirror */}
      <div
        className="pixel-grid-bg pointer-events-none absolute left-0 top-0 h-48 w-48 opacity-20"
        aria-hidden="true"
      />

      {/* Content — stagger children via .landing-item */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="landing-item flex justify-center">
          <PixelAvocadoLogo size={104} />
        </div>

        <div className="landing-item">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-[color:var(--text-primary)] md:text-5xl">
            AdaptLearn
          </h1>
        </div>

        <div className="landing-item">
          <p className="text-base text-[color:var(--text-secondary)] md:text-lg">
            把教材變成測驗・複習・圖譜
          </p>
        </div>

        <div className="landing-item">
          <button
            type="button"
            onClick={handleEnter}
            className="btn-primary px-8 py-3 text-base"
          >
            開始學習 →
          </button>
        </div>

        <div className="landing-item">
          <p className="text-sm text-[color:var(--text-muted)]">
            已支援 PDF・手寫・圖片
          </p>
        </div>
      </div>
    </div>
  );
}
