// cvF 관계 선(React Flow 사용자 엣지). 레일에 붙는 선(장면의 직각 선, 끝 기호 없음)과 헷갈리지 않게 곡선이고 끝에 도면 기호가 있다:
//   핸드오프 = 실선 + 찬 화살, 의존(requires → provides) = 짧은 점선 + 받는 쪽의 빈 원, 대체(replaces) = 사슬선 + 빈 마름모.
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import type { ReactNode } from "react";

export type RelationKind = "handoff" | "depends" | "replaces";

interface RelationEdgeData extends Record<string, unknown> {
  readonly kind: RelationKind;
  readonly label: string;
  /** 고른 노드에 닿는 선: 진하게, 이름표를 보인다 */
  readonly hot: boolean;
  /** 다른 노드를 골라 이 선이 물러난다 */
  readonly dim: boolean;
}

export type RelationEdge = Edge<RelationEdgeData, "relation">;

const MARKER: Readonly<Record<RelationKind, string>> = {
  handoff: "url(#cvf-m-arrow)",
  depends: "url(#cvf-m-circle)",
  replaces: "url(#cvf-m-diamond)",
};

function RelationEdgeView(props: EdgeProps<RelationEdge>): ReactNode {
  const data = props.data;
  if (data === undefined) return null;
  const [path, lx, ly] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.35,
  });
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={MARKER[data.kind]}
        className={`cvf-rel cvf-rel-${data.kind}`}
        data-hot={data.hot}
        data-dim={data.dim}
        interactionWidth={0}
      />
      <EdgeLabelRenderer>
        <span
          className="cvf-rel-label nodrag nopan"
          data-kind={data.kind}
          data-hot={data.hot}
          data-dim={data.dim}
          style={{ transform: `translate(-50%, -50%) translate(${String(lx)}px, ${String(ly)}px)` }}
        >
          {data.label}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

export const EDGE_TYPES: EdgeTypes = { relation: RelationEdgeView };
