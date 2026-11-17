import { expect, test } from "bun:test";
import type { CallContext, CallOptions, ServiceKey } from "@fresnel/contracts/capabilities";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { echoDefs, makeUnit } from "./fixtures/support.ts";

// K-01: 확장이 호출 옵션으로 `context.caller`를 넣어 호스트나 모델로 위장하지 못한다.
// 내장 확장(L1.tools 어댑터)은 도구 호출의 문맥을 그대로 싣는다.

interface Svc {
  echo(input: { text?: string }, options?: CallOptions): Promise<string>;
}
const svcKey: ServiceKey<Svc> = { capability: "demo.echo", version: "1.0.0" };
const POINT = "boundary.settle.after" as const;

const forgedSeen: CallContext[] = [];

async function contextSeenByProvider(builtin: boolean): Promise<CallContext | undefined> {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const received: (CallContext | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "kg-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, {
        echo: (_input, options) => {
          received.push(options?.context);
          return Promise.resolve("ok");
        },
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const forged: CallContext = {
    threadId: thread,
    turnId: t.ids.next("trn"),
    toolCallId: "call_9",
    caller: { kind: "host" },
    interactive: false,
  };
  forgedSeen.push(forged);
  await t.host.install(
    makeUnit(
      {
        name: "kg-consumer",
        builtin,
        loadIndex: 1,
        hooks: [POINT],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on(POINT, async () => {
          await g.capability(svcKey).echo({}, { requestId: "kg:1", context: forged });
        });
      },
    ),
  );
  await t.host.dispatch(
    POINT,
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(received).toHaveLength(1);
  return received[0];
}

test("a non-built-in extension cannot choose caller or interactive, only threadId and toolCallId pass", async () => {
  const seen = await contextSeenByProvider(false);
  expect(seen).toMatchObject({
    toolCallId: "call_9",
    caller: { kind: "extension", extension: "kg-consumer" },
  });
  expect(seen?.interactive).toBeUndefined();
  expect(seen?.turnId).toBeUndefined();
  expect(Object.keys(seen ?? {}).toSorted()).toEqual(["caller", "threadId", "toolCallId"]);
});

test("a built-in extension (the L1 tools adapter) keeps the context it filled", async () => {
  const seen = await contextSeenByProvider(true);
  expect(seen).toEqual(forgedSeen.at(-1));
});

async function conditionsSeen(
  conditions: { interactive: boolean; sandbox?: "read-only" } | undefined,
): Promise<CallContext | undefined> {
  const t = await createTestHost({
    capabilityDefs: echoDefs,
    loop: { callConditions: () => conditions },
  });
  const received: (CallContext | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "kc-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, {
        echo: (_input, options) => {
          received.push(options?.context);
          return Promise.resolve("ok");
        },
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit(
      {
        name: "kc-consumer",
        builtin: false,
        loadIndex: 1,
        hooks: [POINT],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        g.on(POINT, async () => {
          // 호출자가 위조한 조건은 무시되고 호스트가 아는 조건이 간다
          await g
            .capability(svcKey)
            .echo(
              {},
              { requestId: "kc:1", context: { caller: { kind: "host" }, interactive: true } },
            );
        });
      },
    ),
  );
  await t.host.dispatch(
    POINT,
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  return received[0];
}

test("a plugin capability call carries the unattended flag and the read-only ceiling of the turn it ran in", async () => {
  const seen = await conditionsSeen({ interactive: false, sandbox: "read-only" });
  expect(seen).toMatchObject({
    caller: { kind: "extension", extension: "kc-consumer" },
    interactive: false,
    sandbox: "read-only",
  });
});

test("a plugin capability call in an interactive turn without a ceiling carries interactive true and no sandbox", async () => {
  const seen = await conditionsSeen({ interactive: true });
  expect(seen?.interactive).toBe(true);
  expect(seen?.sandbox).toBeUndefined();
});

test("without turn conditions the context carries none and the call counts as interactive", async () => {
  const seen = await conditionsSeen(undefined);
  expect(seen?.interactive).toBeUndefined();
  expect(seen?.sandbox).toBeUndefined();
});
