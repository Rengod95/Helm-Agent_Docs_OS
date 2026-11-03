import { parse } from "@fresnel/contracts";
import {
  FIRST_DENY,
  HOOKS,
  type FailOpenFirstHookName,
  type FirstHookName,
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

/** 결정이 요청을 막는가. 거부 결정(`FIRST_DENY`)의 모양과 같은 값만 센다: `block`·`cancel`이 참, `type`이 deny, `trusted`가 no */
function isBlocking(decision: unknown): boolean {
  if (typeof decision !== "object" || decision === null) return false;
  return (
    ("block" in decision && decision.block === true) ||
    ("cancel" in decision && decision.cancel === true) ||
    ("type" in decision && decision.type === "deny") ||
    ("trusted" in decision && decision.trusted === "no")
  );
}

/**
 * first: 순차 await. failure가 closed인 지점은 예외·시간 초과·중단·스키마 위반을 FIRST_DENY로 바꾸고 멈춘다.
 * failure가 open인 지점(`thread.compact.before`)은 그 핸들러를 결정 없음으로 보고 기록한 뒤 다음 핸들러로 간다.
 * undefined는 결정 없음, 그 밖의 값은 HookDecl.result 스키마를 통과해야 결정이다.
 * 0, "", null, false도 스키마 위반이라 거부로 바뀐다(Cordis bail 함정 회귀 방지, X.primitives.spec §4.3)
 */
export async function foldFirst(
  env: FoldEnv,
  point: FirstHookName,
  entries: readonly HandlerEntry[],
  payload: unknown,
): Promise<FirstOutcome<unknown>> {
  const failures: HandlerFailure[] = [];
  const schema = HOOKS[point].result;
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
    env.noteOk(entry, result, { result: isBlocking(result.value) ? "blocked" : "passed" });
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
  return outcome;
}
