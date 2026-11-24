import { createHash } from "node:crypto";
import { Bug } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  LoopPortKey,
  PluginSetPortKey,
  type PluginSetView,
  RecordCommitPortKey,
  type ExtCommitResult,
  type RecordCommitPort,
  type ExtThreadSnapshot,
  extensionPrefix,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import type { DurableEventDraft } from "@fresnel/contracts/records";
import type {
  BoundarySignal,
  BoundaryTxn,
  HostCore,
  ThreadOpenOptions,
  ThreadRuntime,
} from "./core.ts";
import { isHookUnitName } from "../operations/hooks/names.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { keyPart } from "./keys.ts";
import type { EffectWorkerPort } from "./effect-worker.ts";
import type { Lifecycle } from "./lifecycle.ts";
import type { LeaseBroker } from "./lease.ts";
import type { RegistrationRuntime } from "./registration.ts";

export type { BoundarySignal } from "./core.ts";

/** 단계 경계 커밋에 X가 함께 넣는 내구 이벤트 초안(scope.changed, lease.*) */
export interface BoundaryContribution {
  readonly drafts: readonly DurableEventDraft[];
}

export interface BoundaryHooks {
  /** 커밋 전, 트랜잭션 밖에서 부른다(TX-01). await 허용. 켜기 적용의 setup 실행이 여기서 일어난다 */
  prepare(signal: BoundarySignal): Promise<BoundaryContribution>;
  /** 커밋 결과를 알린다. committed면 끄기 정리(onDispose)와 drive 재호출을 시작하고, failed면 prepare의 변경을 되돌린다 */
  settle(signal: BoundarySignal, result: "committed" | "failed"): Promise<void>;
}

export interface BoundaryService extends BoundaryHooks {
  /** 토글 요청 뒤 유휴 thread에서 적용을 예약한다 */
  requestApply(threadId?: ThreadId): void;
  /**
   * turn.start의 덧씌우기를 입력 처리 앞에 적용한다(M5c §4.3.3). 유휴면 E(T) 차이를 커밋하고 끝날 때까지 기다린다.
   * 실행 중이거나 다른 적용이 진행 중이면 기다리지 않고 다음 경계에 맡긴다
   */
  applyNow(threadId: ThreadId): Promise<void>;
  openThread(threadId: ThreadId, options?: ThreadOpenOptions): Promise<void>;
  closeThread(threadId: ThreadId): Promise<void>;
}

const EMPTY_SNAPSHOT: ExtThreadSnapshot = {
  enabled: [],
  disabled: [],
  scopeTransitions: {},
  enabledAtSeq: {},
  states: [],
  openLeases: [],
  pendingRequests: [],
  pendingUserInputs: [],
  leaseEpochs: {},
};

/** 키에 넣는 scope id의 `/`는 `:`로 바꾼다(X.primitives.spec §4.5.5, COMMIT_KEY_PATTERN에 `/`가 없다) */
function keyScopeId(scopeId: string): string {
  return keyPart(scopeId.replaceAll("/", ":"));
}

/**
 * 유휴 경계 한 번의 커밋 키와 지문 원천. 이미 커밋된 값(전이 대상 scope와 그 세대, 임대 차수, 반납할 임대 id)에서만 파생해
 * 같은 적용을 다시 하면 같은 키가 나온다(eng.transactions.design §4.8, TX-05). 초안 id와 시각은 넣지 않는다.
 * 변경이 하나면 `scope:<scopeId>:<세대>:<상태>`, 임대면 `lease:<scopeId>:<차수>` 또는 `lease:<임대 id>:released`이고,
 * 여러 변경이 한 커밋에 묶이면 정렬한 부품의 해시다
 */
