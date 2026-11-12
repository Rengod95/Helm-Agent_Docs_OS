import { encodeQr } from "@fresnel/client";
import type { ReactNode } from "react";

// QR 코드 그림(SVG). 색은 검정과 흰색으로 고정해 테마 토큰을 쓰지 않는다. 담지 못하면 아무것도 그리지 않는다.
// 검은 모듈은 가로로 이어진 줄마다 한 조각으로 합쳐 path 하나에 담는다. 조용한 영역은 사방 4모듈이다.

const QUIET_ZONE = 4;

export function QrCode(props: {
  /** 담을 글(UTF-8 바이트 기준 412바이트까지) */
  readonly value: string;
  /** 그림의 한 변(px) */
  readonly size: number;
  /** 접근성 이름 */
  readonly label: string;
}): ReactNode {
  const result = encodeQr(props.value);
  if (!result.ok) return null;
  const modules = result.value;
  const side = modules.length + 2 * QUIET_ZONE;
  return (
    <svg
      role="img"
      aria-label={props.label}
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#fff" />
      <path fill="#000" d={darkRunsPath(modules)} />
    </svg>
  );
}

/** 줄마다 검은 모듈의 연속 구간을 `M x y h길이 v1 h-길이z`로 적는다 */
function darkRunsPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  for (let row = 0; row < modules.length; row++) {
    const line = modules[row] ?? [];
    let col = 0;
    while (col < line.length) {
      if (line[col] !== true) {
        col++;
        continue;
      }
      const start = col;
      while (line[col] === true) col++;
      const run = col - start;
      parts.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`);
    }
  }
  return parts.join("");
}
