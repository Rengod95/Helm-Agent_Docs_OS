import { parse } from "@xeon/contracts";
import {
  CHAIN_RULES,
  POINTS,
  type ChainPointName,
  type ChainRule,
  type PointName,
} from "@xeon/contracts/extensions";
import type { ChainOutcome, HandlerFailure, HandlerRef } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import { eachInOrder } from "../sequence.ts";
import type { FoldEnv } from "./env.ts";

/**
 * strict가 아니어도 패치 스키마를 검사하는 지점. merge가 예외 없이 잘못된 값을 만들 수 있는 교체형이다
 * (X.primitives.spec §4.2 chain 아래 [제안], M1에서 지점별 확정)
 */
const ALWAYS_CHECKED: ReadonlySet<PointName> = new Set([
  "context",
  "context_with_system",
  "before_provider_request",
]);

/** 지점 종류를 지운 병합 규칙. 지점 표(CHAIN_RULES)가 지점마다 타입이 달라 여기서 한 번만 넓힌다 */
function ruleOf(point: ChainPointName): ChainRule<unknown, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 지점별 병합 규칙의 제네릭 인자를 지운다. 입력은 PointDecl.result 스키마 검사를 거친 값뿐이다 (X.primitives.spec §4.2)
  return CHAIN_RULES[point] as unknown as ChainRule<unknown, unknown>;
}

export interface ChainOptions {
  readonly initial: unknown;
  readonly finalize?: ((value: unknown) => unknown) | undefined;
}

/**
 * chain: 순차 await. payload는 원본 그대로, current는 누적값이다.
 * 던지거나 스키마·병합을 어긴 핸들러는 그 패치만 버리고 계속한다. stop 규칙이면 멈춘다.
 * finalize는 모든 핸들러 뒤 정확히 한 번 부른다(X.primitives.spec §4.2)
 */
export async function foldChain(
  env: FoldEnv,
  point: ChainPointName,
  entries: readonly HandlerEntry[],
  payload: unknown,
  options: ChainOptions,
): Promise<ChainOutcome<unknown>> {
  const rule = ruleOf(point);
  const schema = POINTS[point].result;
  const check = env.strict || ALWAYS_CHECKED.has(point);
  let value = options.initial;
  const applied: HandlerRef[] = [];
  const failures: HandlerFailure[] = [];
  let stopped = false;

  await eachInOrder(entries, async (entry) => {
    const result = await env.runOne(entry, [payload, value]);
    if (result.kind === "aborted") return "continue";
    if (result.kind === "failed") {
      failures.push(result.failure);
      env.fail(result.failure);
      return "continue";
    }
    if (result.value === undefined) {
      env.settled(entry, result.activeMs);
      return "continue";
    }
    if (check && (schema === undefined || !parse(schema, result.value).ok)) {
      const failure = env.failureOf(entry, "result_invalid", undefined, result.activeMs);
      failures.push(failure);
      env.fail(failure);
      return "continue";
    }
    let next: unknown;
    try {
      next = rule.merge(value, result.value);
    } catch (error) {
      const failure = env.failureOf(entry, "merge_rejected", error, result.activeMs);
      failures.push(failure);
      env.fail(failure);
      return "continue";
    }
    value = next;
    applied.push(env.refOf(entry));
    env.settled(entry, result.activeMs);
    if (rule.stop?.(value) === true) {
      stopped = true;
      return "stop";
    }
    return "continue";
  });
  if (options.finalize !== undefined) value = options.finalize(value);
  return { fold: "chain", value, applied, failures, stopped };
}
