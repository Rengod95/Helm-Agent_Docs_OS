import { assertNever, Bug, err, ok, parse, type Result } from "@fresnel/contracts";
import type {
  DriveCommand,
  DriveLockBudget,
  DriveLimits,
  DriveStep,
  SpawnOutcome,
  StepResult,
  TurnOutcome,
} from "@fresnel/contracts/extensions";
import type { OrchestrationApi } from "@fresnel/group-sdk";
import { Type } from "typebox";
import { dedupeFindings } from "./findings.ts";
import { failureOfRefusal, failureOfTurn, type HelmFailure } from "./failures.ts";
import type { ExplorationMarker } from "./guard.ts";
import { gatherContext } from "./knowledge.ts";
import { BUILTIN_LENSES, selectLenses } from "./lenses.ts";
import { linkWork, recordDiscoveries, recordFinished } from "./outputs.ts";
import { transition, type HelmEvent } from "./phase.ts";
import {
  applyPrompt,
  divergePrompt,
  explorerTask,
  finishedNotice,
  phaseNotice,
  pluginResultNotice,
  postRequestId,
  type PluginOutcome,
} from "./prompts.ts";
import { reactionOf } from "./reaction.ts";
import type { HelmSettings } from "./settings.ts";
import {
  fitState,
  HelmStateSchema,
  pluginNeedOf,
  type HelmLens,
  type HelmPhase,
  type HelmPluginNeed,
  type HelmState,
  type InquiryId,
} from "./state.ts";

type DriveApi = Pick<OrchestrationApi<HelmState>, "record" | "post" | "capability">;
type Command = DriveCommand<HelmState>;
type TurnCommand = Extract<Command, { readonly do: "turn" }>;
type Limit = "turns" | "spawns" | "tokens";

/** 플러그인 제작을 맡는 내장 그룹(plugin-builder)의 이름. 매니페스트 `name`과 같다 */
export const BUILDER_PLUGIN = "authoring";

/** 맡은 쪽이 `done`으로 돌려주는 값(plugin-builder `accepted`). 모양이 맞지 않으면 답을 읽지 못한 것이다 */
const HandoffReplySchema = Type.Object({
  accepted: Type.Boolean(),
  reason: Type.Optional(Type.String({ maxLength: 200 })),
});

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

/**
 * 단계 호출의 문맥. `budget`은 이 호출이 볼 때의 남은 한도다. 한 호출은 효과 명령을 하나만 내고(그 앞뒤에
 * `commit`이 붙을 수 있다), 효과 전에 한도를 본 값이 그 명령에 맞는다
 */
interface Ctx {
  readonly g: DriveApi;
  readonly settings: () => HelmSettings;
  readonly budget: DriveLockBudget;
}

/**
 * g.drive에 넘기는 단계 함수(L3.helm.spec §4.5). 엔진이 단계마다 부른다. 입력은 커밋된 상태와 직전 명령의 결과다.
 * 클로저 지역 변수에 진행 상태를 두지 않는다: 같은 단계가 재시작 뒤 다시 와도 같은 명령을 낸다.
 * 표지(`marker`)는 명령이 효과를 내는 동안 그 단계다. 엔진은 명령을 이 함수 밖에서 실행하므로, 끝내는 명령(done, yield)과
 * 오류에서 idle로 되돌린다
 */
export function helmDrive(
  g: DriveApi,
  settings: () => HelmSettings,
  marker: ExplorationMarker,
): DriveStep<HelmState> {
  return async ({ state, last, budget }) => {
    marker.phase = state.phase;
    try {
      const command = await nextCommand({ g, settings, budget }, state, last);
      marker.phase = phaseOfEffect(command, state.phase);
      return command;
    } catch (error) {
      marker.phase = "idle";
      throw error;
    }
  };
}

/** 명령이 효과를 내는 단계. 커밋 뒤의 명령은 커밋된 단계에서 돈다. 끝내는 명령은 idle이다 */
function phaseOfEffect(command: Command, phase: HelmPhase): HelmPhase {
  switch (command.do) {
    case "commit":
      return phaseOfEffect(command.next, command.state.phase);
    case "done":
    case "yield":
      return "idle";
    case "turn":
    case "spawn":
    case "model":
    case "tool":
    case "ask":
    case "handoff":
      return phase;
    default:
      return assertNever(command, "phaseOfEffect");
  }
}

