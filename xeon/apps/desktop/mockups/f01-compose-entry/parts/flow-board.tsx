// 흐름 판: drive 블록의 단계 머신을 위에서 아래로 그린다. 노드 = 커밋된 단계 하나, 선 = 전이. f01(사람 확인 노드)과 f02(테스트 실행)가 함께 쓴다.
// 진행은 now 하나로 그린다: 지금 단계 앞은 지남(done), 지금은 강조(active), 뒤는 아직(dimmed). 테스트이면 now는 trial.phase의 값이다.
// 멈춤 표지(marker)는 멈출 노드 오른쪽에 붙인다(노드 높이를 바꾸지 않는다). holding이면 now 노드에 도착해 멈춘 모습이다(돌지 않음).
// wb-compose의 FlowCanvas는 store와 "런타임에 없음" 배지에 묶여 있어, 겉모양(blockClass)·호스트(CanvasHost)·렌즈 데이터만 가져왔다.
import {
  GraphNode,
  GraphPort,
  NodeGraph,
  type GraphEdge,
  type GraphNodeState,
  type GraphWireState,
} from "@caustic/react";
import type { ReactNode } from "react";
import { Pause, T } from "../../_shell";
import { StatusDot } from "../../_wb-c/parts";
import type { Lens } from "../../wb-compose/fixtures";
import { CanvasHost, blockClass } from "../../wb-compose/parts/canvas";

export type PhaseId = "idle" | "diverge" | "explore" | "join" | "converge" | "gate" | "apply";
export type GateState = "absent" | "idle" | "waiting" | "answered";

/** Helm 단계 이름(그룹이 선언하는 값이라 용어 표에 두지 않는다). */
export const PHASE_LABEL: Record<PhaseId, string> = {
  idle: "대기",
  diverge: "확산",
  explore: "탐색",
  join: "모으기",
  converge: "수렴",
  gate: T.humanGate,
  apply: "적용",
};

const END = ["applied", "stopped", "limit", "failed", "empty"] as const;
type EndId = (typeof END)[number];
const END_LABEL: Record<EndId, string> = {
  applied: "적용함",
  stopped: T.trialPause,
  limit: "한도",
  failed: "실패",
  empty: "발견 없음",
};
const EXITS: Record<string, { port: string; label: string; to: EndId }[]> = {
  diverge: [{ port: "exit", label: "중단", to: "stopped" }],
  explore: [
    { port: "exit", label: "렌즈 모두 실패", to: "failed" },
    { port: "limit", label: "한도", to: "limit" },
  ],
  converge: [{ port: "exit", label: "발견 없음", to: "empty" }],
};

export interface FlowMarker {
  at: PhaseId;
  text: string;
  /** 아직 도착 전(멈추는 중). 아이콘 없이 연한 글자. */
  pending?: boolean;
  danger?: boolean;
}

export interface FlowBoardProps {
  label: string;
  mode: "edit" | "trial";
  now?: PhaseId | null;
  /** now 노드에 도착해 멈춘 모습. */
  holding?: boolean;
  /** 흐름을 끝까지 돌았다. 끝 노드의 값 하나가 켜진다. */
  finished?: boolean;
  gate?: GateState;
  lenses: readonly Lens[];
  guardHits?: number;
  marker?: FlowMarker | null;
  selected?: string | null;
  onSelect?: (id: string) => void;
}

/** 편집은 오른쪽에 끝 노드(결과 다섯)를 두고, 테스트는 계기 열에 폭을 내주려고 끝을 맨 아래 노드 하나로 접는다. */
const GEOM = {
  edit: { W: 840, CX: 190, lensX: 9, lensW: 188, lensGap: 14, guardW: 624 },
  trial: { W: 520, CX: 145, lensX: 8, lensW: 160, lensGap: 12, guardW: 520 },
};
const NW = 230;
const STEP = 68;
/** 탐색 → 렌즈, 렌즈 → 모으기 사이를 넓혀 선이 곡선으로 엉키지 않게 한다. */
const LENS_TOP = 88;
const LENS_H = 104;

