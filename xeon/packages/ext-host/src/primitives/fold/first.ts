import { Bug, parse } from "@fresnel/contracts";
import {
  FIRST_DENY,
  FIRST_RANK,
  HOOKS,
  decisionKindOf,
  type DecisionKind,
  type HookRunDecision,
  type FailOpenFirstHookName,
  type FirstHookName,
  type MergedFirstHookName,
} from "@fresnel/contracts/extensions";
import type { FirstOutcome, HandlerFailure } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import { eachInOrder } from "../sequence.ts";
import type { FoldEnv } from "./env.ts";

type ClosedFirstHookName = Exclude<FirstHookName, FailOpenFirstHookName>;

/** 훅 선언의 failure가 closed인 first 훅. FIRST_DENY 항목이 있는 지점이다 */
function isClosed(point: FirstHookName): point is ClosedFirstHookName {
  return HOOKS[point].failure === "closed";
}

/** 합치기 지점(M5e 스펙 §5.1 H-2). 모든 핸들러를 돌린 뒤 순위가 가장 강한 결정이 이긴다. 나머지 first 훅은 처음 결정에서 멈춘다 */
function isMergedHook(point: FirstHookName): point is MergedFirstHookName {
  return point === "tool.call.before" || point === "agent.spawn.before";
}

/** 종류의 순위 색인(작을수록 강하다). 순위 표가 세 종류를 모두 담으므로 없는 종류는 불변 조건 위반이다 */
function rankOf(ranks: readonly DecisionKind[], kind: DecisionKind): number {
  const index = ranks.indexOf(kind);
  if (index < 0) throw new Bug(`dispatch.rank_missing: ${kind}`);
  return index;
}

/** 결정이 요청을 막는가. 거부 결정(`FIRST_DENY`)의 모양과 같은 값만 센다: `block`·`cancel`이 참, `type`이 deny, `trusted`가 no. 외부 훅 실행기의 계측 결과(`blocked`)도 이 기준을 쓴다 */
export function isBlocking(decision: unknown): boolean {
  if (typeof decision !== "object" || decision === null) return false;
  return (
    ("block" in decision && decision.block === true) ||
    ("cancel" in decision && decision.cancel === true) ||
    ("type" in decision && decision.type === "deny") ||
    ("trusted" in decision && decision.trusted === "no")
  );
}

/**
 * 값을 낸 핸들러의 결정값(턴 기록 §4.2 규칙 12). 막음이 아니어도 뜻이 있는 모양을 가려낸다: `block`, `cancel`, `replace`, `ask`, `answer`.
 * 그 밖에 막음 기준(`isBlocking`)에 걸리면 `block`이고, 아무것도 아니면 `none`이다. 결과(`blocked`·`passed`)는 이 값과 상관없이 정한다
 */
export function hookDecisionOf(value: unknown): HookRunDecision {
  if (typeof value !== "object" || value === null) return "none";
  if ("block" in value && value.block === true) return "block";
  if ("cancel" in value && value.cancel === true) return "cancel";
  if ("replace" in value) return "replace";
  if ("ask" in value && value.ask === true) return "ask";
  if ("answer" in value) return "answer";
  return isBlocking(value) ? "block" : "none";
}

/** 합치기 지점에서 지금까지 가장 강한 결정. 같은 순위면 먼저 온 핸들러가 남는다 */
interface Strongest {
  readonly value: unknown;
  readonly entry: HandlerEntry;
  readonly rank: number;
}

/**
 * first: 순차 await. failure가 closed인 지점은 예외·시간 초과·중단·스키마 위반을 FIRST_DENY로 바꾸고 멈춘다.
 * failure가 open인 지점(`thread.compact.before`, `ask.human.before`)은 그 핸들러를 결정 없음으로 보고 기록한 뒤 다음 핸들러로 간다.
 * undefined는 결정 없음, 그 밖의 값은 HookDecl.result 스키마를 통과해야 결정이다.
 * 0, "", null, false도 스키마 위반이라 거부로 바뀐다(Cordis bail 함정 회귀 방지, X.primitives.spec §4.3)
 *
 * 합치기 지점(FIRST_RANK: `tool.call.before`, `agent.spawn.before`)은 `ask`와 `replace`에서 멈추지 않는다. 모든 핸들러를 돌린 뒤
 * `block` > `replace` > `ask`에서 가장 강한 결정이 이긴다. 같은 종류 안에서는 먼저 온 핸들러가 이긴다. `block`은 어느 순위보다 강하므로 거기서 멈춘다.
 * 합치기 지점의 핸들러는 모두 원본 payload를 받는다
 */
