import type {
  CompositionDecl,
  PhaseNodeDecl,
  PhaseTransitionDecl,
} from "@fresnel/contracts/extensions";
import { TRANSITIONS } from "./phase.ts";
import type { HelmPhase } from "./state.ts";

/** 단계 노드. 표시 순서이고 시작 노드는 idle이다. 전이는 TRANSITIONS에서 만든다 */
const PHASE_NODES: readonly { readonly id: HelmPhase; readonly title: string }[] = [
  { id: "idle", title: "대기" },
  { id: "diverge", title: "발산" },
  { id: "explore", title: "다른 분야 탐색" },
  { id: "converge", title: "수렴" },
  { id: "apply", title: "적용" },
];

/**
 * 구성 선언(X-16, F.extensions.spec §3.1.2). setupHelm이 등록하는 블록을 적는다. 런타임은 setup 코드가 정하고
 * 이 선언은 읽기용 설계 모델이다. 블록 id와 stage는 설명용 이름이다.
 */
export const helmComposition: CompositionDecl = {
  blocks: [
    {
      id: "input-lens",
      stage: "inject",
      op: "on",
      title: "관점 주입",
      summary: "탐구 단계에 맞는 관점과 방법을 시스템 프롬프트에 더한다",
      hooks: ["input.agent.before"],
    },
    {
      id: "write-guard",
      stage: "guard",
      op: "on",
      title: "쓰기 거부",
      summary: "확산 단계의 쓰기 도구 호출을 실행 전에 거부한다",
      hooks: ["tool.call.before"],
    },
    {
      id: "tool-observe",
      stage: "observe",
      op: "on",
      title: "신호 집계",
      summary: "도구 결과로 막힘, 반복, 분야 밖 신호를 메모리에 센다",
      hooks: ["tool.execution.after"],
    },
    {
      id: "signal-settle",
      stage: "signal",
      op: "on",
      title: "신호 판정",
      summary: "turn이 정착할 때 신호를 기록하고 제안 알림이나 탐구 요청을 만든다",
      hooks: ["boundary.settle.after"],
      produces: [
        { kind: "record", recordKind: "grp.helm.signal.detected" },
        { kind: "post" },
        { kind: "state" },
      ],
    },
    {
      id: "restore",
      stage: "restore",
      op: "on",
      title: "상태 복원 확인",
      summary: "재개할 때 상태가 일관되지 않으면 초기화하고 종료를 기록한다",
      hooks: ["thread.start"],
      produces: [{ kind: "record", recordKind: "grp.helm.inquiry.finished" }, { kind: "state" }],
    },
    {
      id: "lease-rejected",
      stage: "lease",
      op: "on",
      title: "임대 거부",
      summary: "이 그룹의 임대 요청이 거부되면 대기 요청을 지우고 알린다",
      hooks: ["lifecycle.lease.rejected"],
      produces: [{ kind: "post" }, { kind: "state" }],
    },
    {
      id: "command",
      stage: "command",
      op: "register",
      title: "/helm 명령",
      summary: "start, stop, status 하위 명령. 결과는 알림으로 남긴다",
      produces: [{ kind: "post" }, { kind: "state" }],
    },
    {
      id: "methods",
      stage: "method",
      op: "register",
      title: "확장 메서드",
      summary: "status, inquiries, findings. 모두 읽기 전용이다",
    },
    {
      id: "drive",
      stage: "drive",
      op: "drive",
      title: "탐구 구동",
      summary: "단계 머신이다: 발산 turn, 렌즈 탐색, 수렴, 적용 turn",
      consumes: ["knowledge.search", "knowledge.memory", "web.search", "work.tasks"],
      produces: [
        { kind: "record", recordKind: "grp.helm.discovery.recorded" },
        { kind: "record", recordKind: "grp.helm.inquiry.finished" },
        { kind: "post" },
        { kind: "state" },
      ],
    },
  ],
  phases: {
    initial: "idle",
    nodes: PHASE_NODES.map((node): PhaseNodeDecl => ({
      id: node.id,
      kind: "phase",
      title: node.title,
    })),
    transitions: TRANSITIONS.map((row): PhaseTransitionDecl => ({
      from: row.from,
      to: row.to,
      event: row.on,
    })),
  },
};
