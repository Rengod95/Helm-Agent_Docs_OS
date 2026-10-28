import { expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { CompactOutcome, ContextError } from "@xeon/contracts/services";
import { WireError, type WireParams } from "@xeon/contracts/wire";
import type { ThreadCompactFailure } from "../../src/types.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";

// thread.compact(F wire §3.3.1, HS-77). 가짜 엔진 위의 실제 처리기다. 컨텍스트 서비스와 모델을 두는 어댑터는 test/assembly/ports.test.ts,
// 실제 엔진 위의 요약은 test/int/thread-compact.int.test.ts다.

type CompactResult = Result<CompactOutcome, ThreadCompactFailure>;

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

interface Asked {
  readonly threadId: ThreadId;
  readonly instructions: string | undefined;
  readonly signalGiven: boolean;
}

/** 어댑터 대역: 부른 인자를 기록하고 정해 둔 결과를 돌려준다. `commit`이 있으면 결과를 돌려주기 전에 컴팩션 이벤트를 커밋한다 */
function compactingHost(
  outcome: (threadId: ThreadId) => CompactResult,
  commit?: (host: FakeHost, threadId: ThreadId) => void,
) {
  const asked: Asked[] = [];
  const slot: { host: FakeHost | undefined } = { host: undefined };
  const host = createFakeHost({
    overrides: {
      threads: {
        compact: (threadId, instructions, signal) => {
          asked.push({ threadId, instructions, signalGiven: signal instanceof AbortSignal });
          if (slot.host !== undefined) commit?.(slot.host, threadId);
          return Promise.resolve(outcome(threadId));
        },
      },
    },
  });
  slot.host = host;
  return { host, asked };
}

const EVENT = fixedIdFactory(500).next("evt");

test("thread.compact is implemented, so the hello features list it", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("thread.compact");
  await connection.close();
});

test("a compaction returns the outcome and the position that includes the committed event", async () => {
  const { host, asked } = compactingHost(
    () => ok({ status: "compacted", eventId: EVENT, tokensBefore: 91_000, fromExtension: "guard" }),
    (fake, threadId) => {
      fake.fake.commit([{ kind: "thread.compacted", threadId }]);
    },
  );
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const result = await connection.request("thread.compact", {
    threadId: created.threadId,
    instructions: "keep the API decisions",
  });
  expect(result).toEqual({
    status: "compacted",
    eventId: EVENT,
    tokensBefore: 91_000,
    fromExtension: "guard",
    position: { storeId: host.fake.engine.storeId, seq: host.fake.events.length },
  });
  expect(result.status === "compacted" ? result.position.seq : 0).toBeGreaterThan(
    created.position.seq,
  );
  expect(asked).toEqual([
    { threadId: created.threadId, instructions: "keep the API decisions", signalGiven: true },
  ]);
  await connection.close();
});

test("without instructions the adapter gets none, and a thread nobody holds is taken for the call", async () => {
  const { host, asked } = compactingHost(() =>
    ok({ status: "skipped", why: "nothing_to_summarize" }),
  );
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  await connection.request("thread.compact", { threadId });
  expect(asked).toEqual([{ threadId, instructions: undefined, signalGiven: true }]);
  // 암묵 획득(HS-28): 컴팩션 전에 쓰기 소유를 얻고 연결이 쥔다
  expect(host.fake.acquisitions).toEqual([{ threadId, kind: "cli" }]);
  expect(host.fake.held.has(threadId)).toBe(true);
  await connection.close();
});

test("each skipped reason is a result and not an error", async () => {
  const reasons = ["nothing_to_summarize", "last_entry_is_compaction", "disabled"] as const;
  await Promise.all(
    reasons.map(async (why) => {
      const { host } = compactingHost(() => ok({ status: "skipped", why }));
      const connection = await open(host);
      const created = await connection.request("thread.create", {});
      expect(await connection.request("thread.compact", { threadId: created.threadId })).toEqual({
        status: "skipped",
        why,
      });
      await connection.close();
    }),
  );
});

