import { expect, test } from "bun:test";
import { isCapabilityError, type CallOptions, type ServiceKey } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PointName } from "@xeon/contracts/extensions";
import { hostOf } from "../../src/primitives/index.ts";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost, fixedIdFactory, memoryRecordStore } from "../../src/testing/index.ts";
import {
  echoDefs,
  makeGroupUnit,
  makeManifest,
  makeUnit,
  rejectionOf,
} from "./fixtures/support.ts";

// ADR-0015 §3.2, §3.4, §3.6: 재실행되는 코드의 능력 호출 검사와 "재생 2회, 효과 1회"

interface Svc {
  echo(input: { text?: string }, options?: CallOptions): Promise<string>;
  peek(input: { text?: string }, options?: CallOptions): Promise<string>;
  poke(input: { text?: string }, options?: CallOptions): Promise<string>;
}
const svcKey: ServiceKey<Svc> = { capability: "demo.echo", version: "1.0.0" };

/** 호출 수와 효과 수를 센다. 효과는 같은 requestId의 두 번째 호출에서 늘지 않는다(멱등 공급자) */
function makeProvider() {
  const seen = new Set<string>();
  const requestIds: (string | undefined)[] = [];
  const callers: unknown[] = [];
  const state = { calls: 0, effects: 0, requestIds, callers };
  const service: Svc = {
    echo(_input, options) {
      state.calls += 1;
      state.requestIds.push(options?.requestId);
      state.callers.push(options?.context?.caller);
      const id = options?.requestId ?? "";
      if (!seen.has(id)) {
        seen.add(id);
        state.effects += 1;
      }
      return Promise.resolve("ok");
    },
    peek() {
      state.calls += 1;
      return Promise.resolve("peeked");
    },
    poke() {
      state.calls += 1;
      state.effects += 1;
      return Promise.resolve("poked");
    },
  };
  return { state, service };
}

async function codeOf(run: () => unknown): Promise<string> {
  const failure = await rejectionOf(run);
  if (failure === undefined) return "ok";
  return isCapabilityError(failure) ? failure.data.code : "not_capability_error";
}

async function setup() {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const provider = makeProvider();
  await t.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, provider.service);
    }),
  );
  return { t, provider };
}

