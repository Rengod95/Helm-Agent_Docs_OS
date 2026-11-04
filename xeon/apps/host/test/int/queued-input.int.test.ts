import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { TurnStartedPayloadSchema } from "@fresnel/contracts/conversation";
import {
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  maskQueuedInput,
  type InputPlacedPayload,
} from "@fresnel/contracts/records";
import { WireError, type EventWire, type HostConnection } from "@fresnel/contracts/wire";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapePlayer,
  type TapeStream,
} from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/main.ts";
import type { AssembleOptions } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// L1.loop.spec `whenBusy`, F.wire-settings §3.3.1 0a(`turn.start`의 whenBusy, `input.queued`, `turn.withdraw`), L0.secrets.spec §3.5.1(대기 입력 칩의 가림).
// 실행 중인 turn 위에 followUp을 넣으면 큐에 들어가 다음 turn의 입력이 되고, 거둘 수 있고, 칩의 글은 호스트가 준 표식으로 가려진다.
// 모델은 테이프다. 첫 모델 호출만 시험이 풀 때까지 답하지 않아(turn이 실행 중인 채로 남는다), 그 사이에 입력을 보낸다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/**
 * 모델 테이프. 첫 모델 호출은 `release`가 풀 때까지 응답하지 않는다. 그 사이 turn은 실행 중이다.
 * `entered`는 첫 호출이 시작됐다는 표지다. 시험은 이것을 본 뒤에 실행 중 입력을 보낸다.
 * 나머지 차례는 바로 답한다. 응답 내용은 테이프 순서대로다.
 */
interface HeldModels {
  readonly buildModels: NonNullable<AssembleOptions["buildModels"]>;
  readonly entered: Promise<void>;
  release(): void;
}

async function* afterRelease(stream: TapeStream, released: Promise<void>) {
  await released;
  yield* stream;
}

function heldModels(id: string, answers: readonly string[]): HeldModels {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const inner = tapePlayer(
    tape(
      id,
      answers.map((answer, index) => ({
        role: "main" as const,
        label: `answer ${String(index + 1)}`,
        response: {
          type: "message" as const,
          content: [t.text(answer)],
          stopReason: "stop" as const,
        },
      })),
    ),
    { clock: realTapeClock() },
  );
  const calls = { count: 0 };
  const player: TapePlayer = {
    stream(req) {
      const stream = inner.stream(req);
      calls.count += 1;
      if (calls.count > 1) return stream;
      entered.resolve();
      return {
        rawEvents: stream.rawEvents,
        [Symbol.asyncIterator]: () => afterRelease(stream, released.promise),
      };
    },
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => inner.assertExhausted(),
  };
  return {
    buildModels: tapeBuildModels(tapeProvider(player)),
    entered: entered.promise,
    release: () => {
      released.resolve();
    },
  };
}

interface Session {
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly held: HeldModels;
  close(): Promise<void>;
}

