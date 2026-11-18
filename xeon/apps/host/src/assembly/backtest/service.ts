import { canonicalJson, detach, err, ok, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type {
  BacktestClass,
  BacktestItem,
  BacktestResultResult,
  BacktestRunParams,
  BacktestRunResult,
  BacktestStatusResult,
  BacktestSummary,
  CallRecord,
} from "@fresnel/contracts/wire";
import type {
  CandidateCall,
  CandidateOutcome,
  CandidateRunner,
  ReplayPoint,
} from "@fresnel/ext-host";
import type { CandidateResolver } from "./candidate.ts";
import {
  candidateResultOf,
  classifyCall,
  SKIPPED_CANDIDATE,
  verdictOfOutcome,
  type CandidateVerdict,
} from "./classify.ts";
import type { BacktestIsolation } from "./isolation.ts";
import {
  callerIdOf,
  hasBlobPlaceholder,
  threadItemLogOf,
  toolCallPayloadOf,
  type ThreadItemLog,
  type UnreplayableReason,
} from "./payload.ts";
import {
  selectTurns,
  type BacktestSettingsValues,
  type ScopeSource,
  type SelectedTurn,
} from "./scope.ts";
import { argTokensOf, similarNotCaughtOf, type SimilarCall } from "./similar.ts";

// 지난 턴에 돌려 보기의 실행 서비스(turn-record-metrics.md §3.5, §3.7, §4.8). 후보 Hook을 기록된 호출에 하나씩 다시 적용해 분류한다.
// 모델도 도구도 실행하지 않는다. 후보는 주입된 실행기로만 돈다. 실행 결과는 프로세스 메모리에만 둔다(기록, 지표, 추적 버퍼에 쓰지 않는다).
// 이 파일은 저장소 쓰기 모듈을 가져오지 않는다(시험 `service.test.ts`가 가져오기 목록을 고정한다).

/**
 * 재현하지 못하는 것의 고정 식별자(§4.8 규칙 53의 (1)~(6)). 문장은 화면이 용어 카탈로그로 그린다(코드에 한국어 문장을 두지 않는다) [제안].
 * 와이어 목록의 최대 길이가 6이라 실행별 줄을 더하지 않는다
 */
export const NOT_REPRODUCIBLE: readonly string[] = [
  "model_reaction_after_block",
  "later_call_order_and_count",
  "other_plugin_hook_interaction",
  "human_answer_to_ask",
  "candidate_time_or_external_state",
  "candidate_network_side_effects",
];

/** 결과 한 쪽의 항목 수(§3.5). 커서는 다음 쪽의 시작 위치다 */
const RESULT_PAGE = 200;
/** 끝난 실행을 메모리에 두는 수(가장 오래된 것부터 버린다) */
const KEEP_FINISHED = 20;
const CURSOR_PATTERN = /^pg_(0|[1-9][0-9]{0,8})$/;

/** 실행 상태(와이어 `backtest.status`의 값) */
type BacktestRunState = "queued" | "running" | "done" | "cancelled" | "failed";

/** 실행을 시작하지 못한 이유. 와이어 오류 3521·3522·3524·3525와 맞는다 */
type RunStartError =
  | { readonly kind: "isolation_unavailable" }
  | { readonly kind: "busy" }
  | { readonly kind: "candidate_not_found"; readonly message: string }
  | { readonly kind: "hook_not_replayable" };

/** 실행 id를 찾지 못했다(와이어 `3523`) */
interface RunNotFound {
  readonly kind: "run_not_found";
}

/** 결과 쪽을 읽는 이유: 실행이 없거나 커서가 맞지 않는다 */
type ResultReadError = RunNotFound | { readonly kind: "invalid_cursor" };

/** 알림 `backtest.progress`의 내용 */
interface BacktestProgress {
  readonly runId: string;
  readonly done: number;
  readonly total: number;
}

/** 돌려 보기 포트. 처리기(`handlers/m5/backtest.ts`, 후속 단계)가 이것을 부른다 */
export interface BacktestPort {
  run(params: BacktestRunParams): Promise<Result<BacktestRunResult, RunStartError>>;
  status(runId: string): Result<BacktestStatusResult, RunNotFound>;
  result(runId: string, cursor?: string): Result<BacktestResultResult, ResultReadError>;
  cancel(runId: string): Result<true, RunNotFound>;
  /** 진행 알림을 받는다. 끊는 함수를 돌려준다 */
  onProgress(listener: (event: BacktestProgress) => void): () => void;
  /** 실행이 끝날 때까지 기다린다(끝난 실행이나 없는 실행이면 바로 끝난다). 시험과 종료 처리가 쓴다 */
  whenDone(runId: string): Promise<void>;
}

/** 대화 로그 읽기 실패. 이유 문장만 든다 */
export interface ItemLogReadError {
  readonly reason: string;
}

export interface BacktestServiceDeps {
  readonly scope: ScopeSource;
  /** 대화가 아직 있나. 없으면 그 대화의 호출은 `thread_deleted`다 */
  readonly threadExists: (threadId: string) => boolean;
  /** 대화의 `item.recorded` 사건을 본문까지 되살려 읽는다(`item-log.ts`) */
  readonly readItemEvents: (
    threadId: string,
  ) => Promise<Result<readonly DurableEventEnvelope[], ItemLogReadError>>;
  readonly resolveCandidate: CandidateResolver;
  /** 격리 가능 여부와 실행기 만들기. 실행을 시작할 때마다 읽는다 */
  readonly isolation: () => BacktestIsolation;
  readonly settings: () => BacktestSettingsValues;
  readonly now: () => number;
  /** 불투명한 실행 id(`bt_…`)를 만든다 */
  readonly newRunId: () => string;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: () => release?.() };
}

