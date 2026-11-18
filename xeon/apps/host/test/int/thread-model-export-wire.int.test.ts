import { expect, test } from "bun:test";
import { assertNever, parseJson } from "@fresnel/contracts";
import { isId, type ItemId, type ItemRecord, type ThreadId } from "@fresnel/contracts/conversation";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapePlayer,
  type TapeProviderHandle,
  type TapeModelDef,
} from "@fresnel/core-models/testing";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  requestTurn,
  startTurnWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// 모델 목록, 대화의 모델 고르기(thread.setModel), 대화 내보내기(thread.export). 실제 엔진이고 모델은 테이프가 답한다.
// 테이프 provider의 `calls()`가 turn마다 부른 모델 id를 주므로, 모델을 바꾼 뒤의 turn이 어느 모델로 갔는지 값으로 본다.
// 내보내기는 실제 turn으로 쌓인 item(thread.read와 같은 집합과 순서)을 markdown과 json으로 옮긴 결과를 명세의 모양과 견준다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 글을 대화 id로 좁힌다. 모양이 맞지 않으면 시험 설정 오류다 */
function threadIdOf(text: string): ThreadId {
  if (!isId("thr", text)) throw new Error(`not a thread id: ${text}`);
  return text;
}

/** 글을 item id로 좁힌다. 모양이 맞지 않으면 시험 설정 오류다 */
function itemIdOf(text: string): ItemId {
  if (!isId("itm", text)) throw new Error(`not an item id: ${text}`);
  return text;
}