async function start(answers: readonly string[]): Promise<Session> {
  const home: EngineHome = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const held = heldModels("queued-input", answers);
  const host: InProcessHost = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: held.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    connection,
    collector,
    held,
    async close() {
      held.release();
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

/** 목록에 보이는 대기 입력 수. thread가 목록에 없으면 undefined다 */
async function queuedCountOf(
  connection: HostConnection,
  threadId: ThreadId,
): Promise<number | undefined> {
  const listed = await connection.request("thread.list", {});
  return listed.threads.find((thread) => thread.threadId === threadId)?.queuedInputs;
}

function placedOf(event: EventWire): InputPlacedPayload {
  const parsed = parse(InputPlacedPayloadSchema, event.payload);
  if (!parsed.ok) throw new Error("the input.placed payload does not match its schema");
  return parsed.value;
}

/**
 * 요청 키가 `requestId`인 `input.queued`를 기다린다. 사용자 입력은 모두 큐를 거치므로(첫 질문도) 종류만으로는 고르지 못한다
 */
function queuedWith(collector: EventCollector, requestId: string): Promise<EventWire> {
  return collector.waitFor((event) => {
    if (event.kind !== "input.queued") return false;
    const parsed = parse(InputQueuedPayloadSchema, event.payload);
    return parsed.ok && parsed.value.requestId === requestId;
  });
}

/** 입력 id가 `inputId`인 `input.placed`를 기다린다. 첫 질문의 배치도 같은 종류다 */
function placedFor(collector: EventCollector, inputId: string): Promise<EventWire> {
  return collector.waitFor(
    (event) => event.kind === "input.placed" && placedOf(event).inputId === inputId,
  );
}

describe("a turn that is running takes a followUp", () => {
  realTest(
    "a followUp sent while a turn runs is queued on that turn and enters the next turn as its input",
    async () => {
      const session = await start(["first answer", "second answer"]);
      try {
        const { connection, collector, held } = session;
        const { threadId } = await connection.request("thread.create", {});
        const first = await connection.request("turn.start", { threadId, input: "first question" });
        await held.entered;

        // whenBusy가 없으면 큐에 넣지 않고 turn.busy(3003)로 거절한다
        const busy = await wireErrorOf(
          connection.request("turn.start", { threadId, input: "rejected, not queued" }),
        );
        expect(busy.code).toBe(3003);
        expect(busy.data.kind).toBe("turn.busy");
        expect(busy.data.details).toEqual({ turnId: first.turnId });
        expect(await queuedCountOf(connection, threadId)).toBe(0);

        const queued = await connection.request("turn.start", {
          threadId,
          input: "follow-up question",
          whenBusy: "followUp",
          requestId: "follow-1",
        });
        // 새 turn이 아니다: 응답의 turnId는 실행 중인 turn이고 queued가 참이다
        expect(queued).toEqual({ turnId: first.turnId, queued: true });
        const enqueued = await queuedWith(collector, "follow-1");
        expect(enqueued.payload).toMatchObject({
          mode: "followUp",
          item: { kind: "user", content: "follow-up question" },
          requestId: "follow-1",
          source: { type: "user", via: "interactive" },
        });
        // 가릴 글이 없으면 표식을 싣지 않는다
        expect(enqueued.mask).toBeUndefined();
        expect(await queuedCountOf(connection, threadId)).toBe(1);

        held.release();
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === first.turnId,
        );
        // 큐의 입력은 첫 turn이 끝난 뒤 배치되고, 배치된 입력은 다음 turn의 입력 항목이다
        const placed = placedOf(await placedFor(collector, enqueued.id));
        const second = await collector.waitFor(
          (event) => event.kind === "turn.started" && event.turnId !== first.turnId,
        );
        const started = parse(TurnStartedPayloadSchema, second.payload);
        if (!started.ok) throw new Error("the turn.started payload does not match its schema");
        expect(started.value.inputItemIds).toEqual([placed.itemId]);
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === second.turnId,
        );

        // turn은 정확히 두 개이고 그 순서다
        expect(
          collector.events
            .filter((event) => event.kind === "turn.started")
            .map((event) => event.turnId),
        ).toEqual([first.turnId, second.turnId]);
        expect(await queuedCountOf(connection, threadId)).toBe(0);

        // 시스템 프롬프트와 첫 turn 문맥(custom)은 thread의 첫 turn에만 기록된다. 두 번째 turn은 입력과 답만 더한다
        const read = await connection.request("thread.read", { threadId });
        expect(read.items.map((item) => item.kind)).toEqual([
          "user",
          "custom",
          "system",
          "assistant",
          "user",
          "assistant",
        ]);
        const [firstUser, , , firstAnswer, followUp, secondAnswer] = read.items;
        expect(firstUser).toMatchObject({ kind: "user", message: { content: "first question" } });
        expect(firstAnswer).toMatchObject({
          kind: "assistant",
          message: { content: [{ type: "text", text: "first answer" }] },
        });
        expect(followUp).toMatchObject({
          kind: "user",
          message: { content: "follow-up question" },
        });
        expect(secondAnswer).toMatchObject({
          kind: "assistant",
          message: { content: [{ type: "text", text: "second answer" }] },
        });
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});

describe("turn.withdraw takes back a queued input", () => {
  realTest(
    "a withdrawn followUp is never placed: the key answers once, input.withdrawn names the queued input, and the next turn carries only its own input",
    async () => {
      const session = await start(["first answer", "after answer"]);
      try {
        const { connection, collector, held } = session;
        const { threadId } = await connection.request("thread.create", {});
        const first = await connection.request("turn.start", { threadId, input: "first question" });
        await held.entered;
        expect(
          await connection.request("turn.start", {
            threadId,
            input: "withdrawn question",
            whenBusy: "followUp",
            requestId: "follow-w",
          }),
        ).toEqual({ turnId: first.turnId, queued: true });
        const enqueued = await queuedWith(collector, "follow-w");
        expect(await queuedCountOf(connection, threadId)).toBe(1);

        expect(
          await connection.request("turn.withdraw", { threadId, requestId: "follow-w" }),
        ).toEqual({ withdrawn: true });
        // 거두고 나면 같은 키는 거둘 것이 없다. 큐 목록도 비었다
        expect(
          await connection.request("turn.withdraw", { threadId, requestId: "follow-w" }),
        ).toEqual({ withdrawn: false });
        expect(await queuedCountOf(connection, threadId)).toBe(0);
        const withdrawn = await collector.waitFor((event) => event.kind === "input.withdrawn");
        expect(withdrawn.payload).toEqual({ inputId: enqueued.id, reason: "user" });

        held.release();
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === first.turnId,
        );
        // 거둔 입력이 남아 다음 turn을 여는 일이 없다. 새 입력은 그 입력만 담은 turn이 된다
        const next = await startTurnWhenIdle(connection, { threadId, input: "after question" });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === next.turnId,
        );
        // 배치된 입력은 첫 질문과 그 뒤 질문 둘이다. 거둔 입력은 없다
        const placedIds = collector.events
          .filter((event) => event.kind === "input.placed")
          .map((event) => placedOf(event).inputId);
        expect(placedIds).toHaveLength(2);
        expect(placedIds).not.toContain(enqueued.id);

        const read = await connection.request("thread.read", { threadId });
        expect(read.items.filter((item) => item.kind === "user")).toMatchObject([
          { message: { content: "first question" } },
          { message: { content: "after question" } },
        ]);
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});

describe("the queued chip text carries marks from the host", () => {
  realTest(
    "the input.queued event keeps the raw payload and attaches a leaf mark for the token; applying the mark hides the token",
    async () => {
      const session = await start(["first answer", "second answer"]);
      try {
        const { connection, collector, held } = session;
        const { threadId } = await connection.request("thread.create", {});
        const first = await connection.request("turn.start", { threadId, input: "first question" });
        await held.entered;

        // "ghp_" 뒤 36자는 호스트의 깃허브 토큰 패턴(platform-secrets redactor)에 걸린다. 실제 값이 아니다
        const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
        const text = `deploy with ${TOKEN} now`;
        expect(
          await connection.request("turn.start", {
            threadId,
            input: text,
            whenBusy: "followUp",
            requestId: "follow-m",
          }),
        ).toEqual({ turnId: first.turnId, queued: true });
        const enqueued = await queuedWith(collector, "follow-m");

        // payload는 원문 그대로다. 가림은 표식(mask)으로만 싣는다: 글 자리(/item/content)의 길이 56, 토큰은 12~52
        expect(enqueued.payload).toMatchObject({ item: { kind: "user", content: text } });
        expect(enqueued.mask).toEqual([
          {
            pointer: "/item/content",
            len: 56,
            ranges: [{ start: 12, end: 52, label: "github_token" }],
          },
        ]);
        // 표식은 구간과 길이, 표지 이름만 든다. 값은 없다
        expect(JSON.stringify(enqueued.mask)).not.toContain(TOKEN);

        // 화면 쪽: 같은 표식을 같은 글에 적용하면 칩에는 표지만 남는다
        const payload = parse(InputQueuedPayloadSchema, enqueued.payload);
        if (!payload.ok) throw new Error("the input.queued payload does not match its schema");
        const masked = maskQueuedInput(payload.value, enqueued.mask);
        expect(masked).toEqual({
          ...payload.value,
          item: { kind: "user", content: "deploy with [REDACTED:github_token] now" },
        });
        expect(JSON.stringify(masked)).not.toContain(TOKEN);

        held.release();
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === first.turnId,
        );
        await placedFor(collector, enqueued.id);
        // 마스크된 글도 다음 turn의 입력이 된다(표식은 화면에만 간다)
        const second = await collector.waitFor(
          (event) => event.kind === "turn.started" && event.turnId !== first.turnId,
        );
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === second.turnId,
        );
        const read = await connection.request("thread.read", { threadId });
        expect(read.items.filter((item) => item.kind === "user")).toMatchObject([
          { message: { content: "first question" } },
          { message: { content: text } },
        ]);
      } finally {
        await session.close();
      }
    },
    30_000,
  );
});