test("a compaction an extension stopped is 3006 at session.compact.before with the extension's reason", async () => {
  const { host } = compactingHost(() =>
    ok({ status: "cancelled", by: "guard", reason: "not now" }),
  );
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const error = await wireErrorOf(
    connection.request("thread.compact", { threadId: created.threadId }),
  );
  expect(error.code).toBe(3006);
  expect(error.data.details).toEqual({ point: "session.compact.before", reason: "not now" });
  await connection.close();
});

test("an unknown thread is 3001 and a thread another process owns is 3002, and neither reaches the adapter", async () => {
  const unknown = compactingHost(() => ok({ status: "skipped", why: "disabled" }));
  const first = await open(unknown.host);
  const gone = fixedIdFactory(77).next("thr");
  const missing = await wireErrorOf(first.request("thread.compact", { threadId: gone }));
  expect(missing.code).toBe(3001);
  expect(missing.data.details).toEqual({ threadId: gone });
  expect(unknown.asked).toEqual([]);
  await first.close();

  const locked = createFakeHost({ lockedBy: "app" });
  const other = locked.fake.seedThread();
  const second = await open(locked);
  const refused = await wireErrorOf(second.request("thread.compact", { threadId: other }));
  expect(refused.code).toBe(3002);
  await second.close();
});

test("failures become the wire errors of the spec table, each with its details", async () => {
  const TURN = fixedIdFactory(91).next("trn");
  const cases: readonly {
    readonly failure: ThreadCompactFailure;
    readonly code: number;
    readonly kind: string;
    readonly details?: Record<string, unknown>;
  }[] = [
    {
      failure: { kind: "turn_running", turnId: TURN },
      code: 3003,
      kind: "turn.busy",
      details: { turnId: TURN },
    },
    { failure: { kind: "busy" }, code: 5003, kind: "store.busy" },
    {
      failure: { kind: "model_unavailable", detail: "no_model_for_role" },
      code: 3008,
      kind: "thread.compactFailed",
      details: { reason: "summary_failed" },
    },
    ...(
      [
        "read_failed",
        "projection_failed",
        "summary_failed",
        "summary_has_tool_call",
        "summary_truncated",
        "commit_failed",
      ] as const
    ).map((reason) => ({
      failure: {
        kind: "context_failed",
        error: { kind: reason, message: "secret provider text" },
      } satisfies ThreadCompactFailure,
      code: 3008,
      kind: "thread.compactFailed",
      details: { reason },
    })),
    {
      failure: { kind: "context_failed", error: { kind: "aborted", message: "stopped" } },
      code: 5001,
      kind: "request.cancelled",
    },
  ];
  await Promise.all(
    cases.map(async (entry) => {
      const { host } = compactingHost(() => err(entry.failure));
      const connection = await open(host);
      const created = await connection.request("thread.create", {});
      const error = await wireErrorOf(
        connection.request("thread.compact", { threadId: created.threadId }),
      );
      expect([error.code, error.data.kind]).toEqual([entry.code, entry.kind]);
      if (entry.details !== undefined) expect(error.data.details).toEqual(entry.details);
      // 제공자 응답 본문은 와이어로 나가지 않는다
      expect(JSON.stringify(error.data)).not.toContain("secret provider text");
      await connection.close();
    }),
  );
});

test("a closed thread is 3007 with its id", async () => {
  const { host } = compactingHost(() =>
    err({ kind: "thread_closed", threadId: fixedIdFactory(5).next("thr") }),
  );
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const compact: WireParams<"thread.compact"> = { threadId: created.threadId };
  const error = await wireErrorOf(connection.request("thread.compact", compact));
  expect(error.code).toBe(3007);
  await connection.close();
});

test("a thread with no events in its branch is a host bug: -32603 and the wire says nothing more", async () => {
  const failure: ContextError = { kind: "branch_not_found", message: "thread has no events" };
  const { host } = compactingHost(() => err({ kind: "context_failed", error: failure }));
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const error = await wireErrorOf(
    connection.request("thread.compact", { threadId: created.threadId }),
  );
  expect(error.code).toBe(-32603);
  expect(error.data.kind).toBe("internal");
  expect(JSON.stringify(error.data)).not.toContain("no events");
  await connection.close();
});
