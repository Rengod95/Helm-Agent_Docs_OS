// 흐름 캔버스(구성기 2): drive 블록의 단계 머신을 위에서 아래로 그린다. 노드 = 단계(커밋된 phase 하나), 선 = 전이 조건.
// drive 함수는 단계 하나를 처리하고 커밋한 뒤 반환하고, X가 마지막 커밋 상태로 다시 부른다(L3.helm §4.5). 그래서 모든 선은
// 단계 경계(◇)를 지난다. explore는 렌즈마다 loop.spawn(explorer)을 펼치고 모으기에서 합친다. 쓰기 거부 구간은 tool.call.before
// 가드가 켜지는 단계(diverge·explore)를 덮는 면이다. 오른쪽 "끝" 노드는 idle로 돌아가는 결과(applied, stopped, limit, failed, empty).
// 상태: Helm 보기, lens-review 편집(사람 확인 노드에 포트를 잇는 중), Helm 테스트 실행(현재 단계, 렌즈, 가드 발화).
import {
  Badge,
  Button,
  GraphNode,
  GraphPort,
  NodeGraph,
  Progress,
  type GraphEdge,
  type GraphNodeState,
  type GraphWireState,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Circle,
  Component,
  Diamond,
  FlaskConical,
  Hand,
  LoaderCircle,
  MessageSquare,
  Pause,
  Play,
  Search,
  Shield,
  Stop,
  ToneIcon,
  User,
} from "../../_shell";
import { lenses, trialSteps } from "../fixtures";
import { BandLabel, CanvasHost } from "../parts/canvas";
import { useMock } from "../store";

const CX = 210; // 가운데 열 왼쪽
const NW = 230; // 단계 노드 폭
const Y = { idle: 56, diverge: 148, explore: 256, lens: 372, join: 486, converge: 578, apply: 676 };
const GATE = { x: 520, y: 626 };

function B({ children }: { children: ReactNode }) {
  // 단계 경계 표시가 붙은 전이 이름
  return (
    <span className="inline-flex items-center gap-1">
      <Diamond aria-hidden className="size-2.5 text-text-tertiary" />
      {children}
    </span>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-ui-xs">
      <span className="flex-none text-text-tertiary">{k}</span>
      <span className="min-w-0 truncate text-text-primary">{v}</span>
    </div>
  );
}

