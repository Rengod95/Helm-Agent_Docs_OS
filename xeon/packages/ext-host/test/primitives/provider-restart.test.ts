import { expect, test } from "bun:test";
import type { ServiceKey } from "@xeon/contracts/capabilities";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

interface Echo {
  echo(): string;
}
const echoKey: ServiceKey<Echo> = { capability: "demo.echo", version: "1.0.0" };

type Host = Awaited<ReturnType<typeof createTestHost>>;

async function setup(): Promise<{
  t: Host;
  thread: ReturnType<Host["newThread"]>;
  setups: () => number;
  handled: string[];
}> {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "pr-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(echoKey, { echo: () => "pr" });
    }),
  );
  let setupCount = 0;
  const handled: string[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "pr-consumer",
        loadIndex: 1,
        points: ["boundary.settle.after"],
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
      },
      (g) => {
        setupCount += 1;
        g.on("boundary.settle.after", () => {
          handled.push(g.capability(echoKey).echo());
        });
      },
    ),
  );
  await t.settled();
  return { t, thread, setups: () => setupCount, handled };
}

async function fire(t: Host, thread: ReturnType<Host["newThread"]>, key: string): Promise<void> {
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("a provider restart re-runs the consumer setup at the next step boundary, not at once", async () => {
  const { t, thread, setups, handled } = await setup();
  expect(setups()).toBe(1);
  t.loop.setRunning(thread, true);
  t.host.scope("pr-provider")?.disable();
  await t.boundary(thread).stepEnd();
  await t.settled();
  // 공급자가 내려가면 소비자의 등록이 해제된다
  await fire(t, thread, "k0");
  expect(handled).toEqual([]);

  t.host.scope("pr-provider")?.enable();
  await t.boundary(thread).stepEnd();
  await t.settled();
  // 공급자가 돌아와 Cordis가 apply를 다시 불렀지만 setup은 아직 다시 실행되지 않았다
  expect(setups()).toBe(1);
  expect(t.host.scope("pr-consumer")?.status).toBe("enabling");
  await fire(t, thread, "k1");
  expect(handled).toEqual([]);

  const drafts = await t.boundary(thread).stepEnd();
  await t.settled();
  expect(setups()).toBe(2);
  // 켜짐 기록은 그대로라 새 scope.changed가 없다
  expect(drafts.filter((draft) => draft.kind === "scope.changed")).toEqual([]);
  expect(t.host.scopes().find((scope) => scope.id === "pr-consumer")).toMatchObject({
    status: "enabled",
    generation: 2,
  });
  await fire(t, thread, "k2");
  expect(handled).toEqual(["pr"]);
});

test("an idle thread applies the new generation right after the provider returns", async () => {
  const { t, thread, setups, handled } = await setup();
  t.host.scope("pr-provider")?.disable();
  await t.settled();
  t.host.scope("pr-provider")?.enable();
  await t.settled();
  expect(setups()).toBe(2);
  await fire(t, thread, "k1");
  expect(handled).toEqual(["pr"]);
});