/** 실행 한 건. 항목과 유사 판정 입력은 끝까지 쌓인다 */
interface RunRecord {
  readonly id: string;
  state: BacktestRunState;
  total: number;
  turns: number;
  calls: number;
  readonly items: BacktestItem[];
  readonly similar: SimilarCall[];
  cancelRequested: boolean;
  readonly finished: Deferred;
}

/** 호출 하나의 대상. 대화 id, 턴 id, 기록된 호출 */
interface Entry {
  readonly threadId: string;
  readonly turnId: string;
  readonly call: CallRecord;
}

/** 한 번 돌리기의 공유 상태 */
interface RunContext {
  readonly runner: CandidateRunner;
  readonly point: ReplayPoint;
  readonly settings: BacktestSettingsValues;
  readonly deadlineAt: number;
  readonly logs: Map<string, ThreadItemLog>;
  readonly exists: Map<string, boolean>;
}

type ReplayFailure =
  | { readonly kind: "log_read"; readonly reason: string }
  | { readonly kind: "log_corrupt" };

/** 호출 하나의 처리 결과. `out_of_time`이면 이 호출부터는 돌리지 않는다 */
type Step =
  | { readonly kind: "item"; readonly item: BacktestItem; readonly similar: SimilarCall | null }
  | { readonly kind: "out_of_time" };

type ItemBase = Pick<BacktestItem, "toolCallId" | "threadId" | "turnId" | "tool" | "live">;

function isTerminal(state: BacktestRunState): boolean {
  return state === "done" || state === "cancelled" || state === "failed";
}

function liveOf(call: CallRecord): BacktestItem["live"] {
  const decision = call.approval?.decision ?? null;
  return {
    verdict: call.verdict,
    humanDecision: decision === "allow" || decision === "deny" ? decision : null,
    blockedBy: call.blockedBy?.plugin ?? null,
    laterSignals: decision === "deny" ? ["approval_denied"] : [],
  };
}

function baseOf(entry: Entry): ItemBase {
  return {
    toolCallId: entry.call.toolCallId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    tool: entry.call.tool,
    live: liveOf(entry.call),
  };
}

function unreplayableItem(base: ItemBase, reason: UnreplayableReason): BacktestItem {
  return {
    ...base,
    candidate: { ...SKIPPED_CANDIDATE },
    class: "unreplayable",
    unreplayableReason: reason,
  };
}

function classOfResult(result: BacktestItem["candidate"]["result"]): SimilarCall["role"] {
  if (result === "block" || result === "ask" || result === "replace") return "stopped";
  if (result === "pass" || result === "modify") return "passed";
  return "other";
}

/** 같은 입력을 두 번 돌린 결과가 같나. 값이 있는 결과는 값을, 고장은 종류만 비교한다 */
function sameOutcome(first: CandidateOutcome, second: CandidateOutcome): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === "returned" && second.kind === "returned") {
    return canonicalJson(first.value) === canonicalJson(second.value);
  }
  return true;
}

