import { expect, test } from "bun:test";
import { BashToolParams, CapabilityError, WorkspaceShell } from "@xeon/contracts/capabilities";
import { EffectResultSchema, type ProducerHandle } from "@xeon/contracts/records";
import { parse } from "@xeon/contracts";
import type { ExecService, ToolRunContext } from "@xeon/contracts/services";
import { createApprovalService } from "../src/approvals/service.ts";
import { createCallTable } from "../src/calls.ts";
import { lockRequests, openToolScope, type LockEnv } from "../src/tasks.ts";
import { createPipeline } from "../src/pipeline.ts";
import { createRegistry } from "../src/registry.ts";
import type { ToolEntry } from "../src/types.ts";
import {
  ASSISTANT,
  callTool,
  createHarness,
  layer,
  until,
  type Harness,
} from "./support/harness.ts";

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

test("tool_scope_opened_under_turn: each call gets a tool node under its turn and settles after the commit", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const settledBefore: boolean[] = [];
  h.apis.set(WorkspaceShell.id, {
    run: () => {
      const tool = h.tasks.scopes.find((scope) => scope.kind === "tool");
      settledBefore.push(tool !== undefined && tool.parent?.kind === "turn");
      return Promise.resolve({
        exitCode: 0,
        output: "x",
        truncated: false,
        durationMs: 1,
        sandboxed: false,
      });
    },
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: { capability: "workspace.shell", version: "1.0.0" },
  });
  const run = h.run();
  await callTool(h.runtime.tools, run, { id: "call_1", name: "bash", args: { command: "x" } });
  expect(settledBefore).toEqual([true]);
  const tool = h.tasks.scopes.find((scope) => scope.kind === "tool");
  expect(tool?.id).toBe("call_1");
  expect(tool?.parent?.id).toBe(run.turnId);
  const outcome = await tool?.settle();
  expect(outcome?.aborted).toBe(false);
});

test("a turn cancel signals the running tool and the call is recorded as interrupted", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  let started = false;
  h.apis.set(WorkspaceShell.id, {
    run: (_input: unknown, options: { signal: AbortSignal }) => {
      started = true;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            reject(
              new CapabilityError({
                capability: "workspace.shell",
                method: "run",
                code: "aborted",
                message: "cancelled",
                retryable: false,
              }),
            );
          },
          { once: true },
        );
      });
    },
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: { capability: "workspace.shell", version: "1.0.0" },
  });
  const run = h.run();
  const done = callTool(h.runtime.tools, run, {
    id: "call_2",
    name: "bash",
    args: { command: "sleep" },
  });
  await until(() => started);
  h.tasks.abortTurn(run.turnId);
  const out = await done;
  expect(out.isError).toBe(true);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.status).toBe("interrupted");
});

test("without a task service the call still runs without a tool node", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH], withTasks: false });
  h.apis.set(WorkspaceShell.id, {
    run: () =>
      Promise.resolve({
        exitCode: 0,
        output: "fine",
        truncated: false,
        durationMs: 1,
        sandboxed: false,
      }),
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: { capability: "workspace.shell", version: "1.0.0" },
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_3",
    name: "bash",
    args: { command: "x" },
  });
  expect(out.isError).toBe(false);
  expect(openToolScope(undefined, h.run(), "x")).toBeUndefined();
});

test("openToolScope returns nothing when the turn node is unknown", async () => {
  const h = await createHarness();
  const run = h.run();
  h.tasks.scopes.find((scope) => scope.id === run.turnId)?.controller.abort();
  const handle = openToolScope(h.tasks, { ...run, turnId: h.deps.ids.next("trn") }, "call_x");
  expect(handle).toBeUndefined();
});

// ── 잠금 키 산출과 키 큐 ────────────────────────────────────────────────

/** 상대 경로 "./a"와 링크 "link"는 같은 실제 경로 /w/a, 없는 파일은 부모 정규 경로 + 이름이다 */
function lockEnv(): LockEnv {
  const real: Record<string, string> = { "./a": "/w/a", link: "/w/a", "/w": "/w", b: "/w/b" };
  const exec: Pick<ExecService, "id" | "canonicalPath" | "absolutePath"> = {
    id: "env1",
    canonicalPath: (path) =>
      Promise.resolve(
        real[path] === undefined
          ? {
              ok: false,
              error: Object.assign(new Error("nf"), {
                code: "not_found" as const,
                name: "FileError",
              }),
            }
          : { ok: true, value: real[path] },
      ),
    absolutePath: (path) =>
      Promise.resolve({ ok: true, value: path.startsWith("/") ? path : `/w/${path}` }),
  };
  return exec;
}

test("lockRequests builds `${env.id}\\0${realpath}` keys, merges duplicates to the strongest mode and handles new files", async () => {
  const signal = new AbortController().signal;
  const requests = await lockRequests(
    lockEnv(),
    [
      { path: "./a", mode: "shared" },
      { path: "link", mode: "exclusive" },
      { path: "/w/new.txt", mode: "exclusive" },
    ],
    signal,
  );
  expect(requests.ok).toBe(true);
  if (!requests.ok) return;
  expect(requests.value).toEqual([
    { key: "env1\0/w/a", mode: "exclusive" },
    { key: "env1\0/w/new.txt", mode: "exclusive" },
  ]);
  const missing = await lockRequests(lockEnv(), [{ path: "/nowhere/x", mode: "shared" }], signal);
  expect(missing).toEqual({
    ok: false,
    error: { kind: "lock_path_unresolved", path: "/nowhere/x" },
  });
});

