// P-07 예약 고정 데이터. 공용 데이터는 ../_shell/fixtures.ts("예약: 매일 정리" 실패 알림과 맞춘다).
export * from "../../_shell/fixtures";

export type TriggerKind = "interval" | "at" | "fileWatch" | "remote" | "loop";
export type RunStatus = "failed" | "completed" | "running" | "cancelled" | "none";

export interface Schedule {
  id: string;
  title: string;
  prompt: string;
  workspace: string;
  trigger: TriggerKind;
  /** 트리거 요약(목록 칸) */
  triggerText: string;
  next: string;
  last: { status: RunStatus; at?: string; reason?: string; thread?: string };
  enabled: boolean;
}

export const schedules: Schedule[] = [
  {
    id: "s1",
    title: "매일 정리",
    prompt: "오래된 브랜치를 정리하고 결과를 요약해 줘",
    workspace: "~/code/fresnel",
    trigger: "interval",
    triggerText: "24시간마다",
    next: "내일 09:00",
    last: { status: "failed", at: "1시간 전", reason: "rate_limited", thread: "예약: 매일 정리" },
    enabled: true,
  },
  {
    id: "s2",
    title: "빌드 감시",
    prompt: "src가 바뀌면 bun test를 돌리고 실패만 알려 줘",
    workspace: "~/code/fresnel",
    trigger: "fileWatch",
    triggerText: "src/** · 2초",
    next: "바뀔 때",
    last: { status: "completed", at: "3분 전" },
    enabled: true,
  },
  {
    id: "s3",
    title: "원격 점검",
    prompt: "build-box 디스크와 서비스 상태를 확인해 줘",
    workspace: "~/code/fresnel",
    trigger: "remote",
    triggerText: "원격 요청",
    next: "요청 올 때",
    last: { status: "completed", at: "어제" },
    enabled: true,
  },
  {
    id: "s4",
    title: "리팩터 루프",
    prompt: "packages/cache의 any를 하나씩 없애고 테스트를 돌려 줘",
    workspace: "~/code/fresnel",
    trigger: "loop",
    triggerText: "10분마다 · 4/10",
    next: "14:20",
    last: { status: "running", at: "지금" },
    enabled: true,
  },
  {
    id: "s5",
    title: "릴리스 노트 초안",
    prompt: "지난 태그 뒤 커밋으로 릴리스 노트 초안을 써 줘",
    workspace: "~/code/fresnel",
    trigger: "at",
    triggerText: "11월 3일 10:00",
    next: "11월 3일 10:00",
    last: { status: "none" },
    enabled: true,
  },
  {
    id: "s6",
    title: "주간 보고",
    prompt: "이번 주 대화와 커밋으로 주간 보고를 써 줘",
    workspace: "~/notes",
    trigger: "interval",
    triggerText: "7일마다",
    next: "—",
    last: { status: "cancelled", at: "10월 27일" },
    enabled: false,
  },
];

export const triggerLabel: Record<TriggerKind, string> = {
  interval: "간격",
  at: "시각",
  fileWatch: "파일 감시",
  remote: "원격",
  loop: "루프",
};