async function nextCommand(
  ctx: Ctx,
  state: Readonly<HelmState>,
  last: StepResult | null,
): Promise<Command> {
  // 맡기기 결과는 중지 표지보다 먼저 본다. 요청이 없으면(중지로 취소됨) 결과는 알림 없이 지나간다
  const need = pluginNeedOf(state);
  const outcome = pluginOutcomeOf(last);
  if (need !== null && outcome !== undefined) return pluginSettle(ctx, state, need, outcome);
  if (state.stopRequested) return step(ctx, state, { type: "stopRequested" });
  // 사용자 메시지는 `turn`으로 처리하고 원래 단계로 이어 간다(drive-isolation 2.4). 턴 한도가 없으면 턴을 낼 수 없어 단계 진행으로 넘긴다
  if (last?.kind === "user" && turnLimitOf(ctx.budget) === undefined) {
    return { do: "turn", input: last.message };
  }
  return advance(ctx, state, last?.kind === "user" ? null : last);
}

/** 상태와 직전 결과로 다음 명령을 정한다. 단계마다 "아직 안 한 일"을 상태와 `last`로 판정한다 */
async function advance(
  ctx: Ctx,
  state: Readonly<HelmState>,
  last: StepResult | null,
): Promise<Command> {
  if (last?.kind === "refused") return settle(ctx, state, failureOfRefusal(last.code));
  if (state.phase === "idle") {
    // 플러그인 맡기기는 탐구보다 먼저 한다. 맡긴 쪽이 끝나 요청이 비워진 뒤에야 대기 중인 탐구가 시작된다
    const need = pluginNeedOf(state);
    if (need !== null) return handoffOf(need);
    if (state.pending === null) return { do: "done" };
    const lenses = selectLenses(state.pending, ctx.settings().maxLenses, BUILTIN_LENSES);
    return step(ctx, state, { type: "leaseGranted", lenses });
  }
  const inquiry = activeInquiry(state);
  if (!inquiry.ok) return settle(ctx, state, inquiry.error);
  switch (state.phase) {
    case "diverge":
      return diverge(ctx, state, inquiry.value, last);
    case "explore":
      return explore(ctx, state, inquiry.value, last);
    case "converge":
      return converge(ctx, state, inquiry.value);
    case "apply":
      return apply(ctx, state, inquiry.value, last);
    default:
      return assertNever(state.phase, "helmDrive");
  }
}

/**
 * 플러그인 맡기기 명령(drive-isolation.md 2.2, 2.6). 맡은 쪽은 `input`의 `id`로 같은 요청의 알림을 한 번만 낸다.
 * 요청 id는 엔진이 정하므로 여기서 만들지 않는다
 */
function handoffOf(need: HelmPluginNeed): Command {
  return { do: "handoff", to: BUILDER_PLUGIN, input: { purpose: need.purpose, id: need.id } };
}

/** 직전 결과가 맡기기의 끝인가. 맡기기와 무관한 결과는 `undefined`다 */
function pluginOutcomeOf(last: StepResult | null): PluginOutcome | undefined {
  if (last === null) return undefined;
  if (last.kind === "handoff") {
    if (last.status === "aborted") return { kind: "aborted" };
    return replyOf(last.result);
  }
  if (last.kind === "refused") return { kind: "refused", code: last.code };
  if (last.kind === "aborted") return { kind: "aborted" };
  return undefined;
}

/** 맡은 쪽의 `done` 값을 읽는다. 모양이 맞지 않으면 답을 읽지 못한 것이다(예외가 아니다) */
function replyOf(result: unknown): PluginOutcome {
  const read = parse(HandoffReplySchema, result);
  if (!read.ok) return { kind: "unreadable" };
  if (read.value.accepted) return { kind: "accepted" };
  return { kind: "declined", reason: read.value.reason ?? null };
}

/**
 * 맡기기가 끝났다: 결과를 알림으로 남기고 요청을 비운다. 비운 상태를 커밋한 뒤 이어 할 일을 본다(대기 중인 탐구가 있으면 그 시작).
 * 알림 requestId는 요청 id에서 정해져 재시작 뒤 같은 단계가 다시 와도 한 번만 난다
 */
async function pluginSettle(
  ctx: Ctx,
  state: Readonly<HelmState>,
  need: HelmPluginNeed,
  outcome: PluginOutcome,
): Promise<Command> {
  await ctx.g.post(pluginResultNotice(need.purpose, outcome), {
    when: "next",
    requestId: `helm:plugin:${need.id}:result`,
  });
  return commitThen(ctx, { ...state, pluginNeed: null });
}

/** 실패를 반응으로 바꾼다(L3.helm.spec §4.12). 끝내는 반응만 상태를 바꾸고, 나머지는 커밋 없이 반환한다 */
async function settle(
  ctx: Ctx,
  state: Readonly<HelmState>,
  failure: HelmFailure,
): Promise<Command> {
  const reaction = reactionOf(failure, state.phase);
  if (reaction.type === "finish") return step(ctx, state, reaction.event);
  // 출처 저하(degrade)와 렌즈 실패(lens_failed)는 gatherContext·linkWork와 explore가 자기 자리에서 처리하므로 여기에 오지 않는다
  return { do: "yield" };
}

