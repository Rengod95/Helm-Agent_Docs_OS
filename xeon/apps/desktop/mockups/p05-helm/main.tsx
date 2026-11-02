// P-05 탐구(Helm) 목업 진입점. 탐구는 대화 화면(P-02)의 오른쪽 well "탐구" 탭이다(스펙 §4.3). 가운데는 그 대화, well에 탐구.
// ?state=S1..S12(기본 S1 탐색 중), ?theme=dark. S12는 이 시안이 더한 전체 화면 보기다(스펙에 없음, NOTES 참고).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { defaultStatusCells, Shell, standardRightTabs, useShell, type StatusCell } from "../_shell";
import { InboxLite } from "../p07-schedules/parts/inbox-lite";
import { ChatContext, type ContextItem } from "./parts/chat-context";
import { HelmPage, HelmPanel, type HelmState } from "./helm";

loadCausticFonts();

const STATES = [
  { id: "S1", label: "S1 탐색 중" },
  { id: "S2", label: "S2 수렴 중(발견)" },
  { id: "S3", label: "S3 끝: 적용함" },
  { id: "S4", label: "S4 대기" },
  { id: "S5", label: "S5 대기열(주도)" },
  { id: "S6", label: "S6 상한 도달" },
  { id: "S7", label: "S7 멈추는 중" },
  { id: "S8", label: "S8 Helm 꺼짐" },
  { id: "S9", label: "S9 읽는 중" },
  { id: "S10", label: "S10 오프라인" },
  { id: "S11", label: "S11 시작 오류" },
  { id: "S12", label: "S12 전체 화면" },
] as const satisfies readonly { id: HelmState; label: string }[];

const failRun = (n: number): ContextItem => ({
  kind: "tool",
  name: "bash",
  detail: "bun test cache",
  status: "failed",
  duration: n === 3 ? "1.1s" : "1.2s",
});

function transcript(state: HelmState, openHelm: () => void): ContextItem[] {
  const base: ContextItem[] = [
    { kind: "user", text: "무효화 테스트가 계속 실패해. 원인 찾아줘" },
    failRun(1),
    { kind: "agent", text: "만료 비교를 고쳐 다시 돌려 볼게요." },
    failRun(2),
    failRun(3),
  ];
  if (state === "S4" || state === "S8" || state === "S11")
    return [
      ...base,
      {
        kind: "event",
        icon: "helm",
        text: "같은 오류가 세 번 났어요. 여러 관점으로 탐구해 볼까요?",
        detail: "helm · 신호 stuck",
        action: { label: "탐구 시작", onClick: openHelm },
      },
    ];
  const started: ContextItem[] = [
    ...base,
    {
      kind: "event",
      icon: "helm",
      text: "helm이 drive를 받았어요 · 캐시 무효화",
      detail: "턴 경계에서 그룹이 바뀌었어요 · 렌즈 3개",
      action: { label: "탐구 보기", onClick: openHelm },
    },
    {
      kind: "tool",
      name: "edit",
      detail: "src/cache.ts",
      status: "failed",
      duration: "0ms",
      failedLabel: "거부됨",
      output: "탐색 단계에서는 쓰기 도구를 쓰지 않아요 (helm scope).",
    },
  ];
  if (state === "S3")
    return [
      ...started,
      { kind: "event", icon: "helm", text: "수렴 · 발견 4개를 남겼어요" },
      {
        kind: "agent",
        text: "탐구 결과를 적용할게요. ttl을 저장할 때 밀리초로 바꾸고, 경계 시각 테스트를 더했어요.",
      },
      { kind: "tool", name: "edit", detail: "src/cache.ts", status: "done", duration: "12ms" },
      { kind: "tool", name: "bash", detail: "bun test cache", status: "done", duration: "1.3s" },
      {
        kind: "event",
        icon: "helm",
        text: "탐구 끝 · 적용함. drive가 review로 넘어갔어요",
        detail: "작업 #12, #13이 생겼어요",
      },
    ];
  if (state === "S2" || state === "S6")
    return [
      ...started,
      {
        kind: "event",
        icon: "helm",
        text:
          state === "S6"
            ? "자식 에이전트 상한(8)에 걸려 멈췄어요"
            : "탐색 끝 · 수렴 단계로 넘어갔어요",
      },
    ];
  if (state === "S5")
    return [
      ...base,
      {
        kind: "event",
        icon: "helm",
        text: "탐구를 대기열에 넣었어요",
        detail: "주도를 review가 쥐고 있어요",
      },
    ];
  return started;
}

function Page({ state }: { state: HelmState }) {
  const shell = useShell();
  const [full, setFull] = useState(state === "S12");
  // 이 시안의 대상이 well이라 어느 폭에서든 탐구 탭을 연 채로 시작한다(1100px 이하는 대화 위에 뜬다). 전체 화면이면 닫는다.
  useEffect(() => {
    if (full) shell.setEndOpen(false);
    else shell.openEnd("helm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  const running = ["S1", "S2", "S7", "S10", "S12"].includes(state);
  const helmCell: StatusCell = {
    id: "helm",
    text:
      state === "S3"
        ? "Helm 끝"
        : state === "S2" || state === "S12"
          ? "Helm 수렴"
          : state === "S5"
            ? "Helm 대기"
            : running
              ? "Helm 탐색"
              : "Helm",
    title: "Helm",
    description: "이 대화의 Helm 탐구 단계예요. 누르면 탐구 탭을 열어요.",
    action: { label: "탐구 탭 열기", onSelect: () => shell.openEnd("helm") },
  };
  const status = defaultStatusCells({
    layout: shell.layout,
    thread: true,
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    ...(state === "S10"
      ? {
          link: {
            id: "link",
            text: "끊김",
            dot: "danger" as const,
            title: "연결",
            description: "엔진과 연결이 끊겼어요.",
          },
        }
      : {}),
  });
  status.end = status.end.map((c) => (c.id === "helm" ? helmCell : c));
  const openHelm = () => shell.openEnd("helm");
  return (
    <Shell
      activeNav="chat"
      stageLabel={full ? "탐구" : "대화"}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({
        inbox: <InboxLite />,
        inboxBadge: 5,
        helm: <HelmPanel state={state === "S12" ? "S2" : state} onFull={() => setFull(true)} />,
      })}
      status={status}
    >
      {full ? (
        <HelmPage
          onBack={() => {
            setFull(false);
            shell.openEnd("helm");
          }}
        />
      ) : (
        <ChatContext items={transcript(state, openHelm)} goal="목표 2/3" running={running} />
      )}
    </Shell>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider initialTab="helm">
            <Page state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
