import { attemptAsync, detach, err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { ExtensionLoader } from "@fresnel/ext-host";
import type { PluginEditFailure } from "../../handlers/m4/profile-test-run.ts";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";
import type { PluginEditRequest } from "../m4/plugin-edit.ts";
import type { ApprovalContext, ApprovalHooks } from "./review.ts";

// 승인 훅(M5c §4.7.3). 승인 한 번이 프로필에 하는 일과, 커밋 뒤 실행 중인 판을 맞추는 일을 묶는다.
// 검토 서비스(`review.ts`)는 순서와 되돌리기를 맡고, 여기서는 무엇을 쓸지와 어떻게 다시 읽을지만 정한다.

export interface ApprovalHookDeps {
  /** 프로필 검사와 쓰기. 바뀌는 계산은 `m4/plugin-edit.ts`가 한다 */
  readonly profiles: {
    checkPluginEdit(request: PluginEditRequest): Promise<Result<void, PluginEditFailure>>;
    applyPluginEdit(
      request: PluginEditRequest,
    ): Promise<Result<readonly string[], PluginEditFailure>>;
  };
  /** 외부 확장 로더. 기본 그룹이 꺼져 있으면 없다 */
  readonly loader: () => ExtensionLoader | undefined;
  /** 플러그인 집합(E(T))을 다시 맞춘다. 열린 대화의 적용을 다음 경계에 예약한다 */
  readonly refreshPluginSet: () => Promise<void>;
  readonly log: Logger;
}

/**
 * 승인 한 번의 프로필 변경. 제거는 이름 기준이고 모든 프로필과 공통 묶음에서 뺀다. 새 플러그인은 고른 프로필의 맨 뒤에 넣는다
 * (고른 것이 없으면 처음 원본이 속한 프로필, 보관만이면 넣지 않는다). 수정은 목록을 고치지 않고 검사만 한다(§4.7.3)
 */
export function editOf(context: ApprovalContext): PluginEditRequest | null {
  const { item, decision, facts } = context;
  if (item.kind === "remove") return { kind: "remove", plugin: item.name };
  if (facts === null) return null;
  if (item.kind === "update") return { kind: "keep", plugin: facts };
  const profileIds = decision.libraryOnly
    ? []
    : decision.profileIds.length > 0
      ? decision.profileIds
      : item.originProfileId === null
        ? []
        : [item.originProfileId];
  return { kind: "add", plugin: facts, profileIds };
}

/** 프로필 쪽 실패를 검토 함수의 실패로 옮긴다. 검사 이슈는 `pluginReview.profileInvalid`가 된다 */
function failureOf(failure: PluginEditFailure): PluginPortFailure {
  if (failure.kind === "plugin_invalid") return { kind: "profile_invalid", issues: failure.issues };
  return { kind: "profiles", failure };
}

/** 커밋 뒤에 실행 중인 판을 맞춘다. 새 플러그인은 싣고, 수정은 검토본을 다시 읽고, 제거는 집합에서 뺀다. 끝나면 열린 대화를 맞춘다 */
async function reflectOf(deps: ApprovalHookDeps, context: ApprovalContext): Promise<void> {
  const name = context.item.name;
  if (context.item.kind === "remove") {
    await deps.refreshPluginSet();
    return;
  }
  const loader = deps.loader();
  if (loader !== undefined) {
    const record = loader.list().find((info) => info.name === name);
    // 꺼진 기록(시작 때 미룬 것, 내린 것)은 지금 싣지도 다시 읽지도 않는다. 다음 대화가 쓸 때 `ensureLoaded`가 현재 사본으로 싣는다
    if (record?.state === "active") {
      const started = await loader.reloadFromReviewed(name, new AbortController().signal);
      if (!started.ok) {
        deps.log.warn("plugin.review.reload_skipped", { name, kind: started.error.kind });
      } else {
        // 적용이 끝난 뒤(열린 대화가 다음 경계에서 바꾼 뒤) 집합을 다시 맞춘다. 승인은 이 기다림을 기다리지 않는다
        detach(
          started.value.applied.then(() => deps.refreshPluginSet()),
          (cause) => deps.log.error("plugin.review.reflect_failed", { name, cause: String(cause) }),
        );
      }
    } else if (record === undefined) {
      const installed = await loader.loadInstalled(name, new AbortController().signal);
      if (!installed.ok) {
        deps.log.warn("plugin.review.load_skipped", { name, kind: installed.error.kind });
      }
    }
  }
  const refreshed = await attemptAsync(() => deps.refreshPluginSet());
  if (!refreshed.ok) deps.log.error("plugin.review.reflect_failed", { name });
}

/** 승인 훅 묶음. 검토 서비스의 `deps.approvalHooks`로 넘긴다 */
export function approvalHooksOf(deps: ApprovalHookDeps): ApprovalHooks {
  return {
    async beforeCommit(context) {
      const request = editOf(context);
      if (request === null) return ok(undefined);
      const checked = await deps.profiles.checkPluginEdit(request);
      return checked.ok ? ok(undefined) : err(failureOf(checked.error));
    },
    async afterCommit(context) {
      const request = editOf(context);
      if (request === null) return ok([]);
      const applied = await deps.profiles.applyPluginEdit(request);
      return applied.ok ? ok(applied.value) : err(failureOf(applied.error));
    },
    reflect: (context) => reflectOf(deps, context),
  };
}
