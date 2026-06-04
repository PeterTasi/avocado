import { clamp } from "../utils/helpers";

interface Props {
  value?: number;
  compact?: boolean;
}

export function DailyProgressRing({ value = 0, compact = false }: Props) {
  const clamped = clamp(value);

  // SVG arc parameters
  const size = 40;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;
  const gap = circumference - filled;

  // Colour transitions by performance band
  const ringColor =
    clamped >= 70
      ? "var(--high)"
      : clamped >= 40
        ? "var(--medium)"
        : "var(--low)";

  const statusText = clamped >= 70 ? "穩定前進" : clamped >= 40 ? "持續進步" : "需要補強";

  return (
    <div className="flex items-center gap-2.5">
      {/* SVG ring — smoother antialiased arc vs. conic-gradient */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: "block", transform: "rotate(-90deg)" }}
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--bg-sunken)"
            strokeWidth={3.5}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${gap}`}
            style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.34,1.56,0.64,1), stroke 0.3s ease" }}
          />
        </svg>
        {/* Centre label */}
        <div
          className="font-mono-data absolute inset-0 grid place-items-center text-[9px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {Math.round(clamped)}%
        </div>
      </div>

      {!compact && (
        <div className="hidden sm:block">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">今日進度</p>
          <p className="text-[11px] font-semibold text-[color:var(--text-primary)]">{statusText}</p>
        </div>
      )}
    </div>
  );
}
