interface Props {
  className?: string;
}

export function Skeleton({ className = "" }: Props) {
  return <div className={`animate-pulse rounded-lg bg-slate-800/50 ${className}`} />;
}