export function FlowCanvas() {
  const m = useMock();
  const edit = m.group === "lens-review";
  const trial = m.trial;
  const gate = m.gateAdded;
  const applyY = Y.apply;
  const H = applyY + 84;
  const W = trial ? 1040 : 820;

  // 테스트 실행: 지금 explore. diverge까지 지났고 렌즈 셋이 돌고 있다.
  const st = (id: string): GraphNodeState => {
    if (!trial) return m.selected === id ? "idle" : "idle";
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
  const wire = (done: boolean, active = false): GraphWireState =>
    !trial ? "idle" : active ? "active" : done ? "done" : "muted";

  const edges: GraphEdge[] = [
    { from: "idle:out", to: "diverge:in", state: wire(true), label: <B>leaseGranted · pending</B> },
    { from: "diverge:out", to: "explore:in", state: wire(true), label: <B>diverged</B> },
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
    { from: "join:out", to: "converge:in", state: wire(false), label: <B>explored · done ≥ 1</B> },
    // 편집 중(S5): converge → apply 선을 떼어 사람 확인 노드로 끌고 있다. 아직 이어진 선이 없다.
    ...(gate
      ? []
      : [
          {
            from: "converge:out",
            to: "apply:in",
            state: wire(false),
            label: <B>converged · 발견 ≥ 1</B>,
          },
        ]),
    // 끝(idle)으로
    { from: "diverge:exit", to: "end:stopped", dashed: true, state: wire(false) },
    { from: "explore:exit", to: "end:failed", dashed: true, state: wire(false) },
    { from: "explore:limit", to: "end:limit", dashed: true, state: wire(false) },
    { from: "converge:exit", to: "end:empty", dashed: true, state: wire(false) },
    { from: "apply:exit", to: "end:applied", state: wire(false) },
  ];

  const draft = m.draft ? { from: "converge:out", to: { x: GATE.x + 105, y: GATE.y - 2 } } : null;

  return (
    <CanvasHost width={W} height={H} minScale={0.6}>
      <NodeGraph
        aria-label={edit ? "lens-review 단계 머신" : "helm 단계 머신"}
        width={W}
        height={H}
        edges={edges}
        draft={draft}
      >
        <div className="absolute" style={{ left: 0, top: 0 }}>
          <BandLabel layer="L3">
            {edit ? "lens-review" : "helm"} drive · 주도 상한 턴 4 · spawn {edit ? 6 : 8} · 토큰{" "}
            {edit ? "200k" : "400k"}
          </BandLabel>
        </div>
        <div
          className="absolute flex items-center gap-1 text-ui-xs text-text-tertiary"
          style={{ left: 0, top: 20 }}
        >
          <Diamond aria-hidden className="size-2.5" />
          단계 경계: 커밋하고 반환하면 X가 새 상태로 다시 불러요
        </div>

        {/* 쓰기 거부 구간: diverge·explore 단계와 그 자식(subagent:explorer) */}
        <div
          aria-label="쓰기 거부 구간"
          className="absolute rounded-xl bg-neutral-well/70"
          style={{ left: 16, top: Y.diverge - 20, width: 580, height: Y.join - Y.diverge - 4 }}
        >
          <div className="grid w-44 gap-0.5 px-2.5 pt-2 text-ui-xs">
            <span className="inline-flex items-center gap-1.5 text-text-secondary">
              <Shield aria-hidden className="size-icon-xs text-text-tertiary" />
              쓰기 거부
            </span>
            <span className="text-text-tertiary">tool.call.before · first</span>
            <span className="text-text-tertiary">main · subagent:explorer</span>
            {trial && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-xs bg-surface-base py-0.5 ps-0.5 pe-1.5 text-text-primary shadow-1">
                <ToneIcon tone="warning">
                  <Shield />
                </ToneIcon>
                거부 1 · bash · exec
              </span>
            )}
          </div>
        </div>

        <GraphNode
          x={CX}
          y={Y.idle}
          width={NW}
          title="idle"
          meta="신호 대기"
          icon={<Circle />}
          state={st("idle")}
        >
          <p className="m-0 text-ui-xs text-text-tertiary">
            pending이 없으면 효과 없이 반환 · 주도 반납
          </p>
          <GraphPort portId="idle:out" side="bottom" state="connected">
            <span className="sr-only">다음</span>
          </GraphPort>
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.diverge}
          width={NW}
          title="diverge"
          meta="턴 1"
          icon={<MessageSquare />}
          iconTone="accent"
          state={st("diverge")}
          selected={m.selected === "diverge"}
          onClick={() => m.set({ selected: "diverge" })}
        >
          <GraphPort portId="diverge:in" side="top" state="connected">
            <span className="sr-only">들어옴</span>
          </GraphPort>
          <Row k="효과" v="loop.turn 1회 · 발산 프롬프트" />
          <GraphPort portId="diverge:exit" side="end">
            <span className="text-text-tertiary">aborted · error · 턴 0</span>
          </GraphPort>
          <GraphPort portId="diverge:out" side="bottom" state="connected">
            <span className="sr-only">완료</span>
          </GraphPort>
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.explore}
          width={NW}
          title="explore"
          meta={trial ? "spawn 3/8" : "spawn 3"}
          icon={<Component />}
          iconTone="agent"
          state={st("explore")}
          selected={m.selected === "explore"}
          onClick={() => m.set({ selected: "explore" })}
        >
          <GraphPort portId="explore:in" side="top" state="connected">
            <span className="sr-only">들어옴</span>
          </GraphPort>
          <Row k="효과" v="렌즈마다 loop.spawn(explorer) 병렬" />
          <GraphPort portId="explore:exit" side="end">
            <span className="text-text-tertiary">모든 렌즈 실패</span>
          </GraphPort>
          <GraphPort portId="explore:limit" side="end">
            <span className="text-text-tertiary">spawn 0</span>
          </GraphPort>
          <GraphPort portId="explore:out" side="bottom" state={trial ? "active" : "connected"}>
            <span className="sr-only">펼치기</span>
          </GraphPort>
        </GraphNode>

        {lenses.map((l, i) => (
          <GraphNode
            key={l.id}
            x={40 + i * 180}
            y={Y.lens}
            width={168}
            title={l.title}
            meta={trial && l.status === "done" ? `발견 ${l.findings}` : undefined}
            icon={
              trial && l.status === "running" ? (
                <LoaderCircle className="animate-spinner" />
              ) : (
                <User />
              )
            }
            iconTone={trial && l.status === "failed" ? "danger" : "agent"}
            state={lensState(l.status)}
          >
            <GraphPort portId={`lens-${l.id}:in`} side="top" state="connected">
              <span className="sr-only">들어옴</span>
            </GraphPort>
            <p className="m-0 truncate font-mono text-mono-sm text-text-tertiary">{l.id}</p>
            <p className="m-0 truncate text-ui-xs text-text-tertiary">
              {trial ? l.tool : "explorer · 읽기 도구만"}
            </p>
            <GraphPort portId={`lens-${l.id}:out`} side="bottom" state="connected">
              <span className="sr-only">답</span>
            </GraphPort>
          </GraphNode>
        ))}

        <GraphNode
          x={CX}
          y={Y.join}
          width={NW}
          title="모으기"
          meta="explored"
          icon={<Component />}
          state={st("join")}
        >
          <GraphPort portId="join:in" side="top" state="connected">
            <span className="sr-only">들어옴</span>
          </GraphPort>
          <p className="m-0 text-ui-xs text-text-tertiary">
            모두 done·failed·skipped면 · 부분 결과 허용
          </p>
          <GraphPort portId="join:out" side="bottom" state="connected">
            <span className="sr-only">다음</span>
          </GraphPort>
        </GraphNode>

        <GraphNode
          x={CX}
          y={Y.converge}
          width={NW}
          title="converge"
          meta="턴 0"
          icon={<Search />}
          state={st("converge")}
        >
          <GraphPort portId="converge:in" side="top" state="connected">
            <span className="sr-only">들어옴</span>
          </GraphPort>
          <Row k="읽기" v="web.search · knowledge.*" />
          <GraphPort portId="converge:exit" side="end">
            <span className="text-text-tertiary">발견 0</span>
          </GraphPort>
          <GraphPort portId="converge:out" side="bottom" state={m.draft ? "active" : "connected"}>
            <span className="sr-only">다음</span>
          </GraphPort>
        </GraphNode>

        {gate && (
          <GraphNode
            x={GATE.x}
            y={GATE.y}
            width={210}
            title="사람 확인"
            meta="gate"
            icon={<Hand />}
            iconTone="warning"
            selected={m.selected === "gate"}
          >
            <GraphPort portId="gate:in" side="top" state={m.draft ? "target" : "connected"}>
              <span className="sr-only">들어옴</span>
            </GraphPort>
            <p className="m-0 text-ui-xs text-text-tertiary">
              받은 요청으로 발견을 보이고 답을 기다려요
            </p>
            <div>
              <Badge size="sm" tone="warning" variant="soft">
                런타임에 없음
              </Badge>
            </div>
            <GraphPort portId="gate:exit" side="end">
              <span className="text-text-tertiary">거절</span>
            </GraphPort>
            <GraphPort portId="gate:out" side="bottom">
              <span className="sr-only">승인</span>
            </GraphPort>
          </GraphNode>
        )}

        <GraphNode
          x={CX}
          y={applyY}
          width={NW}
          title="apply"
          meta="턴 1"
          icon={<MessageSquare />}
          iconTone="accent"
          state={m.draft ? "dimmed" : st("apply")}
        >
          <GraphPort portId="apply:in" side="top" state={gate ? "idle" : "connected"}>
            <span className="sr-only">들어옴</span>
          </GraphPort>
          <Row k="효과" v="loop.turn 1회 · 발견 기록 · work.tasks" />
          <GraphPort portId="apply:exit" side="end" state="connected">
            <span className="text-text-tertiary">applied</span>
          </GraphPort>
        </GraphNode>

        <GraphNode
          x={630}
          y={Y.explore + 50}
          width={170}
          title="끝 → idle"
          meta="반납"
          icon={<Stop />}
          variant="solid"
          state={trial ? "dimmed" : "idle"}
        >
          {(["applied", "stopped", "limit", "failed", "empty"] as const).map((k) => (
            <GraphPort key={k} portId={`end:${k}`} state="connected">
              <span className="font-mono text-mono-sm">{k}</span>
            </GraphPort>
          ))}
          <p className="m-0 text-ui-xs text-text-tertiary">
            어느 단계든 stopRequested면 stopped · inquiry.finished 기록
          </p>
        </GraphNode>

        {trial && <TrialTimeline x={830} />}
      </NodeGraph>
    </CanvasHost>
  );
}

