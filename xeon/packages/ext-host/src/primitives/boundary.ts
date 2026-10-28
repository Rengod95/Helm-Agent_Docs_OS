import { createHash } from "node:crypto";
import { Bug } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LoopPortKey,
  RecordCommitPortKey,
  type ExtCommitResult,
  type RecordCommitPort,
  type ExtThreadSnapshot,
  type ScopeId,
} from "@xeon/contracts/extensions";
import type { DurableEventDraft } from "@xeon/contracts/records";
import type { BoundarySignal, BoundaryTxn, HostCore, ThreadRuntime } from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { keyPart } from "./keys.ts";
import type { EffectWorkerPort } from "./effect-worker.ts";
import type { Lifecycle } from "./lifecycle.ts";
import type { LeaseBroker } from "./lease.ts";
import type { ScopeRuntime } from "./scope.ts";

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
  openThread(threadId: ThreadId): Promise<void>;
  closeThread(threadId: ThreadId): Promise<void>;
}

const EMPTY_SNAPSHOT: ExtThreadSnapshot = {
  enabled: [],
  disabled: [],
  scopeTransitions: {},
  enabledAtSeq: {},
  states: [],
  openLease: null,
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
  const generationOf = (id: ScopeId): number => {
    const record = core.scopes.get(id);
    return record?.generation?.number ?? record?.generationCount ?? 0;
  };
  // 한 세대가 여러 thread에서 켜졌다 꺼졌다 할 수 있어 같은 thread의 전이 횟수를 키에 더한다(P-28)
  const flipOf = (id: ScopeId): string => {
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
    ...txn.rejected.map(
      (rejection) => `lease:${keyScopeId(rejection.scopeId)}:rejected.${rejection.requestSeq}`,
    ),
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
  return port.commit({
    threadId: thread.threadId,
    requestId: plan.requestId,
    fingerprintSource: plan.fingerprintSource,
    drafts,
  });
}

export function createBoundary(
  core: HostCore,
  scope: ScopeRuntime,
  lease: LeaseBroker,
  effects: EffectWorkerPort,
  lifecycle: Lifecycle,
): BoundaryService {
  function reconcile(thread: ThreadRuntime, txn: BoundaryTxn): void {
    // 이 경계가 끝난 뒤 이 thread에서 켜져 있을 scope
    const future = new Set<ScopeId>(thread.active);
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

  async function prepare(signal: BoundarySignal): Promise<BoundaryContribution> {
    const thread = threadOf(signal.threadId);
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
      rejected: [],
    };
    thread.txn = txn;
    if (signal.kind !== "turn_settled") await scope.applyToggles(thread, txn);
    lease.collectReleases(thread, txn);
    reconcile(thread, txn);
    lease.grant(thread, txn);
    return { drafts: [...txn.drafts] };
  }

  /** 방금 커밋된 켜짐의 seq는 커밋 결과에 없어 저장소에서 다시 읽는다. 읽지 못하면 그 scope는 seq 없이(null) 중재한다 */
  async function refreshEnabledAtSeq(
    thread: ThreadRuntime,
    ids: readonly ScopeId[],
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
    } else {
      txn.grant?.abort.abort();
    }
  }

  /** 유휴 thread의 적용: whenIdle 안에서 prepare → 따로 커밋 → settle(X.primitives.spec §4.5.5) */
  async function applyIdleOnce(thread: ThreadRuntime): Promise<void> {
    const signal: BoundarySignal = { threadId: thread.threadId, kind: "idle" };
    const contribution = await prepare(signal);
    let committed = true;
    if (contribution.drafts.length > 0) {
      const port = core.ports.get(RecordCommitPortKey);
      if (port === undefined) {
        core.deps.report({
          level: "warning",
          code: "port_unavailable",
          message:
            "xeon.session (RecordCommitPort) is not provided; boundary contribution is dropped",
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
    async openThread(threadId) {
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
        flips: new Map(Object.entries(snapshot.scopeTransitions)),
        enabledAtSeq: new Map(Object.entries(snapshot.enabledAtSeq)),
        leaseEpochs: new Map(Object.entries(snapshot.leaseEpochs)),
        lease: null,
        cooldown: new Map(),
        leaseWait: new Map(),
        leaseRejected: new Set(),
        nextRequestSeq: 0,
        txn: null,
        warnedPorts: new Set(),
        applying: false,
        applyAgain: false,
      };
      core.threads.set(threadId, thread);
      // 이미 세대가 열린 scope를 이 thread에서 켠다. 저장된 켜짐 기록과 같으면 scope.changed를 다시 남기지 않는다(N-01)
      await scope.seedThread(thread);
      lease.restore(thread, snapshot.openLease);
      // 재시작 전에 커밋된 요청 가운데 끝나지 않은 것을 이어서 처리한다(ADR-0015 §3.5 2번 3)
      for (const scopeId of thread.active) {
        const record = core.scopes.get(scopeId);
        if (record === undefined) continue;
        effects.schedule({
          threadId,
          scopeId,
          extension: record.extension,
          kind: record.manifest.kind === "group" ? "group" : "plugin",
        });
      }
      requestApply(threadId);
    },
    async closeThread(threadId) {
      const thread = core.threads.get(threadId);
      if (thread === undefined) return;
      core.threads.delete(threadId);
      thread.abort.abort(new DOMException("thread closed", "AbortError"));
      if (thread.lease !== null) thread.lease.abort.abort();
      if (thread.txn !== null) {
        const txn = thread.txn;
        thread.txn = null;
        await scope.settle(thread, txn, "failed");
      }
    },
  };
}
