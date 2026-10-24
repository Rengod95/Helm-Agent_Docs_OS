import { expect, test } from "bun:test";
import type { ExposureMode } from "@xeon/contracts/services";
import {
  createHarness,
  directTool,
  errorText,
  layer,
  rejectionOf,
  registerWorkspace,
  type Harness,
  expectOk,
} from "./support/harness.ts";

function add(
  h: Harness,
  name: string,
  orderKey: string,
  extra: { exposure?: ExposureMode; risk?: "read" | "write" | "exec" } = {},
): () => void {
  return expectOk(
    h.runtime.tools.register({
      kind: "direct",
      orderKey,
      tool: directTool(name, () => Promise.resolve({ content: [], details: null })),
      policy: { risk: extra.risk ?? "read" },
      ...(extra.exposure === undefined ? {} : { exposure: extra.exposure }),
    }),
  );
}

function advertised(h: Harness) {
  return h.runtime.tools.advertise({ run: h.run(), activated: new Set() });
}

test("exposure_removes_denied_tools: a global deny removes the tool, an args or mode condition does not", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          { id: "m.no-bash", action: "tool.call", resource: { tool: "bash" }, effect: "deny" },
          {
            id: "m.no-rm",
            action: "tool.call",
            resource: { tool: "rm_tool", args: [{ pointer: "/command", pattern: "^rm" }] },
            effect: "deny",
          },
          {
            id: "m.no-plan-writes",
            action: "tool.call",
            resource: { tool: "plan_tool", mode: ["plan"] },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  registerWorkspace(h);
  add(h, "rm_tool", "ext.a");
  add(h, "plan_tool", "ext.a");
  const toolset = await advertised(h);
  const names = toolset.tools.map((tool) => tool.name);
  expect(names).not.toContain("bash");
  expect(names).toContain("rm_tool");
  expect(names).toContain("plan_tool");
  expect(names).toContain("read");
  expect(toolset.removed).toEqual([
    { ref: { capability: "workspace.shell", name: "bash" }, ruleId: "m.no-bash", tier: "managed" },
  ]);
});

test("exposure_order_deterministic: any registration order gives the same list and fingerprint", async () => {
  const names = ["delta", "alpha", "charlie", "bravo"];
  const baseline = await (async () => {
    const h = await createHarness();
    names.forEach((name, i) => add(h, name, `ext.k${i % 2}`));
    return advertised(h);
  })();
  const orders: string[][] = [];
  for (let shift = 0; shift < 10; shift += 1) {
    orders.push([...names.slice(shift % 4), ...names.slice(0, shift % 4)].toReversed());
  }
  const toolsets = await Promise.all(
    orders.map(async (order) => {
      const h = await createHarness();
      for (const name of order) add(h, name, `ext.k${names.indexOf(name) % 2}`);
      return advertised(h);
    }),
  );
  for (const toolset of toolsets) {
    expect(toolset.tools.map((tool) => tool.name)).toEqual(baseline.tools.map((tool) => tool.name));
    expect(toolset.fingerprint).toBe(baseline.fingerprint);
  }
  // 순서는 순서 키(능력 id 또는 접두)와 이름의 바이트 순이다. 내장 도구(core.tools)가 맨 앞에 선다
  expect(baseline.tools.map((tool) => `${tool.capability}/${tool.name}`)).toEqual([
    "core.tools/read_tool_output",
    "ext.k0/charlie",
    "ext.k0/delta",
    "ext.k1/alpha",
    "ext.k1/bravo",
  ]);
});

test("exposure_caps_at_128: 129 always tools fail, auto tools fill the remaining room and the rest are deferred", async () => {
  const over = await createHarness();
  for (let i = 0; i < 129; i += 1) add(over, `tool_${String(i).padStart(3, "0")}`, "ext.many");
  expect(errorText(await rejectionOf(() => advertised(over)))).toContain("tools.too_many");

  // 광고 후보(always 101 = 100 + read_tool_output, auto 50)가 임계 128을 넘으므로 auto는 모두 지연 도구가 된다
  const h = await createHarness({
    layers: [layer("user", { "l1.tools.exposure.deferThreshold": 128 })],
  });
  for (let i = 0; i < 100; i += 1) add(h, `a_${String(i).padStart(3, "0")}`, "ext.always");
  for (let i = 0; i < 50; i += 1)
    add(h, `m_${String(i).padStart(3, "0")}`, "ext.mcp", { exposure: "auto" });
  add(h, "later", "ext.zzz", { exposure: "deferred" });
  const toolset = await advertised(h);
  const names = toolset.tools.map((tool) => tool.name);
  expect(toolset.tools).toHaveLength(100 + 1 + 1);
  expect(names).toContain("tool_search");
  expect(names.some((name) => name.startsWith("m_"))).toBe(false);
  expect(toolset.deferred).toHaveLength(50 + 1);

  // 임계 안이면 auto 도구도 싣는다: 후보 101 + 20 = 121 <= 128, 지연 도구가 없으면 tool_search도 없다
  const fits = await createHarness({
    layers: [layer("user", { "l1.tools.exposure.deferThreshold": 128 })],
  });
  for (let i = 0; i < 100; i += 1) add(fits, `a_${String(i).padStart(3, "0")}`, "ext.always");
  for (let i = 0; i < 20; i += 1)
    add(fits, `m_${String(i).padStart(3, "0")}`, "ext.mcp", { exposure: "auto" });
  const roomy = await advertised(fits);
  expect(roomy.tools).toHaveLength(121);
  expect(roomy.deferred).toEqual([]);
  expect(roomy.tools.map((tool) => tool.name)).not.toContain("tool_search");
});

