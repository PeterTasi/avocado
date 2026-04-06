export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function formatPercent(value: number | undefined): string {
  const n = Number(value ?? 0);
  return `${(n * 100).toFixed(1)}%`;
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildTrend(progress: number, seed = 1): { v: number }[] {
  const p = clamp(progress);
  const base = Math.max(8, p - 18);
  const wave = [0, 4, -3, 6, -2, 7, 3, 9];
  return wave.map((offset, index) => ({
    v: clamp(base + offset + seed * (index % 2 === 0 ? 1 : -1)),
  }));
}
