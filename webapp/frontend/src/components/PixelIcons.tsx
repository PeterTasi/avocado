import type { CSSProperties, FC } from "react";

interface P {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

type Grid = (0 | 1)[][];

const Px: FC<P & { g: Grid }> = ({ g, size = 16, style, className }) => (
  <svg
    width={size}
    height={size}
    viewBox={`0 0 ${g[0].length} ${g.length}`}
    shapeRendering="crispEdges"
    style={style}
    className={className}
    aria-hidden="true"
  >
    {g.flatMap((row, y) =>
      row.flatMap((cell, x) =>
        cell ? [<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />] : []
      )
    )}
  </svg>
);

// 🏠 首頁
const HOME: Grid = [
  [0,0,0,1,1,0,0,0],
  [0,0,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,0],
  [1,1,1,0,0,1,1,1],
  [0,1,0,0,0,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,1,1,1,1,1,0],
];

// 📤 匯入教材（上傳箭頭 + 托盤）
const UPLOAD: Grid = [
  [0,0,1,1,1,0,0,0],
  [0,1,1,1,1,1,0,0],
  [0,0,0,1,0,0,0,0],
  [0,0,0,1,0,0,0,0],
  [0,1,1,1,1,1,0,0],
  [0,1,0,0,0,1,0,0],
  [0,1,0,0,0,1,0,0],
  [0,1,1,1,1,1,0,0],
];

// ✨ 測驗（4 方向閃光 + 角落亮點）
const STAR: Grid = [
  [1,0,0,1,0,0,1,0],
  [0,0,0,1,0,0,0,0],
  [0,0,1,1,1,0,0,0],
  [1,1,1,0,1,1,1,0],
  [0,0,1,1,1,0,0,0],
  [0,0,0,1,0,0,0,0],
  [1,0,0,1,0,0,1,0],
  [0,0,0,0,0,0,0,0],
];

// 📅 複習（月曆）
const CALENDAR: Grid = [
  [0,1,0,0,0,1,0,0],
  [1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,0],
  [1,0,1,0,1,0,1,0],
  [1,0,0,0,0,0,1,0],
  [1,0,1,0,1,0,1,0],
  [1,0,0,0,0,0,1,0],
  [1,1,1,1,1,1,1,0],
];

// 🔗 圖譜（三個節點連線）
const GRAPH: Grid = [
  [0,0,0,1,1,0,0,0],
  [0,0,1,1,1,1,0,0],
  [0,0,0,1,1,0,0,0],
  [0,0,1,0,0,1,0,0],
  [1,1,1,0,0,1,1,1],
  [1,1,1,0,0,1,1,1],
  [0,1,0,0,0,0,1,0],
  [0,0,0,0,0,0,0,0],
];

// 📖 概念節點（打開的書）
const BOOK: Grid = [
  [0,1,1,1,1,1,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,0,0],
];

// 📈 作答完成率（趨勢折線 + X 軸）
const CHART: Grid = [
  [0,0,0,0,0,0,1,0],
  [0,0,0,0,0,1,1,1],
  [0,0,0,0,1,0,1,0],
  [0,0,0,1,0,0,0,0],
  [0,1,1,1,0,0,0,0],
  [1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,1,0],
];

export const PixelHome: FC<P> = (p) => <Px g={HOME} {...p} />;
export const PixelUpload: FC<P> = (p) => <Px g={UPLOAD} {...p} />;
export const PixelStar: FC<P> = (p) => <Px g={STAR} {...p} />;
export const PixelCalendar: FC<P> = (p) => <Px g={CALENDAR} {...p} />;
export const PixelGraph: FC<P> = (p) => <Px g={GRAPH} {...p} />;
export const PixelBook: FC<P> = (p) => <Px g={BOOK} {...p} />;
export const PixelChart: FC<P> = (p) => <Px g={CHART} {...p} />;
