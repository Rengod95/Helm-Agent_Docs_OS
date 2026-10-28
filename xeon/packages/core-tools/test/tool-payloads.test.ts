import { expect, test } from "bun:test";
import { WorkspaceFiles } from "@xeon/contracts/capabilities";
import type { ToolCallPayload, ToolExecutionEndPayload } from "@xeon/contracts/extensions";
import { entriesOf } from "../src/entries.ts";
import {
  callTool,
  createHarness,
  installHandlers,
  registerWorkspace,
  type Harness,
} from "./support/harness.ts";

// M3-REQ-71(M3-02): 도구 호출 지점 페이로드의 risk·hints·caller, tool.execution.after의 input·stepId, ToolSpec.locks → LockDecl.

const SECRET = ["fixture", "value", "0001"].join("-");

interface Seen {
  readonly before: ToolCallPayload[];
  readonly result: ToolCallPayload[];
  readonly after: ToolExecutionEndPayload[];
}

async function watch(h: Harness): Promise<Seen> {
  const seen: {
    before: ToolCallPayload[];
    result: ToolCallPayload[];
    after: ToolExecutionEndPayload[];
  } = { before: [], result: [], after: [] };
  await installHandlers(
    h,
    "watch",
    ["tool.call.before", "tool.result", "tool.execution.after"],
    (g) => {
      g.on("tool.call.before", (payload) => {
        seen.before.push(payload);
        return undefined;
      });
      g.on("tool.result", (payload) => {
        seen.result.push(payload);
        return undefined;
      });
      g.on("tool.execution.after", (payload) => {
        seen.after.push(payload);
      });
    },
  );
  return seen;
}

test("tool.call.before and tool.result carry risk, hints and caller next to the call", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen = await watch(h);
  const meta = h.runtime.tools.meta("read");
  expect(meta?.risk).toBe("read");
  const expected: ToolCallPayload = {
    toolCallId: "call_p1",
    toolName: "read",
    input: { path: "a.txt" },
    capability: { id: "workspace.files", method: "read" },
    risk: "read",
    hints: meta?.hints ?? {},
    caller: "main",
  };
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_p1",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.isError).toBe(false);
  expect(seen.before).toEqual([expected]);
  expect(seen.result).toEqual([expected]);
});

test("a subagent call reports caller subagent:<name> and an undeclared-risk tool reports exec", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen = await watch(h);
  const bash = h.runtime.tools.meta("bash");
  expect(bash?.risk).toBe("exec");
  await callTool(h.runtime.tools, h.run({ caller: "subagent:explorer", interactive: true }), {
    id: "call_p2",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(seen.before.map((payload) => [payload.toolName, payload.caller, payload.risk])).toEqual([
    ["read", "subagent:explorer", "read"],
  ]);
});

test("tool.execution.after carries the masked input and the step of the call", async () => {
  const h = await createHarness({ secrets: { API: SECRET } });
  registerWorkspace(h);
  const seen = await watch(h);
  const run = h.run();
  await callTool(h.runtime.tools, run, {
    id: "call_p3",
    name: "read",
    args: { path: `token ${SECRET}.txt` },
  });
  expect(seen.after).toHaveLength(1);
  expect(seen.after[0]).toMatchObject({
    toolCallId: "call_p3",
    toolName: "read",
    input: { path: "token [REDACTED:API].txt" },
    stepId: run.stepId,
    isError: false,
  });
});

test("tool.execution.after also carries input and stepId for a call closed before execution", async () => {
  const h = await createHarness();
  const seen = await watch(h);
  const run = h.run();
  const out = await callTool(h.runtime.tools, run, {
    id: "call_p4",
    name: "missing_tool",
    args: { x: 1 },
  });
  expect(out.blocked).toContain("tool_unavailable");
  expect(seen.after[0]).toMatchObject({
    toolCallId: "call_p4",
    input: { x: 1 },
    stepId: run.stepId,
    isError: true,
  });
});

test("ToolSpec.locks becomes LockDecl: read is shared and write is exclusive", () => {
  const withLocks = {
    ...WorkspaceFiles,
    tools: WorkspaceFiles.tools.map((spec) =>
      spec.name === "read"
        ? Object.assign({}, spec, {
            locks: () => [
              { path: "/w/a", access: "read" as const },
              { path: "/w/b", access: "write" as const },
            ],
          })
        : spec,
    ),
  };
  const entries = entriesOf(
    {
      kind: "capability",
      def: withLocks,
      key: { capability: "workspace.files", version: "1.0.0" },
    },
    () => undefined,
    {
      wait: () => Promise.resolve("unknown"),
      open: () => Promise.reject(new Error("unused")),
      get: () => undefined,
    },
  );
  const read = entries.find((entry) => entry.name === "read");
  const ls = entries.find((entry) => entry.name === "ls");
  expect(read?.locks?.({ path: "x" })).toEqual([
    { path: "/w/a", mode: "shared" },
    { path: "/w/b", mode: "exclusive" },
  ]);
  expect(ls?.locks).toBeUndefined();
});