function TrialTimeline({ x }: { x: number }) {
  return (
    <div className="absolute grid gap-2" style={{ left: x, top: 0, width: 200 }}>
      <BandLabel layer="trial">경계 기록</BandLabel>
      <ol className="m-0 grid list-none gap-1.5 p-0 pt-6">
        {trialSteps.map((s) => (
          <li key={s.label + s.at} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-1.5">
            <span className="pt-1">
              {s.guard === true ? (
                <Shield aria-hidden className="size-3 text-text-secondary" />
              ) : s.done ? (
                <Diamond aria-hidden className="size-2.5 text-text-tertiary" />
              ) : (
                <LoaderCircle aria-hidden className="size-3 animate-spinner text-text-tertiary" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-ui-xs text-text-primary">{s.label}</span>
              <span className="block truncate text-ui-xs text-text-tertiary">
                {s.at} · {s.note}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 테스트 실행 띠: 캔버스 위 한 줄. 주도 사용량(턴·spawn·토큰), 멈춤, 경계마다 한 걸음, replay와 테스트 결과로. */
export function TrialBar() {
  const m = useMock();
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setT((v) => (v + 1) % 1000), 1000);
    return () => window.clearInterval(id);
  }, [paused]);
  const tokens = 120 + (t % 6) * 4;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 text-ui-xs">
      <span className="inline-flex items-center gap-1.5 text-text-primary">
        <FlaskConical aria-hidden className="size-icon-xs text-text-tertiary" />
        테스트: 렌즈 5개
        <span className="text-text-tertiary">
          helm · 1:{String(12 + (t % 48)).padStart(2, "0")}
        </span>
      </span>
      <Meter label="턴" v={1} max={4} />
      <Meter label="spawn" v={3} max={8} />
      <Meter label="토큰" v={tokens} max={400} unit="k" />
      <span className="ms-auto flex items-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          iconStart={paused ? <Play /> : <Pause />}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "이어서" : "멈춤"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => m.notify("다음 단계 경계까지 돌려요")}>
          한 경계씩
        </Button>
        <Button
          size="xs"
          variant="soft"
          onClick={() => m.notify("이 테스트 대화의 테이프로 replay를 열어요")}
        >
          replay로
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => m.notify("테스트 실행 화면에서 결과를 보여요")}
        >
          테스트 결과
        </Button>
      </span>
    </div>
  );
}

function Meter({
  label,
  v,
  max,
  unit = "",
}: {
  label: string;
  v: number;
  max: number;
  unit?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-text-tertiary">{label}</span>
      <Progress
        size="sm"
        value={(v / max) * 100}
        aria-label={`${label} ${v}/${max}`}
        className="w-14"
      />
      <span className="tabular-nums text-text-secondary">
        {v}
        {unit}/{max}
        {unit}
      </span>
    </span>
  );
}
