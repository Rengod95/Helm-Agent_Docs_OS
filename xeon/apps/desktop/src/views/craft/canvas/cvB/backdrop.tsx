// 캔버스 배경: 무채색의 은은한 글로 라인 격자(보기와 함께 움직인다) + 아주 연한 셰이더 빛(화면에 붙어 있다).
// 셰이더는 프레임 루프가 없다. 처음, 크기가 바뀔 때, 테마가 바뀔 때만 한 번 그린다(가만히 있을 때 GPU·CPU 0).
// 격자는 SVG 패턴 하나라 보기를 움직일 때만 다시 그려진다. WebGL이 없으면 셰이더 층만 빠진다.
import { useViewport } from "@xyflow/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { drawLight } from "./shader.ts";

const MINOR = 28;
const MAJOR = MINOR * 5;

export function Backdrop(props: { readonly dark: boolean }): ReactNode {
  return (
    <div className="cvb-backdrop" aria-hidden="true">
      <Light dark={props.dark} />
      <Grid />
    </div>
  );
}

function Grid(): ReactNode {
  const { x, y, zoom } = useViewport();
  const id = useId();
  const minor = MINOR * zoom;
  const major = MAJOR * zoom;
  // 보기를 아주 줄이면 작은 칸을 지운다(선이 뭉쳐 회색 판이 되지 않게)
  const showMinor = minor >= 9;
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <pattern
          id={`${id}-minor`}
          width={minor}
          height={minor}
          patternUnits="userSpaceOnUse"
          x={x % minor}
          y={y % minor}
        >
          <path
            className="cvb-grid-line"
            d={`M${minor} 0 V${minor} M0 ${minor} H${minor}`}
            fill="none"
          />
        </pattern>
        <pattern
          id={`${id}-major`}
          width={major}
          height={major}
          patternUnits="userSpaceOnUse"
          x={x % major}
          y={y % major}
        >
          <path
            className="cvb-grid-glow"
            d={`M${major} 0 V${major} M0 ${major} H${major}`}
            fill="none"
          />
          <path
            className="cvb-grid-major"
            d={`M${major} 0 V${major} M0 ${major} H${major}`}
            fill="none"
          />
          <path
            className="cvb-grid-cross"
            d={`M${major - 4} ${major} H${major + 4} M${major} ${major - 4} V${major + 4} M-4 0 H4 M0 -4 V4 M${major - 4} 0 H${major + 4} M0 ${major - 4} V${major + 4}`}
            fill="none"
          />
        </pattern>
      </defs>
      {showMinor && <rect width="100%" height="100%" fill={`url(#${id}-minor)`} />}
      <rect width="100%" height="100%" fill={`url(#${id}-major)`} />
    </svg>
  );
}

function Light(props: { readonly dark: boolean }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const paint = (): void => {
      drawLight(canvas, props.dark);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [props.dark]);
  return <canvas ref={ref} />;
}
