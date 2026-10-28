import { expect, test } from "bun:test";
import { createToolRuntime } from "../src/runtime.ts";
import {
  createHarness,
  installHandlers,
  layer,
  registerWorkspace,
  textOf,
} from "./support/harness.ts";

// L1A.5: runUserShell(TL-16). 사용자가 직접 친 명령은 caller main, 대화형으로 평가한다.

function kinds(events: readonly { readonly kind: string }[]): string[] {
  return events.map((event) => event.kind);
}

test("run_user_shell_evaluates_as_main_interactive: ask is the user's own command, three effects are written, no toolResult item", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  probe.setShellOutput("listing\n");
  // 비대화형 서브에이전트 맥락으로 불러도 사용자 셸은 main, 대화형으로 평가된다
  const base = h.run({ interactive: false });
  const record = await h.runtime.tools.runUserShell(
    { command: "ls -la", includeInContext: true },
    { ...base, caller: "subagent:worker", depth: 2 },
  );
  expect(record.isError).toBe(false);
  expect(record.content).toEqual([{ type: "text", text: expect.stringContaining("listing") }]);
  expect(probe.calls.map((call) => call.method)).toEqual(["run"]);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  expect(kinds(h.session.events)).toEqual(["effect.intent", "effect.exec", "effect.result"]);
  const resultCommit = h.session.commits.at(-1);
  expect(resultCommit?.kinds).toEqual(["effect.result"]);
  // 호출 id는 도구 호출 id 자리에 들어가므로 커밋 키 형식을 지킨다
  expect(
    h.session.commits.map((commit) => commit.requestId).every((id) => id.startsWith("tool:")),
  ).toBe(true);
});

test("a deny rule still blocks the user's command: nothing runs and no effect is written", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          { id: "m.no-bash", action: "tool.call", resource: { tool: "bash" }, effect: "deny" },
        ],
      }),
    ],
  });
  const probe = registerWorkspace(h);
  const record = await h.runtime.tools.runUserShell(
    { command: "rm -rf /", includeInContext: false },
    h.run(),
  );
  expect(record.isError).toBe(true);
  expect(textOf({ content: record.content, details: null })).toContain("denied_by_policy");
  expect(probe.calls).toEqual([]);
  expect(h.session.events).toEqual([]);
});

test("a tool.call.before handler can still refuse the user's command", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "guard", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no shell today" }));
  });
  const record = await h.runtime.tools.runUserShell(
    { command: "echo hi", includeInContext: true },
    h.run(),
  );
  expect(record.isError).toBe(true);
  expect(textOf({ content: record.content, details: null })).toContain("no shell today");
  expect(probe.calls).toEqual([]);
});

test("without a bash tool the user's command is an error record, not an exception", async () => {
  const h = await createHarness();
  const record = await h.runtime.tools.runUserShell(
    { command: "ls", includeInContext: false },
    h.run(),
  );
  expect(record.isError).toBe(true);
  expect(textOf({ content: record.content, details: null })).toContain("tool_unavailable");
  const restarted = createToolRuntime(h.deps);
  expect(restarted.tools.meta("bash")).toBeUndefined();
});
