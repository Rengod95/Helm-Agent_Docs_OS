import { test } from "bun:test";
import type { ApiOf } from "../../src/capabilities/index.ts";
import type {
  BoundaryPatch,
  BeforeAgentStartPatch,
  BeforeAgentStartPayload,
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
    ReturnType<Handler<"tool.call.before">>,
    ToolCallDecision | undefined | Promise<ToolCallDecision | undefined>
  >
>;
export type ToolCallParams = Expect<
  Equal<Parameters<Handler<"tool.call.before">>, [payload: Readonly<ToolCallPayload>, ctx: Ctx]>
>;

/** chain 지점: (payload, current, ctx)를 받아 패치 또는 undefined를 반환 */
export type TurnEndParams = Expect<
  Equal<
    Parameters<Handler<"boundary.step.after">>,
    [payload: Readonly<TurnEndPayload>, current: Readonly<BoundaryValue>, ctx: Ctx]
  >
>;
export type TurnEndReturn = Expect<
  Equal<
    ReturnType<Handler<"boundary.step.after">>,
    BoundaryPatch | undefined | Promise<BoundaryPatch | undefined>
  >
>;

/** tap 지점: 반환값이 없다 */
export type SessionStartReturn = Expect<
  Equal<ReturnType<Handler<"session.start">>, void | Promise<void>>
>;

/** 상태 타입은 ctx.state로 흐른다 */
export type StateFlows = Expect<
  Equal<Parameters<Handler<"session.start", { n: number }>>[1]["state"], Readonly<{ n: number }>>
>;

/** collect 지점: 핸들러는 payload와 ctx만 받고 기여(또는 undefined)를 반환한다. current는 없다 */
export type CollectParams = Expect<
  Equal<
    Parameters<Handler<"input.agent.before">>,
    [payload: Readonly<BeforeAgentStartPayload>, ctx: Ctx]
  >
>;
export type CollectReturn = Expect<
  Equal<
    ReturnType<Handler<"input.agent.before">>,
    BeforeAgentStartPatch | undefined | Promise<BeforeAgentStartPatch | undefined>
  >
>;

/** 잘못된 반환은 컴파일 오류다 */
export function wrongReturnsAreRejected(g: ExtensionOps<unknown>): void {
  // @ts-expect-error -- tap 핸들러는 값을 반환할 수 없다 (F.extensions.spec §9 5)
  g.on("session.start", () => ({ block: true, reason: "x" }));
  // @ts-expect-error -- first 핸들러는 패치가 아니라 결정을 반환한다 (F.extensions.spec §9 5)
  g.on("tool.call.before", () => ({ continue: true }));
  // @ts-expect-error -- 지점 이름은 표의 46개뿐이다 (F.extensions.spec §4.10)
  g.on("tool.before", () => undefined);
  // @ts-expect-error -- collect 핸들러는 current를 받지 않는다(두 번째 인자는 ctx다)
  g.on("input.agent.before", (_payload, current) => ({ systemPrompt: current.systemPrompt }));
}

/** 올바른 핸들러는 통과한다 */
export function rightReturnsAreAccepted(g: ExtensionOps<unknown>): void {
  g.on("tool.call.before", (payload) =>
    payload.toolName === "bash" ? { block: true, reason: "no" } : undefined,
  );
  g.on("boundary.step.after", (_payload, current) => ({
    entries: current.entries,
    continue: false,
  }));
  g.on("session.start", async () => {});
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