test("registering the same tool name twice is a name_conflict value and leaves the table unchanged", async () => {
  const h = await createHarness();
  const unregister = add(h, "one", "ext.a");
  // 확장 조합이 같은 이름을 내는 것은 정상 운영 중에도 생긴다. 던지지 않고 오류 값으로 알린다
  const fresh = h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.b",
    tool: directTool("fresh", () => Promise.resolve({ content: [], details: null })),
  });
  expect(fresh.ok).toBe(true);
  const clash = h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.b",
    tool: directTool("one", () => Promise.resolve({ content: [], details: null })),
  });
  expect(clash).toEqual({ ok: false, error: { kind: "name_conflict", toolName: "one" } });
  // ToolsPort 등록(확장) 사이의 충돌도 같은 값이다
  const twice = h.runtime.tools.register("ext-twice/main", {
    name: "twin",
    description: "d",
    parameters: directTool("x", () => Promise.resolve({ content: [], details: null })).parameters,
    replay: "safe",
    execute: () => Promise.resolve("a"),
  });
  expect(twice.ok).toBe(true);
  const again = h.runtime.tools.register("ext-twice2/main", {
    name: "twin",
    description: "d",
    parameters: directTool("x", () => Promise.resolve({ content: [], details: null })).parameters,
    replay: "safe",
    execute: () => Promise.resolve("b"),
  });
  expect(again).toEqual({ ok: false, error: { kind: "name_conflict", toolName: "twin" } });
  expect(h.runtime.tools.meta("fresh")).toBeDefined();
  unregister();
  expect(h.runtime.tools.meta("one")).toBeUndefined();
  // 이름이 비면 다시 등록할 수 있다
  add(h, "one", "ext.b");
  expect(h.runtime.tools.meta("one")?.ref).toEqual({ capability: "ext.b", name: "one" });
});

test("meta derives risk, replay and exposure from the registration", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  expect(h.runtime.tools.meta("read")).toMatchObject({
    risk: "read",
    replay: "safe",
    exposure: "always",
    capability: { id: "workspace.files", method: "read" },
    outputLimits: { maxLines: 2000, maxBytes: 51_200 },
  });
  expect(h.runtime.tools.meta("bash")).toMatchObject({ risk: "exec", replay: "unsafe" });
  expect(h.runtime.tools.meta("write")).toMatchObject({ risk: "exec" });
  expect(h.runtime.tools.meta("nothing")).toBeUndefined();
});

test("mcp server tools default to auto exposure and keep the server name for policy", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "mcp.github",
    tool: directTool("gh_issue", () => Promise.resolve({ content: [], details: null })),
    policy: { mcpServer: "github", risk: "read" },
  });
  expect(h.runtime.tools.meta("gh_issue")).toMatchObject({ exposure: "auto", mcpServer: "github" });
});

test("the extension ToolsPort overload registers under ext.<name> with undeclared risk and unsafe replay", async () => {
  const h = await createHarness();
  const unregister = expectOk(
    h.runtime.tools.register("acme-notes/main", {
      name: "note_add",
      description: "add a note",
      parameters: directTool("x", () => Promise.resolve({ content: [], details: null })).parameters,
      replay: "safe",
      execute: () => Promise.resolve("added"),
    }),
  );
  expect(h.runtime.tools.meta("note_add")).toMatchObject({
    ref: { capability: "ext.acme-notes", name: "note_add" },
    risk: "exec",
    replay: "safe",
  });
  unregister();
  expect(h.runtime.tools.meta("note_add")).toBeUndefined();
});
