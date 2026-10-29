import { expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import type { CommandActionHandler, CommandActionRegistry } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ResourceRecord, ResourceRegistry } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { bridgeExtensionCommands } from "../../src/assembly/extension-commands.ts";
import type { CommandRegistryHolder } from "../../src/assembly/l2-units.ts";

// 확장 명령의 처리기 출력과 취소 신호를 동작 명령 처리기까지 잇는 브리지의 단위 시험. 처리기의 반환은 `command.run`의 `done`이 된다.

const THREAD: ThreadId = fixedIdFactory(51).next("thr");

type ExtensionHandler = (
  args: string,
  ctx: { threadId: ThreadId | null; invocationId: string; signal: AbortSignal },
) => Promise<unknown>;

interface Bridged {
  readonly handlers: ReadonlyMap<string, CommandActionHandler>;
  readonly warnings: string[];
}

/** 명령 정의를 확장 자원 레지스트리로 주고 브리지를 건다. 등록된 동작 명령 처리기를 이름으로 모은다 */
function bridge(defs: Readonly<Record<string, ExtensionHandler>>): Bridged {
  const records: ResourceRecord[] = Object.entries(defs).map(([name, handler]) => ({
    kind: "command",
    name,
    exposed: name,
    scopeId: "scope_x",
    extension: "ext-cmd",
    builtin: false,
    def: { description: `${name} command`, handler },
  }));
  const resources: ResourceRegistry = {
    list: (kind) => (kind === undefined || kind === "command" ? records : []),
    subscribe: () => () => undefined,
    setFlag: () => ({ ok: true, value: undefined }),
  };
  const handlers = new Map<string, CommandActionHandler>();
  const actions: CommandActionRegistry = {
    registerAction: (decl, handler) => {
      handlers.set(decl.name, handler);
      return () => undefined;
    },
  };
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      warnings.push(event);
    },
    error: () => undefined,
    child: () => logger,
  };
  const holder: CommandRegistryHolder = { current: actions, api: undefined };
  bridgeExtensionCommands({ resources }, holder, logger);
  return { handlers, warnings };
}

/** 등록된 동작 명령 처리기를 `command.run`이 부르는 모양으로 부른다 */
function callOf(bridged: Bridged, name: string, args: readonly string[], signal: AbortSignal) {
  const handler = bridged.handlers.get(name);
  if (handler === undefined) throw new Error(`command ${name} was not bridged`);
  return handler(args, { threadId: THREAD, requestId: "req-1", signal });
}

/** 신호가 울릴 때까지 기다린다. 이미 울렸으면 바로 끝난다 */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

test("a command handler's return becomes the command.run result exactly: nothing, a string, or {message, result}", async () => {
  const bridged = bridge({
    silent: () => Promise.resolve(),
    text: () => Promise.resolve("2 found"),
    rich: () => Promise.resolve({ message: "2 found", result: { count: 2 } }),
    quiet: () => Promise.resolve({ message: null }),
  });
  const signal = new AbortController().signal;
  expect(await callOf(bridged, "silent", [], signal)).toStrictEqual({ message: null });
  expect(await callOf(bridged, "text", [], signal)).toStrictEqual({ message: "2 found" });
  expect(await callOf(bridged, "rich", [], signal)).toStrictEqual({
    message: "2 found",
    result: { count: 2 },
  });
  expect(await callOf(bridged, "quiet", [], signal)).toStrictEqual({ message: null });
  expect(bridged.warnings).toEqual([]);
});

test("a return of another shape is logged and gives no message instead of passing through", async () => {
  const bridged = bridge({
    number: () => Promise.resolve(3),
    badMessage: () => Promise.resolve({ message: 3 }),
    badResult: () => Promise.resolve({ message: "x", result: Number.NaN }),
    list: () => Promise.resolve(["x"]),
  });
  const signal = new AbortController().signal;
  const outputs = await Promise.all(
    ["number", "badMessage", "badResult", "list"].map((name) => callOf(bridged, name, [], signal)),
  );
  expect(outputs).toStrictEqual([
    { message: null },
    { message: null },
    { message: null },
    { message: null },
  ]);
  expect(bridged.warnings).toEqual([
    "ext.command_output_invalid",
    "ext.command_output_invalid",
    "ext.command_output_invalid",
    "ext.command_output_invalid",
  ]);
});

test("the caller's cancel signal reaches the extension handler as the same object, and aborting it is seen there", async () => {
  const calls: { args: string; signal: AbortSignal }[] = [];
  const bridged = bridge({
    watch: async (args, ctx) => {
      calls.push({ args, signal: ctx.signal });
      await untilAborted(ctx.signal);
      return { message: ctx.signal.aborted ? "stopped" : "finished" };
    },
  });
  const controller = new AbortController();
  const pending = callOf(bridged, "watch", ["a", "b"], controller.signal);
  expect(calls[0]?.args).toBe("a b");
  expect(calls[0]?.signal).toBe(controller.signal);
  controller.abort();
  expect(await pending).toStrictEqual({ message: "stopped" });
});
