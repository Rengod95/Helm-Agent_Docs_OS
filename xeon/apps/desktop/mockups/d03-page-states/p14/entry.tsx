// P-14 목표와 작업 목업 진입점. 대화 화면(P-02)의 오른쪽 well "작업" 탭이다(스펙 §4.3). 가운데는 그 대화(판정 행이 보이는 트랜스크립트).
// ?state=S1..S7(기본 S1 목표 진행 중), ?theme=dark. 스펙에 전체 화면 보기는 없다.
import { ShellStateProvider } from "../../_shell";
import { useEffect } from "react";
import {
  defaultStatusCells,
  Shell,
  standardRightTabs,
  useShell,
  type StatusCell,
} from "../../_shell";
import { InboxLite } from "../../p07-schedules/parts/inbox-lite";
import { ChatContext, type ContextItem } from "../../p05-helm/parts/chat-context";
import { WorkPanel, type WorkState } from "./work";

export const STATES = [
  { id: "S1", label: "S1 목표 진행 중" },
  { id: "S2", label: "S2 충족" },
  { id: "S3", label: "S3 상한 도달" },
  { id: "S4", label: "S4 판정 실패" },
  { id: "S5", label: "S5 목표 없음" },
  { id: "S6", label: "S6 읽는 중" },
  { id: "S7", label: "S7 긴 작업 목록" },
  { id: "D-offline", label: "D 오프라인" },
  { id: "D-error", label: "D 오류(작업 목록 읽기 실패)" },
] as const satisfies readonly { id: WorkState; label: string }[];

function transcript(state: WorkState, openWork: () => void): ContextItem[] {
  const judge = (n: number, text: string, detail?: string): ContextItem => ({
    kind: "event",
    icon: "goal",
    text: `판정 ${n}/3 · ${text}`,
    ...(detail !== undefined ? { detail } : {}),
    action: { label: "작업 보기", onClick: openWork },
  });
  const base: ContextItem[] = [
    { kind: "user", text: "/goal 테스트가 모두 통과한다" },
    {
      kind: "event",
      icon: "goal",
      text: "목표를 걸었어요 · 테스트가 모두 통과한다",
      detail: "work 그룹 · 턴마다 판정 · 최대 3번",
    },
    { kind: "tool", name: "edit", detail: "src/cache.ts", status: "done", duration: "12ms" },
    { kind: "tool", name: "bash", detail: "bun test", status: "failed", duration: "4.1s" },
    judge(1, "미충족", "빠진 것: expires after ttl"),
    { kind: "agent", text: "단위를 맞추고 경계 시각 테스트를 더했어요. e2e까지 다시 돌릴게요." },
    { kind: "tool", name: "bash", detail: "bun test", status: "failed", duration: "6.8s" },
    judge(2, "미충족", "빠진 것: e2e cache-expiry, e2e warm-start · 다음 턴을 이어 가요"),
  ];
  if (state === "S5")
    return [
      { kind: "user", text: "무효화 테스트가 계속 실패해. 원인 찾아줘" },
      { kind: "tool", name: "bash", detail: "bun test cache", status: "failed", duration: "1.2s" },
      { kind: "agent", text: "만료 비교에 초와 밀리초가 섞여 있어요. 고쳐 볼게요." },
    ];
  if (state === "S2")
    return [
      ...base,
      { kind: "tool", name: "bash", detail: "bun test", status: "done", duration: "7.2s" },
      judge(3, "충족", "bun test 312개 모두 통과 · 목표를 끝냈어요"),
    ];
  if (state === "S3")
    return [
      ...base,
      { kind: "tool", name: "bash", detail: "bun test", status: "failed", duration: "7.0s" },
      judge(3, "미충족", "상한에 걸려 멈췄어요 (limit_reached)"),
    ];
  if (state === "S4")
    return [
      ...base,
      { kind: "tool", name: "bash", detail: "bun test", status: "done", duration: "7.2s" },
      {
        kind: "event",
        icon: "goal",
        text: "판정 3/3 · 판정 실패",
        detail: "판정 모델이 응답하지 않았어요 (rate_limited)",
        action: { label: "작업 보기", onClick: openWork },
      },
    ];
  return base;
}

function Page({ state }: { state: WorkState }) {
  const shell = useShell();
  // 이 시안의 대상이 well이라 어느 폭에서든 작업 탭을 연 채로 시작한다(1100px 이하는 대화 위에 뜬다).
  useEffect(() => {
    shell.openEnd("work");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const goalText = {
    S1: "목표 2/3",
    S2: "목표 충족",
    S3: "목표 멈춤",
    S4: "목표 멈춤",
    S5: undefined,
    S6: "목표",
    S7: "목표 2/3",
    "D-offline": "목표 2/3",
    "D-error": "목표 2/3",
  }[state];
  const status = defaultStatusCells({
    layout: shell.layout,
    thread: true,
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    ...(state === "D-offline"
      ? {
          link: {
            id: "link",
            text: "끊김",
            dot: "danger" as const,
            title: "연결 끊김",
            description: "엔진에 연결되지 않았어요.",
          },
        }
      : {}),
  });
  const goalCell: StatusCell | undefined =
    goalText === undefined
      ? undefined
      : {
          id: "goal",
          text: goalText,
          title: "목표",
          description: "판정 횟수 / 최대 판정이에요. 누르면 작업 탭을 열어요.",
          action: { label: "작업 탭 열기", onSelect: () => shell.openEnd("work") },
        };
  status.end = status.end.flatMap((c) => (c.id === "goal" ? (goalCell ? [goalCell] : []) : [c]));
  const running = state === "S1" || state === "S7";
  return (
    <Shell
      activeNav="chat"
      stageLabel="대화"
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({
        inbox: <InboxLite />,
        inboxBadge: 5,
        work: <WorkPanel state={state} />,
      })}
      status={status}
    >
      <ChatContext
        items={transcript(state, () => shell.openEnd("work"))}
        goal={goalText}
        running={running}
      />
    </Shell>
  );
}

export function Root({ state }: { state: string }) {
  return (
    <ShellStateProvider initialTab="work">
      <Page state={state as WorkState} />
    </ShellStateProvider>
  );
}
