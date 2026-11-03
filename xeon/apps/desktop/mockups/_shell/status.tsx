// 상태 표시줄 기본 칸. 페이지는 defaultStatusCells로 만들고 필요한 칸만 바꾼다.
import { extJ, extName, status } from "./fixtures";
import { TokenBar, type StatusCell } from "./parts/status-bar";
import type { Layout } from "./state";
import { L, L2 } from "./i18n";
import { T, josa } from "./terms";

export interface StatusOptions {
  layout: Layout;
  /** 대화를 연 화면이면 목표·Helm 칸을 보인다. */
  thread: boolean;
  pendingApprovals: number;
  openEnd: (tab: string) => void;
  /** 연결 칸을 바꿀 때(예: 다시 맞추는 중). */
  link?: StatusCell | undefined;
  /** 런타임 칸(§14.3): "drive helm", "확장 실패 1". 주면 옛 "Helm" 칸 대신 이 칸들을 보인다.
   *  누르면 대화 영역이면 런타임 탭, 크래프트면 개요(onOpen이 정한다, §4.9.5). */
  runtime?:
    | {
        drive: string | null;
        extFailures: number;
        onOpen: () => void;
        /** 사람 확인(loop.ask)을 기다리며 주도를 반납한 그룹(X-17). 주면 진행 칸이 "<그룹> 확인 기다림". */
        waiting?: string | undefined;
        /** 진행 칸 Popover 둘째 줄(상한 사용량 등). */
        detail?: string | undefined;
      }
    | undefined;
  // 묶음 D(셸 수명, m4/pg-d). 모두 선택 항목이다. 주지 않으면 칸은 예전과 같다.
  /** 대상 칸을 바꿀 때(대상 팝오버 "대상 바꾸기", §6.3·§6.12). */
  target?: StatusCell | undefined;
  /** 엔진 칸을 바꿀 때(다시 시작 중, 시작 실패, §6.3 그림). */
  engine?: StatusCell | undefined;
  /** 연결 칸 뒤에 붙는 칸(안전 모드 칩, 업데이트 점 등). compact 폭에서도 남는다. */
  startExtra?: StatusCell[] | undefined;
  /** "진행 중 n" 칸(host.status.liveTurns, §6.3, 계획에 없음 10). 모델 칸 앞에 둔다. compact 폭에서는 빠진다. */
  live?: StatusCell | undefined;
  /** 승인 칸 앞에 붙는 칸. */
  endExtra?: StatusCell[] | undefined;
}

