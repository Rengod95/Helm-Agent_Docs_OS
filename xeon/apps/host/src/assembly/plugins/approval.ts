import { attemptAsync, detach, err, ok, type Logger, type Result } from "@fresnel/contracts";
import { hardDependencyCycles, type PluginStorePort } from "@fresnel/contracts/extensions";
import {
  checkDependencies,
  updateBreaks,
  type DependencyNode,
  type DependencyProblem,
  type ExtensionLoader,
} from "@fresnel/ext-host";
import type { PluginEditApplied, PluginEditFailure } from "../../handlers/m4/profile-test-run.ts";
import type { DependencyItem, PluginPortFailure } from "../../handlers/m5/plugins.ts";
import type { PluginEditRequest } from "../m4/plugin-edit.ts";
import type { PluginFact } from "../m4/plugin-fact.ts";
import { requiredByRefusalOf, type ApprovalContext, type ApprovalHooks } from "./review.ts";

// 승인 훅(M5c §4.7.3). 승인 한 번이 프로필에 하는 일과, 커밋 뒤 실행 중인 판을 맞추는 일을 묶는다.
// 검토 서비스(`review.ts`)는 순서와 되돌리기를 맡고, 여기서는 무엇을 쓸지와 어떻게 다시 읽을지만 정한다.

export interface ApprovalHookDeps {
  /** 프로필 검사와 쓰기. 바뀌는 계산은 `m4/plugin-edit.ts`가 한다 */
  readonly profiles: {
    checkPluginEdit(request: PluginEditRequest): Promise<Result<void, PluginEditFailure>>;
    applyPluginEdit(
      request: PluginEditRequest,
    ): Promise<Result<PluginEditApplied, PluginEditFailure>>;
  };
  /** 외부 확장 로더. 기본 그룹이 꺼져 있으면 없다 */
  readonly loader: () => ExtensionLoader | undefined;
  /** 플러그인 집합(E(T))을 다시 맞춘다. 열린 대화의 적용을 다음 경계에 예약한다 */
  readonly refreshPluginSet: () => Promise<void>;
  /** 플러그인 전용 저장소의 지우기(X.primitives.spec §4.6.7). 제거 승인이 그 플러그인의 이름 공간을 지운다 */
  readonly pluginDataStore: Pick<PluginStorePort, "clear">;
  /** 설치된 플러그인 사실. 추가, 업데이트, 삭제가 의존을 이 집합으로 확인한다(AGE-33) */
  readonly facts: () => readonly PluginFact[];
  readonly log: Logger;
}

/** 의존 검사가 쓰는 노드. 사실에서 이름, 판, 매니페스트만 뽑는다 */
function nodeOf(fact: PluginFact): DependencyNode {
  return { name: fact.name, version: fact.version, manifest: fact.manifest };
}

/** 의존 문제 한 줄을 wire 상세의 항목으로 옮긴다. 검사 코드가 wire의 `problem`이 된다 */
function itemOf(problem: DependencyProblem): DependencyItem {
  return {
    from: problem.from,
    target: problem.target,
    kind: problem.kind,
    range: problem.range,
    problem: problem.code,
    found: problem.found,
  };
}

/**
 * 승인 한 번의 의존 거절(AGE-33). 삭제는 hard로 기대는 곳이 없어야 한다. 추가와 업데이트는 새 판의 hard 대상이 설치되어 범위에 맞아야 하고,
 * 업데이트는 기대는 쪽의 hard 범위를 깨지 않아야 한다. soft는 막지 않는다. 프로필 검사보다 먼저 본다
 */
