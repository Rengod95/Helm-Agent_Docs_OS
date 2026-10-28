import { expect, test } from "bun:test";
import type { ThreadId, ToolResultRecord } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type UserBashDecision,
  type UserBashPayload,
} from "@xeon/contracts/extensions";
import type { ExtensionUnit } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, kindsOf } from "./support/inspect.ts";

// LP12 user_bash: `!명령` 입력의 진입점 `runUserBash`(L1.loop.spec §3.1)

function guard(decision: UserBashDecision): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("input.bash.before", () => decision);
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "user-bash-guard",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["input.bash.before"],
      usesDrive: false,
    }),
    entry,
    loadIndex: 2,
    builtin: false,
  };
}

// 결정 없이 payload만 보는 관찰자: 다음 핸들러(없으면 셸 실행)로 넘어간다
function observer(seen: UserBashPayload[]): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("input.bash.before", (payload) => {
        seen.push(payload);
        return undefined;
      });
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "user-bash-observer",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["input.bash.before"],
      usesDrive: false,
    }),
    entry,
    loadIndex: 2,
    builtin: false,
  };
}

function customItems(h: Harness) {
  return h.fake
    .events(h.threadId)
    .filter((event) => event.kind === "item.recorded")
    .map((event) => event.payload)
    .filter((payload) => JSON.stringify(payload).includes("core.loop.user_bash"));
}

function shellRecord(partial: Partial<ToolResultRecord>): ToolResultRecord {
  return {
    content: [{ type: "text", text: "" }],
    details: null,
    structuredContent: null,
    isError: false,
    terminate: false,
    usage: null,
    ...partial,
  };
}

// 이 대화는 아직 아무것도 기록하지 않았다. 사용자 셸 입력이 첫 기록이 되도록 입력 하나를 먼저 넣는다
async function withHistory(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const h = await createHarness({
    script: [{ kind: "message", content: [{ type: "text", text: "hi" }], stopReason: "stop" }],
    ...options,
  });
  await h.loop.admit({ threadId: h.threadId, content: "hello", via: "interactive" });
  await h.settle();
  return h;
}

test("user_bash_runs_the_command_and_records_it_for_the_model: main, interactive, one custom item", async () => {
  const h = await withHistory();
  const before = h.fake.events(h.threadId).length;
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "ls -la",
    excludeFromContext: false,
  });
  expect(outcome).toMatchObject({
    ok: true,
    value: { status: "completed", replaced: false, result: { exitCode: 0, cancelled: false } },
  });
  expect(h.tools.userShells).toHaveLength(1);
  const [call] = h.tools.userShells;
  expect(call?.request).toEqual({ command: "ls -la", includeInContext: true });
  expect(call?.run).toMatchObject({
    threadId: h.threadId,
    caller: "main",
    depth: 0,
    interactive: true,
    surfaceThreadId: h.threadId,
  });
  const items = customItems(h);
  expect(items).toHaveLength(1);
  expect(JSON.stringify(items[0])).toContain("Ran `ls -la`");
  expect(h.fake.events(h.threadId).length).toBe(before + 1);
});

test("a !! command leaves the context alone: no item, includeInContext false", async () => {
  const h = await withHistory();
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "git status",
    excludeFromContext: true,
  });
  expect(outcome.ok && outcome.value.status).toBe("completed");
  expect(h.tools.userShells[0]?.request.includeInContext).toBe(false);
  expect(customItems(h)).toEqual([]);
});

test("user_bash_first_deny_skips_shell: a deny decision runs nothing and records nothing", async () => {
  const h = await withHistory();
  await h.host.host.install(guard({ type: "deny", reason: "not today" }));
  await h.host.settled();
  const before = h.fake.events(h.threadId).length;
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "rm -rf build",
    excludeFromContext: false,
  });
  expect(outcome).toEqual({ ok: true, value: { status: "denied", reason: "not today" } });
  expect(h.tools.userShells).toEqual([]);
  expect(h.fake.events(h.threadId).length).toBe(before);
});

test("a handler can replace the result: the command does not run and the replacement is recorded", async () => {
  const h = await withHistory();
  const result = { output: "cached listing", exitCode: 0, cancelled: false, truncated: false };
  await h.host.host.install(guard({ type: "result", result }));
  await h.host.settled();
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "ls",
    excludeFromContext: false,
  });
  expect(outcome).toEqual({ ok: true, value: { status: "completed", result, replaced: true } });
  expect(h.tools.userShells).toEqual([]);
  expect(JSON.stringify(customItems(h))).toContain("cached listing");
});

test("a command the tools service refused before running is reported as denied", async () => {
  const h = await withHistory();
  h.tools.userShellResult = () =>
    shellRecord({
      isError: true,
      content: [{ type: "text", text: '[xeon:denied_by_policy] Tool "bash" is denied.' }],
      details: { code: "not_executed" },
    });
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "rm -rf /",
    excludeFromContext: false,
  });
  expect(outcome).toMatchObject({
    ok: true,
    value: { status: "denied", reason: expect.stringContaining("denied_by_policy") },
  });
  expect(customItems(h)).toEqual([]);
});

test("a failing command is a completed result with its exit code, shown to the model", async () => {
  const h = await withHistory();
  h.tools.userShellResult = () =>
    shellRecord({
      isError: true,
      content: [{ type: "text", text: "boom" }],
      details: {
        code: "exit_nonzero",
        detail: { exitCode: 2, output: "boom", truncated: true, fullOutputPath: "/tmp/full.txt" },
      },
    });
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "make",
    excludeFromContext: false,
  });
  expect(outcome).toMatchObject({
    ok: true,
    value: {
      status: "completed",
      result: { exitCode: 2, output: "boom", truncated: true, fullOutputPath: "/tmp/full.txt" },
    },
  });
  const text = JSON.stringify(customItems(h));
  expect(text).toContain("Command exited with code 2");
  expect(text).toContain("Full output: /tmp/full.txt");
});