interface Gate {
  readonly entered: string[];
  readonly finished: string[];
  open(name: string): void;
}

function lockedHarness(h: Harness) {
  const gates = new Map<string, PromiseWithResolvers<void>>();
  const gate: Gate = {
    entered: [],
    finished: [],
    open: (name) => {
      gates.get(name)?.resolve();
    },
  };
  const entry = (name: string): ToolEntry => ({
    name,
    label: name,
    description: name,
    parameters: BashToolParams,
    outputSchema: undefined,
    executionMode: "parallel",
    prepareArguments: undefined,
    ref: { capability: "ext.test", name },
    capability: undefined,
    mcpServer: undefined,
    risk: "read",
    classes: [],
    hints: {},
    replay: "unsafe",
    exposure: "always",
    outputLimits: {},
    raw: async (call) => {
      gate.entered.push(call.toolCallId);
      const wait = Promise.withResolvers<void>();
      gates.set(call.toolCallId, wait);
      await wait.promise;
      gate.finished.push(call.toolCallId);
      return {
        result: { content: [{ type: "text", text: `done ${call.toolCallId}` }], details: null },
        interrupted: false,
      };
    },
    locks: (args) => {
      const path = typeof args["command"] === "string" ? args["command"] : "";
      return [{ path, mode: "exclusive" }];
    },
  });
  const registry = createRegistry();
  const calls = createCallTable();
  const deps = { ...h.deps, lockEnv: lockEnv() };
  const approvals = createApprovalService({
    session: deps.session,
    producer: deps.producer,
    ids: deps.ids,
    clock: deps.clock,
    ext: deps.ext,
    logger: undefined,
    runOf: () => undefined,
  });
  const pipeline = createPipeline(deps, registry, calls, approvals);
  const toolEntry = entry("write");
  registry.add([toolEntry]);

  async function drive(run: ToolRunContext, id: string, path: string) {
    const hooks = pipeline.hooks(run);
    const tool = pipeline.agentTool(toolEntry, run);
    const toolCall = { type: "toolCall" as const, id, name: "write", arguments: {} };
    const context = { messages: [], tools: [tool] };
    const before = await hooks.beforeToolCall(
      { assistantMessage: ASSISTANT, toolCall, args: { command: path }, context },
      run.signal,
    );
    if (before?.block === true) return { blocked: before.reason ?? "" };
    const result = await tool.execute(id, { command: path }, run.signal, undefined);
    await hooks.afterToolCall(
      {
        assistantMessage: ASSISTANT,
        toolCall,
        args: { command: path },
        result,
        isError: false,
        context,
      },
      run.signal,
    );
    return { blocked: undefined };
  }
  return { gate, drive };
}

test("same_realpath_writes_serialized: a relative path and a link to the same file never overlap, other files do", async () => {
  const h = await createHarness();
  const { gate, drive } = lockedHarness(h);
  const run = h.run();
  const first = drive(run, "w1", "./a");
  const second = drive(run, "w2", "link");
  const third = drive(run, "w3", "b");
  await until(() => gate.entered.includes("w1") && gate.entered.includes("w3"));
  // 같은 파일의 두 번째 쓰기는 첫 번째가 끝나기 전에는 시작하지 않는다
  expect(gate.entered).not.toContain("w2");
  gate.open("w3");
  gate.open("w1");
  await until(() => gate.entered.includes("w2"));
  expect(gate.finished).toContain("w1");
  gate.open("w2");
  await Promise.all([first, second, third]);
  const spans = h.tasks.spans;
  expect(spans).toHaveLength(3);
  const same = spans.filter((span) => span.keys[0] === "env1\0/w/a");
  expect(same).toHaveLength(2);
  const [early, late] = [...same].toSorted((a, b) => a.start - b.start);
  expect((early?.end ?? 0) < (late?.start ?? 0)).toBe(true);
  const other = spans.find((span) => span.keys[0] === "env1\0/w/b");
  expect(other?.start).toBeLessThan(early?.end ?? 0);
});

test("lock_wait_abort_leaves_no_exec: cancelling a turn while waiting for a lock records no effect.exec", async () => {
  const h = await createHarness();
  const { gate, drive } = lockedHarness(h);
  const runA = h.run();
  const runB = h.run();
  const holder = drive(runA, "h1", "./a");
  await until(() => gate.entered.includes("h1"));
  const waiter = drive(runB, "h2", "link");
  // 두 번째 호출의 의도가 커밋될 때까지 기다린 뒤 turn을 취소한다
  await until(() => h.session.commits.some((commit) => commit.requestId === "tool:h2:intent"));
  h.tasks.abortTurn(runB.turnId);
  await waiter;
  gate.open("h1");
  await holder;
  expect(h.session.commits.some((commit) => commit.requestId === "tool:h2:exec")).toBe(false);
  const results = h.session.events
    .filter((event) => event.kind === "effect.result")
    .map((event) => parse(EffectResultSchema, event.payload));
  const statuses = results.map((entry) => (entry.ok ? entry.value.status : "invalid"));
  expect(statuses).toContain("abandoned");
  expect(JSON.stringify(h.session.events)).toContain("cancelled while waiting for a lock");
});

test("an unresolvable lock path is an error result without exec", async () => {
  const h = await createHarness();
  const { drive } = lockedHarness(h);
  await drive(h.run(), "w9", "/nowhere/x");
  expect(h.session.commits.some((commit) => commit.requestId === "tool:w9:exec")).toBe(false);
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.status).toBe("abandoned");
});

export type { ProducerHandle };
