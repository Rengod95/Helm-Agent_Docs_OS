import { assertNever, attemptAsync, err, ok, rethrow, type Result } from "@xeon/contracts";
import type {
  DriveFn,
  DriveLimits,
  LoopHandle,
  SpawnOutcome,
  TurnOutcome,
} from "@xeon/contracts/extensions";
import type { GroupApi } from "@xeon/group-kit";
import { dedupeFindings } from "./findings.ts";
import { failureOf, type FailureSite, type HelmFailure } from "./failures.ts";
import { gatherContext } from "./knowledge.ts";
import { BUILTIN_LENSES, selectLenses } from "./lenses.ts";
import { linkWork, recordDiscoveries, recordFinished } from "./outputs.ts";
import { transition, type HelmEvent, type LensResult } from "./phase.ts";
import {
  applyPrompt,
  divergePrompt,
  explorerTask,
  finishedNotice,
  postRequestId,
} from "./prompts.ts";
import { reactionOf } from "./reaction.ts";
import type { HelmSettings } from "./settings.ts";
import { updateState, type HelmLens, type HelmState, type InquiryId } from "./state.ts";

type DriveApi = Pick<GroupApi<HelmState>, "state" | "commit" | "record" | "post" | "capability">;

function pick(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  return right === undefined ? left : Math.min(left, right);
}