/** 테이프 provider의 모델 셋. 가격과 추론 여부가 서로 달라 `models.list`의 각 칸을 가린다. tape-free는 가격을 모른다(0) */
const CATALOG: readonly TapeModelDef[] = [
  {
    id: "tape-1",
    contextWindow: 200_000,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
  },
  {
    id: "tape-2",
    contextWindow: 32_000,
    reasoning: true,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    id: "tape-free",
    contextWindow: 8_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

const NO_SUCH_THREAD = threadIdOf("thr_01ARZ3NDEKTSV4RRFFQ69G5FAX");
/** 이 대화 어디에도 없는 item id */
const NO_SUCH_ITEM = itemIdOf("itm_01ARZ3NDEKTSV4RRFFQ69G5FAX");

interface Session {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly tape: TapeProviderHandle;
}

interface OpenOptions {
  /** 테이프 플레이어. 답을 차례로 낸다 */
  readonly player: TapePlayer;
  readonly models: readonly TapeModelDef[];
  /** 사용자 설정. 없으면 테이프 기본 설정이다 */
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** 테이프 모델 셋으로 실제 엔진을 띄운다. 이벤트를 구독한 뒤 돌려준다 */
async function open(options: OpenOptions): Promise<Session> {
  const home = useEngineHome();
  writeUserSettings(home, options.settings ?? TAPE_SETTINGS);
  const tapeHandle = tapeProvider(options.player, { models: options.models });
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(tapeHandle),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return { home, host, connection, collector, tape: tapeHandle };
}

async function close(session: Session): Promise<void> {
  await session.connection.close();
  await session.host.close();
  session.home.dispose();
}

/** 테이프가 한 번 정해진 글로 답하는 응답 */
function answer(text: string) {
  return {
    role: "main" as const,
    label: `answer ${text}`,
    response: { type: "message" as const, content: [t.text(text)], stopReason: "stop" as const },
  };
}

function playerOf(turns: Parameters<typeof tape>[1]): TapePlayer {
  return tapePlayer(tape("model-export", turns), { clock: realTapeClock() });
}

/** 글 한 줄을 보내고 그 turn이 끝날 때까지 기다린다 */
async function converse(session: Session, threadId: ThreadId, input: string): Promise<void> {
  const started = await startTurnWhenIdle(session.connection, { threadId, input });
  await session.collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    20_000,
  );
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

/**
 * 첫 요청을 `release()`가 불릴 때까지 붙잡는 테이프. `reached`는 첫 요청이 모델 호출에 닿았을 때 풀린다.
 * 모델 호출이 실제로 시작했는지를 이벤트 대신 이 신호로 본다(recording-tape의 `holdRequest`와 같은 방법)
 */
function holdingFirstRequest(inner: TapePlayer): {
  readonly player: TapePlayer;
  readonly reached: Promise<void>;
  release(): void;
} {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const counter = { requests: 0 };
  const player: TapePlayer = {
    stream(request) {
      const index = counter.requests;
      counter.requests += 1;
      const events = inner.stream(request);
      if (index !== 0) return events;
      reached.resolve();
      return {
        rawEvents: events.rawEvents,
        async *[Symbol.asyncIterator]() {
          await released.promise;
          yield* events;
        },
      };
    },
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => {
      inner.assertExhausted();
    },
  };
  return { player, reached: reached.promise, release: () => released.resolve() };
}

/** 글 블록의 모양. 글 블록과 이미지 블록 모두 `type`을 가진다 */
type Block = { readonly type: string; readonly text?: string };

/** 글 본문. 글 블록은 글만 든다는 것을 확인하고 블록을 `\n\n`으로 잇는다(thread.export와 같은 규칙) */
function bodyOf(content: string | readonly Block[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type !== "text" || block.text === undefined) {
        throw new Error("the test conversation has text blocks only");
      }
      return block.text;
    })
    .join("\n\n");
}

/** item 하나의 markdown 절. 제목은 명세(F wire §3.4.7 5항)가 정한 역할 이름이고 본문은 item의 글 그대로다 */
function sectionOf(item: ItemRecord): string {
  switch (item.kind) {
    case "user":
      return `## User\n\n${bodyOf(item.message.content)}\n\n`;
    case "assistant":
      return `## Assistant\n\n${bodyOf(item.message.content)}\n\n`;
    case "system":
      return `## System\n\n${bodyOf(item.message.content)}\n\n`;
    case "custom":
      return `## Extension message: ${item.message.customType}\n\n${bodyOf(item.message.content)}\n\n`;
    case "toolResult":
      throw new Error("the test conversation has no tool results");
    default:
      return assertNever(item, "ItemRecord");
  }
}

function markdownOf(title: string, threadId: string, items: readonly ItemRecord[]): string {
  return `# ${title}\n\n- Thread ID: ${threadId}\n- Items: ${String(items.length)}\n\n${items.map(sectionOf).join("")}`;
}

// ── models.list ──────────────────────────────────────────────────────────────

realTest(
  "models.list: the models of a provider that holds a key reference, in ref order, with prices (an unknown price is null)",
  async () => {
    const session = await open({
      player: playerOf([answer("답")]),
      models: CATALOG,
      // 키 참조가 있으면 provider가 설정된 것이다. 목록은 키를 풀지 않는다
      settings: {
        ...TAPE_SETTINGS,
        "l1.models.providers": [
          { id: "tape", enabled: true, apiKeyRef: "secret://tape-key", baseUrl: null },
        ],
      },
    });
    try {
      expect(await session.connection.request("models.list", {})).toEqual({
        models: [
          {
            ref: "tape/tape-1",
            name: "tape-1",
            contextWindow: 200_000,
            reasoning: false,
            inputPrice: 1,
            outputPrice: 2,
          },
          {
            ref: "tape/tape-2",
            name: "tape-2",
            contextWindow: 32_000,
            reasoning: true,
            inputPrice: 3,
            outputPrice: 15,
          },
          {
            ref: "tape/tape-free",
            name: "tape-free",
            contextWindow: 8_000,
            reasoning: false,
            inputPrice: null,
            outputPrice: null,
          },
        ],
      });
      expect(session.tape.calls()).toEqual([]);
    } finally {
      await close(session);
    }
  },
  60_000,
);

realTest(
  "models.list is empty for a provider with no key reference, while thread.setModel still takes its catalog models",
  async () => {
    // 테이프 기본 설정은 키 참조가 없다. 목록은 자격 증명이 있는 provider의 모델만 낸다
    const session = await open({ player: playerOf([answer("답")]), models: CATALOG });
    try {
      expect(await session.connection.request("models.list", {})).toEqual({ models: [] });
      // 대화 고르기는 목록이 아니라 카탈로그로 판정한다
      const created = await session.connection.request("thread.create", {});
      await session.connection.request("thread.setModel", {
        threadId: created.threadId,
        model: "tape/tape-2",
      });
      expect(
        (await session.connection.request("thread.list", {})).threads.find(
          (thread) => thread.threadId === created.threadId,
        )?.model,
      ).toBe("tape/tape-2");
    } finally {
      await close(session);
    }
  },
  60_000,
);

realTest(
  "models.list on a host with no user settings: the built-in catalog is not listed without a key",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(await connection.request("models.list", {})).toEqual({ models: [] });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

// ── thread.setModel ──────────────────────────────────────────────────────────

realTest(
  "thread.setModel: the next turn uses the chosen model, null goes back to the default, and a model outside the catalog is refused with nothing changed",
  async () => {
    const session = await open({
      player: playerOf([answer("첫 답"), answer("둘째 답")]),
      models: CATALOG,
    });
    const { connection } = session;
    try {
      const created = await connection.request("thread.create", {});
      const modelOf = async () =>
        (await connection.request("thread.list", {})).threads.find(
          (thread) => thread.threadId === created.threadId,
        )?.model;
      expect(await modelOf()).toBeUndefined();

      const set = await connection.request("thread.setModel", {
        threadId: created.threadId,
        model: "tape/tape-2",
      });
      expect(set.position.seq).toBeGreaterThan(0);
      expect(await modelOf()).toBe("tape/tape-2");

      // 카탈로그에 없는 모델이나 provider 없는 값은 거절하고 값을 바꾸지 않는다
      const refused = await Promise.all(
        ["tape/tape-nope", "nope/tape-1", "tape"].map((model) =>
          wireErrorOf(connection.request("thread.setModel", { threadId: created.threadId, model })),
        ),
      );
      for (const caught of refused) {
        expect(caught.data.kind).toBe("jsonrpc.invalidParams");
        expect(caught.data.details).toEqual({
          issues: [{ path: "model", message: "model is not in the catalog" }],
        });
      }
      expect(await modelOf()).toBe("tape/tape-2");

      // 바꾼 뒤의 turn은 고른 모델로 간다
      await converse(session, created.threadId, "첫 질문");
      expect(session.tape.calls().map((call) => call.modelId)).toEqual(["tape-2"]);

      // null이면 지정을 거두고 기본 모델(tape/tape-1)로 돌아간다
      await connection.request("thread.setModel", { threadId: created.threadId, model: null });
      expect(await modelOf()).toBeUndefined();
      await converse(session, created.threadId, "둘째 질문");
      expect(session.tape.calls().map((call) => call.modelId)).toEqual(["tape-2", "tape-1"]);

      // 없는 대화는 3001이다
      const missing = await wireErrorOf(
        connection.request("thread.setModel", { threadId: NO_SUCH_THREAD, model: "tape/tape-1" }),
      );
      expect(missing.code).toBe(3001);
    } finally {
      await close(session);
    }
  },
  60_000,
);

realTest(
  "thread.setModel during a running turn: the running turn keeps the model it started with, the next turn takes the new one",
  async () => {
    const held = holdingFirstRequest(playerOf([answer("진행 중인 답"), answer("바뀐 뒤의 답")]));
    const session = await open({ player: held.player, models: CATALOG });
    const { connection, collector } = session;
    try {
      const created = await connection.request("thread.create", {});
      const started = await requestTurn(connection, {
        threadId: created.threadId,
        input: "진행 중인 질문",
      });
      // 첫 요청이 tape-1에 닿은 뒤에 모델을 바꾼다
      await held.reached;
      expect(session.tape.calls().map((call) => call.modelId)).toEqual(["tape-1"]);
      await connection.request("thread.setModel", {
        threadId: created.threadId,
        model: "tape/tape-2",
      });
      expect(
        (await connection.request("thread.list", {})).threads.find(
          (thread) => thread.threadId === created.threadId,
        )?.model,
      ).toBe("tape/tape-2");

      held.release();
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        20_000,
      );
      expect(session.tape.calls().map((call) => call.modelId)).toEqual(["tape-1"]);
      await converse(session, created.threadId, "다음 질문");
      expect(session.tape.calls().map((call) => call.modelId)).toEqual(["tape-1", "tape-2"]);
    } finally {
      await close(session);
    }
  },
  60_000,
);

// ── thread.export ────────────────────────────────────────────────────────────

realTest(
  "thread.export: a thread of two turns exports as markdown and as json with the items thread.read returns, and after continues from an item",
  async () => {
    const session = await open({
      player: playerOf([answer("답 하나"), answer("답 둘")]),
      models: CATALOG,
    });
    const { connection } = session;
    try {
      const created = await connection.request("thread.create", { title: "내보내기 시험" });
      await converse(session, created.threadId, "질문 하나");
      await converse(session, created.threadId, "질문 둘");
      const read = await connection.request("thread.read", { threadId: created.threadId });
      expect(read.items.filter((item) => item.kind === "user")).toHaveLength(2);

      // 명세: 내보내기는 thread.read와 같은 item 집합과 순서다. 시스템 절과 확장 메시지 절도 든다
      const markdown = await connection.request("thread.export", {
        threadId: created.threadId,
        format: "markdown",
      });
      expect(markdown).toEqual({
        format: "markdown",
        filename: "내보내기 시험.md",
        chunk: markdownOf("내보내기 시험", created.threadId, read.items),
        itemCount: read.items.length,
      });
      expect(markdown.chunk).toContain("## User\n\n질문 하나\n\n");
      expect(markdown.chunk).toContain("## Assistant\n\n답 하나\n\n");
      expect(markdown.chunk).toContain("## Assistant\n\n답 둘\n\n");

      const json = await connection.request("thread.export", {
        threadId: created.threadId,
        format: "json",
      });
      expect(json).toEqual({
        format: "json",
        filename: "내보내기 시험.json",
        chunk: json.chunk,
        itemCount: read.items.length,
      });
      const parsed = parseJson(json.chunk);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual(read.items);

      // `after`는 그 item 뒤부터 싣고 머리말을 뺀다. 쪽이 하나로 끝나므로 `next`가 없다
      const pivot = read.items[1];
      if (pivot === undefined) throw new Error("the thread has fewer than two items");
      const rest = await connection.request("thread.export", {
        threadId: created.threadId,
        format: "markdown",
        after: pivot.itemId,
      });
      expect(rest).toEqual({
        format: "markdown",
        filename: "내보내기 시험.md",
        chunk: read.items.slice(2).map(sectionOf).join(""),
        itemCount: read.items.length - 2,
      });
      const restJson = await connection.request("thread.export", {
        threadId: created.threadId,
        format: "json",
        after: pivot.itemId,
      });
      // 이어서 받은 json 쪽은 `,\n`으로 시작하고 `]`로 끝나며, 한 번에 받은 문서의 뒷부분과 같다
      expect(restJson.chunk.startsWith(",\n")).toBe(true);
      expect(json.chunk.endsWith(restJson.chunk)).toBe(true);
      const restParsed = parseJson(`[${restJson.chunk.slice(2)}`);
      expect(restParsed.ok).toBe(true);
      if (restParsed.ok) expect(restParsed.value).toEqual(read.items.slice(2));
      expect(restJson.next).toBeUndefined();

      // 마지막 item 뒤는 빈 쪽이다
      const last = read.items.at(-1);
      if (last === undefined) throw new Error("the thread has no items");
      expect(
        await connection.request("thread.export", {
          threadId: created.threadId,
          format: "markdown",
          after: last.itemId,
        }),
      ).toEqual({ format: "markdown", filename: "내보내기 시험.md", chunk: "", itemCount: 0 });

      // 이 대화 가지에 없는 item을 `after`로 주면 3005다
      const unknown = await wireErrorOf(
        connection.request("thread.export", {
          threadId: created.threadId,
          format: "markdown",
          after: NO_SUCH_ITEM,
        }),
      );
      expect(unknown.code).toBe(3005);

      // 빈 대화: 머리말만 있고 json은 빈 배열이다. 제목의 `/`와 `:`는 파일 이름에서 `_`가 된다
      const empty = await connection.request("thread.create", { title: "계획/검토: v2" });
      expect(
        await connection.request("thread.export", { threadId: empty.threadId, format: "markdown" }),
      ).toEqual({
        format: "markdown",
        filename: "계획_검토_ v2.md",
        chunk: `# 계획/검토: v2\n\n- Thread ID: ${empty.threadId}\n- Items: 0\n\n`,
        itemCount: 0,
      });
      expect(
        await connection.request("thread.export", { threadId: empty.threadId, format: "json" }),
      ).toEqual({
        format: "json",
        filename: "계획_검토_ v2.json",
        chunk: "[]",
        itemCount: 0,
      });

      // 없는 대화는 3001이다
      const missing = await wireErrorOf(
        connection.request("thread.export", { threadId: NO_SUCH_THREAD, format: "markdown" }),
      );
      expect(missing.code).toBe(3001);
    } finally {
      await close(session);
    }
  },
  60_000,
);
