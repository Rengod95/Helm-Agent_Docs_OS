import { test } from "bun:test";
import type { Static } from "typebox";
import type {
  WIRE_ERRORS,
  WIRE_METHODS,
  HostConnection,
  ServerNotificationMap,
  TurnStartInput,
  WireErrorKind,
  WireHandlers,
  WireMethodMap,
  WireMethodName,
  WireParams,
  WireResult,
} from "../../src/wire-settings/wire/index.ts";
import type { UserMessage } from "../../src/conversation/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

/** params inferred from registry */
export type TurnStartParamsFromRegistry = Expect<
  Equal<WireParams<"turn.start">, Static<(typeof WIRE_METHODS)["turn.start"]["params"]>>
>;
export type TurnStartResultFromRegistry = Expect<
  Equal<WireResult<"turn.start">, Static<(typeof WIRE_METHODS)["turn.start"]["result"]>>
>;

/** 모든 메서드에서 타입 쪽과 값 쪽이 같은 원천이다 */
type EveryParamsMatch = {
  [M in WireMethodName]: Equal<WireParams<M>, Static<(typeof WIRE_METHODS)[M]["params"]>>;
}[WireMethodName];
type EveryResultMatch = {
  [M in WireMethodName]: Equal<WireResult<M>, Static<(typeof WIRE_METHODS)[M]["result"]>>;
}[WireMethodName];
export type AllParamsMatch = Expect<Equal<EveryParamsMatch, true>>;
export type AllResultsMatch = Expect<Equal<EveryResultMatch, true>>;

/** keys match */
export type KeysMatch = Expect<Equal<keyof WireMethodMap, keyof typeof WIRE_METHODS>>;
export type ErrorKeysMatch = Expect<Equal<WireErrorKind, keyof typeof WIRE_ERRORS>>;

/** turn.start 입력은 pi UserMessage의 content와 같다 */
export type TurnStartInputIsUserContent = Expect<Equal<TurnStartInput, UserMessage["content"]>>;
export type TurnStartParamsInput = Expect<
  Equal<WireParams<"turn.start">["input"], UserMessage["content"]>
>;

/** 연결은 메서드 이름에서 params와 결과를 추론한다 */
export async function requestInference(connection: HostConnection): Promise<void> {
  const created = await connection.request("thread.create", {});
  const threadId: Static<(typeof WIRE_METHODS)["thread.create"]["result"]>["threadId"] =
    created.threadId;
  // @ts-expect-error -- turn.start는 threadId와 input이 필요하다 (F.wire-settings.spec §9 A8)
  await connection.request("turn.start", {});
  // @ts-expect-error -- 레지스트리에 없는 메서드는 컴파일 오류다
  await connection.request("turn.nothing", {});
  await connection.request("turn.start", { threadId, input: "hi" });
}

/** 알림 이름은 서버 알림 표의 키다 */
export function notificationInference(connection: HostConnection): void {
  connection.onNotification("events.batch", (params) => {
    params.caughtUp satisfies boolean;
  });
  // @ts-expect-error -- 클라이언트 알림은 서버 알림 구독에 쓸 수 없다
  connection.onNotification("$/cancelRequest", () => {});
}
export type ServerNotificationNames = Expect<
  Equal<
    keyof ServerNotificationMap,
    "events.batch" | "events.ended" | "stream.chunk" | "settings.invalidated"
  >
>;

/** handler table exhaustive: 처리기 하나를 빼면 WireHandlers 대입이 컴파일 오류다 */
export type HandlerKeys = Expect<Equal<keyof WireHandlers, WireMethodName>>;
export type HandlerNeedsEveryMethod = Expect<
  Equal<Assignable<Omit<WireHandlers, "turn.start">, WireHandlers>, false>
>;

test("type assertions compile", () => {});
