import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { defineManifest } from "@fresnel/contracts/extensions";
import { LeaseAcquiredPayloadSchema, LeaseReleasedPayloadSchema } from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapePlayer,
} from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle, until } from "../fixtures/wire-client.ts";

// AGE-64 (M5c §4.1.14 6번, §4.3.4), 실제 엔진: 프로필 칩이 보여 주는 것과 실제 동작이 같다. 첫 메시지를 보낸 뒤에도 스타트 Drive가 있는 프로필로 바꾸면
// 바꾼 직후(턴이 도는 중이면 턴이 끝난 뒤) 새 스타트 Drive가 시작한다. 스타트 Drive가 있는 프로필에서 다른 스타트 Drive로 바꾸면 아직 메시지를
// 받지 않은 Drive는 내리고, 이미 일을 시작한 Drive는 두고 그 Drive가 끝난 뒤 시작한다. "어느 Drive가 쥐었는지"는 메시지를 받은 플러그인으로 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const FINISH = "FINISH-NOW";

/** 시험이 보는 두 스타트 Drive의 기록: 어느 플러그인의 단계가 무엇을 받았는가 */
interface Seen {
  readonly plugin: string;
  readonly last: "null" | "user";
  readonly text: string;
}

function driveModule(name: string, seen: Seen[]): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name,
      version: "0.1.0",
      displayName: name,
      description: "Profile switch start drive test plugin.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register(name, {}, (g) => {
        g.drive(({ last }) => {
          if (last?.kind === "user") {
            const text = JSON.stringify(last.message);
            seen.push({ plugin: name, last: "user", text });
            if (text.includes(FINISH)) return Promise.resolve({ do: "done", result: "finished" });
            return Promise.resolve({ do: "turn", input: last.message });
          }
          if (last === null) seen.push({ plugin: name, last: "null", text: "" });
          return Promise.resolve({ do: "yield" });
        });
      });
    },
  };
}

/** 모델 호출이 `hold`가 풀릴 때까지 응답하지 않게 하는 테이프 선수. 코어 루프의 턴이 도는 중을 만든다 */
function heldPlayer(inner: TapePlayer, hold: { promise: Promise<void> | null }): TapePlayer {
  return {
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => {
      inner.assertExhausted();
    },
    stream(req) {
      const stream = inner.stream(req);
      return {
        rawEvents: stream.rawEvents,
        [Symbol.asyncIterator]() {
          const iterator = stream[Symbol.asyncIterator]();
          let waited = false;
          return {
            async next() {
              if (!waited) {
                waited = true;
                const pending = hold.promise;
                if (pending !== null) await pending;
              }
              return await iterator.next();
            },
          };
        },
      };
    },
  };
}

const REPLIES = Array.from({ length: 16 }, (_, index) => ({
  role: "main" as const,
  label: `reply ${index}`,
  response: { type: "message" as const, content: [t.text("ok.")], stopReason: "stop" as const },
}));

function acquiredScopes(events: readonly EventWire[], threadId: ThreadId): string[] {
  return events.flatMap((event) => {
    if (event.kind !== "lease.acquired" || event.threadId !== threadId) return [];
    const parsed = parse(LeaseAcquiredPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value.scopeId] : [];
  });
}

function releasedOf(
  events: readonly EventWire[],
  threadId: ThreadId,
): { scopeId: string; reason: string }[] {
  return events.flatMap((event) => {
    if (event.kind !== "lease.released" || event.threadId !== threadId) return [];
    const parsed = parse(LeaseReleasedPayloadSchema, event.payload);
    return parsed.ok ? [{ scopeId: parsed.value.scopeId, reason: parsed.value.reason }] : [];
  });
}

