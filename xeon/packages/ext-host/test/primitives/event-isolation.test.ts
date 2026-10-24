import { expect, test } from "bun:test";
import { hostInternalsOf, hostOf, type PlatformContext } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import type { BusEvent, EventBusError } from "../../src/primitives/event-bus.ts";
import type { Result } from "@xeon/contracts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

// X.primitives.spec §4.9, P-26. 확장 사이의 통신은 그룹 레코드와 능력 서비스뿐이고,
// pi events 어댑터용 휘발 버스는 이름 접두와 읽기 선언을 강제한다

/** Cordis 이벤트·컨텍스트 API의 이름. 확장에 주는 어떤 객체에도 없어야 한다 */
const CORDIS_NAMES = [
  "emit",
  "parallel",
  "serial",
  "bail",
  "waterfall",
  "broadcast",
  "ctx",
  "root",
  "reflect",
  "fiber",
  "lifecycle",
  "plugin",
];

function leaked(target: object): string[] {
  const names = new Set([...Object.keys(target), ...Object.getOwnPropertyNames(target)]);
  return CORDIS_NAMES.filter((name) => names.has(name));
}

test("no Cordis event or context API reaches extension code", async () => {
  const t = await createTestHost();
  const seen: string[] = [];
  let platform: PlatformContext | undefined;
  await t.host.registerPlatform({
    name: "iso-platform",
    setup(ctx) {
      platform = ctx;
    },
  });
  await t.host.install(
    makeUnit({ name: "iso-ext" }, (g) => {
      seen.push(...leaked(g), ...leaked(hostOf(g)));
    }),
  );
  expect(seen).toEqual([]);
  expect(leaked(t.host)).toEqual([]);
  expect(platform === undefined ? [] : leaked(platform)).toEqual([]);
  expect(leaked(t.host.resources)).toEqual([]);
});

async function busHost() {
  const t = await createTestHost();
  const events = hostInternalsOf(t.host).events;
  return { t, events };
}

function collector() {
  const received: string[] = [];
  return {
    received,
    listener: (event: BusEvent) => {
      received.push(`${event.from}:${event.name}:${JSON.stringify(event.data)}`);
    },
  };
}

function kinds(r: Result<void, EventBusError>): string {
  return r.ok ? "ok" : r.error.kind;
}

test("event bus: names must carry the sender's own prefix", async () => {
  const { t, events } = await busHost();
  const results: Record<string, string> = {};
  await t.host.install(
    makeUnit({ name: "bus-plugin" }, (g) => {
      results.own = kinds(events.emit(g, "x.bus-plugin.note.shown", { n: 1 }));
      results.foreign = kinds(events.emit(g, "x.other.note.shown", { n: 1 }));
      results.group = kinds(events.emit(g, "grp.bus-plugin.note.shown", { n: 1 }));
      results.malformed = kinds(events.emit(g, "my:event", { n: 1 }));
    }),
  );
  await t.host.install(
    makeGroupUnit({ name: "bus-group", loadIndex: 1 }, (g) => {
      const result = events.emit(g, "x.bus-group.note.shown", {});
      results.groupAsPlugin = result.ok ? "ok" : result.error.kind;
      const own = events.emit(g, "grp.bus-group.note.shown", {});
      results.groupOwn = own.ok ? "ok" : own.error.kind;
    }),
  );
  expect(results).toEqual({
    own: "ok",
    foreign: "prefix_not_owned",
    group: "prefix_not_owned",
    malformed: "name_invalid",
    groupAsPlugin: "prefix_not_owned",
    groupOwn: "ok",
  });
});

test("event bus: subscribing to another extension needs a readsRecordKinds declaration", async () => {
  const { t, events } = await busHost();
  const mine = collector();
  const declared = collector();
  const undeclared: string[] = [];
  let sender: Parameters<typeof events.emit>[0] | undefined;
  await t.host.install(
    makeUnit({ name: "bus-src" }, (g) => {
      sender = g;
      const own = events.on(g, "x.bus-src.*", mine.listener);
      expect(own.ok).toBe(true);
    }),
  );
  await t.host.install(
    makeUnit({ name: "bus-reader", loadIndex: 1, readsRecordKinds: ["x.bus-src.*"] }, (g) => {
      const on = events.on(g, "x.bus-src.note.shown", declared.listener);
      expect(on.ok).toBe(true);
    }),
  );
  await t.host.install(
    makeUnit({ name: "bus-stranger", loadIndex: 2 }, (g) => {
      const on = events.on(g, "x.bus-src.note.shown", () => {});
      undeclared.push(on.ok ? "ok" : on.error.kind);
    }),
  );
  expect(undeclared).toEqual(["read_undeclared"]);
  if (sender === undefined) throw new Error("setup did not run");
  const sent = events.emit(sender, "x.bus-src.note.shown", { n: 7 });
  expect(sent.ok).toBe(true);
  // 구독자는 발행이 돌아온 뒤에 호출된다
  expect(mine.received).toEqual([]);
  await t.settled();
  expect(mine.received).toEqual(['bus-src:x.bus-src.note.shown:{"n":7}']);
  expect(declared.received).toEqual(['bus-src:x.bus-src.note.shown:{"n":7}']);
});

test("event bus: events are volatile, frozen copies, and listeners die with their scope", async () => {
  const { t, events } = await busHost();
  const late = collector();
  const frozen: boolean[] = [];
  const failures = collector();
  let sender: Parameters<typeof events.emit>[0] | undefined;
  await t.host.install(
    makeUnit({ name: "bus-vol", readsRecordKinds: [] }, (g) => {
      sender = g;
      events.on(g, "x.bus-vol.tick.fired", (event) => {
        frozen.push(Object.isFrozen(event.data));
        throw new Error("listener failure");
      });
      events.on(g, "x.bus-vol.tick.fired", failures.listener);
    }),
  );
  if (sender === undefined) throw new Error("setup did not run");
  const payload = { list: [1, 2] };
  events.emit(sender, "x.bus-vol.tick.fired", payload);
  payload.list.push(3);
  await t.settled();
  // 발행 뒤 원본을 고쳐도 구독자는 발행 시점의 복사본을 받는다. 예외는 다른 구독자를 막지 않는다
  expect(frozen).toEqual([true]);
  expect(failures.received).toEqual(['bus-vol:x.bus-vol.tick.fired:{"list":[1,2]}']);
  expect(t.diagnostics.some((d) => d.message.includes("event bus listener"))).toBe(true);

  // scope를 끄면 구독이 사라지고, 늦게 발행해도 아무도 받지 않는다
  await t.host.openThread(t.newThread());
  t.host.scope("bus-vol")?.disable();
  await t.settled();
  const before = failures.received.length;
  const closed = events.emit(sender, "x.bus-vol.tick.fired", {});
  expect(closed.ok).toBe(false);
  expect(failures.received).toHaveLength(before);
  expect(late.received).toEqual([]);
});
