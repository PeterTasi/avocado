import { useMemo } from "react";

interface Props {
  retention: number;
  stability: number;
  nextReviewAt: string;
}

// FSRS-5 forgetting curve: R(t) = (1 + FACTOR * t / S)^DECAY
const DECAY = -0.5;
const FACTOR = 19 / 81;

function fsrsR(elapsed: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsed) / stability, DECAY);
}

function elapsedFromRetention(retention: number, stability: number): number {
  if (stability <= 0 || retention <= 0) return 0;
  // Invert: elapsed = ((R^(1/DECAY)) - 1) * S / FACTOR
  return ((Math.pow(retention, 1 / DECAY) - 1) * stability) / FACTOR;
}

export function ForgettingCurve({ retention, stability, nextReviewAt }: Props) {
  const curve = useMemo(() => {
    if (stability <= 0) return null;

    const elapsed0 = elapsedFromRetention(retention, stability);
    const reviewDate = new Date(nextReviewAt);
    const now = new Date();
    const daysUntilReview = Math.max(0, (reviewDate.getTime() - now.getTime()) / 86400000);

    // Draw from "now" forward to max(daysUntilReview * 1.5, 14) days
    const windowDays = Math.max(daysUntilReview * 1.5, 14);
    const W = 220;
    const H = 52;
    const points: [number, number][] = [];
    const steps = 60;

    for (let i = 0; i <= steps; i++) {
      const futureDays = (i / steps) * windowDays;
      const r = fsrsR(elapsed0 + futureDays, stability);
      const x = (futureDays / windowDays) * W;
      const y = H - r * H;
      points.push([x, y]);
    }

    const pathD =
      points
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");

    const areaD = `${pathD} L${W},${H} L0,${H} Z`;
    const reviewX = ((daysUntilReview / windowDays) * W).toFixed(1);
    const reviewR = fsrsR(elapsed0 + daysUntilReview, stability);
    const reviewY = (H - reviewR * H).toFixed(1);
    const retentionPct = Math.round(retention * 100);
    const reviewPct = Math.round(reviewR * 100);

    return { pathD, areaD, reviewX, reviewY, daysUntilReview, retentionPct, reviewPct, H, W };
  }, [retention, stability, nextReviewAt]);

  if (!curve) {
    return (
      <p className="mt-1.5 text-[10px] text-[color:var(--text-muted)]">尚無作答，完成測驗後產生遺忘曲線</p>
    );
  }

  const { pathD, areaD, reviewX, reviewY, daysUntilReview, retentionPct, reviewPct, H, W } = curve;

  return (
    <div className="mt-2">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-label={`遺忘曲線：現在記憶 ${retentionPct}%，預計 ${Math.round(daysUntilReview)} 天後複習時剩 ${reviewPct}%`}
        style={{ display: "block", height: 48 }}
      >
        <defs>
          <linearGradient id={`fc-grad-${retentionPct}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaD} fill={`url(#fc-grad-${retentionPct})`} />
        {/* Decay line */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
        {/* "Now" dot */}
        <circle cx="0" cy={(H - retention * H).toFixed(1)} r="3" fill="var(--accent)" />
        {/* Review threshold dashed line */}
        <line
          x1={reviewX} y1="0" x2={reviewX} y2={H}
          stroke="var(--medium)" strokeWidth="1" strokeDasharray="3 3"
        />
        <circle cx={reviewX} cy={reviewY} r="3" fill="var(--medium)" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[color:var(--text-muted)]">
        <span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>● </span>
          現在 {retentionPct}%
        </span>
        <span>
          <span style={{ color: "var(--medium)", fontWeight: 600 }}>┊ </span>
          {Math.round(daysUntilReview)} 天後複習 · 剩 {reviewPct}%
        </span>
      </div>
    </div>
  );
}