function entriesOf(turns: readonly SelectedTurn[]): Entry[] {
  return turns.flatMap((turn) =>
    turn.record.steps.flatMap((step) =>
      step.calls.map((call) => ({ threadId: turn.threadId, turnId: turn.turnId, call })),
    ),
  );
}

function offsetOf(cursor: string | undefined, length: number): Result<number, ResultReadError> {
  if (cursor === undefined) return ok(0);
  const digits = CURSOR_PATTERN.exec(cursor)?.[1];
  if (digits === undefined) return err({ kind: "invalid_cursor" });
  const offset = Number(digits);
  if (offset > length) return err({ kind: "invalid_cursor" });
  return ok(offset);
}

/** 요약은 실행 전체의 값이다. 항목이 쌓이는 동안에도 지금까지의 값을 보인다 */
function summaryOf(run: RunRecord): BacktestSummary {
  const counts: Record<BacktestClass, number> = {
    newly_caught: 0,
    already_stopped: 0,
    agrees_block: 0,
    would_block_allowed_by_human: 0,
    passes_same: 0,
    candidate_fault: 0,
    unreplayable: 0,
  };
  let replayed = 0;
  let threw = 0;
  let timeout = 0;
  for (const item of run.items) {
    counts[item.class] += 1;
    if (item.candidate.result !== "skipped") replayed += 1;
    if (item.candidate.result === "failed") threw += 1;
    if (item.candidate.result === "timeout") timeout += 1;
  }
  return {
    turns: run.turns,
    calls: run.calls,
    replayed,
    counts,
    similarNotCaught: similarNotCaughtOf(run.similar),
    candidateFaults: { threw, timeout },
  };
}

