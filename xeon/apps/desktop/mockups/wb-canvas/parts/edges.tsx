// 엣지 층(세계 좌표 svg). 연산마다 선 모양이 다르고 색은 neutral 단계만 쓴다(DP-29: tone은 아이콘 면에만).
//   기능 provides→consumes: 실선(optional은 긴 점선), 제공자 없음: 짧은 점선 + 끝 글자
//   on → 훅: 가는 실선, post → 큐: 둥근 점선, drive → 주도: 굵은 실선(보유 중이면 흐름 움직임), 등록: 짧은 점선
// caustic 빈틈 [gap:C-36 제안]: 노드 그래프 엣지(`GraphEdge`: 경로, kind별 dash, traced·dimmed, 흐름 움직임)가 없다.
// TokenGraph의 wire는 DOM을 재서 그리는 가로 곡선 하나뿐이다.
import type { Edge } from "../data";

export const pathOf = (e: Edge) => {
  const [x1, y1] = e.a;
  const [x2, y2] = e.b;
  if (e.kind === "register") {
    const mx = (x1 + x2) / 2;
    return `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const dy = (y2 - y1) * 0.5;
  return `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
};

export type EdgeLook = "base" | "traced" | "dimmed" | "hidden";

export interface EdgeLayerProps {
  /** 이 맥락에서 꺼진 확장의 엣지(이어 그려도 점선). */
  ghost?: (e: Edge) => boolean;
  edges: Edge[];
  lookOf: (e: Edge) => EdgeLook;
  /** 흐름 움직임을 줄 엣지(보유 주도, 재생 중 핸들러). */
  flowing?: (e: Edge) => boolean;
  w: number;
  h: number;
}

const dash: Partial<Record<Edge["kind"], string>> = {
  post: "0.5 4",
  register: "3 3",
  "cap-missing": "2 3",
};

export function EdgeLayer({ edges, lookOf, flowing, ghost, w, h }: EdgeLayerProps) {
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      {edges.map((e) => {
        const look = lookOf(e);
        if (look === "hidden") return null;
        const flow = flowing?.(e) === true;
        const width =
          e.kind === "drive" ? 2.25 : e.kind === "fire" ? 8 : e.kind === "post" ? 1.75 : 1.25;
        const da =
          ghost?.(e) === true
            ? "3 3"
            : e.kind === "cap" && e.optional === true
              ? "5 3"
              : dash[e.kind];
        const stroke =
          look === "traced" || flow
            ? e.kind === "drive"
              ? "stroke-text-primary"
              : "stroke-text-secondary"
            : e.kind === "fire"
              ? "stroke-neutral-track"
              : e.kind === "drive"
                ? "stroke-text-tertiary"
                : "stroke-border-strong";
        return (
          <g
            key={e.id}
            className={`transition-opacity duration-quick ${look === "dimmed" ? "opacity-15" : look === "base" ? (e.kind === "on" || e.kind === "post" ? "opacity-40" : "opacity-70") : ""}`}
          >
            <path
              id={`edge-${e.id}`}
              d={pathOf(e)}
              fill="none"
              strokeWidth={width}
              strokeLinecap="round"
              strokeDasharray={flow ? "6 5" : da}
              className={`${stroke} ${flow ? "animate-[edge-flow_0.9s_linear_infinite]" : ""}`}
            />
            {e.kind === "cap-missing" && (
              <>
                <line
                  x1={e.b[0] - 3}
                  y1={e.b[1] - 3}
                  x2={e.b[0] + 3}
                  y2={e.b[1] + 3}
                  className="stroke-text-tertiary"
                  strokeWidth={1.25}
                />
                <line
                  x1={e.b[0] - 3}
                  y1={e.b[1] + 3}
                  x2={e.b[0] + 3}
                  y2={e.b[1] - 3}
                  className="stroke-text-tertiary"
                  strokeWidth={1.25}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** 엣지를 따라 한 번 움직이는 점: 단계 경계의 주도 교대·켜기를 보인다(CSS offset-path). */
export function Pulse({ edge, reverse }: { edge: Edge; reverse?: boolean }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 size-2.5 rounded-full bg-text-primary shadow-[0_0_0_3px_var(--cs-color-bg-app)]"
      style={{
        offsetPath: `path("${pathOf(edge)}")`,
        animation: `pulse-run 2.4s ease-in-out infinite${reverse === true ? " reverse" : ""}`,
      }}
    />
  );
}
