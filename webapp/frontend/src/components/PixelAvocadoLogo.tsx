import type { FC } from "react";

interface Props {
  size?: number;
  className?: string;
  withPulse?: boolean;
}

export const PixelAvocadoLogo: FC<Props> = ({ size = 32, className, withPulse = true }) => {
  const h = Math.round(size * 1.2);
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 20 24"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      {/* Outer skin — dark green */}
      <rect x="7"  y="0"  width="6"  height="2" fill="#0b7d57" />
      <rect x="5"  y="2"  width="10" height="2" fill="#0b7d57" />
      <rect x="3"  y="4"  width="14" height="2" fill="#0b7d57" />
      <rect x="2"  y="6"  width="16" height="2" fill="#0b7d57" />
      <rect x="1"  y="8"  width="18" height="2" fill="#0b7d57" />
      <rect x="1"  y="10" width="18" height="2" fill="#0b7d57" />
      <rect x="1"  y="12" width="18" height="2" fill="#0b7d57" />
      <rect x="2"  y="14" width="16" height="2" fill="#0b7d57" />
      <rect x="3"  y="16" width="14" height="2" fill="#0b7d57" />
      <rect x="5"  y="18" width="10" height="2" fill="#0b7d57" />
      <rect x="7"  y="20" width="6"  height="2" fill="#0b7d57" />
      <rect x="8"  y="22" width="4"  height="2" fill="#0b7d57" />

      {/* Inner flesh — light green */}
      <rect x="7"  y="2"  width="6"  height="2" fill="#a7ecd3" />
      <rect x="5"  y="4"  width="10" height="2" fill="#a7ecd3" />
      <rect x="4"  y="6"  width="12" height="2" fill="#a7ecd3" />
      <rect x="3"  y="8"  width="14" height="2" fill="#a7ecd3" />
      <rect x="3"  y="10" width="14" height="2" fill="#a7ecd3" />
      <rect x="3"  y="12" width="14" height="2" fill="#a7ecd3" />
      <rect x="4"  y="14" width="12" height="2" fill="#a7ecd3" />
      <rect x="5"  y="16" width="10" height="2" fill="#a7ecd3" />
      <rect x="7"  y="18" width="6"  height="2" fill="#a7ecd3" />

      {/* ECG pulse — indigo, at pit position (center rows) */}
      {withPulse && (
        <polyline
          points="4,11 6,11 7,9 8,13 9,9 10,13 11,11 16,11"
          fill="none"
          stroke="#4f46e5"
          strokeWidth="1.5"
          strokeLinecap="square"
          shapeRendering="crispEdges"
        />
      )}
    </svg>
  );
};