async function startRig() {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "x.primitives.driveRequiresOrchestration": false });
  const seen: Seen[] = [];
  const hold: { promise: Promise<void> | null } = { promise: null };
  const releaser: { current: () => void } = { current: () => {} };
  const player = heldPlayer(tapePlayer(tape("switch", REPLIES), { clock: realTapeClock() }), hold);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [driveModule("sw-a", seen), driveModule("sw-b", seen)],
    buildModels: tapeBuildModels(tapeProvider(player)),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const put = (id: string, startDrive: string | null) =>
    connection.request("profile.put", {
      profile: {
        id,
        title: id,
        plugins: [{ name: "sw-a" }, { name: "sw-b" }],
        settings: [],
        startDrive,
      },
      baseRev: null,
    });
  await put("plain", null);
  await put("pa", "sw-a");
  await put("pb", "sw-b");
  let counter = 0;
  const send = async (threadId: ThreadId, input: string, whenBusy?: "followUp") => {
    counter += 1;
    return await startInputWhenIdle(connection, {
      threadId,
      input,
      requestId: `req-${counter}`,
      ...(whenBusy === undefined ? {} : { whenBusy }),
    });
  };
  const create = async (profileId: string): Promise<ThreadId> =>
    (await connection.request("thread.create", { profileId })).threadId;
  const completedCount = (threadId: ThreadId): number =>
    collector.events.filter(
      (event) => event.kind === "turn.completed" && event.threadId === threadId,
    ).length;
  const waitCompleted = async (threadId: ThreadId, count: number): Promise<void> => {
    await collector.waitFor(() => completedCount(threadId) >= count, 20_000);
  };
  const waitAcquired = async (threadId: ThreadId, scope: string): Promise<void> => {
    await collector.waitFor(
      () => acquiredScopes(collector.events, threadId).includes(scope),
      20_000,
    );
  };
  /** 플러그인의 단계 함수가 그 입력을 받을 때까지 기다린다(전달은 접수 뒤 비동기다) */
  const waitSeen = async (count: number, last: Seen["last"]): Promise<void> => {
    const reached = await until(
      () => seen.filter((entry) => entry.last === last).length >= count,
      20_000,
    );
    expect(reached).toBe(true);
  };
  const finish = async (): Promise<void> => {
    await host.close();
    home.dispose();
  };
  return {
    connection,
    collector,
    seen,
    hold,
    send,
    create,
    waitCompleted,
    waitAcquired,
    waitSeen,
    releaseHeld: () => {
      releaser.current();
    },
    setRelease: (release: () => void) => {
      releaser.current = release;
    },
    finish,
    switchTo: (threadId: ThreadId, profileId: string) =>
      connection.request("thread.setProfile", { threadId, profileId }),
  };
}

const delivered = (result: object): boolean => !("turnId" in result);

realTest(
  "before the first message, the new profile's start drive takes the message whatever the previous profile held, and an untouched old start drive is lowered",
  async () => {
    const rig = await startRig();
    try {
      // 직전 프로필이 스타트 Drive가 없다: 새 것이 쥔다
      const fromPlain = await rig.create("plain");
      expect((await rig.switchTo(fromPlain, "pb")).startDrive).toBe("requested");
      expect(delivered(await rig.send(fromPlain, "one"))).toBe(true);
      await rig.waitSeen(1, "user");
      expect(rig.seen.filter((entry) => entry.last === "user").map((e) => e.plugin)).toEqual([
        "sw-b",
      ]);

      // 같은 스타트 Drive: 바꿀 것이 없다
      const same = await rig.create("pa");
      expect((await rig.switchTo(same, "pa")).startDrive).toBe("leading");
      expect(delivered(await rig.send(same, "two"))).toBe(true);
      await rig.waitSeen(2, "user");
      expect(rig.seen.filter((entry) => entry.last === "user").map((e) => e.plugin)).toEqual([
        "sw-b",
        "sw-a",
      ]);

      // 다른 스타트 Drive: 옛 것은 메시지를 받지 않았으므로 내려가고 새 것이 받는다
      const other = await rig.create("pa");
      await rig.waitAcquired(other, "sw-a");
      expect((await rig.switchTo(other, "pb")).startDrive).toBe("requested");
      await rig.waitAcquired(other, "sw-b");
      expect(delivered(await rig.send(other, "three"))).toBe(true);
      await rig.waitSeen(3, "user");
      expect(rig.seen.filter((entry) => entry.last === "user").map((e) => e.plugin)).toEqual([
        "sw-b",
        "sw-a",
        "sw-b",
      ]);
      expect(releasedOf(rig.collector.events, other)).toEqual([
        { scopeId: "sw-a", reason: "revoked" },
      ]);

      // 새 프로필에 스타트 Drive가 없다: 옛 것은 내려가고 메시지는 코어 루프의 턴이 된다
      const toNone = await rig.create("pa");
      await rig.waitAcquired(toNone, "sw-a");
      expect((await rig.switchTo(toNone, "plain")).startDrive).toBe("none");
      expect(delivered(await rig.send(toNone, "four"))).toBe(false);
      expect(releasedOf(rig.collector.events, toNone)).toEqual([
        { scopeId: "sw-a", reason: "revoked" },
      ]);
    } finally {
      await rig.finish();
    }
  },
  120_000,
);