/** 돌려 보기 서비스를 만든다. 실행기는 `isolation`이 만든 것만 쓴다 */
export function createBacktestService(deps: BacktestServiceDeps): BacktestPort {
  const runs = new Map<string, RunRecord>();
  const listeners = new Set<(event: BacktestProgress) => void>();
  /** 시작했고 아직 끝나지 않은 실행. 하나만 있다(`busy`) */
  let active: RunRecord | undefined;

  function emit(run: RunRecord): void {
    const event: BacktestProgress = { runId: run.id, done: run.items.length, total: run.total };
    for (const listener of listeners) listener(event);
  }

  function finish(run: RunRecord, state: BacktestRunState): void {
    if (isTerminal(run.state)) return;
    run.state = state;
    if (active === run) active = undefined;
    run.finished.resolve();
    let terminal = 0;
    for (const other of runs.values()) if (isTerminal(other.state)) terminal += 1;
    for (const [id, other] of runs) {
      if (terminal <= KEEP_FINISHED) break;
      if (!isTerminal(other.state)) continue;
      runs.delete(id);
      terminal -= 1;
    }
  }

  function budgetOf(ctx: RunContext): number {
    return Math.min(ctx.settings.callTimeoutMs, ctx.deadlineAt - deps.now());
  }

  async function logOf(
    ctx: RunContext,
    threadId: string,
  ): Promise<Result<ThreadItemLog, ReplayFailure>> {
    const cached = ctx.logs.get(threadId);
    if (cached !== undefined) return ok(cached);
    const read = await deps.readItemEvents(threadId);
    if (!read.ok) return err({ kind: "log_read", reason: read.error.reason });
    const parsed = threadItemLogOf(read.value);
    if (!parsed.ok) return err({ kind: "log_corrupt" });
    ctx.logs.set(threadId, parsed.value);
    return ok(parsed.value);
  }

  /** 후보를 한 번 돌린다. 결과가 값이면 같은 입력으로 바로 한 번 더 돌려 비결정성을 본다(규칙 48) */
  async function replayCall(
    ctx: RunContext,
    request: {
      readonly threadId: string;
      readonly payload: JsonValue;
      readonly current: JsonValue;
      readonly caller: string;
    },
  ): Promise<{ readonly outcome: CandidateOutcome; readonly nondeterministic: boolean }> {
    const input = (deadlineMs: number): CandidateCall => ({
      point: ctx.point,
      threadId: request.threadId,
      payload: request.payload,
      current: request.current,
      caller: request.caller,
      deadlineMs,
    });
    const first = await ctx.runner.run(input(budgetOf(ctx)));
    if (first.kind !== "returned" || deps.now() >= ctx.deadlineAt) {
      return { outcome: first, nondeterministic: false };
    }
    const second = await ctx.runner.run(input(budgetOf(ctx)));
    return { outcome: first, nondeterministic: !sameOutcome(first, second) };
  }

  /** 호출 하나를 처리한다. 인자나 결과를 읽을 수 없으면 `unreplayable`이고 후보는 돌지 않는다 */
  async function replayEntry(ctx: RunContext, entry: Entry): Promise<Result<Step, ReplayFailure>> {
    const base = baseOf(entry);
    const { threadId, call } = entry;
    let exists = ctx.exists.get(threadId);
    if (exists === undefined) {
      exists = deps.threadExists(threadId);
      ctx.exists.set(threadId, exists);
    }
    if (!exists)
      return ok({ kind: "item", item: unreplayableItem(base, "thread_deleted"), similar: null });
    const log = await logOf(ctx, threadId);
    if (!log.ok) return log;
    const logged = log.value.calls.get(call.toolCallId);
    if (logged === undefined || logged.argumentsError) {
      return ok({ kind: "item", item: unreplayableItem(base, "args_missing"), similar: null });
    }
    if (hasBlobPlaceholder(logged.args)) {
      return ok({ kind: "item", item: unreplayableItem(base, "blob_expired"), similar: null });
    }
    const payload = toolCallPayloadOf(call, logged.args);
    if (!payload.ok) {
      return ok({ kind: "item", item: unreplayableItem(base, "tool_unknown"), similar: null });
    }
    let current: JsonValue = null;
    if (ctx.point === "tool.result") {
      const stored = log.value.results.get(call.toolCallId)?.value ?? null;
      if (stored === null) {
        return ok({
          kind: "item",
          item: unreplayableItem(base, "result_not_stored"),
          similar: null,
        });
      }
      if (hasBlobPlaceholder(stored)) {
        return ok({ kind: "item", item: unreplayableItem(base, "blob_expired"), similar: null });
      }
      current = stored;
    }
    // 시간이 다 된 뒤에는 후보를 부르지 않는다(남은 호출은 돌리지 않는다, §4.8 규칙 47)
    if (deps.now() >= ctx.deadlineAt) return ok({ kind: "out_of_time" });
    const replayed = await replayCall(ctx, {
      threadId,
      payload: payload.value.json,
      current,
      caller: callerIdOf(call) ?? "subagent",
    });
    const verdict: CandidateVerdict = verdictOfOutcome(ctx.point, replayed.outcome);
    const classified = classifyCall({
      point: ctx.point,
      verdict: call.verdict,
      blockedHook: call.blockedBy?.hook ?? null,
      approval: call.approval?.decision ?? null,
      candidate: verdict,
    });
    const candidate = candidateResultOf(verdict);
    const item: BacktestItem = {
      ...base,
      candidate,
      class: classified.class,
      ...(classified.skippedBy === null ? {} : { skippedBy: classified.skippedBy }),
      ...(replayed.nondeterministic ? { nondeterministic: true as const } : {}),
    };
    const similar: SimilarCall = {
      toolCallId: call.toolCallId,
      tool: call.tool,
      targetKey: call.targetKey,
      argTokens: argTokensOf(logged.args),
      role: classOfResult(candidate.result),
    };
    return ok({ kind: "item", item, similar });
  }

  /** 실행 본문. 기록된 순서대로 호출을 한 번에 하나씩 돌리고, 끝나면 실행기를 닫는다 */
  async function execute(
    run: RunRecord,
    runner: CandidateRunner,
    params: BacktestRunParams,
    settings: BacktestSettingsValues,
  ): Promise<void> {
    run.state = "running";
    try {
      const selected = selectTurns(deps.scope, params.scope, settings);
      if (!selected.ok) return finish(run, "failed");
      const entries = entriesOf(selected.value);
      run.turns = selected.value.length;
      run.calls = entries.length;
      run.total = Math.min(entries.length, settings.maxCalls);
      const ctx: RunContext = {
        runner,
        point: params.hook,
        settings,
        deadlineAt: deps.now() + settings.totalTimeoutMs,
        logs: new Map(),
        exists: new Map(),
      };
      let cancelled = false;
      for (const entry of entries.slice(0, run.total)) {
        if (run.cancelRequested) {
          cancelled = true;
          break;
        }
        if (deps.now() >= ctx.deadlineAt) break;
        // 호출은 한 번에 하나씩 기록된 순서대로 돈다(§4.8 규칙 47). 그래서 기다림을 반복문 안에 둔다
        // oxlint-disable-next-line no-await-in-loop -- 호출은 한 번에 하나씩 차례로 돈다 (turn-record-metrics.md §4.8 규칙 47)
        const step = await replayEntry(ctx, entry);
        if (!step.ok) return finish(run, "failed");
        if (step.value.kind === "out_of_time") break;
        run.items.push(step.value.item);
        if (step.value.similar !== null) run.similar.push(step.value.similar);
        emit(run);
      }
      finish(run, cancelled ? "cancelled" : "done");
    } finally {
      runner.close("idle");
    }
  }

  /** 시작 단계: 후보 찾기, 실행기 열기, 지점의 핸들러 확인. 실패하면 실행을 만들지 않는다 */
  async function start(
    run: RunRecord,
    createRunner: () => CandidateRunner,
    params: BacktestRunParams,
  ): Promise<Result<true, RunStartError>> {
    const resolved = await deps.resolveCandidate(params.candidate);
    if (!resolved.ok) return err({ kind: "candidate_not_found", message: resolved.error.message });
    const candidate = resolved.value;
    if (candidate.entry === null) return err({ kind: "hook_not_replayable" });
    const runner = createRunner();
    const opened = await runner.open({
      name: candidate.name,
      versionId: candidate.versionId,
      root: candidate.root,
      manifest: candidate.manifest,
      entry: candidate.entry,
      settings: {},
    });
    if (!opened.ok) {
      runner.close("idle");
      return err({ kind: "isolation_unavailable" });
    }
    if (runner.handlersFor(params.hook).length === 0) {
      runner.close("idle");
      return err({ kind: "hook_not_replayable" });
    }
    detach(execute(run, runner, params, deps.settings()), () => {
      finish(run, "failed");
    });
    return ok(true);
  }

  async function begin(
    params: BacktestRunParams,
  ): Promise<Result<BacktestRunResult, RunStartError>> {
    // 격리가 없으면 아무것도 읽지 않고 끝낸다(규칙 46, 수용 시험 a)
    const isolation = deps.isolation();
    if (!isolation.available) return err({ kind: "isolation_unavailable" });
    if (active !== undefined) return err({ kind: "busy" });
    const record: RunRecord = {
      id: deps.newRunId(),
      state: "queued",
      total: 0,
      turns: 0,
      calls: 0,
      items: [],
      similar: [],
      cancelRequested: false,
      finished: deferred(),
    };
    active = record;
    runs.set(record.id, record);
    let accepted = false;
    try {
      const started = await start(record, isolation.createRunner, params);
      if (!started.ok) return started;
      accepted = true;
      return ok({ runId: record.id });
    } finally {
      // 시작하지 못했으면(또는 시작 중 던졌으면) 실행을 남기지 않고 자리를 비운다
      if (!accepted) {
        runs.delete(record.id);
        if (active === record) active = undefined;
      }
    }
  }

  function status(runId: string): Result<BacktestStatusResult, RunNotFound> {
    const found = runs.get(runId);
    if (found === undefined) return err({ kind: "run_not_found" });
    return ok({ state: found.state, done: found.items.length, total: found.total });
  }

  function result(runId: string, cursor?: string): Result<BacktestResultResult, ResultReadError> {
    const found = runs.get(runId);
    if (found === undefined) return err({ kind: "run_not_found" });
    const offset = offsetOf(cursor, found.items.length);
    if (!offset.ok) return offset;
    const end = Math.min(found.items.length, offset.value + RESULT_PAGE);
    return ok({
      summary: summaryOf(found),
      items: found.items.slice(offset.value, end),
      notReproducible: [...NOT_REPRODUCIBLE],
      next: end < found.items.length ? `pg_${end}` : null,
    });
  }

  function cancel(runId: string): Result<true, RunNotFound> {
    const found = runs.get(runId);
    if (found === undefined) return err({ kind: "run_not_found" });
    if (!isTerminal(found.state)) found.cancelRequested = true;
    return ok(true);
  }

  return {
    run: begin,
    status,
    result,
    cancel,
    onProgress(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    whenDone(runId) {
      return runs.get(runId)?.finished.promise ?? Promise.resolve();
    },
  };
}
