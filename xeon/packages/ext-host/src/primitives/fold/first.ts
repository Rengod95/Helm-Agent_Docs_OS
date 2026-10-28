import { parse } from "@xeon/contracts";
import {
  FIRST_DENY,
  POINTS,
  type FailOpenFirstPointName,
  type FirstPointName,
} from "@xeon/contracts/extensions";
import type { FirstOutcome, HandlerFailure } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import { eachInOrder } from "../sequence.ts";
import type { FoldEnv } from "./env.ts";

type ClosedFirstPointName = Exclude<FirstPointName, FailOpenFirstPointName>;

/** 지점 선언의 failure가 closed인 first 지점. FIRST_DENY 항목이 있는 지점이다 */
function isClosed(point: FirstPointName): point is ClosedFirstPointName {
  return POINTS[point].failure === "closed";
}

/**
 * first: 순차 await. failure가 closed인 지점은 예외·시간 초과·중단·스키마 위반을 FIRST_DENY로 바꾸고 멈춘다.
 * failure가 open인 지점(`session.compact.before`)은 그 핸들러를 결정 없음으로 보고 기록한 뒤 다음 핸들러로 간다.
 * undefined는 결정 없음, 그 밖의 값은 PointDecl.result 스키마를 통과해야 결정이다.
 * 0, "", null, false도 스키마 위반이라 거부로 바뀐다(Cordis bail 함정 회귀 방지, X.primitives.spec §4.3)
 */
export async function foldFirst(
  env: FoldEnv,
  point: FirstPointName,
  entries: readonly HandlerEntry[],
  payload: unknown,
): Promise<FirstOutcome<unknown>> {
  const failures: HandlerFailure[] = [];
  const schema = POINTS[point].result;
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

  await eachInOrder(entries, async (entry) => {
    const result = await env.runOne(entry, [payload]);
    if (result.kind === "aborted") {
      if (!closed) return "continue";
      outcome = deny(entry);
      return "stop";
    }
    if (result.kind === "failed") {
      failures.push(result.failure);
      env.fail(result.failure);
      if (!closed) return "continue";
      outcome = deny(entry);
      return "stop";
    }
    if (result.value === undefined) {
      env.settled(entry, result.activeMs);
      return "continue";
    }
    // 결정 스키마 검사는 strict와 무관하게 항상 한다. first는 보안 지점이다
    if (schema === undefined || !parse(schema, result.value).ok) {
      const failure = env.failureOf(entry, "result_invalid", undefined, result.activeMs);
      failures.push(failure);
      env.fail(failure);
      if (!closed) return "continue";
      outcome = deny(entry);
      return "stop";
    }
    env.settled(entry, result.activeMs);
    outcome = {
      fold: "first",
      decision: result.value,
      decidedBy: env.refOf(entry),
      substituted: false,
      failures,
    };
    return "stop";
  });
  return outcome;
}
