// 프로필 적용의 상태 기계(N-41). profile.preview(W-44)가 실패하거나, profile.apply(W-46)가 하나라도 실패해 모두 되돌아오는 길을 그린다.
// 들어오는 길이 둘이다: 구조 화면의 프로필 미리 보기(structure)와 구성기 프로필 보기(compose). 실패 원인은 같고 되돌아갈 곳만 다르다.
import type { Pick as StackPick } from "../wb-compose/fixtures";

export const STATES = [
  { id: "apply-reverted", label: "적용 실패: 모두 되돌림" },
  { id: "preview-fail", label: "미리 보기 실패" },
  { id: "apply-pending", label: "적용 기다림" },
  { id: "apply-done", label: "적용함" },
  { id: "apply-compose-reverted", label: "구성기에서 적용 실패: 모두 되돌림" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const SCENARIOS = [
  { id: "apply-ok", label: "적용 → 기다림 → 적용함" },
  { id: "apply-rollback", label: "실패: 적용 → 모두 되돌림 → 다시 적용" },
  { id: "preview-retry", label: "실패: 미리 보기 실패 → 다시 켜기 → 미리 보기" },
  { id: "compose-fix", label: "실패: 구성기에서 적용 → 되돌림 → 그대로로 고쳐 다시 적용" },
] as const;

export type Phase =
  | "preview-loading"
  | "preview"
  | "preview-fail"
  | "pending"
  | "done"
  | "reverted";
export type Entry = "structure" | "compose";

/** 실패하는 확장. 두 입구에서 같다. */
export const FAIL_ID = "cost-router";

export interface S {
  entry: Entry;
  phase: Phase;
  /** 미리 보기를 막던 리뷰를 다시 켰는가 */
  reviewOn: boolean;
  /** 구조 입구에서 다음 적용이 실패하는가(시나리오만). 구성기 입구는 고른 값으로 정한다. */
  failNext: boolean;
  picks: Record<string, StackPick>;
  /** 타이머가 도는가. ?state=apply-pending은 멈춰 있다. */
  auto: boolean;
}

const base: S = {
  entry: "structure",
  phase: "preview",
  reviewOn: false,
  failNext: false,
  picks: {},
  auto: true,
};

export function initial(state: StateId): S {
  switch (state) {
    case "preview-fail":
      return { ...base, phase: "preview-fail" };
    case "apply-pending":
      return { ...base, phase: "pending", auto: false };
    case "apply-done":
      return { ...base, phase: "done" };
    case "apply-reverted":
      return { ...base, phase: "reverted" };
    case "apply-compose-reverted":
      return { ...base, entry: "compose", phase: "reverted" };
  }
}

const compose: S = { ...base, entry: "compose" };
const fixed = { [FAIL_ID]: "keep" as const };

/** 시나리오의 단계별 화면. &step=n&hold=1이면 그 단계에 멈춘다. */
export const STEPS: Record<string, readonly S[]> = {
  "apply-ok": [base, { ...base, phase: "pending" }, { ...base, phase: "done" }],
  "apply-rollback": [
    { ...base, failNext: true },
    { ...base, failNext: true, phase: "pending" },
    { ...base, phase: "reverted" },
    { ...base, phase: "pending" },
    { ...base, phase: "done" },
  ],
  "preview-retry": [
    { ...base, phase: "preview-fail" },
    { ...base, phase: "preview-loading", reviewOn: true },
    { ...base, reviewOn: true },
  ],
  "compose-fix": [
    compose,
    { ...compose, phase: "pending" },
    { ...compose, phase: "reverted" },
    { ...compose, phase: "reverted", picks: fixed },
    { ...compose, phase: "pending", picks: fixed },
    { ...compose, phase: "done", picks: fixed },
  ],
};
