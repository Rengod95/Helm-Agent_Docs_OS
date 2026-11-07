import { describe, expect, test } from "bun:test";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { EventWire, VolatileEventWire } from "@fresnel/contracts/wire";
import { decodeDurable, decodeVolatile } from "../../src/state/engine/decode.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectRetrying } from "../../src/state/engine/selectors.ts";
import { evt, itm, STORE, SUB, thr, trn } from "./helpers.ts";

// 제공자 재시도 대기(L4 desktop-ux 입력창 상태 줄): 휘발 turn.updated notice provider_retry를 거울이 thread별로 든다.
// 응답이 오기 시작하거나(item 갱신) 단계·턴이 시작·끝나면 지운다.

const T: ThreadId = thr(1);
const OTHER: ThreadId = thr(2);
const TURN: TurnId = trn(1);
const RECEIVED = 1_000_000;
const AT = "2026-11-07T00:00:00.000Z";
const DETAIL = { attempt: 2, maxRetries: 3, waitMs: 4000 };

function retryEvent(n: number, detail: unknown, threadId: ThreadId = T): VolatileEventWire {
  return {
    id: evt(400 + n),
    kind: "turn.updated",
    version: 1,
    durable: false,
    threadId,
    turnId: TURN,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    n,
    afterSeq: 5,
    payload: { status: "running", notice: { code: "provider_retry", detail } },
  };
}

function wire(
  seq: number,
  kind: EventWire["kind"],
  payload: unknown,
  threadId: ThreadId = T,
): EventWire {
  return {
    id: evt(seq),
    kind,
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId,
    turnId: TURN,
    stepId: null,
    recordedAt: AT,
    causationId: null,
    correlationId: null,
    payload,
    redactions: [],
  };
}

const subscribed: MirrorInput = {
  type: "subscribed",
  sub: SUB,
  storeId: STORE,
  start: 0,
  live: true,
  from: "head",
};

const chunk = (event: VolatileEventWire, receivedAt: number = RECEIVED): MirrorInput => ({
  type: "chunk",
  fact: decodeVolatile(event, receivedAt),
});

/** 한 건짜리 배치. 거울의 위치가 0이므로 from은 0이다 */
const batchOf = (event: EventWire): MirrorInput => ({
  type: "batch",
  sub: SUB,
  from: 0,
  to: event.seq,
  caughtUp: true,
  facts: [decodeDurable(event)],
});

function run(inputs: readonly MirrorInput[], from: EngineMirror = INITIAL_MIRROR): EngineMirror {
  let state = from;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

describe("provider_retry 디코드", () => {
  test("provider_retry 알림은 받은 시각과 detail을 실은 provider.retry 사실이다", () => {
    expect(decodeVolatile(retryEvent(0, DETAIL), RECEIVED)).toEqual({
      type: "provider.retry",
      n: 0,
      threadId: T,
      turnId: TURN,
      retry: DETAIL,
      receivedAt: RECEIVED,
    });
  });

  test("다른 알림과 모양이 틀린 detail은 other다", () => {
    const gate: VolatileEventWire = {
      ...retryEvent(1, DETAIL),
      payload: { status: "running", notice: { code: "gate_limit", detail: { limit: 8 } } },
    };
    expect(decodeVolatile(gate, RECEIVED).type).toBe("other");
    expect(
      decodeVolatile(retryEvent(2, { attempt: 2, maxRetries: 3, waitMs: 1.5 }), RECEIVED).type,
    ).toBe("other");
  });

  test("단계 시작(durable step.started)은 step.started 사실이다", () => {
    expect(decodeDurable(wire(9, "step.started", { stepIndex: 0 })).type).toBe("step.started");
  });
});

describe("재시도 대기의 거울 상태", () => {
  test("provider.retry는 그 대화의 재시도 대기를 받은 시각과 함께 둔다", () => {
    const state = run([subscribed, chunk(retryEvent(0, DETAIL))]);
    expect(selectRetrying(state, T)).toEqual({ ...DETAIL, at: RECEIVED });
    expect(selectRetrying(state, OTHER)).toBeNull();
  });

  test("같은 대화에서 다시 오면 가장 최근 재시도로 바뀐다", () => {
    const state = run([
      subscribed,
      chunk(retryEvent(0, DETAIL)),
      chunk(retryEvent(1, { attempt: 3, maxRetries: 3, waitMs: 8000 }), RECEIVED + 4000),
    ]);
    expect(selectRetrying(state, T)).toEqual({
      attempt: 3,
      maxRetries: 3,
      waitMs: 8000,
      at: RECEIVED + 4000,
    });
  });

  test("응답이 오기 시작하면(item.started) 그 대화의 대기만 지운다", () => {
    const pending = run([
      subscribed,
      chunk(retryEvent(0, DETAIL)),
      chunk(retryEvent(1, DETAIL, OTHER)),
    ]);
    const started = run(
      [
        chunk({
          id: evt(700),
          kind: "item.started",
          version: 1,
          durable: false,
          threadId: T,
          turnId: TURN,
          stepId: null,
          recordedAt: AT,
          causationId: null,
          correlationId: null,
          n: 2,
          afterSeq: 5,
          payload: { itemId: itm(1), kind: "assistant", toolCallId: null, toolName: null },
        }),
      ],
      pending,
    );
    expect(selectRetrying(started, T)).toBeNull();
    expect(selectRetrying(started, OTHER)).toEqual({ ...DETAIL, at: RECEIVED });
  });

  test("단계가 시작하거나 턴이 시작·끝나면 지운다", () => {
    const pending = run([subscribed, chunk(retryEvent(0, DETAIL))]);
    const stepped = run([batchOf(wire(1, "step.started", { stepIndex: 0 }))], pending);
    const begun = run(
      [batchOf(wire(1, "turn.started", { inputItemIds: [], requestId: null, scopeId: null }))],
      pending,
    );
    const ended = run(
      [
        batchOf(
          wire(1, "turn.completed", {
            status: "completed",
            stepCount: 1,
            usage: null,
            error: null,
          }),
        ),
      ],
      pending,
    );
    expect(selectRetrying(stepped, T)).toBeNull();
    expect(selectRetrying(begun, T)).toBeNull();
    expect(selectRetrying(ended, T)).toBeNull();
  });

  test("엔진이 꺼지면 지운다", () => {
    const pending = run([subscribed, chunk(retryEvent(0, DETAIL))]);
    const stopped = run([{ type: "engine", state: { kind: "stopped" } }], pending);
    expect(selectRetrying(stopped, T)).toBeNull();
  });
});
