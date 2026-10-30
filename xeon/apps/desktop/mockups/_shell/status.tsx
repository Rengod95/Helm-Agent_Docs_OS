// 상태 표시줄 기본 칸. 페이지는 defaultStatusCells로 만들고 필요한 칸만 바꾼다.
import { status } from "./fixtures";
import { TokenBar, type StatusCell } from "./parts/status-bar";
import type { Layout } from "./state";

export interface StatusOptions {
  layout: Layout;
  /** 대화를 연 화면이면 목표·Helm 칸을 보인다. */
  thread: boolean;
  pendingApprovals: number;
  openEnd: (tab: string) => void;
  /** 연결 칸을 바꿀 때(예: 다시 맞추는 중). */
  link?: StatusCell | undefined;
}

/** 상태 표시줄 칸(S-03). compact 폭에서는 연결과 승인만 남는다. */
export function defaultStatusCells(m: StatusOptions): { start: StatusCell[]; end: StatusCell[] } {
  const openInbox = { label: "받은 요청 열기", onSelect: () => m.openEnd("inbox") };
  const link: StatusCell = m.link ?? {
    id: "link",
    text: status.link,
    dot: "success",
    title: "연결",
    description: "엔진과 실시간으로 연결되어 있어요.",
  };
  const approvalsCell: StatusCell = {
    id: "approvals",
    text: `승인 ${m.pendingApprovals}`,
    label: `승인 대기 ${m.pendingApprovals}개`,
    title: "승인 대기",
    description: `답을 기다리는 승인이 ${m.pendingApprovals}개 있어요.`,
    action: openInbox,
  };
  if (m.layout === "compact") return { start: [link], end: [approvalsCell] };
  const thread = m.thread;
  return {
    start: [
      {
        id: "target",
        text: status.target,
        title: "대상",
        description: "이 창은 이 컴퓨터의 로컬 사이드카 엔진에 붙어 있어요.",
      },
      {
        id: "engine",
        text: status.engine,
        dot: "success",
        title: "엔진",
        description: "엔진이 실행 중이에요.",
      },
      link,
    ],
    end: [
      {
        id: "model",
        text: status.model,
        title: "모델",
        description: "이 대화의 기본 모델이에요. 누르면 모델을 바꿀 수 있어요.",
      },
      {
        id: "tokens",
        text: "41k",
        label: "문맥 41k 토큰 사용, 40%",
        trailing: <TokenBar ratio={status.tokens.ratio} />,
        title: "문맥 사용량",
        description: "문맥 창의 40%(41,000 토큰)를 썼어요.",
      },
      ...(thread
        ? ([
            {
              id: "goal",
              text: `목표 ${status.goal}`,
              label: "목표 3개 중 2개 이룸",
              title: "목표",
              description: "목표 3개 중 2개를 이뤘어요.",
              action: { label: "작업 탭 열기", onSelect: () => m.openEnd("work") },
            },
            {
              id: "helm",
              text: "Helm",
              label: `Helm ${status.helm} 중`,
              title: "Helm",
              description: `Helm 탐구가 ${status.helm} 단계예요.`,
              action: { label: "탐구 탭 열기", onSelect: () => m.openEnd("helm") },
            },
          ] satisfies StatusCell[])
        : []),
      approvalsCell,
      {
        id: "notices",
        text: `알림 ${status.notices}`,
        label: `알림 ${status.notices}개`,
        title: "알림",
        description: "새 알림이 3개 있어요. 예약 실패 1개가 있어요.",
        action: openInbox,
      },
    ],
  };
}