export function FlowBoard({
  label,
  mode,
  now = null,
  holding = false,
  finished = false,
  gate = "absent",
  lenses,
  guardHits = 0,
  marker = null,
  selected = null,
  onSelect,
}: FlowBoardProps) {
  const trial = mode === "trial";
  const { W, CX, lensX, lensW, lensGap, guardW } = GEOM[mode];
  const hasGate = gate !== "absent";
  const order: PhaseId[] = hasGate
    ? ["idle", "diverge", "explore", "join", "converge", "gate", "apply"]
    : ["idle", "diverge", "explore", "join", "converge", "apply"];
  const nowIdx = now === null ? -1 : order.indexOf(now);
  const idx = (id: PhaseId) => order.indexOf(id);

  const Y: Record<PhaseId, number> = {
    idle: 0,
    diverge: STEP,
    explore: STEP * 2,
    join: STEP * 2 + LENS_TOP + LENS_H,
    converge: STEP * 3 + LENS_TOP + LENS_H,
    gate: STEP * 4 + LENS_TOP + LENS_H,
    // 사람 확인 노드는 둘째 줄이 있어 다음 노드와 띄운다.
    apply: (hasGate ? STEP * 5 + 14 : STEP * 4) + LENS_TOP + LENS_H,
  };
  const H = Y.apply + (trial ? STEP + 48 : 72);

  const st = (id: PhaseId): GraphNodeState => {
    if (!trial) return "idle";
    if (finished) return "done";
    const i = idx(id);
    if (i < nowIdx) return "done";
    if (i === nowIdx) return holding ? "idle" : "active";
    return "dimmed";
  };
  const lensState = (s: Lens["status"]): GraphNodeState => {
    if (!trial) return "idle";
    if (nowIdx < idx("explore") && !finished) return "dimmed";
    if (s === "running") return "active";
    if (s === "failed") return "failed";
    if (s === "done") return "done";
    return "dimmed";
  };
  /** from에서 나가는 선. */
  const wire = (from: PhaseId): GraphWireState => {
    if (!trial) return "idle";
    if (finished) return "done";
    const i = idx(from);
    if (i < nowIdx) return "done";
    if (i === nowIdx && !holding && from !== "explore") return "active";
    return "muted";
  };

  const main: GraphEdge[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    const from = order[i];
    const to = order[i + 1];
    if (from === undefined || to === undefined || from === "explore") continue;
    main.push({ from: `${from}:out`, to: `${to}:in`, state: wire(from) });
  }
  const exits = trial || selected === null ? [] : (EXITS[selected] ?? []);
  const edges: GraphEdge[] = [
    ...main,
    ...lenses.map((l): GraphEdge => ({
      from: "explore:out",
      to: `lens-${l.id}:in`,
      state: !trial
        ? "idle"
        : nowIdx < idx("explore") && !finished
          ? "muted"
          : l.status === "failed"
            ? "invalid"
            : l.status === "running" && nowIdx === idx("explore")
              ? "active"
              : "done",
    })),
    ...lenses.map((l): GraphEdge => ({
      from: `lens-${l.id}:out`,
      to: "join:in",
      state: !trial
        ? "idle"
        : finished || (nowIdx > idx("explore") && l.status !== "failed")
          ? "done"
          : "muted",
    })),
    ...exits.map((e): GraphEdge => ({
      from: `${selected}:${e.port}`,
      to: `end:${e.to}`,
      dashed: true,
    })),
  ];
  edges.push(
    trial
      ? { from: "apply:out", to: "end:in", state: finished ? "done" : wire("apply") }
      : { from: "apply:exit", to: "end:applied" },
  );

  const pick = (id: string) =>
    onSelect === undefined
      ? {}
      : {
          selected: selected === id,
          onClick: () => onSelect(id),
          onKeyDown: (e: { key: string }) => {
            if (e.key === "Enter" || e.key === " ") onSelect(id);
          },
        };

  const phase = (id: PhaseId, children?: ReactNode) => {
    const state = st(id);
    return (
      <GraphNode
        key={id}
        x={CX}
        y={Y[id]}
        width={NW}
        className={blockClass({ flat: false })}
        title={PHASE_LABEL[id]}
        state={state}
        {...pick(id)}
        selected={selected === id || (holding && now === id)}
      >
        {id !== "idle" && (
          <GraphPort portId={`${id}:in`} side="top" state="connected">
            <span className="sr-only">들어옴</span>
          </GraphPort>
        )}
        {children}
        {selected === id &&
          !trial &&
          (EXITS[id] ?? []).map((e) => (
            <GraphPort key={e.port} portId={`${id}:${e.port}`} side="end" state="connected">
              <span className="text-text-tertiary">{e.label}</span>
            </GraphPort>
          ))}
        {!trial && id === "apply" ? (
          <GraphPort portId="apply:exit" side="end" state="connected" className="h-0 min-h-0">
            <span className="sr-only">{END_LABEL.applied}</span>
          </GraphPort>
        ) : (
          <GraphPort
            portId={`${id}:out`}
            side="bottom"
            state={state === "active" ? "active" : "connected"}
          >
            <span className="sr-only">다음</span>
          </GraphPort>
        )}
      </GraphNode>
    );
  };

  return (
    <CanvasHost width={W} height={H} minScale={0.6}>
      <NodeGraph aria-label={label} width={W} height={H} edges={edges}>
        <div
          aria-label={`${T.writeGuard} 구간`}
          className="absolute rounded-xl border border-border-subtle bg-neutral-soft/40"
          style={{ left: 0, top: Y.diverge - 16, width: guardW, height: Y.join - Y.diverge - 4 }}
        >
          <div className="grid gap-0.5 px-4 pt-3">
            <span className="text-footnote text-text-secondary">{T.writeGuard}</span>
            {trial && guardHits > 0 && (
              <span className="text-footnote text-text-tertiary tabular-nums">
                {guardHits}번 막았어요
              </span>
            )}
          </div>
        </div>

        {marker !== null && (
          <div className="absolute" style={{ left: CX + NW + 10, top: Y[marker.at] + 9 }}>
            <Marker m={marker} />
          </div>
        )}

        {phase("idle")}
        {phase("diverge")}
        {phase("explore")}

        {lenses.map((l, i) => {
          const state = lensState(l.status);
          return (
            <GraphNode
              key={l.id}
              x={lensX + i * (lensW + lensGap)}
              y={Y.explore + LENS_TOP}
              width={lensW}
              className={blockClass({ flat: false })}
              title={l.title}
              state={state}
              {...(trial && l.status === "done" && l.findings !== undefined
                ? { meta: `${T.finding} ${l.findings}` }
                : {})}
            >
              <GraphPort portId={`lens-${l.id}:in`} side="top" state="connected">
                <span className="sr-only">들어옴</span>
              </GraphPort>
              {trial && l.tool !== undefined && state !== "dimmed" && (
                <span
                  className={`truncate text-footnote ${l.status === "failed" ? "text-danger-text" : "text-text-tertiary"}`}
                >
                  {l.tool}
                </span>
              )}
              <GraphPort portId={`lens-${l.id}:out`} side="bottom" state="connected">
                <span className="sr-only">답</span>
              </GraphPort>
            </GraphNode>
          );
        })}

        {phase("join")}
        {phase("converge")}
        {hasGate &&
          phase(
            "gate",
            gate === "waiting" ? (
              <span className="flex items-center gap-1.5 text-footnote text-warning-text">
                <StatusDot tone="warning" />
                {"답을 기다려요"}
              </span>
            ) : gate === "answered" ? (
              <span className="text-footnote text-text-tertiary">{"답했어요"}</span>
            ) : undefined,
          )}
        {phase("apply")}

        {trial ? (
          <GraphNode
            x={CX}
            y={Y.apply + STEP}
            width={NW}
            className={blockClass({ flat: false })}
            title={T.stageDone}
            state={finished ? "done" : "dimmed"}
            {...(finished ? { meta: END_LABEL.applied } : {})}
          >
            <GraphPort portId="end:in" side="top" state="connected">
              <span className="sr-only">들어옴</span>
            </GraphPort>
          </GraphNode>
        ) : (
          <GraphNode
            x={660}
            y={Y.converge - STEP}
            width={160}
            className={blockClass({ flat: false })}
            title={T.stageDone}
            state="idle"
          >
            {END.map((k) => (
              <GraphPort key={k} portId={`end:${k}`} state="connected">
                <span className="text-text-tertiary">{END_LABEL[k]}</span>
              </GraphPort>
            ))}
          </GraphNode>
        )}
      </NodeGraph>
    </CanvasHost>
  );
}

function Marker({ m }: { m: FlowMarker }) {
  if (m.danger === true)
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-footnote text-danger-text">
        <StatusDot tone="danger" />
        {m.text}
      </span>
    );
  if (m.pending === true)
    return <span className="whitespace-nowrap text-footnote text-text-tertiary">{m.text}</span>;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-footnote text-text-primary">
      <Pause aria-hidden className="size-icon-xs flex-none" />
      {m.text}
    </span>
  );
}
