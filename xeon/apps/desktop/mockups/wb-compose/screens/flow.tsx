// 흐름 캔버스(구성기 2): drive 블록의 단계 머신을 위에서 아래로 그린다. 노드 = 단계(커밋된 phase 하나), 선 = 전이.
// 탐색 단계는 렌즈마다 자식 에이전트를 펼치고 모으기에서 합친다. 쓰기 거부 구간은 가드가 켜지는 단계(확산·탐색)를 덮는 면이다.
// 오른쪽 "끝" 노드는 대기로 돌아가는 결과. 선은 주 흐름과 고른 단계의 나가는 길만 그린다(전이 이름표 없음).
// 상태: Helm 보기, lens-review 편집(사람 확인 노드에 포트를 잇는 중), Helm 테스트 실행(현재 단계, 렌즈, 가드 발화, 기록).
import {
  Button,
  GraphNode,
  GraphPort,
  NodeGraph,
  Timeline,
  TimelineItem,
  type GraphEdge,
  type GraphNodeState,
  type GraphWireState,
} from "@caustic/react";
import { useEffect, useState } from "react";
import { BAR_INSET, T } from "../../_shell";
import { lenses, trialSteps } from "../fixtures";
import { CanvasHost, ColumnHead, blockClass } from "../parts/canvas";
import { useMock } from "../store";

const CX = 230; // 가운데 열 왼쪽
const NW = 230; // 단계 노드 폭
const Y = { idle: 40, diverge: 140, explore: 240, lens: 356, join: 470, converge: 560, apply: 660 };
const GATE = { x: 540, y: 610 };
const END = ["applied", "stopped", "limit", "failed", "empty"] as const;
const END_LABEL: Record<(typeof END)[number], string> = {
  applied: "적용함",
  stopped: "멈춤",
  limit: "한도",
  failed: "실패",
  empty: "발견 없음",
};
/** 단계별 나가는 길(끝 노드로). 고른 단계의 것만 선으로 그린다. */
const EXITS: { from: string; to: (typeof END)[number] }[] = [
  { from: "diverge:exit", to: "stopped" },
  { from: "explore:exit", to: "failed" },
  { from: "explore:limit", to: "limit" },
  { from: "converge:exit", to: "empty" },
];

function In({ id }: { id: string }) {
  return (
    <GraphPort portId={`${id}:in`} side="top" state="connected">
      <span className="sr-only">들어옴</span>
    </GraphPort>
  );
}
function Out({ id, state = "connected" }: { id: string; state?: "connected" | "active" }) {
  return (
    <GraphPort portId={`${id}:out`} side="bottom" state={state}>
      <span className="sr-only">다음</span>
    </GraphPort>
  );
}
function Exit({ id, label }: { id: string; label: string }) {
  return (
    <GraphPort portId={id} side="end" state="connected">
      <span className="text-text-tertiary">{label}</span>
    </GraphPort>
  );
}

