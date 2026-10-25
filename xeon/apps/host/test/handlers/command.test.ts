import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// command.list, command.run(F wire §3.3.1, HS-72). 가짜 엔진 위의 실제 처리기다. 명령 서비스 쪽은 test/assembly/commands.test.ts와
// test/int/command.int.test.ts(실제 cap-work 명령)다.

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

const LISTED: WireResult<"command.list"> = {
  commands: [
    {
      name: "plan",
      description: "plan mode",
      argumentHint: "[exit]",
      args: [],
      kind: "action",
      source: "capability",
      origin: "cap-work",
      hasShell: false,
    },
  ],
};

test("command.list passes the filter on and returns the list as the service gave it", async () => {
  const asked: WireParams<"command.list">[] = [];
  const host = createFakeHost({
    overrides: {
      commands: {
        list: (params) => {
          asked.push(params);
          return Promise.resolve(ok(LISTED));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("command.list", { prefix: "pl", includeHidden: true })).toEqual(
    LISTED,
  );
  expect(asked).toEqual([{ prefix: "pl", includeHidden: true }]);
  await connection.close();
});

test("command.run on an unknown thread is thread.notFound and runs nothing", async () => {
  const ran: string[] = [];
  const host = createFakeHost({
    overrides: {
      commands: {
        run: (_threadId, params) => {
          ran.push(params.text);
          return Promise.resolve(ok({ status: "not_command" }));
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = fixedIdFactory(88).next("thr");
  const error = await wireErrorOf(connection.request("command.run", { threadId, text: "/plan" }));
  expect(error.code).toBe(3001);
  expect(ran).toEqual([]);
  await connection.close();
});

test("command.run takes the write ownership like turn.start, then hands over the line and the confirmation", async () => {
  const calls: { readonly threadId: ThreadId; readonly params: unknown }[] = [];
  const done: WireResult<"command.run"> = {
    status: "done",
    name: "plan",
    message: "계획 모드를 시작했습니다.",
    result: { mode: "plan" },
  };
  const host = createFakeHost({
    overrides: {
      commands: {
        run: (threadId, params) => {
          calls.push({ threadId, params });
          return Promise.resolve(ok(done));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(host.fake.held.has(threadId)).toBe(false);
  const result = await connection.request("command.run", {
    threadId,
    text: "/plan",
    confirmShell: true,
  });
  expect(result).toEqual(done);
  expect(calls).toEqual([{ threadId, params: { text: "/plan", confirmShell: true } }]);
  expect(host.fake.held.has(threadId)).toBe(true);
  expect(host.hub.state(served.id)?.writeThreads.has(threadId)).toBe(true);
  await connection.close();
});

test("command.run on a thread another process owns is thread.locked", async () => {
  const host = createFakeHost({ lockedBy: "service" });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("command.run", { threadId, text: "/plan" }));
  expect(error.code).toBe(3002);
  await connection.close();
});

test("each result shape of the service reaches the client unchanged", async () => {
  const shapes: WireResult<"command.run">[] = [
    { status: "not_command" },
    { status: "expanded", name: "review", text: "Review the diff." },
    { status: "needs_confirmation", name: "log", shell: [{ index: 0, command: "git log" }] },
  ];
  const queue = [...shapes];
  const host = createFakeHost({
    overrides: {
      commands: {
        run: () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("no more shapes");
          return Promise.resolve(ok(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const first = await connection.request("command.run", { threadId, text: "/x" });
  const second = await connection.request("command.run", { threadId, text: "/x" });
  const third = await connection.request("command.run", { threadId, text: "/x" });
  expect([first, second, third]).toEqual(shapes);
  await connection.close();
});

test("input rejections are invalid params on the text, any other rejection is internal with the code", async () => {
  const failures = [
    { kind: "rejected", code: "command_args_invalid", message: "missing <feedback>" },
    { kind: "rejected", code: "command_shell_disabled", message: "shell injection is off" },
    { kind: "rejected", code: "denied", message: "the shell command was denied" },
    { kind: "unavailable" },
  ] as const;
  const queue = [...failures];
  const host = createFakeHost({
    overrides: {
      commands: {
        run: () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("no more failures");
          return Promise.resolve(err(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const invalid = await wireErrorOf(connection.request("command.run", { threadId, text: "/x" }));
  expect(invalid.data.kind).toBe("jsonrpc.invalidParams");
  expect(invalid.data.details).toEqual({
    issues: [{ path: "text", message: "missing <feedback>" }],
  });
  const shell = await wireErrorOf(connection.request("command.run", { threadId, text: "/x" }));
  expect(shell.data.kind).toBe("jsonrpc.invalidParams");
  const denied = await wireErrorOf(connection.request("command.run", { threadId, text: "/x" }));
  expect(denied.data.kind).toBe("internal");
  expect(denied.message).toContain("denied");
  const unavailable = await wireErrorOf(
    connection.request("command.run", { threadId, text: "/x" }),
  );
  expect(unavailable.data.kind).toBe("internal");
  await connection.close();
});

test("host.hello lists the command and resume methods now that they have handlers", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  for (const method of ["command.list", "command.run", "turn.resume", "thread.rename"]) {
    expect(names).toContain(method);
  }
  await connection.close();
});
