import { assertNever } from "@xeon/contracts";
import type { HelmFailure } from "./failures.ts";
import type { HelmEvent } from "./phase.ts";
import type { HelmPhase } from "./state.ts";

export type HelmSource = "web" | "knowledge" | "session" | "work";

export type HelmReaction =
  /** 전이로 탐구를 끝낸다 */
  | { readonly type: "finish"; readonly event: HelmEvent }
  /** 그 출처만 건너뛴다 */
  | { readonly type: "degrade"; readonly source: HelmSource }
  /** 상태를 다시 읽고 같은 단계를 한 번 더 */
  | { readonly type: "retry_once" }
  /** 커밋 없이 반환. X가 다음 경계에서 다시 부른다 */
  | { readonly type: "yield" }
  /** 렌즈 하나만 실패로 센다. 나머지로 수렴한다 */
  | { readonly type: "lens_failed"; readonly lensId: string };

function sourceOfCapability(id: string): HelmSource {
  if (id.startsWith("web.")) return "web";
  if (id.startsWith("work.")) return "work";
  return "knowledge";
}

/**
 * HelmFailure kind별 처리(L3.helm.spec §4.12 표). 순수 함수.
 * `source`는 같은 능력이 두 출처를 맡을 때(`knowledge.search`의 스킬·세션) 호출한 쪽이 알려 준다
 */
export function reactionOf(
  failure: HelmFailure,
  _phase: HelmPhase,
  source?: HelmSource,
): HelmReaction {
  switch (failure.kind) {
    case "lease_lost":
    case "state_conflict":
    case "storage":
    case "disabled":
      return { type: "yield" };
    case "budget":
      return { type: "finish", event: { type: "limitReached", limit: failure.limit } };
    case "state_too_large":
    case "state_inconsistent":
      return { type: "finish", event: { type: "failed", failure } };
    case "capability":
      return { type: "degrade", source: source ?? sourceOfCapability(failure.capability) };
    case "turn":
      return failure.status === "aborted"
        ? { type: "finish", event: { type: "stopRequested" } }
        : { type: "finish", event: { type: "failed", failure } };
    case "spawn":
      return { type: "lens_failed", lensId: failure.lensId };
    default:
      return assertNever(failure, "HelmFailure");
  }
}
