import type { InquiryOutcome } from "./records.ts";
import type { HelmLens } from "./state.ts";

/**
 * 사용자에게 보이는 상태 값 말. `/helm` 결과 글과 대화 알림이 같은 표를 쓴다.
 * 저장 값(`held`, `waiting`, `none`, `finished` 같은 기록 문자열)은 그대로 두고 보일 때만 바꾼다.
 * 앱의 Helm 결과 목록(`desktop.helm.results.*`)과 같은 말이다.
 */
export type HelmLeaseKind = "held" | "waiting" | "none";

export const LEASE_TEXT: Readonly<Record<HelmLeaseKind, string>> = {
  held: "탐구하는 중이에요",
  waiting: "시작을 기다리는 중이에요",
  none: "쉬는 중이에요",
};

export const LENS_STATUS_TEXT: Readonly<Record<HelmLens["status"], string>> = {
  pending: "대기",
  running: "진행 중",
  done: "끝남",
  failed: "실패",
  skipped: "건너뜀",
};

export const OUTCOME_TEXT: Readonly<Record<InquiryOutcome, string>> = {
  applied: "적용됨",
  empty: "발견 없음",
  stopped: "멈춤",
  limit: "상한에 걸림",
  failed: "실패",
};

export const LIMIT_TEXT: Readonly<Record<"turns" | "spawns" | "tokens", string>> = {
  turns: "턴 수",
  spawns: "하위 에이전트 수",
  tokens: "토큰",
};