function commitPlanOf(
  core: HostCore,
  txn: BoundaryTxn,
): { readonly requestId: string; readonly fingerprintSource: readonly string[] } {
  const generationOf = (id: RegistrationId): number => {
    const record = core.scopes.get(id);
    return record?.generation?.number ?? record?.generationCount ?? 0;
  };
  // 한 세대가 여러 thread에서 켜졌다 꺼졌다 할 수 있어 같은 thread의 전이 횟수를 키에 더한다(P-28)
  const flipOf = (id: RegistrationId): string => {
    const flips = core.threads.get(txn.signal.threadId)?.flips.get(id) ?? 0;
    return flips === 0 ? "" : `.${flips}`;
  };
  const parts = [
    ...txn.recordEnabled.map(
      (id) => `scope:${keyScopeId(id)}:${generationOf(id)}${flipOf(id)}:enabled`,
    ),
    ...txn.recordDisabled.map(
      (id) => `scope:${keyScopeId(id)}:${generationOf(id)}${flipOf(id)}:disabled`,
    ),
    ...txn.releasing.map((lease) => `lease:${keyPart(lease.leaseId)}:released`),
    ...(txn.grant === null
      ? []
      : [`lease:${keyScopeId(txn.grant.scopeId)}:${txn.grant.leaseEpoch}`]),
  ].toSorted();
  const [only] = parts;
  const requestId =
    parts.length === 1 && only !== undefined && only.length <= 120
      ? only
      : `xb:${createHash("sha256").update(parts.join(",")).digest("hex").slice(0, 24)}`;
  return { requestId, fingerprintSource: parts };
}

/**
 * 유휴 경계 커밋 하나. 재시작 뒤에도 `thread.flips`가 `ExtThreadSnapshot.scopeTransitions`에서 시작하므로
 * 이전 실행이 쓴 키와 같은 키가 나오지 않는다(커밋 키는 `commitPlanOf`)
 */
function commitIdleTxn(
  core: HostCore,
  port: RecordCommitPort,
  thread: ThreadRuntime,
  txn: BoundaryTxn,
  drafts: readonly DurableEventDraft[],
): Promise<ExtCommitResult> {
  const plan = commitPlanOf(core, txn);
  // 장부 변화가 없는 유휴 경계(예: 덧씌우기 표지만 바뀐 `profile.applied`)는 키 부품이 비어 모든 그런 경계가 같은 키를 받는다.
  // 두 번째부터는 재생으로 응답돼 기록이 버려진다. 그때는 경계마다 새로 만든 초안 id로 키를 정한다. 같은 경계를 다시 쓰면 같은 id다
  if (plan.fingerprintSource.length > 0) {
    return port.commit({
      threadId: thread.threadId,
      requestId: plan.requestId,
      fingerprintSource: plan.fingerprintSource,
      drafts,
    });
  }
  const ids = drafts.map((draft) => draft.id);
  return port.commit({
    threadId: thread.threadId,
    requestId: `xb:draft:${createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 24)}`,
    fingerprintSource: ids,
    drafts,
  });
}

/** 대화가 쓰는 플러그인 집합(E(T))을 포트에서 읽는다. 포트가 없는 조립이면 undefined다 */
function pluginSetOf(core: HostCore, threadId: ThreadId): PluginSetView | undefined {
  return core.ports.get(PluginSetPortKey)?.resolve(threadId);
}

/** 대화를 열 때 등록별 켜짐을 E(T)로 맞추고, 그 값을 맞춘 값으로 기록한다(`applyPluginSet`의 기준) */
function seedPluginSet(core: HostCore, thread: ThreadRuntime): void {
  const view = pluginSetOf(core, thread.threadId);
  if (view === undefined) return;
  const wanted = new Set(view.plugins);
  for (const record of core.scopes.values()) {
    if (isHookUnitName(record.extension)) continue;
    const enabled = wanted.has(record.extension);
    thread.want.set(record.id, { enabled, reason: undefined });
    thread.pluginReconciled.set(record, enabled);
  }
}

function hashesOf(view: PluginSetView): string {
  return (view.pluginHashes ?? [])
    .map((item) => `${item.plugin}\0${item.contentHash}`)
    .toSorted()
    .join("\n");
}

function overlayKeyOf(view: PluginSetView): string {
  return (view.overlay ?? [])
    .map((item) => `${overlayIdOf(item)}\0${item.contentHash}\0${item.until}`)
    .toSorted()
    .join("\n");
}

/** 덧씌우기 항목 하나의 식별. 초안은 같은 이름의 검토본과 다른 항목이다(§4.3.8) */
function overlayIdOf(item: { readonly plugin: string; readonly draftId?: string }): string {
  return `${item.draftId ?? ""}\0${item.plugin}`;
}

