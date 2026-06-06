import type { FC } from "react";
import bibilavocado from "../assets/bibilavocado.png";

interface Props {
  size?: number;
  className?: string;
  withPulse?: boolean;
  animate?: "idle" | "subtle" | "none";
}

const animationStyle: Record<"idle" | "subtle" | "none", React.CSSProperties> = {
  idle:   { animation: "avocado-breathe 3.6s ease-in-out infinite" },
  subtle: { animation: "avocado-float-subtle 4s ease-in-out infinite" },
  none:   {},
};

export const PixelAvocadoLogo: FC<Props> = ({ size = 32, className, animate = "none" }) => {
  return (
    <img
      src={bibilavocado}
      width={size}
      height={size}
      className={className}
      alt="比比拉布"
      aria-hidden="true"
      style={{ imageRendering: "pixelated", ...animationStyle[animate] }}
    />
  );
};
