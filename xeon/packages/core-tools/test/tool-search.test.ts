import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { EffectResultSchema } from "@xeon/contracts/records";
import { activatedTools } from "../src/builtin/activation.ts";
import { createToolRuntime } from "../src/runtime.ts";
import {
  callTool,
  createHarness,
  directTool,
  expectOk,
  layer,
  textOf,
  type Harness,
} from "./support/harness.ts";

// L1A.5: 지연 노출과 내장 도구 tool_search(TL-7 M2, TL-10)

function addMcp(h: Harness, name: string, description: string): void {
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "mcp.github",
      tool: {
        ...directTool(name, () => Promise.resolve({ content: [], details: null })),
        description,
      },
      policy: { mcpServer: "github", risk: "read" },
    }),
  );
}

function threshold(value: number) {
  return layer("user", { "l1.tools.exposure.deferThreshold": value });
}

async function advertise(h: Harness, activated: string[] = []) {
  return expectOk(await h.runtime.tools.advertise({ run: h.run(), activated: new Set(activated) }));
}

test("auto tools stay in the list up to the threshold; above it they are all deferred behind tool_search", async () => {
  const within = await createHarness({ layers: [threshold(5)] });
  // 후보: read_tool_output(always) + auto 4 = 5 <= 5
  for (const name of ["a1", "a2", "a3", "a4"]) addMcp(within, name, `tool ${name}`);
  const listed = await advertise(within);
  expect(listed.tools.map((tool) => tool.name)).toEqual([
    "read_tool_output",
    "a1",
    "a2",
    "a3",
    "a4",
  ]);
  expect(listed.deferred).toEqual([]);

  const over = await createHarness({ layers: [threshold(5)] });
  for (const name of ["a1", "a2", "a3", "a4", "a5"]) addMcp(over, name, `tool ${name}`);
  const deferred = await advertise(over);
  expect(deferred.tools.map((tool) => tool.name)).toEqual(["read_tool_output", "tool_search"]);
  expect(deferred.deferred.map((ref) => ref.name)).toEqual(["a1", "a2", "a3", "a4", "a5"]);

  // 임계 0이면 auto 도구는 모두 지연 도구다
  const zero = await createHarness({ layers: [threshold(0)] });
  addMcp(zero, "only", "the only tool");
  expect((await advertise(zero)).deferred.map((ref) => ref.name)).toEqual(["only"]);
});

test("tool_search is advertised only when something is deferred, and deferred tools are never dropped silently", async () => {
  const h = await createHarness();
  expect((await advertise(h)).tools.map((tool) => tool.name)).not.toContain("tool_search");
  expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey: "ext.z",
      tool: directTool("hidden", () => Promise.resolve({ content: [], details: null })),
      exposure: "deferred",
    }),
  );
  const toolset = await advertise(h);
  expect(toolset.tools.map((tool) => tool.name)).toContain("tool_search");
  expect(toolset.deferred.map((ref) => ref.name)).toEqual(["hidden"]);
  // tool_search는 이 도구들을 순서 키 core.tools로 보인다
  expect(h.runtime.tools.meta("tool_search")).toMatchObject({
    ref: { capability: "core.tools", name: "tool_search" },
    risk: "read",
    replay: "safe",
  });
});

test("tool_search_activates_for_next_step: the matches are recorded as activated and the next advertise lists them, also after a restart", async () => {
  const h = await createHarness({ layers: [threshold(0)] });
  addMcp(h, "create_issue", "Create an issue in a GitHub repository");
  addMcp(h, "list_issues", "List the issues of a repository");
  addMcp(h, "get_commit", "Show a commit");
  addMcp(h, "merge_pull_request", "Merge a pull request");
  const before = await advertise(h);
  expect(before.tools.map((tool) => tool.name)).toEqual(["read_tool_output", "tool_search"]);

  const found = await callTool(h.runtime.tools, h.run(), {
    id: "search_1",
    name: "tool_search",
    args: { query: "issue" },
  });
  expect(found.blocked).toBeUndefined();
  const text = textOf(found.result);
  expect(text).toContain("create_issue: Create an issue");
  expect(text).toContain("list_issues: List the issues");
  expect(text).not.toContain("get_commit");
  const result = parse(
    EffectResultSchema,
    h.session.events.find((event) => event.kind === "effect.result")?.payload,
  );
  expect(result.ok && result.value.output?.structuredContent).toEqual({
    activated: ["create_issue", "list_issues"],
  });

  const activated = expectOk(await activatedTools(h.session, h.thread));
  expect([...activated].toSorted()).toEqual(["create_issue", "list_issues"]);
  const after = await advertise(h, [...activated]);
  expect(after.tools.map((tool) => tool.name)).toEqual([
    "read_tool_output",
    "tool_search",
    "create_issue",
    "list_issues",
  ]);
  expect(after.deferred.map((ref) => ref.name)).toEqual(["get_commit", "merge_pull_request"]);
  expect(after.fingerprint).not.toBe(before.fingerprint);

  // 재시작 뒤에도 이벤트에서 같은 활성화 집합과 같은 광고 목록이 나온다
  const restarted = createToolRuntime(h.deps);
  for (const name of ["create_issue", "list_issues", "get_commit", "merge_pull_request"]) {
    expectOk(
      restarted.tools.register({
        kind: "direct",
        orderKey: "mcp.github",
        tool: directTool(name, () => Promise.resolve({ content: [], details: null })),
        policy: { mcpServer: "github", risk: "read" },
      }),
    );
  }
  const again = expectOk(await activatedTools(h.session, h.thread));
  expect([...again].toSorted()).toEqual([...activated].toSorted());
  const relisted = expectOk(await restarted.tools.advertise({ run: h.run(), activated: again }));
  expect(relisted.tools.map((tool) => tool.name)).toEqual(after.tools.map((tool) => tool.name));
});

