import { randomUUID } from "node:crypto";
import { assertNever, attemptAsync, err, ok, parse, type Result } from "@fresnel/contracts";
import type { EventId, ItemId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import {
  RewindIdSchema,
  WorkspaceFilesCapturedPayloadSchema,
  type DurableEventEnvelope,
  type FileBefore,
  type RewindFileOutcome,
  type RewindFileResult,
  type RewindScope,
  type RewindUndoState,
  type WorkspaceRewindEntry,
  type WorkspaceRewindStartedPayload,
} from "@fresnel/contracts/records";
import type {
  FileRewindError,
  FileRewindService,
  IncompleteRewind,
  KeptFile,
  RewindPreview,
  RewindUndoResult,
  TurnFile,
  TurnFilesView,
  UntrackedEffect,
  WorkspaceEnv,
} from "@fresnel/contracts/services";
import { WorkspaceFailure } from "@fresnel/contracts/capabilities";
import { scopeDeps, type WorkspaceDeps } from "../deps.ts";
import {
  NO_CANCEL,
  inOrder,
  matchesBefore,
  matchesSha,
  readCurrent,
  removeFile,
  writeBytes,
  type CurrentFile,
} from "./files.ts";
import { planRange, previewFileOf, rangeAfter, untrackedOf, type PlanEntry } from "./plan.ts";
import type { RewindLog, RewindStore } from "./store.ts";

// 파일 되감기 서비스(L1.persistence.spec §4.13.2, F.records.spec §3.3.3, F `services/file-rewind.ts`).
// 대화 쪽 되감기(leaf 이동)는 호스트가 한다. 이 서비스는 파일과 그 기록만 다룬다.
// 기록 순서: 시작(`rewind_started`, 파일에 손대기 전) → 파일 쓰기 → 적용(`rewind_applied`). 시작만 있으면 반만 되돌린 상태다.

const NO_OVERWRITE: ReadonlySet<string> = new Set();

interface TouchAccumulator {
  readonly path: string;
  /** 그 턴에서 처음 본 쓰기의 옛 상태. 처음 쓰기가 범위에 없으면 null */
  readonly before: FileBefore | null;
  touches: number;
}

function storeFailed(cause: string): FileRewindError {
  return { kind: "store_failed", cause };
}

function unknownRewind(rewindId: string): FileRewindError {
  return { kind: "rewind_not_found", rewindId };
}

function isRewindId(value: string): boolean {
  return parse(RewindIdSchema, value).ok;
}

function fileResult(
  path: string,
  outcome: RewindFileOutcome,
  reason: string | null,
): RewindFileResult {
  return { path, outcome, reason };
}

/** 밖에서 바뀐 파일이 지워졌는지에 따라 사유가 정해진다 */
function keptReasonOf(current: CurrentFile): string {
  return current.kind === "absent" ? "deleted_outside" : "changed_outside";
}

/** 결과 목록에서 밖에서 바뀌어 남긴 파일. 최신 결과가 kept_changed인 경로만 든다 */
function keptFilesOf(results: readonly RewindFileResult[]): KeptFile[] {
  const kept: KeptFile[] = [];
  for (const result of results) {
    if (result.outcome !== "kept_changed") continue;
    kept.push({
      path: result.path,
      reason: result.reason === "deleted_outside" ? "deleted_outside" : "changed_outside",
    });
  }
  return kept;
}

/** 적용 결과와 덮어쓰기 결과를 합친 최신 상태의 밖에서 바뀐 파일. 경로마다 가장 나중 결과를 쓴다 */
function keptAfter(
  log: RewindLog,
  rewindId: string,
  latest: readonly RewindFileResult[],
): KeptFile[] {
  const byPath = new Map<string, RewindFileResult>();
  for (const result of log.applied.get(rewindId)?.results ?? []) byPath.set(result.path, result);
  for (const record of log.overwritten) {
    if (record.rewindId !== rewindId) continue;
    for (const result of record.results) byPath.set(result.path, result);
  }
  for (const result of latest) byPath.set(result.path, result);
  return keptFilesOf([...byPath.values()]);
}

function incompleteIn(log: RewindLog): IncompleteRewind[] {
  const out: IncompleteRewind[] = [];
  for (const started of log.started.values()) {
    if (log.applied.has(started.rewindId)) continue;
    out.push({
      rewindId: started.rewindId,
      scope: started.scope,
      targetItemId: started.targetItemId,
      targetEventId: started.targetEventId,
    });
  }
  return out;
}

function conversationStateOf(
  scope: RewindScope,
  oldLeaf: EventId | null,
  leaf: EventId | null,
): RewindUndoState {
  if (scope === "files") return "not_included";
  return oldLeaf !== null && leaf === oldLeaf ? "restored" : "moved_on";
}

function isRestoredOutcome(outcome: RewindFileOutcome | undefined): boolean {
  return outcome === "restored" || outcome === "deleted";
}

/** 현재 상태에서 옛 상태를 저장한다. 저장하지 못하면 `unrestorable`이고, 아무것도 저장할 수 없으면 실패 문자열이다 */
function undoBeforeOf(
  store: RewindStore,
  threadId: ThreadId,
  current: CurrentFile,
): Result<FileBefore, string> {
  switch (current.kind) {
    case "absent":
      return ok({ state: "absent" });
    case "file":
      return store.snapshot(threadId, current.bytes);
    case "other":
    case "unreadable":
    case "denied":
      return ok({ state: "unrestorable", reason: "unreadable", size: null });
    default:
      return assertNever(current, "CurrentFile");
  }
}

function startEntriesOf(
  store: RewindStore,
  threadId: ThreadId,
  plan: readonly PlanEntry[],
): Result<WorkspaceRewindEntry[], string> {
  const entries: WorkspaceRewindEntry[] = [];
  for (const entry of plan) {
    const undoBefore = undoBeforeOf(store, threadId, entry.current);
    if (!undoBefore.ok) return err(undoBefore.error);
    entries.push({
      path: entry.path,
      action: entry.action,
      expectedSha256: entry.expectedSha256,
      targetBefore: entry.targetBefore,
      undoBefore: undoBefore.value,
      outcome: entry.outcome,
      reason: entry.reason,
    });
  }
  return ok(entries);
}

/** 옛 상태(`want`)로 바꾼다. 없던 파일은 지우고, 저장된 내용은 blob에서 읽어 바이트 그대로 쓴다 */
async function writeState(
  store: RewindStore,
  env: WorkspaceEnv,
  canonical: string,
  path: string,
  want: FileBefore,
): Promise<RewindFileResult> {
  switch (want.state) {
    case "unrestorable":
      return fileResult(path, "skipped", want.reason);
    case "absent": {
      const removed = await removeFile(env, canonical);
      return removed.ok
        ? fileResult(path, "deleted", null)
        : fileResult(path, "failed", removed.error);
    }
    case "saved": {
      const bytes = store.blobs.readBlob(want.blob);
      if (!bytes.ok) return fileResult(path, "failed", `blob:${bytes.error.kind}`);
      const written = await writeBytes(env, canonical, bytes.value);
      return written.ok
        ? fileResult(path, "restored", null)
        : fileResult(path, "failed", written.error);
    }
    default:
      return assertNever(want, "FileBefore");
  }
}

/** 적용: 현재 내용이 옛 상태면 건너뛰고, 밖에서 바뀌었으면(강제가 아니면) 남기고, 아니면 옛 상태로 바꾼다 */
async function applyWork(
  store: RewindStore,
  env: WorkspaceEnv,
  canonical: string,
  entry: WorkspaceRewindEntry,
  forced: boolean,
): Promise<RewindFileResult> {
  const current = await readCurrent(env, canonical);
  if (current.kind === "unreadable") return fileResult(entry.path, "skipped", "unreadable");
  if (matchesBefore(current, entry.targetBefore))
    return fileResult(entry.path, "already_original", null);
  if (!forced && !matchesSha(current, entry.expectedSha256)) {
    return fileResult(entry.path, "kept_changed", keptReasonOf(current));
  }
  return writeState(store, env, canonical, entry.path, entry.targetBefore);
}

/** 되돌리기: 되감기가 쓴 내용과 같은 파일만 옛 내용(되감기 직전)으로 돌린다 */
async function undoWork(
  store: RewindStore,
  env: WorkspaceEnv,
  canonical: string,
  entry: WorkspaceRewindEntry,
): Promise<RewindFileResult> {
  const current = await readCurrent(env, canonical);
  if (current.kind === "unreadable") return fileResult(entry.path, "skipped", "unreadable");
  if (matchesBefore(current, entry.undoBefore))
    return fileResult(entry.path, "already_original", null);
  if (!matchesBefore(current, entry.targetBefore)) {
    return fileResult(entry.path, "kept_changed", keptReasonOf(current));
  }
  return writeState(store, env, canonical, entry.path, entry.undoBefore);
}

/**
 * 경로 하나의 파일 작업을 같은 경로의 다른 변경과 줄 세워 한다(기존 쓰기 도구와 같은 줄).
 * 쓰기 루트 밖이나 보호 경로는 막힌 것이라 건너뛴다. 사람에게 묻지 않는다.
 */
async function underLock(
  deps: WorkspaceDeps,
  threadId: ThreadId,
  path: string,
  work: (env: WorkspaceEnv, canonical: string) => Promise<RewindFileResult>,
): Promise<RewindFileResult> {
  const scoped = scopeDeps(deps, threadId);
  const env = scoped.env;
  const outcome = await attemptAsync(() =>
    scoped.core.queueInCallOrder(
      env.id,
      () => scoped.core.resolveWorkspacePath(scoped.roots, path, "write", NO_CANCEL),
      (resolved) => scoped.core.mutationKey(env.id, resolved.canonical),
      (resolved) => work(env, resolved.canonical),
    ),
  );
  if (outcome.ok) return outcome.value;
  return outcome.error.cause instanceof WorkspaceFailure
    ? fileResult(path, "skipped", "denied")
    : fileResult(path, "failed", "unexpected");
}

function restoreEntry(
  deps: WorkspaceDeps,
  store: RewindStore,
  threadId: ThreadId,
  entry: WorkspaceRewindEntry,
  forced: boolean,
): Promise<RewindFileResult> {
  return underLock(deps, threadId, entry.path, (env, canonical) =>
    applyWork(store, env, canonical, entry, forced),
  );
}

/** 적용 단계의 한 줄 결과. 계획이 계획대로면 실제로 쓰고, 그 밖이면 계획의 결과를 그대로 낸다 */
function resultOfEntry(
  deps: WorkspaceDeps,
  store: RewindStore,
  threadId: ThreadId,
  entry: WorkspaceRewindEntry,
  overwrite: ReadonlySet<string>,
): Promise<RewindFileResult> | RewindFileResult {
  switch (entry.outcome) {
    case "planned":
    case "kept_changed":
      return restoreEntry(deps, store, threadId, entry, overwrite.has(entry.path));
    case "skipped":
      return entry.reason === "already_original"
        ? fileResult(entry.path, "already_original", null)
        : fileResult(entry.path, "skipped", entry.reason);
    case "unrestorable":
      return fileResult(entry.path, "skipped", entry.reason);
    default:
      return assertNever(entry.outcome, "RewindPlanOutcome");
  }
}

function checkThread(store: RewindStore, threadId: ThreadId): Result<void, FileRewindError> {
  const row = store.session.query.thread(threadId);
  if (!row.ok) return err(storeFailed(row.error.kind));
  if (row.value === undefined) return err({ kind: "thread_not_found", threadId });
  return ok(undefined);
}

/** 대화의 활성 가지(루트에서 leaf 순서)를 모은다 */
async function branchOf(
  store: RewindStore,
  threadId: ThreadId,
): Promise<Result<DurableEventEnvelope[], FileRewindError>> {
  const exists = checkThread(store, threadId);
  if (!exists.ok) return err(exists.error);
  const events: DurableEventEnvelope[] = [];
  for await (const item of store.session.readBranch(threadId)) {
    if (!item.ok) return err(storeFailed(item.error.kind));
    events.push(item.value);
  }
  return ok(events);
}

/** `to` 항목을 기록한 이벤트. 활성 가지에 없으면 되감기 대상이 아니다 */
function targetOf(
  store: RewindStore,
  threadId: ThreadId,
  to: ItemId,
  branch: readonly DurableEventEnvelope[],
): Result<EventId, FileRewindError> {
  const found = store.session.query.itemEvent(threadId, to);
  if (!found.ok) return err(storeFailed(found.error.kind));
  if (found.value === undefined) return err({ kind: "target_not_found", to });
  const eventId = found.value;
  if (!branch.some((event) => event.id === eventId))
    return err({ kind: "target_not_on_branch", to });
  return ok(eventId);
}

function untrackedOrFail(
  range: readonly DurableEventEnvelope[],
): Result<UntrackedEffect[], FileRewindError> {
  const found = untrackedOf(range);
  return found.ok ? ok(found.value) : err(storeFailed(found.error));
}

async function planFor(
  deps: WorkspaceDeps,
  threadId: ThreadId,
  range: readonly DurableEventEnvelope[],
  overwrite: ReadonlySet<string>,
): Promise<Result<PlanEntry[], FileRewindError>> {
  const plan = await planRange(deps, threadId, range, overwrite);
  return plan.ok ? ok(plan.value) : err(storeFailed(plan.error));
}

function readLogOrFail(store: RewindStore, threadId: ThreadId): Result<RewindLog, FileRewindError> {
  const log = store.readLog(threadId);
  return log.ok ? ok(log.value) : err(storeFailed(log.error));
}

function incompleteOf(
  store: RewindStore,
  threadId: ThreadId,
): Result<IncompleteRewind[], FileRewindError> {
  const log = readLogOrFail(store, threadId);
  return log.ok ? ok(incompleteIn(log.value)) : err(log.error);
}

function turnFileOf(acc: TouchAccumulator): TurnFile {
  const before = acc.before;
  if (before === null) {
    return {
      path: acc.path,
      existedBefore: null,
      restorable: false,
      unrestorableReason: "unreadable",
      touches: acc.touches,
    };
  }
  switch (before.state) {
    case "absent":
      return {
        path: acc.path,
        existedBefore: false,
        restorable: true,
        unrestorableReason: null,
        touches: acc.touches,
      };
    case "saved":
      return {
        path: acc.path,
        existedBefore: true,
        restorable: true,
        unrestorableReason: null,
        touches: acc.touches,
      };
    case "unrestorable":
      return {
        path: acc.path,
        existedBefore: null,
        restorable: false,
        unrestorableReason: before.reason,
        touches: acc.touches,
      };
    default:
      return assertNever(before, "FileBefore");
  }
}

export function createFileRewindService(
  deps: WorkspaceDeps,
  store: RewindStore,
): FileRewindService {
  return {
    async preview({ threadId, to }) {
      const branch = await branchOf(store, threadId);
      if (!branch.ok) return err(branch.error);
      const eventId = targetOf(store, threadId, to, branch.value);
      if (!eventId.ok) return err(eventId.error);
      const range = rangeAfter(branch.value, eventId.value);
      const plan = await planFor(deps, threadId, range, NO_OVERWRITE);
      if (!plan.ok) return err(plan.error);
      const untracked = untrackedOrFail(range);
      if (!untracked.ok) return err(untracked.error);
      const log = readLogOrFail(store, threadId);
      if (!log.ok) return err(log.error);
      const preview: RewindPreview = {
        toEventId: eventId.value,
        files: plan.value.map((entry) => previewFileOf(entry)),
        untracked: untracked.value,
        incomplete: incompleteIn(log.value),
      };
      return ok(preview);
    },

    async apply(input) {
      const { threadId, to, scope, rewindId, oldLeafEventId } = input;
      if (!isRewindId(rewindId)) return err(unknownRewind(rewindId));
      // 대화만 되감을 때는 파일을 건드리지 않고 기록도 남기지 않는다
      if (scope === "conversation") return ok({ rewindId, files: [], kept: [], untracked: [] });
      const branch = await branchOf(store, threadId);
      if (!branch.ok) return err(branch.error);
      const log = readLogOrFail(store, threadId);
      if (!log.ok) return err(log.error);
      const overwrite: ReadonlySet<string> = new Set(input.overwrite);
      const started = log.value.started.get(rewindId);
      const applied = log.value.applied.get(rewindId);

      // 이미 적용이 끝난 되감기다. 처음 결과를 그대로 돌려준다(다시 불러도 안전하다)
      if (started !== undefined && applied !== undefined) {
        const untracked = untrackedOrFail(rangeAfter(branch.value, started.targetEventId));
        if (!untracked.ok) return err(untracked.error);
        return ok({
          rewindId,
          files: applied.results,
          kept: keptAfter(log.value, rewindId, []),
          untracked: untracked.value,
        });
      }

      let entries: readonly WorkspaceRewindEntry[];
      let untracked: UntrackedEffect[];
      if (started !== undefined) {
        // 시작만 남은 되감기(반만 되돌린 상태)다. 처음 계획을 그대로 이어서 한다
        entries = started.entries;
        const found = untrackedOrFail(rangeAfter(branch.value, started.targetEventId));
        if (!found.ok) return err(found.error);
        untracked = found.value;
      } else {
        const eventId = targetOf(store, threadId, to, branch.value);
        if (!eventId.ok) return err(eventId.error);
        const range = rangeAfter(branch.value, eventId.value);
        const plan = await planFor(deps, threadId, range, overwrite);
        if (!plan.ok) return err(plan.error);
        const startEntries = startEntriesOf(store, threadId, plan.value);
        if (!startEntries.ok) return err(storeFailed(startEntries.error));
        const found = untrackedOrFail(range);
        if (!found.ok) return err(found.error);
        untracked = found.value;
        const payload: WorkspaceRewindStartedPayload = {
          rewindId,
          scope,
          targetItemId: to,
          targetEventId: eventId.value,
          oldLeafEventId,
          entries: startEntries.value,
        };
        // 파일에 손대기 전에 시작을 적는다
        const committed = store.commitEvent({
          threadId,
          turnId: null,
          requestKey: `rewind:start:${rewindId}`,
          kind: "workspace.rewind_started",
          payload,
        });
        if (!committed.ok) return err(storeFailed(committed.error));
        entries = startEntries.value;
      }

      const results = await inOrder(entries, (entry) =>
        resultOfEntry(deps, store, threadId, entry, overwrite),
      );
      const committed = store.commitEvent({
        threadId,
        turnId: null,
        requestKey: `rewind:applied:${rewindId}`,
        kind: "workspace.rewind_applied",
        payload: { rewindId, results },
      });
      if (!committed.ok) return err(storeFailed(committed.error));
      return ok({ rewindId, files: results, kept: keptFilesOf(results), untracked });
    },

    async overwrite({ threadId, rewindId, paths }) {
      if (!isRewindId(rewindId)) return err(unknownRewind(rewindId));
      const branch = await branchOf(store, threadId);
      if (!branch.ok) return err(branch.error);
      const log = readLogOrFail(store, threadId);
      if (!log.ok) return err(log.error);
      const started = log.value.started.get(rewindId);
      if (started === undefined) return err(unknownRewind(rewindId));
      const unique = [...new Set(paths)];
      // 밖에서 바뀌어 남긴 파일만 덮어쓴다. 그 밖의 경로는 건너뛴다
      const results = await inOrder(unique, (path) => {
        const entry = started.entries.find((candidate) => candidate.path === path);
        if (entry === undefined || entry.outcome !== "kept_changed") {
          return fileResult(path, "skipped", "not_kept");
        }
        return restoreEntry(deps, store, threadId, entry, true);
      });
      const committed = store.commitEvent({
        threadId,
        turnId: null,
        // 같은 경로를 다시 골라도 결과가 다를 수 있다(이미 원본일 수 있다). 키를 매번 새로 만든다
        requestKey: `rewind:over:${rewindId}:${randomUUID()}`,
        kind: "workspace.rewind_overwritten",
        payload: { rewindId, results },
      });
      if (!committed.ok) return err(storeFailed(committed.error));
      const untracked = untrackedOrFail(rangeAfter(branch.value, started.targetEventId));
      if (!untracked.ok) return err(untracked.error);
      return ok({
        rewindId,
        files: results,
        kept: keptAfter(log.value, rewindId, results),
        untracked: untracked.value,
      });
    },

    async undoFiles({ threadId, rewindId }) {
      if (!isRewindId(rewindId)) return err(unknownRewind(rewindId));
      const branch = await branchOf(store, threadId);
      if (!branch.ok) return err(branch.error);
      const log = readLogOrFail(store, threadId);
      if (!log.ok) return err(log.error);
      const started = log.value.started.get(rewindId);
      if (started === undefined) return err(unknownRewind(rewindId));
      const undone = log.value.undone.get(rewindId);
      if (undone !== undefined)
        return ok({ rewindId, files: undone.results } satisfies RewindUndoResult);
      const applied = log.value.applied.get(rewindId);
      // 적용 기록이 없으면 무엇을 바꿨는지 알 수 없다. 되돌릴 것이 없다
      if (applied === undefined) return ok({ rewindId, files: [] } satisfies RewindUndoResult);
      const appliedOutcome = new Map<string, RewindFileOutcome>(
        applied.results.map((result): [string, RewindFileOutcome] => [result.path, result.outcome]),
      );
      const candidates = started.entries.filter(
        (entry) => entry.outcome === "planned" && isRestoredOutcome(appliedOutcome.get(entry.path)),
      );
      const results = await inOrder(candidates, (entry) =>
        underLock(deps, threadId, entry.path, (env, canonical) =>
          undoWork(store, env, canonical, entry),
        ),
      );
      const leaf = branch.value.at(-1)?.id ?? null;
      const committed = store.commitEvent({
        threadId,
        turnId: null,
        requestKey: `rewind:undo:${rewindId}`,
        kind: "workspace.rewind_undone",
        payload: {
          rewindId,
          results,
          conversation: conversationStateOf(started.scope, started.oldLeafEventId, leaf),
        },
      });
      if (!committed.ok) return err(storeFailed(committed.error));
      return ok({ rewindId, files: results });
    },

    async turnFiles({ threadId, turnId }) {
      const branch = await branchOf(store, threadId);
      if (!branch.ok) return err(branch.error);
      const turns = new Map<TurnId, Map<string, TouchAccumulator>>();
      for (const event of branch.value) {
        if (event.kind !== "workspace.files_captured" || event.turnId === null) continue;
        if (turnId !== null && event.turnId !== turnId) continue;
        const payload = parse(WorkspaceFilesCapturedPayloadSchema, event.payload);
        if (!payload.ok) return err(storeFailed("row_invalid:workspace.files_captured"));
        let files = turns.get(event.turnId);
        if (files === undefined) {
          files = new Map<string, TouchAccumulator>();
          turns.set(event.turnId, files);
        }
        for (const entry of payload.value.entries) {
          const acc = files.get(entry.path);
          if (acc === undefined) {
            files.set(entry.path, {
              path: entry.path,
              before: entry.first ? entry.before : null,
              touches: 1,
            });
          } else {
            acc.touches += 1;
          }
        }
      }
      const view: TurnFilesView = {
        turns: [...turns].map(([id, files]) => ({
          turnId: id,
          files: [...files.values()].map((acc) => turnFileOf(acc)),
        })),
      };
      return ok(view);
    },

    incomplete({ threadId }) {
      const exists = checkThread(store, threadId);
      if (!exists.ok) return Promise.resolve(err(exists.error));
      return Promise.resolve(incompleteOf(store, threadId));
    },
  };
}
