import { Bug, parse } from "@xeon/contracts";
import {
  GoalIdSchema,
  ReportIdSchema,
  type CallOptions,
  type GoalId,
  type ReportId,
} from "@xeon/contracts/capabilities";
import type { ThreadId, Usage } from "@xeon/contracts/conversation";

/** 문자열을 목표 ID로 좁힌다. 형식이 틀리면 시험 입력의 결함이다 */
export function gid(raw: string): GoalId {
  const parsed = parse(GoalIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a goal id`);
  return parsed.value;
}

export function rid(raw: string): ReportId {
  const parsed = parse(ReportIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a report id`);
  return parsed.value;
}

/** 호출자를 바꾼 옵션. 위임 판정자 검사에 쓴다 */
export function asCaller(
  options: CallOptions,
  caller: NonNullable<CallOptions["context"]>["caller"],
  threadId: ThreadId,
): CallOptions {
  return { ...options, context: { threadId, caller } };
}

/** 사용량 하나. 시험 입력의 값이 읽기 쉽게 숫자만 받는다 */
export function usage(input: number, output: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}
