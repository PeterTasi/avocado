import { clamp } from "../utils/helpers";

interface Props {
  value?: number;
}

export function DailyProgressRing({ value = 0 }: Props) {
  const clamped = clamp(value);
  const angle = Math.round((clamped / 100) * 360);

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-12 w-12 rounded-full"
        style={{ background: `conic-gradient(rgb(129 140 248) ${angle}deg, rgb(30 41 59) ${angle}deg 360deg)` }}
      >
        <div className="absolute inset-[5px] rounded-full bg-slate-950" />
        <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-slate-100">
          {Math.round(clamped)}%
        </div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Daily Goal</p>
        <p className="text-sm font-medium text-emerald-400">{clamped >= 70 ? "On Track" : "Needs Boost"}</p>
      </div>
    </div>
  );
}