test("tool_search with no match says so and activates nothing; a limit caps the matches", async () => {
  const h = await createHarness({ layers: [threshold(0)] });
  for (let i = 0; i < 8; i += 1) addMcp(h, `issue_${i}`, "issue tool");
  const none = await callTool(h.runtime.tools, h.run(), {
    id: "search_2",
    name: "tool_search",
    args: { query: "weather" },
  });
  expect(textOf(none.result)).toContain('No unloaded tool matches "weather"');
  const limited = await callTool(h.runtime.tools, h.run(), {
    id: "search_3",
    name: "tool_search",
    args: { query: "issue", limit: 3 },
  });
  expect(textOf(limited.result).match(/^- issue_/gm)).toHaveLength(3);
  const activated = expectOk(await activatedTools(h.session, h.thread));
  expect(activated.size).toBe(3);
});

test("tool_search does not reveal tools a global deny rule removed", async () => {
  const h = await createHarness({
    layers: [
      threshold(0),
      layer("managed", {
        "l1.tools.rules": [
          {
            id: "m.no-secret",
            action: "tool.call",
            resource: { tool: "secret_issue" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  addMcp(h, "secret_issue", "issue tool that policy forbids");
  addMcp(h, "open_issue", "open an issue");
  const found = await callTool(h.runtime.tools, h.run(), {
    id: "search_4",
    name: "tool_search",
    args: { query: "issue" },
  });
  expect(textOf(found.result)).toContain("open_issue");
  expect(textOf(found.result)).not.toContain("secret_issue");
});

test("a subagent's tool_search lists only deferred tools inside its allow list", async () => {
  const h = await createHarness({ layers: [threshold(0)] });
  addMcp(h, "open_issue", "open an issue");
  addMcp(h, "close_issue", "close an issue outside the allow list");
  const run = {
    ...h.run(),
    caller: "subagent:worker" as const,
    depth: 1,
    ceiling: {
      caller: "main" as const,
      depth: 0,
      mode: "default" as const,
      allow: ["open_*", "tool_search"],
    },
  };
  const found = await callTool(h.runtime.tools, run, {
    id: "search_ceiling",
    name: "tool_search",
    args: { query: "issue" },
  });
  expect(textOf(found.result)).toContain("open_issue");
  expect(textOf(found.result)).not.toContain("close_issue");
});

test("activation beyond the request limit is reported and not recorded", async () => {
  // always 124 + read_tool_output + tool_search = 126, room 2
  const h = await createHarness({ layers: [threshold(128)] });
  for (let i = 0; i < 124; i += 1) {
    expectOk(
      h.runtime.tools.register({
        kind: "direct",
        orderKey: "ext.base",
        tool: directTool(`base_${String(i).padStart(3, "0")}`, () =>
          Promise.resolve({ content: [], details: null }),
        ),
      }),
    );
  }
  for (const name of ["extra_a", "extra_b", "extra_c", "extra_d"]) {
    expectOk(
      h.runtime.tools.register({
        kind: "direct",
        orderKey: "ext.zzz",
        tool: {
          ...directTool(name, () => Promise.resolve({ content: [], details: null })),
          description: "extra tool",
        },
        exposure: "deferred",
      }),
    );
  }
  const found = await callTool(h.runtime.tools, h.run(), {
    id: "search_5",
    name: "tool_search",
    args: { query: "extra" },
  });
  expect(textOf(found.result)).toContain("2 of them were not activated");
  const activated = expectOk(await activatedTools(h.session, h.thread));
  expect(activated.size).toBe(2);
  expect((await advertise(h, [...activated])).tools).toHaveLength(128);
});
