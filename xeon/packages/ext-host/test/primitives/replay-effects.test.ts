import { expect, test } from "bun:test";
import { isCapabilityError, type CallOptions, type ServiceKey } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PointName } from "@xeon/contracts/extensions";
import { hostOf } from "../../src/primitives/index.ts";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { echoDefs, makeGroupUnit, makeUnit, rejectionOf } from "./fixtures/support.ts";

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
  expect(settled?.payload).toEqual({ key: "ew:1", outcome: { kind: "ok", output: "poked" } });
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
      draft("requested", { key: "ew:9", capability: "demo.echo", method: "poke", input: {} }),
    ],
  });
  await first.t.records.commit({
    threadId: thread,
    requestId: "seed:s",
    visibility: "private",
    drafts: [draft("started", { key: "ew:9" })],
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
  expect(settled?.payload).toEqual({ key: "ew:9", outcome: { kind: "unknown" } });
});
