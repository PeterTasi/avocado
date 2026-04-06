import type { ComponentType } from "react";

interface ModuleSparklineProps {
  id: string;
  data: { v: number }[];
  trendColor?: string;
}
declare const ModuleSparkline: ComponentType<ModuleSparklineProps>;
export default ModuleSparkline;