/** 상태 표시줄 칸(S-03). compact 폭에서는 연결과 승인만 남는다. */
export function defaultStatusCells(m: StatusOptions): { start: StatusCell[]; end: StatusCell[] } {
  const openInbox = { label: L("받은 요청 열기"), onSelect: () => m.openEnd("inbox") };
  const link: StatusCell = m.link ?? {
    id: "link",
    text: L(status.link),
    dot: "success",
    title: T.connection,
    description: L("엔진과 실시간으로 연결되어 있어요."),
  };
  const approvalsCell: StatusCell = {
    id: "approvals",
    text: `${L("승인")} ${m.pendingApprovals}`,
    label: `${L("승인 대기")} ${m.pendingApprovals}`,
    title: L("승인 대기"),
    description: L2(
      `답을 기다리는 승인이 ${m.pendingApprovals}개 있어요.`,
      `${m.pendingApprovals} approvals are waiting for an answer.`,
    ),
    action: openInbox,
  };
  // DP-27: 값이 0인 개수 칸(승인, 알림, 확장 실패)은 숨긴다. 연결·엔진·모델 칸은 늘 보인다.
  const approvals = m.pendingApprovals > 0 ? [approvalsCell] : [];
  if (m.layout === "compact")
    return {
      start: [...(m.engine?.dot === "danger" ? [m.engine] : []), link, ...(m.startExtra ?? [])],
      end: approvals,
    };
  const rt = m.runtime;
  const runtimeCells: StatusCell[] =
    rt === undefined
      ? []
      : [
          {
            id: "drive",
            text:
              rt.waiting !== undefined
                ? `${extName(rt.waiting)} 확인 기다림`
                : rt.drive === null
                  ? `${T.drive} ${L("없음")}`
                  : `${T.drive} ${extName(rt.drive)}`,
            label:
              rt.waiting !== undefined
                ? `${extJ(rt.waiting, "이", "가")} ${T.humanGate}을 기다려요, ${T.lead} 반납`
                : rt.drive === null
                  ? `${josa(T.lead, "을", "를")} 쥔 ${T.group} 없음`
                  : `${T.lead} 보유 ${extName(rt.drive)}`,
            title: T.lead,
            description:
              rt.waiting !== undefined
                ? `${extJ(rt.waiting, "이", "가")} 답을 기다리는 동안 ${josa(T.lead, "을", "를")} 놓았어요. 답하면 다시 받아요.`
                : rt.drive === null
                  ? `지금 ${josa(T.turn, "을", "를")} 구동하는 ${T.group}이 없어요. ${T.baseAgent}가 그대로 돌아요.`
                  : `${extJ(rt.drive, "이", "가")} ${josa(T.lead, "을", "를")} 쥐고 있어요. ${rt.detail ?? `${T.turn} 1/4 · spawn 3/8`}.`,
            action: { label: `${T.runtime} 보기`, onSelect: rt.onOpen },
          },
          ...(rt.extFailures > 0
            ? [
                {
                  id: "ext-failures",
                  text: `${L("확장 실패")} ${rt.extFailures}`,
                  label: `${L("확장 실패")} ${rt.extFailures}`,
                  dot: "warning",
                  title: L("확장 실패"),
                  description: `핸들러가 실패한 확장이 ${rt.extFailures}개 있어요.`,
                  action: { label: `${T.runtime} 보기`, onSelect: rt.onOpen },
                } satisfies StatusCell,
              ]
            : []),
        ];
  const thread = m.thread;
  return {
    start: [
      m.target ?? {
        id: "target",
        text: L(status.target),
        title: L("대상"),
        description: L("이 창은 이 컴퓨터의 로컬 앱 안 엔진 엔진에 붙어 있어요."),
      },
      m.engine ?? {
        id: "engine",
        text: L(status.engine),
        dot: "success",
        title: T.engine,
        description: L("엔진이 실행 중이에요."),
      },
      link,
      ...(m.startExtra ?? []),
    ],
    end: [
      ...(m.live !== undefined ? [m.live] : []),
      {
        id: "model",
        text: status.model,
        title: L("모델"),
        description: L("이 대화의 기본 모델이에요. 누르면 모델을 바꿀 수 있어요."),
      },
      {
        id: "tokens",
        text: "41k",
        label: "문맥 41k 토큰 사용, 40%",
        trailing: <TokenBar ratio={status.tokens.ratio} />,
        title: L("문맥 사용량"),
        description: L("문맥 창의 40%(41,000 토큰)를 썼어요."),
      },
      ...(thread
        ? ([
            {
              id: "goal",
              text: `${L("목표")} ${status.goal}`,
              label: L("목표 3개 중 2개 이룸"),
              title: L("목표"),
              description: L("목표 3개 중 2개를 이뤘어요."),
              action: { label: L("작업 탭 열기"), onSelect: () => m.openEnd("work") },
            },
            ...(rt === undefined
              ? [
                  {
                    id: "helm",
                    text: "Helm",
                    label: `Helm ${status.helm} 중`,
                    title: "Helm",
                    description: `Helm 탐구가 ${status.helm} 단계예요.`,
                    action: { label: "탐구 탭 열기", onSelect: () => m.openEnd("helm") },
                  },
                ]
              : []),
          ] satisfies StatusCell[])
        : []),
      ...runtimeCells,
      ...(m.endExtra ?? []),
      ...approvals,
      {
        id: "notices",
        text: `${L("알림")} ${status.notices}`,
        label: `${L("알림")} ${status.notices}`,
        title: L("알림"),
        description: L("새 알림이 3개 있어요. 예약 실패 1개가 있어요."),
        action: openInbox,
      },
    ],
  };
}
