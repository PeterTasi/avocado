import type { FC } from "react";
import bibilavocado from "../assets/bibilavocado.png";

interface Props {
  size?: number;
  className?: string;
  withPulse?: boolean;
}

export const PixelAvocadoLogo: FC<Props> = ({ size = 32, className }) => {
  return (
    <img
      src={bibilavocado}
      width={size}
      height={size}
      className={className}
      alt="比比拉布"
      aria-hidden="true"
      style={{ imageRendering: "pixelated" }}
    />
  );
};
