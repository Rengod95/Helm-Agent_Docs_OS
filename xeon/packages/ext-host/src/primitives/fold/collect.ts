import { attempt, parse } from "@xeon/contracts";
import { POINTS, type CollectPointName } from "@xeon/contracts/extensions";
import { collectRuleOf } from "../../erase.ts";
import type { CollectOutcome, HandlerFailure, HandlerRef } from "../dispatch-types.ts";
import type { HandlerEntry } from "../registry.ts";
import { eachInOrder } from "../sequence.ts";
import type { FoldEnv } from "./env.ts";

export interface CollectOptions {
  readonly initial: unknown;
}

/**
 * collect: 순차 await. 모든 핸들러가 원본 payload만 받는다(current 없음).
 * `undefined`가 아닌 반환값을 등록 순서대로 모은 뒤 COLLECT_RULES[point].merge가 initial에 한 번 합친다.
 * 던지거나 시간 초과, 스키마 위반, 병합 거부를 낸 핸들러는 그 기여만 빼고 계속한다(fail-open, X.primitives.spec §4.2).
 * 병합이 기여 하나를 거부하면 그 기여를 뺀 나머지로 다시 합친다
 */
export async function foldCollect(
  env: FoldEnv,
  point: CollectPointName,
  entries: readonly HandlerEntry[],
  payload: unknown,
  options: CollectOptions,
): Promise<CollectOutcome<unknown>> {
  const rule = collectRuleOf(point);
  const schema = POINTS[point].result;
  const check = env.strict;
  const contributions: { readonly entry: HandlerEntry; readonly value: unknown }[] = [];
  const failures: HandlerFailure[] = [];

  await eachInOrder(entries, async (entry) => {
    const result = await env.runOne(entry, [payload]);
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
    contributions.push({ entry, value: result.value });
    env.settled(entry, result.activeMs);
    return "continue";
  });

  const all = attempt(() =>
    rule.merge(
      options.initial,
      contributions.map((item) => item.value),
    ),
  );
  if (all.ok) {
    return {
      fold: "collect",
      value: all.value,
      contributed: contributions.map((item) => env.refOf(item.entry)),
      failures,
    };
  }
  // 병합이 던지면 기여 단위로 다시 합쳐 거부한 핸들러만 뺀다
  let value = options.initial;
  const accepted: unknown[] = [];
  const contributed: HandlerRef[] = [];
  for (const item of contributions) {
    const merged = attempt(() => rule.merge(options.initial, [...accepted, item.value]));
    if (merged.ok) {
      value = merged.value;
      accepted.push(item.value);
      contributed.push(env.refOf(item.entry));
    } else {
      const failure = env.failureOf(item.entry, "merge_rejected", merged.error.cause, 0);
      failures.push(failure);
      env.fail(failure);
    }
  }
  return { fold: "collect", value, contributed, failures };
}
