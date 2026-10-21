import { createHash } from "node:crypto";
import { Bug } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  LoopPortKey,
  RecordCommitPortKey,
  type ExtThreadSnapshot,
  type ScopeId,
} from "@xeon/contracts/extensions";
import type { DurableEventDraft } from "@xeon/contracts/records";
import type { BoundarySignal, BoundaryTxn, HostCore, ThreadRuntime } from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { keyPart } from "./keys.ts";
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
  const parts = [
    ...txn.recordEnabled.map((id) => `scope:${keyScopeId(id)}:${generationOf(id)}:enabled`),
    ...txn.recordDisabled.map((id) => `scope:${keyScopeId(id)}:${generationOf(id)}:disabled`),
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

export function createBoundary(
  core: HostCore,
  scope: ScopeRuntime,
  lease: LeaseBroker,
): BoundaryService {
  function reconcile(thread: ThreadRuntime, txn: BoundaryTxn): void {
    const future = new Set<ScopeId>();
    for (const record of core.scopes.values()) {
      if (record.generation !== null && !txn.closing.includes(record)) future.add(record.id);
    }
    const disabled = [...thread.recordedEnabled].filter((id) => !future.has(id)).toSorted();
    for (const id of disabled) {
      const reason = core.scopes.get(id)?.reason;
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
      closing: [],
      recordEnabled: [],
      recordDisabled: [],
      releasing: [],
      grant: null,
    };
    thread.txn = txn;
    if (signal.kind !== "turn_settled") await scope.applyToggles(thread, txn);
    lease.collectReleases(thread, txn);
    reconcile(thread, txn);
    lease.grant(thread, txn);
    return { drafts: [...txn.drafts] };
  }

  async function settle(signal: BoundarySignal, result: "committed" | "failed"): Promise<void> {
    const thread = core.threads.get(signal.threadId);
    const txn = thread?.txn;
    if (thread === undefined || txn === null || txn === undefined) return;
    thread.txn = null;
    await scope.settle(thread, txn, result);
    if (result === "committed") {
      for (const id of txn.recordEnabled) thread.recordedEnabled.add(id);
      for (const id of txn.recordDisabled) thread.recordedEnabled.delete(id);
      lease.applyCommitted(thread, txn);
      lease.onBoundary(thread, signal);
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
        const plan = commitPlanOf(core, txn);
        const result = await port.commit({
          threadId: thread.threadId,
          requestId: plan.requestId,
          fingerprintSource: plan.fingerprintSource,
          drafts: contribution.drafts,
        });
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
      const snapshot = port === undefined ? EMPTY_SNAPSHOT : await port.loadThread(threadId);
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
        leaseEpochs: new Map(Object.entries(snapshot.leaseEpochs)),
        lease: null,
        cooldown: new Map(),
        txn: null,
        warnedPorts: new Set(),
        applying: false,
        applyAgain: false,
      };
      core.threads.set(threadId, thread);
      lease.restore(thread, snapshot.openLease);
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