/** `profile.applied`의 덧씌우기 항목 하나. 초안이면 식별자를 싣는다 */
function overlayEntryOf(item: NonNullable<PluginSetView["overlay"]>[number]): {
  readonly plugin: string;
  readonly contentHash: string;
  readonly until: "turn" | "release";
  readonly draftId?: string;
} {
  const entry = { plugin: item.plugin, contentHash: item.contentHash, until: item.until };
  return item.draftId === undefined ? entry : { ...entry, draftId: item.draftId };
}

function sameApplied(a: PluginSetView, b: PluginSetView): boolean {
  return (
    a.profileId === b.profileId &&
    a.profileRev === b.profileRev &&
    a.commonRev === b.commonRev &&
    a.missingProfileId === b.missingProfileId &&
    a.plugins.toSorted().join("\n") === b.plugins.toSorted().join("\n") &&
    hashesOf(a) === hashesOf(b) &&
    overlayKeyOf(a) === overlayKeyOf(b)
  );
}

/** 지난번에 맞춘 값과 검토본 해시가 다른 플러그인(둘 다 해시가 있고 다른 것만). M5c §4.6.7 */
function updatedOf(
  previous: PluginSetView,
  view: PluginSetView,
): { readonly plugin: string; readonly fromHash: string; readonly toHash: string }[] {
  const before = new Map(
    (previous.pluginHashes ?? []).map((item) => [item.plugin, item.contentHash]),
  );
  return (view.pluginHashes ?? [])
    .flatMap((item) => {
      const fromHash = before.get(item.plugin);
      if (fromHash === undefined || fromHash === item.contentHash) return [];
      return [{ plugin: item.plugin, fromHash, toHash: item.contentHash }];
    })
    .toSorted((a, b) => (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
}

/**
 * 단계 경계마다 E(T)를 다시 계산해, 마지막으로 맞춘 값(`pluginReconciled`)과 다른 등록만 켜기·끄기 요청으로 옮긴다(기존 경로
 * `RegistrationRuntime.request`, M5c §4.1.5). 현재 상태와 비교하지 않으므로 엔진이 끈 등록은 E(T)가 바뀔 때까지 다시 켜지지 않는다.
 * 적용이 바뀌었으면 `profile.applied`를 이 경계 기여에 넣는다. 요청은 같은 경계의 `applyToggles`가 적용하고 `scope.changed`는 reconcile이 남긴다.
 */
function applyPluginSet(
  core: HostCore,
  scope: RegistrationRuntime,
  thread: ThreadRuntime,
  txn: BoundaryTxn,
): void {
  const view = pluginSetOf(core, thread.threadId);
  if (view === undefined) return;
  const wanted = new Set(view.plugins);
  for (const record of core.scopes.values()) {
    // 훅 단위는 폴더 신뢰와 저장된 끄기가 정한다(프로필 집합 밖)
    if (isHookUnitName(record.extension)) continue;
    const enabled = wanted.has(record.extension);
    if (thread.pluginReconciled.get(record) === enabled) continue;
    thread.pluginReconciled.set(record, enabled);
    scope.request(record, enabled, undefined, thread.threadId);
  }
  const previous = thread.appliedPlugins;
  if (previous !== null && sameApplied(previous, view)) return;
  const before = new Set(previous?.plugins ?? []);
  const added = view.plugins.filter((name) => !before.has(name)).toSorted();
  const removed = (previous?.plugins ?? []).filter((name) => !wanted.has(name)).toSorted();
  const updated = previous === null ? [] : updatedOf(previous, view);
  const liveOverlay = view.overlay ?? [];
  const previousOverlay = previous?.overlay ?? [];
  // 첫 경계(열기)에 이미 스택에 든 프레임의 덧씌우기는 재시작 복원이다. 이전 실행이 켠 것이 활성 기록이므로 `overlay_on`을 다시 남기지 않는다
  const restoredFrames = new Set(
    thread.frames.flatMap((frame) => {
      const extension = core.scopes.get(frame.scopeId)?.extension;
      return extension === undefined ? [] : [extension];
    }),
  );
  const overlayOn = liveOverlay.filter(
    (item) =>
      !previousOverlay.some((old) => overlayIdOf(old) === overlayIdOf(item)) &&
      (previous !== null || !restoredFrames.has(item.plugin)),
  );
  const overlayOff = previousOverlay.filter(
    (item) => !liveOverlay.some((now) => overlayIdOf(now) === overlayIdOf(item)),
  );
  const reason =
    previous === null
      ? overlayOn.length > 0
        ? "overlay_on"
        : view.missingProfileId === undefined
          ? "open"
          : "profile_missing"
      : previous.profileId !== view.profileId
        ? "switched"
        : previous.profileRev !== view.profileRev
          ? "profile_edited"
          : previous.commonRev !== view.commonRev
            ? "common_edited"
            : overlayOn.length > 0
              ? "overlay_on"
              : overlayOff.length > 0
                ? "overlay_off"
                : removed.length > 0
                  ? "plugin_stopped"
                  : updated.length > 0
                    ? "plugin_updated"
                    : "profile_edited";
  // 덧씌우기 항목은 켜거나 끈 것만 싣는다. 다른 이유에서는 이 경계에서 살아 있는 덧씌우기를 싣는다(M5c §3.2)
  const overlay =
    reason === "overlay_on" ? overlayOn : reason === "overlay_off" ? overlayOff : liveOverlay;
  txn.drafts.push(
    makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: "profile.applied",
      payload: {
        reason,
        profileId: view.profileId,
        profileRev: view.profileRev,
        commonRev: view.commonRev,
        added,
        removed,
        overlay: overlay.map(overlayEntryOf),
        ...(updated.length === 0 ? {} : { updated }),
      },
      turnId: txn.signal.turnId,
      stepId: txn.signal.stepId,
    }),
  );
  thread.appliedPlugins = view;
}

