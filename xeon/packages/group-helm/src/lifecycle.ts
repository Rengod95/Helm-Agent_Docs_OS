import type { GroupApi } from "@xeon/group-kit";
import { activeInquiry } from "./drive.ts";
import { recordFinished } from "./outputs.ts";
import { transition } from "./phase.ts";
import { postRequestId, rejectedNotice } from "./prompts.ts";
import { updateState, type HelmState } from "./state.ts";

type LifecycleApi = Pick<GroupApi<HelmState>, "state" | "commit" | "post" | "record">;

/** 이 그룹의 이름. 임대 거부 이벤트의 groupId와 맞춘다 */
const HELM_GROUP_ID = "helm";

/**
 * `lifecycle.lease.rejected` 구독 핸들러(L3.helm.spec §4.13). 입력은 이벤트 페이로드와 커밋된 상태뿐이다.
 * 이 그룹의 요청이 거부되면 pending을 지우고 알림을 한 번 남긴다. 같은 이벤트로 다시 실행돼도 알림은 duplicate다
 */
export function onLeaseRejected(
  g: LifecycleApi,
): (
  payload: { readonly groupId: string },
  ctx: { readonly state: Readonly<HelmState> },
) => Promise<void> {
  return async (payload, ctx) => {
    if (payload.groupId !== HELM_GROUP_ID) return;
    const pending = ctx.state.pending;
    if (pending === null) return;
    await g.post(rejectedNotice(), {
      when: "next",
      requestId: `${postRequestId(pending.inquiryId, "idle", 0)}:rejected`,
    });
    await updateState(g, (current) => ({ ...current, pending: null }));
  };
}

/**
 * `session.start` tap. 마지막 커밋 상태가 일관된지만 본다(L3.helm.spec §4.9). 탐구 단계인데 inquiryId·topic이 없으면
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