/**
 * 전이 하나를 적용한다. 탐구가 끝나면 종료 기록과 알림을 먼저 낸다(record → post → commit). 그다음 커밋과 이어질 명령을 정한다
 */
async function step(ctx: Ctx, state: Readonly<HelmState>, event: HelmEvent): Promise<Command> {
  const { finished, state: next } = transition(state, event);
  if (finished !== undefined) {
    await recordFinished(ctx.g, finished);
    await ctx.g.post(finishedNotice(finished), {
      when: "next",
      requestId: `${postRequestId(finished.inquiryId, state.phase, state.round)}:${finished.outcome === "limit" ? "limit" : "finished"}`,
    });
  }
  if (
    state.inquiryId !== null &&
    state.phase !== "idle" &&
    next.phase !== "idle" &&
    state.phase !== next.phase
  ) {
    await ctx.g.post(phaseNotice(state.phase, next.phase), {
      when: "next",
      requestId: `${postRequestId(state.inquiryId, state.phase, state.round)}:phase`,
    });
  }
  return commitThen(ctx, next);
}

/** 상태를 커밋하는 명령을 만든다. 커밋 뒤의 명령은 커밋될 상태를 보고 정한다 */
async function commitThen(ctx: Ctx, next: Readonly<HelmState>): Promise<Command> {
  const fitted = fittedState(next);
  return { do: "commit", state: fitted, next: await advance(ctx, fitted, null) };
}

/** 크기 맞춤과 스키마 검사(L3.helm.spec §4.1). 스키마를 어기는 값은 Helm 코드의 잘못이다 */
function fittedState(next: Readonly<HelmState>): HelmState {
  const fitted = fitState(next).state;
  if (!parse(HelmStateSchema, fitted).ok) {
    throw new Bug("helm.drive: the next state is outside HelmStateSchema");
  }
  return fitted;
}

/** 턴 명령을 낸다. 표지가 없으면 턴을 내기 전에 `awaitingTurn`을 커밋한다(결과를 기다리는 턴임을 남긴다) */
function issueTurn(state: Readonly<HelmState>, turn: TurnCommand): Command {
  if (state.awaitingTurn) return turn;
  return { do: "commit", state: fittedState({ ...state, awaitingTurn: true }), next: turn };
}

/** 턴을 낼 수 없는 한도. turns나 tokens가 0이면 엔진이 lease_budget으로 거부하므로 미리 본다 */
function turnLimitOf(budget: DriveLockBudget): Limit | undefined {
  if (budget.turns === 0) return "turns";
  return budget.tokens === 0 ? "tokens" : undefined;
}

/** spawn을 낼 수 없는 한도 */
function spawnLimitOf(budget: DriveLockBudget): Limit | undefined {
  if (budget.spawns === 0) return "spawns";
  return budget.tokens === 0 ? "tokens" : undefined;
}

/** 직전 결과가 턴의 결과인가. 사용자 중지로 끊긴 턴은 `aborted`다 */
function turnResultOf(last: StepResult | null): TurnOutcome | "aborted" | undefined {
  if (last?.kind === "aborted") return "aborted";
  if (last?.kind === "ok" && last.of === "turn") return last.value;
  return undefined;
}

/** 직전 결과가 spawn의 결과인가 */
function spawnResultOf(last: StepResult | null): SpawnOutcome | undefined {
  return last?.kind === "ok" && last.of === "spawn" ? last.value : undefined;
}

async function diverge(
  ctx: Ctx,
  state: Readonly<HelmState>,
  inquiry: ActiveInquiry,
  last: StepResult | null,
): Promise<Command> {
  const result = turnResultOf(last);
  if (result === "aborted") {
    return settle(ctx, state, { kind: "turn", phase: "diverge", status: "aborted" });
  }
  // 표지가 켜진 뒤의 턴 결과가 발산 턴의 결과다. 사용자 메시지의 턴 결과는 표지가 없을 때만 온다
  if (result !== undefined && state.awaitingTurn) {
    const failure = failureOfTurn(result, "diverge");
    if (failure !== undefined) return settle(ctx, state, failure);
    return step(ctx, state, { type: "diverged", outcome: result });
  }
  const limit = turnLimitOf(ctx.budget);
  if (limit !== undefined) return settle(ctx, state, { kind: "budget", limit });
  return issueTurn(state, {
    do: "turn",
    input: divergePrompt(state),
    requestId: turnRequestId(inquiry.inquiryId, "diverge", inquiry.round),
  });
}

/** 렌즈 라벨: "렌즈 실패 사례". `SpawnSpec.label` 상한 64자 안으로 자른다 */
function lensLabel(title: string): string {
  return `렌즈 ${title}`.slice(0, 64);
}