export function FlowCanvas() {
  const m = useMock();
  const edit = m.group === "lens-review";
  const trial = m.trial;
  const gate = m.gateAdded;
  const H = Y.apply + 90;
  const W = trial ? 1100 : 840;

  // 테스트 실행: 지금 탐색. 확산까지 지났고 렌즈 셋이 돌고 있다.
  const st = (id: string): GraphNodeState => {
    if (!trial) return "idle";
    if (id === "idle" || id === "diverge") return "done";
    if (id === "explore") return "active";
    return "dimmed";
  };
  const lensState = (s: string): GraphNodeState =>
    !trial
      ? "idle"
      : s === "running"
        ? "active"
        : s === "done"
          ? "done"
          : s === "failed"
            ? "failed"
            : "dimmed";
  const wire = (done: boolean): GraphWireState => (!trial ? "idle" : done ? "done" : "muted");
  const sel = m.selected;
  /** 나가는 길(끝으로)은 고른 단계에만 포트와 선을 그린다. */
  const showExits = (id: string) => !trial && sel === id;

  const edges: GraphEdge[] = [
    { from: "idle:out", to: "diverge:in", state: wire(true) },
    { from: "diverge:out", to: "explore:in", state: wire(true) },
    ...lenses.map((l) => ({
      from: "explore:out",
      to: `lens-${l.id}:in`,
      state: trial
        ? l.status === "failed"
          ? ("invalid" as const)
          : l.status === "running"
            ? ("active" as const)
            : ("done" as const)
        : ("idle" as const),
    })),
    ...lenses.map((l) => ({
      from: `lens-${l.id}:out`,
      to: "join:in",
      state: trial
        ? l.status === "done"
          ? ("done" as const)
          : ("muted" as const)
        : ("idle" as const),
    })),
    { from: "join:out", to: "converge:in", state: wire(false) },
    // 편집 중(S5): 수렴 → 적용 선을 떼어 사람 확인 노드로 끌고 있다.
    ...(gate ? [] : [{ from: "converge:out", to: "apply:in", state: wire(false) }]),
    ...(trial
      ? []
      : EXITS.filter((e) => e.from.startsWith(`${sel ?? ""}:`)).map((e) => ({
          from: e.from,
          to: `end:${e.to}`,
          dashed: true,
        }))),
  ];

  const draft = m.draft ? { from: "converge:out", to: { x: GATE.x + 105, y: GATE.y - 2 } } : null;
  const pick = (id: string) => ({
    selected: sel === id,
    onClick: () => m.set({ selected: id }),
  });

  return (
    <CanvasHost width={W} height={H} minScale={0.6}>
      <NodeGraph
        aria-label={`${edit ? "lens-review" : "helm"} 단계 머신`}
        width={W}
        height={H}
        edges={edges}
        draft={draft}
      >
        {/* 쓰기 거부 구간: 확산·탐색 단계와 그 자식 */}
        <div
          aria-label="쓰기 거부 구간"
          className="absolute rounded-xl border border-border-subtle bg-neutral-soft/40"
          style={{ left: 24, top: Y.diverge - 24, width: 600, height: Y.join - Y.diverge - 4 }}
        >
          <div className="grid gap-0.5 px-4 pt-3">
            <span className="text-footnote text-text-secondary">쓰기 거부</span>
            {trial && <span className="text-footnote text-text-tertiary">1번 막았어요</span>}
          </div>
        </div>

        <GraphNode
          x={CX}
          y={Y.idle}
          width={NW}
          className={blockClass({ flat: false })}
          title="대기"
          state={st("idle")}
        >
          <Out id="idle" />
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.diverge}
          width={NW}
          className={blockClass({ flat: false })}
          title="확산"
          state={st("diverge")}
          {...pick("diverge")}
        >
          <In id="diverge" />
          {showExits("diverge") && <Exit id="diverge:exit" label="중단" />}
          <Out id="diverge" />
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.explore}
          width={NW}
          className={blockClass({ flat: false })}
          title="탐색"
          state={st("explore")}
          {...pick("explore")}
        >
          <In id="explore" />
          {showExits("explore") && <Exit id="explore:exit" label="렌즈 모두 실패" />}
          {showExits("explore") && <Exit id="explore:limit" label="한도" />}
          <Out id="explore" state={trial ? "active" : "connected"} />
        </GraphNode>

        {lenses.map((l, i) => (
          <GraphNode
            key={l.id}
            x={60 + i * 186}
            y={Y.lens}
            width={170}
            className={blockClass({ flat: false })}
            title={l.title}
            meta={trial && l.status === "done" ? `${T.finding} ${l.findings}` : undefined}
            state={lensState(l.status)}
          >
            <GraphPort portId={`lens-${l.id}:in`} side="top" state="connected">
              <span className="sr-only">들어옴</span>
            </GraphPort>
            <GraphPort portId={`lens-${l.id}:out`} side="bottom" state="connected">
              <span className="sr-only">답</span>
            </GraphPort>
          </GraphNode>
        ))}

        <GraphNode
          x={CX}
          y={Y.join}
          width={NW}
          className={blockClass({ flat: false })}
          title="모으기"
          state={st("join")}
        >
          <In id="join" />
          <Out id="join" />
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.converge}
          width={NW}
          className={blockClass({ flat: false })}
          title="수렴"
          state={st("converge")}
          {...pick("converge")}
        >
          <In id="converge" />
          {showExits("converge") && <Exit id="converge:exit" label="발견 없음" />}
          <Out id="converge" state={m.draft ? "active" : "connected"} />
        </GraphNode>

        {gate && (
          <GraphNode
            x={GATE.x}
            y={GATE.y}
            width={210}
            className={blockClass({ flat: false })}
            title={T.humanGate}
            selected={sel === "gate"}
          >
            <GraphPort portId="gate:in" side="top" state={m.draft ? "target" : "connected"}>
              <span className="sr-only">들어옴</span>
            </GraphPort>
            <GraphPort portId="gate:out" side="bottom">
              <span className="sr-only">승인</span>
            </GraphPort>
          </GraphNode>
        )}

        <GraphNode
          x={CX}
          y={Y.apply}
          width={NW}
          className={blockClass({ flat: false })}
          title="적용"
          state={m.draft ? "dimmed" : st("apply")}
        >
          <In id="apply" />
        </GraphNode>

        <GraphNode
          x={660}
          y={Y.explore + 40}
          width={160}
          className={blockClass({ flat: false })}
          title="끝"
          state={trial ? "dimmed" : "idle"}
        >
          {END.map((k) => (
            <GraphPort key={k} portId={`end:${k}`} state="connected">
              <span>{END_LABEL[k]}</span>
            </GraphPort>
          ))}
        </GraphNode>

        {trial && <TrialLog x={870} />}
      </NodeGraph>
    </CanvasHost>
  );
}

/** 테스트 기록: caustic Timeline(새것이 위). */
function TrialLog({ x }: { x: number }) {
  return (
    <div className="absolute grid gap-4" style={{ left: x, top: 0, width: 230 }}>
      <div className={BAR_INSET}>
        <ColumnHead title="기록" />
      </div>
      <Timeline aria-label={`${T.trial} 기록`} size="sm">
        {[...trialSteps].reverse().map((s) => (
          <TimelineItem
            key={s.label}
            author="system"
            title={s.label}
            time={s.at}
            running={!s.done}
          />
        ))}
      </Timeline>
    </div>
  );
}

/** 테스트 실행 띠: 캔버스 위 한 줄. 테스트 대화와 경과, 멈춤, 한 경계씩, 다시 돌려 검사, 테스트 결과. */
export function TrialBar() {
  const m = useMock();
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setT((v) => (v + 1) % 1000), 1000);
    return () => window.clearInterval(id);
  }, [paused]);
  return (
    <div
      className={`flex min-w-0 flex-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${BAR_INSET}`}
    >
      <span className="text-body text-text-primary">
        {T.trialThread}
        <span className="ms-2 text-footnote text-text-tertiary tabular-nums">
          1:{String(12 + (t % 48)).padStart(2, "0")}
        </span>
      </span>
      <span className="ms-auto flex items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? "이어서" : "멈춤"}
        </Button>
        <Button size="xs" variant="outline" onClick={() => m.notify("다음 단계 경계까지 돌려요")}>
          한 경계씩
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => m.notify("이 테스트 대화로 다시 돌려 검사를 열어요")}
        >
          {T.replay}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => m.notify("테스트 실행 화면에서 결과를 보여요")}
        >
          테스트 결과
        </Button>
      </span>
    </div>
  );
}
