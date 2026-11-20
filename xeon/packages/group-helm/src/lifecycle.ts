import type { OrchestrationApi } from "@fresnel/group-sdk";
import { activeInquiry } from "./drive.ts";
import { recordFinished } from "./outputs.ts";
import { transition } from "./phase.ts";
import { updateState, type HelmState } from "./state.ts";

type LifecycleApi = Pick<OrchestrationApi<HelmState>, "state" | "commit" | "record">;

/**
 * `thread.start` tap. 마지막 커밋 상태가 일관된지만 본다(L3.helm.spec §4.9). 탐구 단계인데 inquiryId·topic이 없으면
 * 초기 상태로 커밋하고 종료 기록(failed)을 남긴다. 스키마를 어기는 저장 상태는 X가 scope를 켜지 못하므로 이 핸들러까지 오지 않는다
 */
export function checkRestore(
  g: LifecycleApi,
): (_payload: unknown, ctx: { readonly state: Readonly<HelmState> }) => Promise<void> {
  return async (_payload, ctx) => {
    const inquiry = activeInquiry(ctx.state);
    if (ctx.state.phase === "idle" || inquiry.ok) return;
    const reset = transition(ctx.state, { type: "failed", failure: inquiry.error });
    if (reset.finished !== undefined) await recordFinished(g, reset.finished);
    await updateState(g, () => reset.state);
  };
}