/** 렌즈 spawn 결과를 렌즈 결과로 바꾼다. 완료되지 않은 결과는 그 렌즈의 spawn 실패다 */
function lensOutcomeOf(lensId: string, outcome: SpawnOutcome): Result<SpawnOutcome, HelmFailure> {
  if (outcome.status === "completed") return ok(outcome);
  return err({ kind: "spawn", lensId, status: outcome.status });
}

function firstLensWith(
  state: Readonly<HelmState>,
  status: HelmLens["status"],
): HelmLens | undefined {
  return state.lenses.find((lens) => lens.status === status);
}

/**
 * 렌즈는 한 번에 하나씩 spawn한다. 실행 중인 렌즈는 순서상 첫 번째 `running`이다(lensesStarted가 시작 표시를 한꺼번에 하고
 * 결과는 순서대로 받는다). 결과를 받으면 그 렌즈를 상태에 커밋하고, 다음 렌즈를 낸다
 */
async function explore(
  ctx: Ctx,
  state: Readonly<HelmState>,
  inquiry: ActiveInquiry,
  last: StepResult | null,
): Promise<Command> {
  const spawned = spawnResultOf(last);
  const running = firstLensWith(state, "running");
  if (spawned !== undefined && running !== undefined) {
    const next = transition(state, {
      type: "lensFinished",
      lensId: running.id,
      outcome: lensOutcomeOf(running.id, spawned),
    }).state;
    return commitThen(ctx, next);
  }
  const todo = state.lenses.filter(
    (lens) => lens.status === "pending" || lens.status === "running",
  );
  if (todo.length === 0) return step(ctx, state, { type: "explored" });
  const limit = spawnLimitOf(ctx.budget);
  if (limit !== undefined) {
    // 한도가 모자라면 렌즈 하나라도 끝났을 때는 남은 렌즈를 건너뛰고 수렴한다(옛 동작). 한 렌즈도 끝나지 않았을 때만 한도 실패다
    const anyDone = state.lenses.some((lens) => lens.status === "done" || lens.status === "failed");
    return anyDone
      ? step(ctx, state, { type: "explored" })
      : settle(ctx, state, { kind: "budget", limit });
  }
  if (state.lenses.some((lens) => lens.status === "pending")) {
    return commitThen(ctx, transition(state, { type: "lensesStarted" }).state);
  }
  if (running === undefined) {
    return settle(ctx, state, {
      kind: "state_inconsistent",
      detail: "explore without a running lens",
    });
  }
  return {
    do: "spawn",
    agent: "explorer",
    task: explorerTask(state, running, BUILTIN_LENSES),
    label: lensLabel(running.title),
    requestId: spawnRequestId(inquiry.inquiryId, inquiry.round, running.id),
  };
}

async function converge(
  ctx: Ctx,
  state: Readonly<HelmState>,
  inquiry: ActiveInquiry,
): Promise<Command> {
  // 지식 수집은 실패하지 않는다(출처별로 저하한다). 읽기라서 다시 불려도 같은 결과를 얻는다
  const digest = await gatherContext(ctx.g, inquiry);
  return step(ctx, state, {
    type: "converged",
    findings: dedupeFindings(state.findings),
    context: digest.sources,
  });
}

async function apply(
  ctx: Ctx,
  state: Readonly<HelmState>,
  inquiry: ActiveInquiry,
  last: StepResult | null,
): Promise<Command> {
  const result = turnResultOf(last);
  if (result === "aborted") {
    await recordDiscoveries(ctx.g, state, inquiry.inquiryId, undefined);
    return settle(ctx, state, { kind: "turn", phase: "apply", status: "aborted" });
  }
  if (result !== undefined && state.awaitingTurn) {
    // 발견은 턴 결과와 같이 기록한다. 적용됐는지는 턴이 완료됐는지로 정한다
    await recordDiscoveries(
      ctx.g,
      state,
      inquiry.inquiryId,
      result.status === "completed" ? result : undefined,
    );
    const failure = failureOfTurn(result, "apply");
    if (failure !== undefined) return settle(ctx, state, failure);
    const linked = await linkWork(ctx.g, state, inquiry.inquiryId);
    if (linked.leaseLost) return { do: "yield" };
    return step(ctx, state, { type: "applied", outcome: result });
  }
  const limit = turnLimitOf(ctx.budget);
  if (limit !== undefined) {
    // 적용 없이 발견만 기록한다(applied: false)
    await recordDiscoveries(ctx.g, state, inquiry.inquiryId, undefined);
    return settle(ctx, state, { kind: "budget", limit });
  }
  return issueTurn(state, {
    do: "turn",
    input: applyPrompt(state),
    requestId: turnRequestId(inquiry.inquiryId, "apply", inquiry.round),
  });
}