function fire(t: Awaited<ReturnType<typeof createTestHost>>, thread: ThreadId, key: string) {
  const point: PointName = "boundary.settle.after";
  return t.host.dispatch(
    point,
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("on handler: only idempotent writes with an explicit requestId reach the provider", async () => {
  const { t, provider } = await setup();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: Record<string, string> = {};
  await t.host.install(
    makeUnit(
      {
        name: "re-on",
        loadIndex: 1,
        points: ["boundary.settle.after"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          const svc = g.capability(svcKey);
          codes.read = await codeOf(() => svc.peek({}));
          codes.undeclared = await codeOf(() => svc.poke({}));
          codes.noKey = await codeOf(() => svc.echo({}));
          codes.keyed = await codeOf(() => svc.echo({}, { requestId: "re-on:1" }));
        });
      },
    ),
  );
  await fire(t, thread, "k");
  expect(codes).toEqual({
    read: "effect_not_allowed",
    undeclared: "effect_not_allowed",
    noKey: "invalid_input",
    keyed: "ok",
  });
  // 거부된 호출은 공급자를 부르지 않았다
  expect(provider.state.calls).toBe(1);
  expect(provider.state.requestIds).toEqual(["re-on:1"]);
  expect(provider.state.callers).toEqual([{ kind: "extension", extension: "re-on" }]);
});

test("drive function: reads and keyed idempotent writes pass, undeclared and keyless writes are refused", async () => {
  const { t, provider } = await setup();
  const thread = t.newThread();
  const codes: Record<string, string> = {};
  await t.host.install(
    makeGroupUnit(
      { name: "re-drv", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      (g) => {
        g.drive(async () => {
          const svc = g.capability(svcKey);
          codes.read = await codeOf(() => svc.peek({}));
          codes.undeclared = await codeOf(() => svc.poke({}));
          codes.noKey = await codeOf(() => svc.echo({}));
          codes.keyed = await codeOf(() => svc.echo({}, { requestId: "re-drv:1" }));
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(codes).toEqual({
    read: "ok",
    undeclared: "effect_not_allowed",
    noKey: "invalid_input",
    keyed: "ok",
  });
  expect(provider.state.calls).toBe(2);
  // 기본 키는 없다([결정: adr.0015] §3.4 3번). 명시 키만 공급자에 닿는다
  expect(provider.state.requestIds).toEqual(["re-drv:1"]);
});

test("replaying a drive twice produces the effect once", async () => {
  const { t, provider } = await setup();
  const thread = t.newThread();
  let invocations = 0;
  await t.host.install(
    makeGroupUnit(
      { name: "re-twice", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      (g) => {
        g.drive(async (loop) => {
          invocations += 1;
          await g.capability(svcKey).echo({ text: "once" }, { requestId: "re-twice:1" });
          await loop.turn({ input: { kind: "user", content: "go" } });
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 같은 상태 판으로 다시 불린다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(invocations).toBe(2);
  expect(provider.state.calls).toBe(2);
  expect(provider.state.effects).toBe(1);
  expect(t.loop.turns).toHaveLength(1);
  expect(new Set(provider.state.requestIds).size).toBe(1);
});

// ── 효과 워커(ADR-0015 §3.5, M3-REQ-27) ──

test("an undeclared write goes through a request record and the worker, once", async () => {
  const { t, provider } = await setup();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit(
      {
        name: "ew-grp",
        kind: "group",
        loadIndex: 1,
        points: ["boundary.settle.after"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          await hostOf(g).requestEffect({
            capability: "demo.echo",
            method: "poke",
            input: { text: "a" },
            key: "ew:1",
          });
        });
      },
    ),
  );
  await t.settled();
  await fire(t, thread, "k");
  await t.settled();
  // 같은 디스패치 키로 다시 실행돼도 요청과 효과는 한 번이다
  await fire(t, thread, "k");
  await t.settled();
  expect(provider.state.effects).toBe(1);
  expect(
    t.records
      .events(thread)
      .map((event) => event.kind)
      .filter((kind) => kind.includes(".effect.")),
  ).toEqual([
    "grp.ew-grp.effect.requested",
    "grp.ew-grp.effect.started",
    "grp.ew-grp.effect.settled",
  ]);
  const settled = t.records.events(thread).find((event) => event.kind.endsWith(".effect.settled"));
  expect(settled?.payload).toEqual({
    scopeId: "ew-grp",
    key: "ew:1",
    outcome: { kind: "ok", output: "poked" },
  });
});

test("after a restart, a started request without a result is closed as unknown when replay is unsafe", async () => {
  const first = await setup();
  const thread = first.t.newThread();
  const draft = (area: "requested" | "started", payload: unknown) =>
    makeDraft(first.t.ids, {
      threadId: thread,
      kind: area === "requested" ? "grp.ew-grp.effect.requested" : "grp.ew-grp.effect.started",
      payload,
    });
  await first.t.records.commit({
    threadId: thread,
    requestId: "seed:r",
    visibility: "private",
    drafts: [
      draft("requested", {
        scopeId: "ew-grp",
        key: "ew:9",
        capability: "demo.echo",
        method: "poke",
        input: {},
      }),
    ],
  });
  await first.t.records.commit({
    threadId: thread,
    requestId: "seed:s",
    visibility: "private",
    drafts: [draft("started", { scopeId: "ew-grp", key: "ew:9" })],
  });
  const restarted = await first.t.restart({ capabilityDefs: echoDefs });
  const provider = makeProvider();
  await restarted.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, provider.service);
    }),
  );
  await restarted.host.install(
    makeUnit(
      {
        name: "ew-grp",
        kind: "group",
        loadIndex: 1,
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      () => {},
    ),
  );
  await restarted.host.openThread(thread);
  await restarted.settled();
  expect(provider.state.calls).toBe(0);
  const settled = restarted.records
    .events(thread)
    .find((event) => event.kind === "grp.ew-grp.effect.settled");
  expect(settled?.payload).toEqual({
    scopeId: "ew-grp",
    key: "ew:9",
    outcome: { kind: "unknown" },
  });
});

test("a turn started by a drive is not a replayed context for the tools inside it", async () => {
  const provider = makeProvider();
  const holder: { svc?: Svc } = {};
  const codes: string[] = [];
  const ids = fixedIdFactory(500);
  const t = await createTestHost({
    capabilityDefs: echoDefs,
    loop: {
      runTurn: async () => {
        // 도구 실행처럼 turn 안에서 선언 없는 쓰기를 부른다. drive의 검사를 받지 않는다
        const svc = holder.svc;
        codes.push(svc === undefined ? "no service" : await codeOf(() => svc.poke({})));
        return { outcome: { turnId: ids.next("trn"), status: "completed" }, usage: null };
      },
    },
  });
  const thread = t.newThread();
  await t.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, provider.service);
    }),
  );
  await t.host.install(
    makeGroupUnit(
      { name: "re-turn", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      (g) => {
        holder.svc = g.capability(svcKey);
        g.drive(async (loop) => {
          await loop.turn({ input: { kind: "user", content: "go" } });
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(codes).toEqual(["ok"]);
  expect(provider.state.effects).toBe(1);
});

test("members outside the capability definition pass through the wrapper", async () => {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const extra = { registerAction: () => "registered" };
  await t.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, { ...makeProvider().service, ...extra });
    }),
  );
  const seen: unknown[] = [];
  await t.host.install(
    makeUnit(
      { name: "re-extra", loadIndex: 1, requires: [{ id: "demo.echo", range: "^1.0.0" }] },
      (g) => {
        const service: unknown = g.capability(svcKey);
        seen.push(
          typeof service === "object" && service !== null && "registerAction" in service
            ? typeof service.registerAction
            : "missing",
        );
      },
    ),
  );
  expect(seen).toEqual(["function"]);
});

test("a worker pass that throws does not block the later requests of the scope", async () => {
  const records = memoryRecordStore();
  let failures = 0;
  const flaky: typeof records = {
    ...records,
    queryRecords(threadId, query, reader) {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error("store read blew up"));
      }
      return records.queryRecords(threadId, query, reader);
    },
  };
  const t = await createTestHost({ capabilityDefs: echoDefs, shared: { records: flaky } });
  const provider = makeProvider();
  let dispatches = 0;
  await t.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, provider.service);
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit(
      {
        name: "ew-flaky",
        kind: "group",
        loadIndex: 1,
        points: ["boundary.settle.after"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          dispatches += 1;
          await hostOf(g).requestEffect({
            capability: "demo.echo",
            method: "poke",
            input: {},
            key: `ew:${dispatches}`,
          });
        });
      },
    ),
  );
  await t.settled();
  failures = 1;
  await fire(t, thread, "k1");
  await t.settled();
  // 첫 처리 한 번이 던졌다
  expect(t.diagnostics.some((d) => d.message.includes("background task failed"))).toBe(true);
  expect(provider.state.effects).toBe(0);
  await fire(t, thread, "k2");
  await t.settled();
  // 두 요청 모두 실행되었다. 던진 뒤에도 scope의 처리 표시가 남지 않는다
  expect(provider.state.effects).toBe(2);
});

test("two scopes of one extension keep their effect requests apart even with the same key", async () => {
  const { t, provider } = await setup();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const manifest = makeManifest({
    name: "ew-two",
    kind: "group",
    points: ["boundary.settle.after"],
    requires: [{ id: "demo.echo", range: "^1.0.0" }],
  });
  await t.host.install({
    manifest,
    loadIndex: 1,
    builtin: true,
    entry: ({ scope }) => {
      for (const id of ["ew-two", "ew-two/side"]) {
        scope(id, { defaultEnabled: true }, (g) => {
          g.on("boundary.settle.after", async () => {
            await hostOf(g).requestEffect({
              capability: "demo.echo",
              method: "poke",
              input: {},
              key: "same",
            });
          });
        });
      }
    },
  });
  await t.settled();
  await fire(t, thread, "k");
  await t.settled();
  expect(provider.state.effects).toBe(2);
  const scopes = t.records
    .events(thread)
    .filter((event) => event.kind.endsWith(".effect.settled"))
    .map((event) => (isRecordLike(event.payload) ? event.payload["scopeId"] : undefined))
    .toSorted((a, b) => String(a).localeCompare(String(b)));
  expect(scopes).toEqual(["ew-two", "ew-two/side"]);
});

test("a provider's own tools are not judged as replayed code", async () => {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const inner: string[] = [];
  const holder: { svc?: Svc } = {};
  await t.host.install(
    makeUnit({ name: "re-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, {
        echo: async () => {
          // 공급자가 안에서 선언 없는 쓰기를 부른다(도구가 하는 일과 같다)
          const svc = holder.svc;
          inner.push(svc === undefined ? "no service" : await codeOf(() => svc.poke({})));
          return "ok";
        },
        peek: () => Promise.resolve("peeked"),
        poke: () => Promise.resolve("poked"),
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit(
      {
        name: "re-outer",
        loadIndex: 1,
        points: ["boundary.settle.after"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        holder.svc = g.capability(svcKey);
        g.on("boundary.settle.after", async () => {
          await g.capability(svcKey).echo({}, { requestId: "outer:1" });
        });
      },
    ),
  );
  await fire(t, thread, "k");
  expect(inner).toEqual(["ok"]);
});

function isRecordLike(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