export function createBoundary(
  core: HostCore,
  scope: RegistrationRuntime,
  lease: LeaseBroker,
  effects: EffectWorkerPort,
  lifecycle: Lifecycle,
): BoundaryService {
  function reconcile(thread: ThreadRuntime, txn: BoundaryTxn): void {
    // 이 경계가 끝난 뒤 이 thread에서 켜져 있을 scope
    const future = new Set<RegistrationId>(thread.active);
    for (const record of txn.activating) future.add(record.id);
    for (const record of txn.deactivating) future.delete(record.id);
    const disabled = [...thread.recordedEnabled].filter((id) => !future.has(id)).toSorted();
    for (const id of disabled) {
      const reason = thread.want.get(id)?.reason ?? core.scopes.get(id)?.reason;
      txn.drafts.push(
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "scope.changed",
          payload: { scopeId: id, status: "disabled", ...(reason === undefined ? {} : { reason }) },
          turnId: txn.signal.turnId,
          stepId: txn.signal.stepId,
        }),
      );
      txn.recordDisabled.push(id);
    }
    const enabled = [...future].filter((id) => !thread.recordedEnabled.has(id)).toSorted();
    for (const id of enabled) {
      txn.drafts.push(
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "scope.changed",
          payload: { scopeId: id, status: "enabled" },
          turnId: txn.signal.turnId,
          stepId: txn.signal.stepId,
        }),
      );
      txn.recordEnabled.push(id);
    }
  }

  function threadOf(threadId: ThreadId): ThreadRuntime {
    const thread = core.threads.get(threadId);
    if (thread === undefined) {
      throw new Bug(`boundary.thread_not_open: ${threadId} (call ExtHost.openThread first)`);
    }
    return thread;
  }

  /**
   * 경계 기여를 계산한다. 유휴 적용이 진행 중이면 그 적용이 끝난 뒤에 시작한다. 유휴 적용은 자기 prepare·커밋·settle을 끝까지 하므로
   * 기다려도 멈추지 않고, 기다리지 않으면 이쪽 prepare가 아직 커밋 중인 유휴 적용을 실패로 되돌려 같은 끄기·켜기가 두 번 기록된다
   */
  async function prepare(signal: BoundarySignal): Promise<BoundaryContribution> {
    const thread = threadOf(signal.threadId);
    if (thread.idleApply !== null) {
      await thread.idleApply;
      return await prepare(signal);
    }
    return await prepareNow(thread, signal);
  }

  async function prepareNow(
    thread: ThreadRuntime,
    signal: BoundarySignal,
  ): Promise<BoundaryContribution> {
    if (thread.txn !== null) {
      // 정산되지 않은 이전 prepare는 실패로 되돌린다
      const stale = thread.txn;
      thread.txn = null;
      await scope.settle(thread, stale, "failed");
      stale.grant?.abort.abort();
    }
    const txn: BoundaryTxn = {
      signal,
      drafts: [],
      opening: [],
      activating: [],
      deactivating: [],
      closing: [],
      recordEnabled: [],
      recordDisabled: [],
      releasing: [],
      grant: null,
      startRequest: null,
      abandoning: null,
      recording: [],
    };
    thread.txn = txn;
    if (signal.kind !== "turn_settled") {
      applyPluginSet(core, scope, thread, txn);
      await scope.applyToggles(thread, txn);
    }
    lease.collectReleases(thread, txn);
    reconcile(thread, txn);
    lease.grant(thread, txn);
    return { drafts: [...txn.drafts] };
  }

  /** 방금 커밋된 켜짐의 seq는 커밋 결과에 없어 저장소에서 다시 읽는다. 읽지 못하면 그 scope는 seq 없이(null) 중재한다 */
  async function refreshEnabledAtSeq(
    thread: ThreadRuntime,
    ids: readonly RegistrationId[],
  ): Promise<void> {
    const port = core.ports.get(RecordCommitPortKey);
    if (port === undefined) return;
    const loaded = await port.loadThread(thread.threadId);
    if (!loaded.ok) {
      core.deps.report({
        level: "warning",
        code: "storage_unavailable",
        message: "enabledAtSeq could not be refreshed after the scope.changed commit",
      });
      return;
    }
    for (const id of ids) {
      const seq = loaded.value.enabledAtSeq[id];
      if (seq !== undefined) thread.enabledAtSeq.set(id, seq);
    }
  }

  async function settle(signal: BoundarySignal, result: "committed" | "failed"): Promise<void> {
    const thread = core.threads.get(signal.threadId);
    const txn = thread?.txn;
    if (thread === undefined || txn === null || txn === undefined) return;
    thread.txn = null;
    await scope.settle(thread, txn, result);
    if (thread.applyDeferred) {
      thread.applyDeferred = false;
      requestApply(thread.threadId);
    }
    if (result === "committed") {
      for (const id of txn.recordEnabled) {
        thread.recordedEnabled.add(id);
        thread.flips.set(id, (thread.flips.get(id) ?? 0) + 1);
      }
      for (const id of txn.recordDisabled) {
        thread.recordedEnabled.delete(id);
        thread.enabledAtSeq.delete(id);
        thread.flips.set(id, (thread.flips.get(id) ?? 0) + 1);
      }
      if (txn.recordEnabled.length > 0) await refreshEnabledAtSeq(thread, txn.recordEnabled);
      lease.applyCommitted(thread, txn);
      lease.onBoundary(thread, signal);
      // 이 경계 커밋에 실린 이벤트의 수명주기 지점은 커밋 뒤에만 발화한다(M3-REQ-108)
      await lifecycle.afterCommit(thread.threadId, txn.drafts);
      // 턴이 정착했으면 호스트가 턴 덧씌우기를 풀고 집합을 다시 맞춘다(M5c §4.3.4). 맞추기는 다음 유휴 적용으로 간다
      if (signal.kind === "turn_settled") {
        core.ports.get(PluginSetPortKey)?.turnSettled?.(thread.threadId);
        // 첫 메시지 뒤의 전환이 건 시작은 턴이 끝난 뒤 유휴 경계에서 부여한다(AGE-64). 유휴 적용을 청한다
        if (lease.hasAfterTurnStart(thread)) requestApply(thread.threadId);
      }
    } else {
      txn.grant?.abort.abort();
    }
  }

  /** 유휴 thread의 적용: whenIdle 안에서 prepare → 따로 커밋 → settle(X.primitives.spec §4.5.5) */
  async function applyIdleOnce(thread: ThreadRuntime): Promise<void> {
    // 루프가 커밋한 경계(turn_settled)가 아직 정산되지 않았다. 그 txn을 되돌리지 않고 정산된 뒤에 적용한다
    if (thread.txn !== null) {
      thread.applyDeferred = true;
      return;
    }
    const finished = Promise.withResolvers<void>();
    thread.idleApply = finished.promise;
    try {
      await applyIdle(thread);
    } finally {
      thread.idleApply = null;
      finished.resolve();
    }
  }

  async function applyIdle(thread: ThreadRuntime): Promise<void> {
    const signal: BoundarySignal = { threadId: thread.threadId, kind: "idle" };
    const contribution = await prepareNow(thread, signal);
    let committed = true;
    if (contribution.drafts.length > 0) {
      const port = core.ports.get(RecordCommitPortKey);
      if (port === undefined) {
        core.deps.report({
          level: "warning",
          code: "port_unavailable",
          message:
            "fresnel.session (RecordCommitPort) is not provided; boundary contribution is dropped",
        });
        committed = false;
      } else {
        const txn = thread.txn;
        if (txn === null) throw new Bug("boundary.txn_missing_after_prepare");
        const result = await commitIdleTxn(core, port, thread, txn, contribution.drafts);
        if (result.status === "rejected") {
          committed = false;
          core.deps.report({
            level: "error",
            code: "storage_unavailable",
            message: `boundary contribution commit was rejected (${result.code})`,
          });
        }
      }
    }
    await settle(signal, committed ? "committed" : "failed");
  }

  /** 유휴 thread에서 적용을 한 번 한다. 실행 중이면 단계 경계가 적용하므로 하지 않는다 */
  async function applyOnce(thread: ThreadRuntime): Promise<void> {
    const loop = core.ports.get(LoopPortKey);
    if (loop === undefined) {
      await applyIdleOnce(thread);
    } else if (loop.status(thread.threadId) === "idle") {
      await loop.whenIdle(thread.threadId, () => applyIdleOnce(thread));
    }
  }

  async function runApply(thread: ThreadRuntime): Promise<void> {
    if (thread.applying) {
      thread.applyAgain = true;
      return;
    }
    thread.applying = true;
    try {
      await applyOnce(thread);
    } finally {
      thread.applying = false;
    }
    if (thread.applyAgain) {
      thread.applyAgain = false;
      await runApply(thread);
    }
  }

  /**
   * 덧씌우기 적용(M5c §4.3.3). 대화가 유휴이고 다른 적용이 없으면 지금 커밋하고 끝날 때까지 기다린다.
   * 실행 중이면 다음 단계 경계가 맞춘다(`requestApply`와 같다). 열려 있지 않은 대화는 무시한다
   */
  async function applyNow(threadId: ThreadId): Promise<void> {
    const thread = core.threads.get(threadId);
    if (thread === undefined) return;
    const loop = core.ports.get(LoopPortKey);
    if (loop !== undefined && loop.status(threadId) !== "idle") {
      requestApply(threadId);
      return;
    }
    // 진행 중인 유휴 적용이 끝난 뒤에 이 적용을 한다(같은 차이를 두 번 쓰지 않도록 `prepare`와 같은 순서)
    if (thread.idleApply !== null) await thread.idleApply;
    await applyIdleOnce(thread);
  }

  function requestApply(threadId?: ThreadId): void {
    const targets = threadId === undefined ? [...core.threads.values()] : [threadOf(threadId)];
    for (const thread of targets) {
      core.track(
        runApply(thread).catch((error: unknown) => {
          core.deps.report({
            level: "error",
            code: "storage_unavailable",
            message: "idle boundary application failed",
            cause: error,
          });
        }),
      );
    }
  }

  return {
    prepare,
    settle,
    requestApply,
    applyNow,
    async openThread(threadId, options) {
      if (core.threads.has(threadId)) await this.closeThread(threadId);
      const port = core.ports.get(RecordCommitPortKey);
      let snapshot = EMPTY_SNAPSHOT;
      if (port !== undefined) {
        // 읽기 연결의 busy·io·손상 행은 예상 가능한 실패다. 빈 스냅샷으로 열면 켜짐과 상태 판을 잃은 채 이어 쓰게 되므로 열지 않는다
        const loaded = await port.loadThread(threadId);
        if (!loaded.ok) {
          throw new PrimitiveError(
            "storage_unavailable",
            `the thread's extension state could not be read: ${loaded.error.kind}`,
          );
        }
        snapshot = loaded.value;
      }
      const thread: ThreadRuntime = {
        threadId,
        abort: new AbortController(),
        child: options?.child === true,
        states: new Map(
          snapshot.states.map((stored) => [
            stored.scopeId,
            { eventId: stored.eventId, rev: stored.rev, version: stored.version, doc: stored.doc },
          ]),
        ),
        recordedEnabled: new Set(snapshot.enabled),
        active: new Set(),
        // 끈 scope는 기본 켜짐이어도 다시 열 때 꺼진 채로 둔다. 기록이 같으므로 scope.changed를 다시 쓰지 않는다
        want: new Map(snapshot.disabled.map((id) => [id, { enabled: false, reason: undefined }])),
        refused: new Set(),
        driveFailed: new Set(),
        flips: new Map(Object.entries(snapshot.scopeTransitions)),
        enabledAtSeq: new Map(Object.entries(snapshot.enabledAtSeq)),
        leaseEpochs: new Map(Object.entries(snapshot.leaseEpochs)),
        frames: [],
        startQueue: [],
        heldUser: [],
        userStopped: false,
        txn: null,
        warnedPorts: new Set(),
        appliedPlugins: null,
        pluginReconciled: new WeakMap(),
        applying: false,
        applyAgain: false,
        idleApply: null,
        applyDeferred: false,
      };
      core.threads.set(threadId, thread);
      // 대화별 켜짐은 E(T)로 정한다(M5c §4.1.3). 저장된 끄기 기록보다 E(T)가 이긴다
      seedPluginSet(core, thread);
      // 이미 세대가 열린 scope를 이 thread에서 켠다. 저장된 켜짐 기록과 같으면 scope.changed를 다시 남기지 않는다(N-01)
      await scope.seedThread(thread);
      lease.restore(thread, snapshot.openLeases, snapshot.pendingRequests);
      // 프로필의 시작 설정(drive-isolation.md 2.2): 열린 임대가 없는 대화에서만 이 scope의 시작 요청을 둔다
      if (snapshot.openLeases.length === 0 && options?.startDrive !== undefined) {
        thread.startQueue.push({
          scopeId: options.startDrive,
          trigger: "profile",
          input: null,
          parentLeaseId: null,
          requestId: null,
          recorded: true,
        });
      }
      // 시작 요청까지 세운 뒤에 가로챘으나 처리되지 않은 사용자 메시지를 되살린다(AGE-26)
      // 열린 임대가 있어 위 시작 요청을 못 둔 대화: 전환이 걸어 둔 기다리는 시작은 기록하지 않으므로, 시작 Drive가 스택에 없으면 같은 요청을 다시 건다(AGE-64)
      if (
        snapshot.openLeases.length > 0 &&
        options?.startDrive !== undefined &&
        !thread.frames.some((frame) => frame.scopeId === options.startDrive)
      ) {
        thread.startQueue.push({
          scopeId: options.startDrive,
          trigger: "profile",
          input: null,
          parentLeaseId: null,
          requestId: null,
          recorded: true,
          waitStack: true,
          afterTurn: true,
        });
      }
      lease.restoreUserInputs(thread, snapshot.pendingUserInputs);
      // 재시작 전에 커밋된 요청 가운데 끝나지 않은 것을 이어서 처리한다(ADR-0015 §3.5 2번 3)
      for (const scopeId of thread.active) {
        const record = core.scopes.get(scopeId);
        if (record === undefined) continue;
        effects.schedule({
          threadId,
          scopeId,
          extension: record.extension,
          prefix: extensionPrefix(record.manifest),
        });
      }
      requestApply(threadId);
    },
    async closeThread(threadId) {
      const thread = core.threads.get(threadId);
      if (thread === undefined) return;
      core.threads.delete(threadId);
      thread.abort.abort(new DOMException("thread closed", "AbortError"));
      for (const frame of thread.frames) frame.abort.abort();
      if (thread.txn !== null) {
        const txn = thread.txn;
        thread.txn = null;
        await scope.settle(thread, txn, "failed");
      }
    },
  };
}
