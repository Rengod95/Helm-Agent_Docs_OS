import { expect, test } from "bun:test";
import {
  CapabilityError,
  type CallOptions,
  type CommandInfo,
  type CommandRunOutputValue,
} from "@xeon/contracts/capabilities";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createCommandPort } from "../../src/assembly/commands.ts";
import type { CommandRegistryHolder, CommandsApi } from "../../src/assembly/l2-units.ts";

// G1-01: 호스트는 사람이 클라이언트에서 친 명령을 호출자 `host`로, 호출마다 새 요청 키와 thread 문맥을 달아 명령 서비스에 넘긴다.

const ids = fixedIdFactory(620);
const THREAD = ids.next("thr");
const SIGNAL = new AbortController().signal;

const INFO: CommandInfo = {
  name: "plan",
  description: "plan mode",
  argumentHint: null,
  args: [],
  kind: "action",
  source: "capability",
  origin: "cap-work",
  hasShell: false,
};

interface Seen {
  readonly method: "list" | "run";
  readonly input: unknown;
  readonly options: CallOptions | undefined;
}

function holderWith(
  seen: Seen[],
  run: (input: { readonly text: string }) => Promise<CommandRunOutputValue>,
): CommandRegistryHolder {
  const api: CommandsApi = {
    register: () => Promise.reject(new Error("register is not part of the fake")),
    expand: () => Promise.reject(new Error("expand is not part of the fake")),
    list: (input, options) => {
      seen.push({ method: "list", input, options });
      return Promise.resolve({ commands: [INFO] });
    },
    run: (input, options) => {
      seen.push({ method: "run", input, options });
      return run(input);
    },
  };
  return { current: undefined, api };
}

function capabilityError(code: string, message: string): CapabilityError {
  return new CapabilityError({
    capability: "dialog.commands",
    method: "run",
    code,
    message,
    retryable: false,
  });
}

test("list calls the command service as the host without a thread and returns what it listed", async () => {
  const seen: Seen[] = [];
  const port = createCommandPort({
    holder: holderWith(seen, () => Promise.reject(new Error("x"))),
    ids,
  });
  const listed = await port.list({ prefix: "pl" }, SIGNAL);
  expect(listed).toEqual({ ok: true, value: { commands: [INFO] } });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.input).toEqual({ prefix: "pl" });
  expect(seen[0]?.options?.signal).toBe(SIGNAL);
  expect(seen[0]?.options?.context).toEqual({ caller: { kind: "host" } });
});

test("list with a thread puts it into the call context and not into the service input", async () => {
  const seen: Seen[] = [];
  const port = createCommandPort({
    holder: holderWith(seen, () => Promise.reject(new Error("x"))),
    ids,
  });
  const listed = await port.list({ prefix: "pl", threadId: THREAD }, SIGNAL);
  expect(listed).toEqual({ ok: true, value: { commands: [INFO] } });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.input).toEqual({ prefix: "pl" });
  expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
});

test("run passes the thread, the host as the caller and a fresh request key every call", async () => {
  const seen: Seen[] = [];
  const done: CommandRunOutputValue = { status: "done", name: "plan", message: "ok", result: null };
  const port = createCommandPort({ holder: holderWith(seen, () => Promise.resolve(done)), ids });
  const first = await port.run(THREAD, { text: "/plan", confirmShell: true }, SIGNAL);
  const second = await port.run(THREAD, { text: "/plan" }, SIGNAL);
  expect(first).toEqual({ ok: true, value: done });
  expect(second).toEqual({ ok: true, value: done });
  expect(seen.map((entry) => entry.input)).toEqual([
    { text: "/plan", confirmShell: true },
    { text: "/plan" },
  ]);
  for (const entry of seen) {
    expect(entry.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
    expect(entry.options?.signal).toBe(SIGNAL);
  }
  const keys = seen.map((entry) => entry.options?.requestId);
  expect(keys[0]).toMatch(/^evt_/);
  expect(keys[1]).toMatch(/^evt_/);
  expect(keys[0]).not.toBe(keys[1]);
});

test("a rejection of the service is a value with its code and a cut message, not a thrown error", async () => {
  const long = "x".repeat(500);
  const port = createCommandPort({
    holder: holderWith([], () => Promise.reject(capabilityError("command_args_invalid", long))),
    ids,
  });
  const ran = await port.run(THREAD, { text: "/plan x" }, SIGNAL);
  expect(ran).toEqual({
    ok: false,
    error: { kind: "rejected", code: "command_args_invalid", message: "x".repeat(200) },
  });
});

test("a failure that is not a capability error is a defect and is thrown again", async () => {
  const port = createCommandPort({
    holder: holderWith([], () => Promise.reject(new TypeError("broken"))),
    ids,
  });
  const caught = await port.run(THREAD, { text: "/plan" }, SIGNAL).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(TypeError);
});

test("without a command service both calls are unavailable", async () => {
  const port = createCommandPort({ holder: { current: undefined, api: undefined }, ids });
  expect(await port.list({}, SIGNAL)).toEqual({ ok: false, error: { kind: "unavailable" } });
  expect(await port.run(THREAD, { text: "/plan" }, SIGNAL)).toEqual({
    ok: false,
    error: { kind: "unavailable" },
  });
});
