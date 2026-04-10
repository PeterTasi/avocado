import { clamp } from "../utils/helpers";

interface Props {
  value?: number;
}

export function DailyProgressRing({ value = 0 }: Props) {
  const clamped = clamp(value);
  const angle = Math.round((clamped / 100) * 360);
  const statusText = clamped >= 70 ? "穩定前進" : "需要補強";

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-12 w-12 rounded-full shadow-[0_12px_30px_rgba(15,23,42,0.18)]"
        style={{ background: `conic-gradient(rgba(255,255,255,0.95) ${angle}deg, rgba(255,255,255,0.16) ${angle}deg 360deg)` }}
      >
        <div className="absolute inset-[5px] rounded-full bg-[rgba(18,27,52,0.6)] backdrop-blur-xl" />
        <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-white">
          {Math.round(clamped)}%
        </div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">今日進度</p>
        <p className="text-sm font-medium text-white">{statusText}</p>
      </div>
    </div>
  );
}
