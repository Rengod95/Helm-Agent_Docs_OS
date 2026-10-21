import { test } from "bun:test";
import type { ApiOf } from "../../src/capabilities/index.ts";
import type {
  BoundaryPatch,
  BoundaryValue,
  DriveFn,
  ExtensionOps,
  Handler,
  HandlerContext,
  LoopHandle,
  ScopeApi,
  ToolCallDecision,
  ToolCallPayload,
  TurnEndPayload,
} from "../../src/extensions/index.ts";
import type { WebSearchKey } from "../capabilities/fixtures/web-search.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

type Ctx = HandlerContext<unknown>;

/** first 지점: 반환은 결정 또는 undefined(Promise 포함) */
export type ToolCallReturn = Expect<
  Equal<
    ReturnType<Handler<"tool_call">>,
    ToolCallDecision | undefined | Promise<ToolCallDecision | undefined>
  >
>;
export type ToolCallParams = Expect<
  Equal<Parameters<Handler<"tool_call">>, [payload: Readonly<ToolCallPayload>, ctx: Ctx]>
>;

/** chain 지점: (payload, current, ctx)를 받아 패치 또는 undefined를 반환 */
export type TurnEndParams = Expect<
  Equal<
    Parameters<Handler<"turn_end">>,
    [payload: Readonly<TurnEndPayload>, current: Readonly<BoundaryValue>, ctx: Ctx]
  >
>;
export type TurnEndReturn = Expect<
  Equal<
    ReturnType<Handler<"turn_end">>,
    BoundaryPatch | undefined | Promise<BoundaryPatch | undefined>
  >
>;

/** tap 지점: 반환값이 없다 */
export type SessionStartReturn = Expect<
  Equal<ReturnType<Handler<"session_start">>, void | Promise<void>>
>;

/** 상태 타입은 ctx.state로 흐른다 */
export type StateFlows = Expect<
  Equal<Parameters<Handler<"session_start", { n: number }>>[1]["state"], Readonly<{ n: number }>>
>;

/** 잘못된 반환은 컴파일 오류다 */
export function wrongReturnsAreRejected(g: ExtensionOps<unknown>): void {
  // @ts-expect-error -- tap 핸들러는 값을 반환할 수 없다 (F.extensions.spec §9 5)
  g.on("session_start", () => ({ block: true, reason: "x" }));
  // @ts-expect-error -- first 핸들러는 패치가 아니라 결정을 반환한다 (F.extensions.spec §9 5)
  g.on("tool_call", () => ({ continue: true }));
  // @ts-expect-error -- 지점 이름은 pi snake_case 41개뿐이다 (F.extensions.spec §4.10)
  g.on("tool.before", () => undefined);
}

/** 올바른 핸들러는 통과한다 */
export function rightReturnsAreAccepted(g: ExtensionOps<unknown>): void {
  g.on("tool_call", (payload) =>
    payload.toolName === "bash" ? { block: true, reason: "no" } : undefined,
  );
  g.on("turn_end", (_payload, current) => ({ entries: current.entries, continue: false }));
  g.on("session_start", async () => {});
}

/** capability(key)의 반환 타입은 키가 실은 API다 */
export function capabilityIsTypedByKey(
  g: ScopeApi<unknown>,
  key: typeof WebSearchKey,
): ApiOf<typeof WebSearchKey> {
  // @ts-expect-error -- 키가 실은 API와 다른 타입 인자는 거부된다 (F.extensions.plan 5 ops.type-test)
  g.capability<number>(key);
  return g.capability(key);
}

/** DriveFn 시그니처 */
export type DriveFnSignature = Expect<
  Equal<DriveFn<{ n: number }>, (loop: LoopHandle, state: Readonly<{ n: number }>) => Promise<void>>
>;
export type DriveFnAcceptsAsync = Expect<
  Assignable<(loop: LoopHandle) => Promise<void>, DriveFn<unknown>>
>;

test("type assertions compile", () => {});