export async function foldFirst(
  env: FoldEnv,
  point: FirstHookName,
  entries: readonly HandlerEntry[],
  payload: unknown,
): Promise<FirstOutcome<unknown>> {
  const failures: HandlerFailure[] = [];
  const schema = HOOKS[point].result;
  const ranks = isMergedHook(point) ? FIRST_RANK[point] : undefined;
  let strongest: Strongest | undefined;
  let outcome: FirstOutcome<unknown> = {
    fold: "first",
    decision: undefined,
    decidedBy: null,
    substituted: false,
    failures,
  };

  const closed = isClosed(point);
  const deny = (entry: HandlerEntry): FirstOutcome<unknown> => ({
    fold: "first",
    decision: isClosed(point) ? FIRST_DENY[point] : undefined,
    decidedBy: env.refOf(entry),
    substituted: true,
    failures,
  });

  let index = -1;
  await eachInOrder(entries, async (entry) => {
    index += 1;
    const result = await env.runOne(entry, [payload]);
    if (result.kind === "aborted") {
      env.noteLost(entry, result);
      if (!closed) return "continue";
      outcome = deny(entry);
      env.skip(entries.slice(index + 1), entry);
      return "stop";
    }
    if (result.kind === "failed") {
      env.noteLost(entry, result);
      failures.push(result.failure);
      env.fail(result.failure);
      if (!closed) return "continue";
      outcome = deny(entry);
      env.skip(entries.slice(index + 1), entry);
      return "stop";
    }
    if (result.value === undefined) {
      env.noteOk(entry, result, { result: "passed" });
      env.settled(entry, result.activeMs);
      return "continue";
    }
    // 결정 스키마 검사는 strict와 무관하게 항상 한다. first는 보안 지점이다
    if (schema === undefined || !parse(schema, result.value).ok) {
      env.noteOk(entry, result, { result: "failed", reason: "result_invalid" });
      const failure = env.failureOf(entry, "result_invalid", undefined, result.activeMs);
      failures.push(failure);
      env.fail(failure);
      if (!closed) return "continue";
      outcome = deny(entry);
      env.skip(entries.slice(index + 1), entry);
      return "stop";
    }
    if (ranks !== undefined) {
      // 스키마를 통과했으므로 세 모양 가운데 하나다. 아니면 검사가 깨진 것이다
      const kind = decisionKindOf(result.value);
      if (kind === null) throw new Bug(`dispatch.decision_kind: ${point}`);
      if (kind === "block") {
        env.noteOk(entry, result, { result: "blocked", decision: "block" });
        env.settled(entry, result.activeMs);
        outcome = {
          fold: "first",
          decision: result.value,
          decidedBy: env.refOf(entry),
          substituted: false,
          failures,
        };
        env.skip(entries.slice(index + 1), entry);
        return "stop";
      }
      // ask와 replace는 뒤 핸들러를 멈추지 않는다. 결과는 `passed`이고 결정만 기록에 남는다
      env.noteOk(entry, result, { result: "passed", decision: kind });
      env.settled(entry, result.activeMs);
      const rank = rankOf(ranks, kind);
      if (strongest === undefined || rank < strongest.rank) {
        strongest = { value: result.value, entry, rank };
      }
      return "continue";
    }
    env.noteOk(entry, result, {
      result: isBlocking(result.value) ? "blocked" : "passed",
      decision: hookDecisionOf(result.value),
    });
    env.settled(entry, result.activeMs);
    outcome = {
      fold: "first",
      decision: result.value,
      decidedBy: env.refOf(entry),
      substituted: false,
      failures,
    };
    env.skip(entries.slice(index + 1), entry);
    return "stop";
  });
  // 합치기 지점에서 막음이나 거부로 멈추지 않았다면 모은 가장 강한 결정이 이긴다. 거부(FIRST_DENY)나 막음은 이미 decision이 있다
  if (strongest !== undefined && outcome.decision === undefined) {
    outcome = {
      fold: "first",
      decision: strongest.value,
      decidedBy: env.refOf(strongest.entry),
      substituted: false,
      failures,
    };
  }
  return outcome;
}
