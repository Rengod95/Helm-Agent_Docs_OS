import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { hostOf, type CommandOutput } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// X.primitives.spec §3.9, §4.6.6. 명령 처리기는 문자열이나 {message, result}를 돌려주고, 호출자의 취소 신호를 ctx.signal로 받는다

type Host = Awaited<ReturnType<typeof createTestHost>>;

interface CallCtx {
  readonly threadId: ThreadId | null;
  readonly invocationId: string;
  readonly signal: AbortSignal;
}

const rich: CommandOutput = { message: "2 found", result: { count: 2 } };

/** 등록부에서 명령 정의를 꺼내 L4처럼 부른다. 정의는 `unknown`으로 보관되므로 처리기 모양을 확인한 뒤 부른다 */
function callRegistered(t: Host, name: string, args: string, ctx: CallCtx): Promise<unknown> {
  const record = t.host.resources.list("command").find((entry) => entry.name === name);
  const def: unknown = record?.def;
  if (typeof def !== "object" || def === null || !("handler" in def)) {
    throw new Error(`command ${name} is not registered`);
  }
  const handler: unknown = def.handler;
  if (typeof handler !== "function") throw new Error(`command ${name} has no handler`);
  const done: unknown = Reflect.apply(handler, def, [args, ctx]);
  return Promise.resolve(done);
}

/** 취소 신호가 울릴 때까지 기다린다. 이미 울렸으면 바로 끝난다 */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

test("a command handler's string, {message, result} or no output comes back through the registered handler unchanged", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "cmd-output" }, (g) => {
      const host = hostOf(g);
      host.registerCommand("text", { handler: () => Promise.resolve("2 found") });
      host.registerCommand("rich", { handler: () => Promise.resolve(rich) });
      host.registerCommand("quiet", { handler: () => Promise.resolve() });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const ctx: CallCtx = {
    threadId: thread,
    invocationId: "inv-1",
    signal: new AbortController().signal,
  };
  expect(await callRegistered(t, "text", "", ctx)).toBe("2 found");
  expect(await callRegistered(t, "rich", "", ctx)).toEqual({
    message: "2 found",
    result: { count: 2 },
  });
  expect(await callRegistered(t, "quiet", "", ctx)).toBeUndefined();
});

test("the cancel signal the caller passes reaches the command handler as the same object and aborting it is seen there", async () => {
  const t = await createTestHost();
  const seen: { signal?: AbortSignal } = {};
  await t.host.install(
    makeUnit({ name: "cmd-signal" }, (g) => {
      hostOf(g).registerCommand("watch", {
        handler: async (_args, ctx) => {
          seen.signal = ctx.signal;
          await untilAborted(ctx.signal);
          return { message: "stopped", result: { aborted: ctx.signal.aborted } };
        },
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const controller = new AbortController();
  const pending = callRegistered(t, "watch", "", {
    threadId: thread,
    invocationId: "inv-2",
    signal: controller.signal,
  });
  expect(seen.signal).toBe(controller.signal);
  controller.abort();
  expect(await pending).toEqual({ message: "stopped", result: { aborted: true } });
});