test("the same requestId returns the first outcome without running again", async () => {
  const h = await withHistory();
  const request = {
    threadId: h.threadId,
    command: "date",
    excludeFromContext: false,
    requestId: "ubash-1",
  };
  const [first, second] = await Promise.all([
    h.loop.runUserBash(request),
    h.loop.runUserBash(request),
  ]);
  const third = await h.loop.runUserBash(request);
  expect(second).toEqual(first);
  expect(third).toEqual(first);
  expect(h.tools.userShells).toHaveLength(1);
  expect(customItems(h)).toHaveLength(1);
});

test("a rejected request is not remembered: a retry with the same key starts over", async () => {
  const h = await withHistory();
  const unknown = fixedIdFactory(7_000_000).next("thr");
  const bad = await h.loop.runUserBash({
    threadId: unknown,
    command: "ls",
    excludeFromContext: false,
    requestId: "again",
  });
  expect(bad).toEqual({ ok: false, error: { kind: "thread_not_found", threadId: unknown } });
  expect(h.tools.userShells).toEqual([]);
});

test("a command that ran but could not be recorded is not run again: the retry only records", async () => {
  const h = await withHistory();
  const request = {
    threadId: h.threadId,
    command: "make deploy",
    excludeFromContext: false,
    requestId: "ubash-record-fails",
  };
  // 커밋 재시도(3회)를 모두 busy로 막아 기록 단계만 실패시킨다
  h.fake.failBusyFor((key) => key.startsWith("ubash:"), 3);
  const failed = await h.loop.runUserBash(request);
  expect(failed).toEqual({ ok: false, error: { kind: "busy" } });
  expect(h.tools.userShells).toHaveLength(1);
  expect(customItems(h)).toEqual([]);

  const retried = await h.loop.runUserBash(request);
  expect(retried).toMatchObject({
    ok: true,
    value: { status: "completed", replaced: false, result: { exitCode: 0 } },
  });
  expect(h.tools.userShells).toHaveLength(1);
  expect(customItems(h)).toHaveLength(1);
  // 기록까지 끝난 요청은 처음 결과를 그대로 돌려준다
  expect(await h.loop.runUserBash(request)).toEqual(retried);
  expect(h.tools.userShells).toHaveLength(1);
  expect(customItems(h)).toHaveLength(1);
});

test("invalid input is an error value: empty command, long requestId", async () => {
  const h = await withHistory();
  const empty = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "  ",
    excludeFromContext: false,
  });
  expect(empty.ok).toBe(false);
  const long = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "ls",
    excludeFromContext: false,
    requestId: "x".repeat(65),
  });
  expect(long).toMatchObject({ ok: false, error: { kind: "input_invalid" } });
  expect(h.tools.userShells).toEqual([]);
});

test("a user command runs while a turn is in progress and does not disturb it", async () => {
  const gate = Promise.withResolvers<void>();
  const h = await createHarness({
    tools: [
      {
        name: "slow",
        run: async () => {
          await gate.promise;
          return { text: "slow done" };
        },
      },
    ],
    script: [
      {
        kind: "message",
        content: [{ type: "toolCall", id: "c1", name: "slow", arguments: {} }],
        stopReason: "toolUse",
      },
      { kind: "message", content: [{ type: "text", text: "finished" }], stopReason: "stop" },
    ],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.tick();
  expect(h.loop.threadStatus(h.threadId).phase).not.toBe("idle");
  const outcome = await h.loop.runUserBash({
    threadId: h.threadId,
    command: "pwd",
    excludeFromContext: false,
  });
  expect(outcome.ok && outcome.value.status).toBe("completed");
  gate.resolve();
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(kindsOf(events)).toContain("item.recorded");
  expect(customItems(h)).toHaveLength(1);
});

test("user_bash_cwd_follows_the_thread: each thread's working directory reaches the handler payload", async () => {
  const directories = new Map<ThreadId, string>();
  const h = await createHarness({ workingDirectory: (threadId) => directories.get(threadId) });
  const other = h.fake.startThread();
  await h.host.host.openThread(other);
  directories.set(h.threadId, "/work/alpha");
  directories.set(other, "/work/beta");
  const seen: UserBashPayload[] = [];
  await h.host.host.install(observer(seen));
  await h.host.settled();

  const pwd = (threadId: ThreadId) =>
    h.loop.runUserBash({ threadId, command: "pwd", excludeFromContext: true });
  const first = await pwd(h.threadId);
  const second = await pwd(other);
  expect([first, second].map((outcome) => outcome.ok && outcome.value.status)).toEqual([
    "completed",
    "completed",
  ]);
  expect(seen).toEqual([
    { command: "pwd", excludeFromContext: true, cwd: "/work/alpha" },
    { command: "pwd", excludeFromContext: true, cwd: "/work/beta" },
  ]);
});

test("user_bash_cwd_is_empty_without_a_working_directory", async () => {
  const h = await createHarness({ workingDirectory: () => undefined });
  const seen: UserBashPayload[] = [];
  await h.host.host.install(observer(seen));
  await h.host.settled();
  await h.loop.runUserBash({ threadId: h.threadId, command: "pwd", excludeFromContext: true });
  expect(seen).toEqual([{ command: "pwd", excludeFromContext: true, cwd: "" }]);
});