realTest(
  "after the first message, a rest conversation starts the new start drive right away, and a running turn delays it until the turn ends while messages sent in between go to the core loop first",
  async () => {
    const rig = await startRig();
    try {
      // 쉬는 중
      const rest = await rig.create("plain");
      expect(delivered(await rig.send(rest, "one"))).toBe(false);
      await rig.waitCompleted(rest, 1);
      expect((await rig.switchTo(rest, "pb")).startDrive).toBe("requested");
      await rig.waitAcquired(rest, "sw-b");
      await rig.waitSeen(1, "null");
      // 메시지를 기다리지 않고 첫 단계(last null)를 돈다
      expect(rig.seen.filter((entry) => entry.plugin === "sw-b").map((e) => e.last)).toEqual([
        "null",
      ]);
      expect(delivered(await rig.send(rest, "two"))).toBe(true);

      // 코어 루프의 턴이 도는 중
      const busy = await rig.create("plain");
      const held = Promise.withResolvers<void>();
      rig.hold.promise = held.promise;
      rig.setRelease(held.resolve);
      const seenBefore = rig.seen.length;
      expect(delivered(await rig.send(busy, "first"))).toBe(false);
      expect((await rig.switchTo(busy, "pb")).startDrive).toBe("deferred");
      // 그 사이에 온 메시지는 시작 Drive보다 먼저 코어 루프가 받는다
      expect(delivered(await rig.send(busy, "second", "followUp"))).toBe(false);
      expect(acquiredScopes(rig.collector.events, busy)).toEqual([]);
      rig.hold.promise = null;
      held.resolve();
      await rig.waitCompleted(busy, 2);
      await rig.waitAcquired(busy, "sw-b");
      await rig.waitSeen(2, "null");
      const events = rig.collector.events;
      const lastCompleted = events.findLastIndex(
        (event) => event.kind === "turn.completed" && event.threadId === busy,
      );
      const acquiredAt = events.findIndex(
        (event) => event.kind === "lease.acquired" && event.threadId === busy,
      );
      expect(acquiredAt).toBeGreaterThan(lastCompleted);
      expect(rig.seen.slice(seenBefore).map((entry) => [entry.plugin, entry.last])).toEqual([
        ["sw-b", "null"],
      ]);
    } finally {
      // 어떤 실패에서도 붙들린 모델 호출을 풀어 호스트가 닫히게 한다
      rig.hold.promise = null;
      rig.releaseHeld();
      await rig.finish();
    }
  },
  120_000,
);

realTest(
  "a start drive that already works is kept, the new start drive begins after it ends, and only the last of several switches counts",
  async () => {
    const rig = await startRig();
    try {
      const working = await rig.create("pa");
      await rig.waitAcquired(working, "sw-a");
      expect(delivered(await rig.send(working, "work"))).toBe(true);
      expect((await rig.switchTo(working, "pb")).startDrive).toBe("deferred");
      // 연달아 바꾸면 마지막만 유효하다
      expect((await rig.switchTo(working, "plain")).startDrive).toBe("none");
      expect((await rig.switchTo(working, "pb")).startDrive).toBe("deferred");
      expect(releasedOf(rig.collector.events, working)).toEqual([]);
      expect(acquiredScopes(rig.collector.events, working)).toEqual(["sw-a"]);
      // 일하던 Drive가 끝나면 새 시작 Drive가 시작한다
      await rig.send(working, FINISH);
      await rig.waitAcquired(working, "sw-b");
      expect(releasedOf(rig.collector.events, working)).toEqual([
        { scopeId: "sw-a", reason: "done" },
      ]);
      expect(acquiredScopes(rig.collector.events, working)).toEqual(["sw-a", "sw-b"]);

      // 기다리는 시작이 걸린 뒤 시작 Drive가 없는 프로필로 바꾸면 시작하지 않는다
      const dropped = await rig.create("pa");
      await rig.waitAcquired(dropped, "sw-a");
      await rig.send(dropped, "work");
      await rig.switchTo(dropped, "pb");
      await rig.switchTo(dropped, "plain");
      await rig.send(dropped, FINISH);
      await rig.waitCompleted(dropped, 1);
      expect(acquiredScopes(rig.collector.events, dropped)).toEqual(["sw-a"]);
    } finally {
      await rig.finish();
    }
  },
  120_000,
);