/** 필드별 작은 값. undefined는 상한 없음 */
export function minLimits(a: DriveLimits | undefined, b: DriveLimits | undefined): DriveLimits {
  const maxTurns = pick(a?.maxTurns, b?.maxTurns);
  const maxSpawns = pick(a?.maxSpawns, b?.maxSpawns);
  const maxTokens = pick(a?.maxTokens, b?.maxTokens);
  return {
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(maxSpawns === undefined ? {} : { maxSpawns }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

/** loop.turn requestId. 64자 이하 */
export function turnRequestId(
  inquiryId: InquiryId,
  phase: "diverge" | "apply",
  round: number,
): string {
  return `helm:${inquiryId}:turn:${phase}:${String(round)}`;
}

/** loop.spawn requestId. 64자 이하 */
export function spawnRequestId(inquiryId: InquiryId, round: number, lensId: string): string {
  return `helm:${inquiryId}:spawn:${String(round)}:${lensId}`;
}

/** 탐구 단계에서 반드시 있는 값. idle이 아니면 inquiryId와 topic이 있어야 한다 */
export interface ActiveInquiry {
  readonly inquiryId: InquiryId;
  readonly topic: string;
  readonly round: number;
}

/** 순수 함수. 탐구 단계인데 inquiryId·topic이 없으면 state_inconsistent 실패를 돌려준다 */
export function activeInquiry(
  state: Readonly<HelmState>,
): Result<ActiveInquiry, Extract<HelmFailure, { kind: "state_inconsistent" }>> {
  if (state.inquiryId === null || state.topic === null) {
    return err({
      kind: "state_inconsistent",
      detail: `phase ${state.phase} without ${state.inquiryId === null ? "inquiryId" : "topic"}`,
    });
  }
  return ok({ inquiryId: state.inquiryId, topic: state.topic, round: state.round });
}

/** 예상 가능한 실패를 값으로 바꾼다. 모르는 예외는 다시 던진다 */
async function guarded<T>(
  call: () => Promise<T>,
  at: FailureSite = {},
): Promise<Result<T, HelmFailure>> {
  const called = await attemptAsync(call);
  if (called.ok) return ok(called.value);
  const failure = failureOf(called.error.cause, at);
  if (failure === undefined) return rethrow(called.error.cause);
  return err(failure);
}

function turnResult(
  out: Result<TurnOutcome, HelmFailure>,
  phase: "diverge" | "apply",
): Result<TurnOutcome, HelmFailure> {
  if (!out.ok) return out;
  if (out.value.status === "completed")
    return ok({ turnId: out.value.turnId, status: "completed" });
  return err({ kind: "turn", phase, status: out.value.status });
}

/**
 * 전이를 적용한다. 탐구가 끝나는 전이면 종료 기록과 알림을 먼저 내고 상태를 커밋한다(record → commit).
 * 같은 임대와 같은 상태 판에서 다시 불리면 기록은 X가 같은 키로 받는다
 */
async function step(g: DriveApi, event: HelmEvent): Promise<Result<void, HelmFailure>> {
  const before = g.state();
  const { finished } = transition(before, event);
  if (finished !== undefined) {
    await recordFinished(g, finished);
    await g.post(finishedNotice(finished), {
      when: "next",
      requestId: `${postRequestId(finished.inquiryId, before.phase, before.round)}:${finished.outcome === "limit" ? "limit" : "finished"}`,
    });
  }
  const written = await updateState(g, (current) => transition(current, event).state);
  return written.ok ? ok(undefined) : err(written.error);
}

/** 실패에 대한 처리(L3.helm.spec §4.12). 끝내는 전이가 다시 실패하면 커밋 없이 반환한다 */
async function settle(
  g: DriveApi,
  state: Readonly<HelmState>,
  result: Result<unknown, HelmFailure>,
): Promise<void> {
  if (result.ok) return;
  const reaction = reactionOf(result.error, state.phase);
  if (reaction.type === "finish") await step(g, reaction.event);
}

function toLensResults(
  run: readonly HelmLens[],
  results: readonly Result<SpawnOutcome, HelmFailure>[],
): readonly LensResult[] {
  return run.flatMap((lens, index) => {
    const outcome = results[index];
    return outcome === undefined ? [] : [{ lensId: lens.id, outcome }];
  });
}

/**
 * g.drive에 넘기는 함수. 클로저 지역 변수에 진행 상태를 두지 않는다(EV-09). 한 호출은 현재 단계 하나만 처리하고 커밋한다.
 * 다음 단계는 X가 다시 부를 때 처리한다(상태만 커밋하고 반환하면 X가 새 판으로 다시 부른다)
 */
export function helmDrive(g: DriveApi, settings: () => HelmSettings): DriveFn<HelmState> {
  return (loop, st) => branch(g, settings, loop, st);
}

async function branch(
  g: DriveApi,
  settings: () => HelmSettings,
  loop: LoopHandle,
  st: Readonly<HelmState>,
): Promise<void> {
  if (st.stopRequested) {
    await settle(g, st, await step(g, { type: "stopRequested" }));
    return;
  }
  if (st.phase === "idle") {
    if (st.pending === null) return;
    const lenses = selectLenses(st.pending, settings().maxLenses, BUILTIN_LENSES);
    await settle(g, st, await step(g, { type: "leaseGranted", lenses }));
    return;
  }
  const inquiry = activeInquiry(st);
  if (!inquiry.ok) {
    await settle(g, st, inquiry);
    return;
  }
  switch (st.phase) {
    case "diverge":
      return diverge(g, loop, st, inquiry.value);
    case "explore":
      return explore(g, loop, st, inquiry.value);
    case "converge":
      return converge(g, loop, st, inquiry.value);
    case "apply":
      return apply(g, loop, st, inquiry.value);
    default:
      return assertNever(st.phase, "helmDrive");
  }
}

async function diverge(
  g: DriveApi,
  loop: LoopHandle,
  st: Readonly<HelmState>,
  inquiry: ActiveInquiry,
): Promise<void> {
  if (loop.budget.turns === 0) {
    await settle(g, st, err({ kind: "budget", limit: "turns" }));
    return;
  }
  const out = turnResult(
    await guarded(
      () =>
        loop.turn({
          input: divergePrompt(st),
          requestId: turnRequestId(inquiry.inquiryId, "diverge", inquiry.round),
        }),
      { limit: "turns" },
    ),
    "diverge",
  );
  if (!out.ok) {
    if (out.error.kind === "lease_lost") return;
    await settle(g, st, out);
    return;
  }
  await settle(g, st, await step(g, { type: "diverged", outcome: out.value }));
}

async function explore(
  g: DriveApi,
  loop: LoopHandle,
  st: Readonly<HelmState>,
  inquiry: ActiveInquiry,
): Promise<void> {
  const todo = st.lenses.filter((lens) => lens.status === "pending" || lens.status === "running");
  const room = loop.budget.spawns ?? todo.length;
  if (todo.length > 0 && room === 0) {
    await settle(g, st, err({ kind: "budget", limit: "spawns" }));
    return;
  }
  const run = todo.slice(0, room);
  if (run.some((lens) => lens.status === "pending")) {
    const started = await step(g, { type: "lensesStarted" });
    if (!started.ok) {
      await settle(g, st, started);
      return;
    }
  }
  const results = await Promise.all(
    run.map((lens) =>
      guarded(
        () =>
          loop.spawn({
            agent: "explorer",
            task: explorerTask(st, lens, BUILTIN_LENSES),
            requestId: spawnRequestId(inquiry.inquiryId, inquiry.round, lens.id),
          }),
        { limit: "spawns" },
      ),
    ),
  );
  if (results.some((result) => !result.ok && result.error.kind === "lease_lost")) return;
  await settle(g, st, await step(g, { type: "explored", results: toLensResults(run, results) }));
}

async function converge(
  g: DriveApi,
  loop: LoopHandle,
  st: Readonly<HelmState>,
  inquiry: ActiveInquiry,
): Promise<void> {
  const digest = await gatherContext(g, inquiry, { signal: loop.signal });
  await settle(
    g,
    st,
    await step(g, {
      type: "converged",
      findings: dedupeFindings(st.findings),
      context: digest.sources,
    }),
  );
}

async function apply(
  g: DriveApi,
  loop: LoopHandle,
  st: Readonly<HelmState>,
  inquiry: ActiveInquiry,
): Promise<void> {
  if (loop.budget.turns === 0) {
    await recordDiscoveries(g, st, inquiry.inquiryId, undefined);
    await settle(g, st, err({ kind: "budget", limit: "turns" }));
    return;
  }
  const out = turnResult(
    await guarded(
      () =>
        loop.turn({
          input: applyPrompt(st),
          requestId: turnRequestId(inquiry.inquiryId, "apply", inquiry.round),
        }),
      { limit: "turns" },
    ),
    "apply",
  );
  if (!out.ok && out.error.kind === "lease_lost") return;
  await recordDiscoveries(g, st, inquiry.inquiryId, out.ok ? out.value : undefined);
  if (!out.ok) {
    await settle(g, st, out);
    return;
  }
  const linked = await linkWork(g, st, inquiry.inquiryId, { signal: loop.signal });
  if (linked.leaseLost) return;
  await settle(g, st, await step(g, { type: "applied", outcome: out.value }));
}