function dependencyRefusalOf(
  context: ApprovalContext,
  installed: readonly PluginFact[],
): PluginPortFailure | null {
  const { item, facts } = context;
  if (item.kind === "remove") return requiredByRefusalOf(item.name, installed);
  if (facts === null) return null;
  const nodes = installed.map(nodeOf);
  const subject = nodeOf(facts);
  const report = checkDependencies(subject, nodes);
  if (report.blocking.length > 0) {
    return {
      kind: "dependency",
      reason: "unmet",
      plugin: item.name,
      items: report.blocking.map(itemOf),
    };
  }
  // hard 순환은 승인이 만들지 못하게 막는다(soft 순환은 허용). 순환에 이 플러그인이 든 것만 센다
  const cycles = hardDependencyCycles([
    ...nodes.filter((node) => node.name !== subject.name).map((node) => node.manifest),
    subject.manifest,
  ]).filter((cycle) => cycle.some((id) => id.split("/")[0] === subject.name));
  if (cycles.length > 0) {
    return {
      kind: "dependency",
      reason: "unmet",
      plugin: item.name,
      items: cycles.flatMap((cycle) =>
        cycle.map((from, index) => ({
          from,
          target: cycle[(index + 1) % cycle.length] ?? from,
          kind: "hard" as const,
          range: null,
          problem: "cycle" as const,
          found: null,
        })),
      ),
    };
  }
  if (item.kind === "update") {
    const breaks = updateBreaks(subject, nodes).filter((problem) => problem.kind === "hard");
    if (breaks.length > 0) {
      return {
        kind: "dependency",
        reason: "breaks_range",
        plugin: item.name,
        items: breaks.map(itemOf),
      };
    }
  }
  return null;
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

/**
 * 제거된 플러그인의 전용 저장소를 지운다. 승인은 이미 커밋됐으므로 실패는 제거를 되돌리지 않고 로그에만 남긴다
 * (X.primitives.spec §4.6.7, L0.store.spec §3.3 sys v4)
 */
async function clearPluginDataOf(deps: ApprovalHookDeps, name: string): Promise<void> {
  const cleared = await attemptAsync(() => deps.pluginDataStore.clear(name));
  if (!cleared.ok) {
    deps.log.error("plugin.review.plugin_data_failed", {
      name,
      cause: String(cleared.error.cause),
    });
    return;
  }
  if (!cleared.value.ok) {
    deps.log.error("plugin.review.plugin_data_failed", { name, kind: cleared.value.error.kind });
  }
}

/** 커밋 뒤에 실행 중인 판을 맞춘다. 새 플러그인은 싣지 않고(처음 대화에 들 때 싣는다), 수정은 검토본을 다시 읽고, 제거는 저장소를 지우고 집합에서 뺀다. 끝나면 열린 대화를 맞춘다 */
async function reflectOf(deps: ApprovalHookDeps, context: ApprovalContext): Promise<void> {
  const name = context.item.name;
  if (context.item.kind === "remove") {
    await clearPluginDataOf(deps, name);
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
      // 기록이 없는 새 이름은 코드를 싣지 않는다. 승인은 적재가 아니다(§4.1.11): 검토본을 검증해 꺼진 기록만 남기고(`deferStart`),
      // 처음 어느 대화의 프로필이나 덧씌우기에 들 때 `ensureLoaded`가 싣는다. 기록이 있어야 목록과 프로필 검사가 이 이름을 안다
      const recorded = await loader.loadInstalled(name, new AbortController().signal, {
        deferStart: true,
      });
      const deferred =
        !recorded.ok && recorded.error.kind === "not_active" && recorded.error.state === "disabled";
      if (!recorded.ok && !deferred) {
        deps.log.warn("plugin.review.load_skipped", { name, kind: recorded.error.kind });
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
      const refused = dependencyRefusalOf(context, deps.facts());
      if (refused !== null) return err(refused);
      const request = editOf(context);
      if (request === null) return ok(undefined);
      const checked = await deps.profiles.checkPluginEdit(request);
      return checked.ok ? ok(undefined) : err(failureOf(checked.error));
    },
    async afterCommit(context) {
      const request = editOf(context);
      if (request === null) return ok({ profileIds: [], missingPlugins: [] });
      const applied = await deps.profiles.applyPluginEdit(request);
      return applied.ok ? ok(applied.value) : err(failureOf(applied.error));
    },
    reflect: (context) => reflectOf(deps, context),
  };
}
