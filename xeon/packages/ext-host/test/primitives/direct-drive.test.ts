import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { Type } from "typebox";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

// X.primitives.spec §4.4.3, §4.6.6: 명령·도구가 연 ambient의 상태 커밋도 drive 재호출을 일으킨다

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
type Host = Awaited<ReturnType<typeof createTestHost>>;

function runCommand(t: Host, threadId: ThreadId, invocationId: string): Promise<void> {
  const def = t.host.resources.list("command")[0]?.def;
  if (typeof def !== "object" || def === null || !("handler" in def)) {
    throw new Error("command is not registered");
  }
  const handler = def.handler;
  if (typeof handler !== "function") throw new Error("command handler is not a function");
  return Promise.resolve(
    handler.call(def, "", { threadId, invocationId, signal: new AbortController().signal }),
  );
}

async function boot(
  options: (ids: Host["ids"]) => Parameters<typeof createTestHost>[0],
  turnOnFirst: boolean,
) {
  const late: { ids: Host["ids"] | undefined } = { ids: undefined };
  const t = await createTestHost(
    options({
      next: (prefix) => {
        if (late.ids === undefined) throw new Error("host is not created yet");
        return late.ids.next(prefix);
      },
    }),
  );
  late.ids = t.ids;
  const thread = t.newThread();
  const seen: number[] = [];
  await t.host.install(
    makeGroupUnit(
      {
        name: "cmd-drive",
        def: { state: { schema: CounterSchema, initial: { n: 0 }, version: 1 } },
      },
      (g) => {
        g.drive(async (loop, state) => {
          seen.push(state.n);
          if (turnOnFirst && state.n === 0) {
            await loop.turn({ input: { kind: "user", content: "go" } });
          }
        });
        hostOf(g).registerCommand("bump", {
          handler: async () => {
            await g.commit({ n: g.state().n + 1 });
          },
        });
      },
    ),
  );
  await t.host.openThread(thread);
  // 첫 turn이 열릴 때까지 기다리면 settled()는 끝나지 않는다
  if (turnOnFirst) await flushMicrotasks(200);
  else await t.settled();
  return { t, thread, seen };
}

test("a command that commits state on an idle thread makes the drive run once without more input", async () => {
  const { t, thread, seen } = await boot(() => ({}), false);
  expect(seen).toEqual([0]);
  await runCommand(t, thread, "cmd-1");
  await t.settled();
  expect(seen).toEqual([0, 1]);
  // 같은 판으로는 더 부르지 않는다
  await t.settled();
  expect(seen).toEqual([0, 1]);
});

test("a command that commits during a running turn waits for the turn and calls the drive once", async () => {
  const gate: { open: () => void } = { open: () => {} };
  const { t, thread, seen } = await boot(
    (ids) => ({
      loop: {
        runTurn: async () => {
          await new Promise<void>((resolve) => {
            gate.open = resolve;
          });
          return { outcome: { turnId: ids.next("trn"), status: "completed" }, usage: null };
        },
      },
    }),
    true,
  );
  await flushMicrotasks(200);
  expect(t.loop.status(thread)).toBe("running");
  await runCommand(t, thread, "cmd-1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await flushMicrotasks(200);
  expect(seen).toEqual([0]);
  gate.open();
  await t.settled();
  expect(seen).toEqual([0, 1]);
});
