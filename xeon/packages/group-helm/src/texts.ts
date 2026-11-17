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

/** 맡기기 거부 코드(drive-isolation.md 2.1, L3.primitives 4.4.1b)의 사람 말. 모르는 코드는 코드 그대로 보인다 */
const HANDOFF_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  self_handoff: "자기 자신에게 맡길 수 없어요",
  already_in_stack: "이미 주도 중인 플러그인이라 맡길 수 없어요",
  target_unavailable: "맡을 플러그인을 쓸 수 없어요(꺼져 있거나 구동 기능이 없어요)",
  depth_limit: "맡기기 깊이 상한에 닿았어요",
};

export function handoffRefusalText(code: string): string {
  return HANDOFF_REFUSAL_TEXT[code] ?? `거부 코드 ${code}`;
}

/** authoring이 맡기기를 받지 않은 사유(plugin-builder가 `done({accepted: false, reason})`로 준다) */
const BUILDER_DECLINE_TEXT: Readonly<Record<string, string>> = {
  session_open: "제작 대화가 이미 열려 있어요",
  bad_input: "요청 내용을 읽지 못했어요",
};

export function builderDeclineText(reason: string): string {
  return BUILDER_DECLINE_TEXT[reason] ?? reason;
}
