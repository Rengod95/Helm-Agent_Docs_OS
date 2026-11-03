import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import type { ToolName } from "@fresnel/contracts/capabilities";
import {
  ToolCallDecisionSchema,
  type ToolReplaceClaim,
  type ToolResourceDef,
} from "@fresnel/contracts/extensions";
import {
  TOOL_REPLACE_APPROVAL_TOOL,
  TOOL_REPLACE_RULE_ID,
  type ToolRisk,
} from "@fresnel/contracts/services";
import { Type } from "typebox";
import { resourceEntry } from "../src/entries.ts";
import { createRegistry } from "../src/registry.ts";
import { TOOLS_SETTING_KEYS } from "../src/settings.ts";
import {
  callTool,
  createHarness,
  expectOk,
  layer,
  registerWorkspace,
  textOf,
  until,
  type Harness,
} from "./support/harness.ts";

// L1.tools.spec §4.13, F.capabilities.spec §10 [결정: 2026-11-03 사용자]. 내장 도구를 같은 이름으로 대체하는 등록의 조건별 시험.

const USER: ToolReplaceClaim = { extension: "acme-files", trust: "user" };
const PROJECT: ToolReplaceClaim = { extension: "repo-files", trust: "project" };
const BUILTIN: ToolReplaceClaim = { extension: "core-files", trust: "builtin" };

function replacement(
  name: string,
  claim: ToolReplaceClaim | undefined,
  ran: string[],
  risk?: ToolRisk,
): ToolResourceDef {
  return {
    name,
    description: `${name} by an extension`,
    parameters: Type.Object({}, { additionalProperties: true }),
    replay: "safe",
    ...(risk === undefined ? {} : { risk }),
    ...(claim === undefined ? {} : { replaces: claim }),
    execute: () => {
      ran.push(name);
      return Promise.resolve("from the extension");
    },
  };
}

async function workspace(): Promise<{ h: Harness; probe: ReturnType<typeof registerWorkspace> }> {
  const h = await createHarness();
  return { h, probe: registerWorkspace(h) };
}

async function advertiseNames(h: Harness): Promise<readonly string[]> {
  const advertised = expectOk(
    await h.runtime.tools.advertise({
      run: { threadId: h.thread, caller: "main", depth: 0 },
      activated: new Set<ToolName>(),
    }),
  );
  return advertised.tools.map((tool) => tool.wire.name);
}

/** 이 대화에서 열린 대체 승인 요청 하나를 사용자가 답한다 */
async function answer(h: Harness, decision: "allow" | "deny"): Promise<void> {
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(await h.runtime.approvals.respond(request?.approvalId ?? "", { decision })).toEqual({
    applied: true,
  });
}

test("a same-name registration without a replaces claim is refused and the built-in stays", async () => {
  const { h } = await workspace();
  const refused = h.runtime.tools.register("acme-files/main", replacement("read", undefined, []));
  expect(refused).toEqual({ ok: false, error: { kind: "name_conflict", toolName: "read" } });
  expect(h.runtime.tools.meta("read")?.capability?.id).toBe("workspace.files");
  expect(h.runtime.tools.replacements()).toEqual([]);
});

test("a declared replacement stays pending until the user approves and the built-in keeps running", async () => {
  const { h, probe } = await workspace();
  const ran: string[] = [];
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, ran)));
  expect(h.runtime.tools.replacements()).toMatchObject([
    { toolName: "read", extension: "acme-files", status: "pending", approvalId: null },
  ]);
  // 승인 전: 원본이 그대로다
  expect(h.runtime.tools.meta("read")?.capability?.id).toBe("workspace.files");
  const before = await callTool(h.runtime.tools, h.run(), {
    id: "r1",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(before.blocked).toBeUndefined();
  expect(ran).toEqual([]);
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("activation raises one approval request that names the tool, the extension, the trust and the path protection duty", async () => {
  const { h } = await workspace();
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, [])));
  await advertiseNames(h);
  await advertiseNames(h);
  const requested = h.session.events.filter((event) => event.kind === "approval.requested");
  expect(requested).toHaveLength(1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.title).toBe('Let "acme-files" replace the built-in tool "read"?');
  expect(request?.remember).toEqual(["once"]);
  expect(request?.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: TOOL_REPLACE_APPROVAL_TOOL,
      ruleId: TOOL_REPLACE_RULE_ID,
      risk: "exec",
      args: {
        tool: "read",
        extension: "acme-files",
        trust: "user",
        originalRisk: "read",
        effectiveRisk: "exec",
      },
    },
  });
  expect(JSON.stringify(request?.body)).toContain("must enforce path protection itself");
  expect(h.runtime.tools.replacements()).toMatchObject([
    { status: "pending", approvalId: request?.approvalId },
  ]);
});

test("an allow answer activates the replacement; the model then sees and runs the extension tool", async () => {
  const { h, probe } = await workspace();
  const ran: string[] = [];
  // 선언을 exec로 낮추지 않았으므로 호출마다 승인이 필요하다. 사용자 규칙으로 허용해 실행까지 본다
  h.setLayers([
    layer("user", {
      [TOOLS_SETTING_KEYS.rules]: [
        {
          id: "user.allow-acme-read",
          action: "tool.call",
          resource: { tool: "read" },
          effect: "allow",
        },
      ],
    }),
  ]);
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, ran)));
  await advertiseNames(h);
  await answer(h, "allow");
  await until(() => h.runtime.tools.replacements()[0]?.status === "active");
  expect(h.runtime.tools.meta("read")).toMatchObject({
    ref: { capability: "ext.acme-files", name: "read" },
    risk: "exec",
  });
  expect(h.runtime.tools.meta("read")?.capability).toBeUndefined();
  expect(await advertiseNames(h)).toContain("read");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "r2",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(textOf(out.result)).toBe("from the extension");
  expect(ran).toEqual(["read"]);
  expect(probe.calls).toEqual([]);
});

test("a deny answer keeps the built-in and the replacement is not asked again", async () => {
  const { h, probe } = await workspace();
  const ran: string[] = [];
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, ran)));
  await advertiseNames(h);
  await answer(h, "deny");
  await until(() => h.runtime.tools.replacements()[0]?.status === "denied");
  await advertiseNames(h);
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "r3",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(ran).toEqual([]);
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a project-scope plugin needs the same approval and the request carries its trust level", async () => {
  const { h } = await workspace();
  expectOk(h.runtime.tools.register("repo-files/main", replacement("ls", PROJECT, [])));
  expect(h.runtime.tools.replacements()).toMatchObject([{ toolName: "ls", trust: "project" }]);
  expect(h.runtime.tools.meta("ls")?.capability?.id).toBe("workspace.files");
  await advertiseNames(h);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body).toMatchObject({
    kind: "tool",
    tool: { toolName: TOOL_REPLACE_APPROVAL_TOOL, args: { tool: "ls", trust: "project" } },
  });
  expect(h.runtime.tools.meta("ls")?.capability?.id).toBe("workspace.files");
});

test("the risk floor is the original risk even when the replacement declares less", async () => {
  const { h } = await workspace();
  // bash는 exec다. builtin 확장이 read로 선언해도 대체 항목은 exec로 남는다
  const classesBefore = h.runtime.tools.meta("bash")?.classes;
  expect(classesBefore).toBeDefined();
  expectOk(h.runtime.tools.register("core-files/main", replacement("bash", BUILTIN, [], "read")));
  expect(h.runtime.tools.replacements()).toMatchObject([
    { toolName: "bash", originalRisk: "exec", effectiveRisk: "exec" },
  ]);
  await advertiseNames(h);
  await answer(h, "allow");
  await until(() => h.runtime.tools.replacements()[0]?.status === "active");
  expect(h.runtime.tools.meta("bash")?.risk).toBe("exec");
  expect(h.runtime.tools.meta("bash")?.classes).toEqual(classesBefore);
});

test("the default auto-allow for read does not apply to an active replacement; a user rule still can", async () => {
  const { h, probe } = await workspace();
  const ran: string[] = [];
  // builtin 확장이 read로 선언해 하한이 read가 된다. 기본 규칙(risk read allow)이 그대로면 승인 없이 실행될 자리다
  expectOk(h.runtime.tools.register("core-files/main", replacement("read", BUILTIN, ran, "read")));
  expect(h.runtime.tools.replacements()).toMatchObject([{ effectiveRisk: "read" }]);
  await advertiseNames(h);
  await answer(h, "allow");
  await until(() => h.runtime.tools.replacements()[0]?.status === "active");
  expect(h.runtime.tools.meta("read")?.risk).toBe("read");
  // 원본 read는 기본 허용이라 무인 호출도 실행됐지만, 대체 항목은 승인이 필요해 무인 호출이 거부된다
  const unattended = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r4",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(unattended.blocked).toContain("noninteractive_ask_denied");
  expect(ran).toEqual([]);
  expect(probe.calls).toEqual([]);
  // 사용자가 쓴 규칙은 그대로 적용된다
  h.setLayers([
    layer("user", {
      [TOOLS_SETTING_KEYS.rules]: [
        { id: "user.allow-read", action: "tool.call", resource: { tool: "read" }, effect: "allow" },
      ],
    }),
  ]);
  const allowed = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r5",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(allowed.blocked).toBeUndefined();
  expect(ran).toEqual(["read"]);
});

test("the built-in read is still auto-allowed without a prompt (control for the replacement test)", async () => {
  const { h, probe } = await workspace();
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r6",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

/** 활성화된 대체를 만든다. 승인은 사용자가 허용해 끝낸다 */
async function activeReplacement(h: Harness, ran: string[]): Promise<void> {
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, ran)));
  await advertiseNames(h);
  await answer(h, "allow");
  await until(() => h.runtime.tools.replacements()[0]?.status === "active");
}

// 저장소(project·local)가 적은 설정은 사용자가 쓴 것이 아니다. 그 설정으로 대체가 승인 없이 켜지면 안 된다(L1.tools.spec §4.13)
test.each(["project", "local"] as const)(
  "a %s-scope allow rule cannot auto-allow an active replacement",
  async (scope) => {
    const { h, probe } = await workspace();
    const ran: string[] = [];
    await activeReplacement(h, ran);
    h.setLayers([
      layer(
        scope,
        {
          [TOOLS_SETTING_KEYS.rules]: [
            {
              id: "repo.allow-read",
              action: "tool.call",
              resource: { tool: "read" },
              effect: "allow",
            },
          ],
        },
        `/repo/.fresnel/${scope === "local" ? "settings.local.json" : "settings.json"}`,
      ),
    ]);
    const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
      id: "r7",
      name: "read",
      args: { path: "a.txt" },
    });
    expect(out.blocked).toContain("noninteractive_ask_denied");
    expect(ran).toEqual([]);
    expect(probe.calls).toEqual([]);
  },
);

test("the same repository allow still works for a built-in tool that is not replaced", async () => {
  const { h, probe } = await workspace();
  h.setLayers([
    layer(
      "project",
      {
        [TOOLS_SETTING_KEYS.rules]: [
          {
            id: "repo.allow-bash",
            action: "tool.call",
            resource: { tool: "bash" },
            effect: "allow",
          },
        ],
      },
      "/repo/.fresnel/settings.json",
    ),
  ]);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r8",
    name: "bash",
    args: { command: "ls" },
  });
  expect(out.blocked).toBeUndefined();
  expect(probe.calls.map((call) => call.method)).toEqual(["run"]);
});

test("a repository's bypass mode cannot auto-allow an active replacement", async () => {
  const { h, probe } = await workspace();
  const ran: string[] = [];
  await activeReplacement(h, ran);
  h.setLayers([
    layer(
      "project",
      { [TOOLS_SETTING_KEYS.permissionMode]: "bypass" },
      "/repo/.fresnel/settings.json",
    ),
  ]);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r9",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(ran).toEqual([]);
  expect(probe.calls).toEqual([]);
});

test("a bypass the user chose still lets an active replacement run", async () => {
  const { h } = await workspace();
  const ran: string[] = [];
  await activeReplacement(h, ran);
  h.setLayers([layer("user", { [TOOLS_SETTING_KEYS.permissionMode]: "bypass" })]);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "r10",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(ran).toEqual(["read"]);
});

test("a second extension replacing the same tool is a conflict error and the first is untouched", async () => {
  const { h } = await workspace();
  expectOk(h.runtime.tools.register("acme-files/main", replacement("read", USER, [])));
  const second = h.runtime.tools.register("other-files/main", replacement("read", PROJECT, []));
  expect(second).toEqual({
    ok: false,
    error: { kind: "replace_conflict", toolName: "read", existing: "acme-files" },
  });
  expect(h.runtime.tools.replacements()).toMatchObject([{ extension: "acme-files" }]);
});

test("tools that are not built-in file or shell tools cannot be replaced", async () => {
  const { h } = await workspace();
  // 도구 실행 틀의 내장 도구
  expect(h.runtime.tools.register("acme-files/main", replacement("tool_search", USER, []))).toEqual(
    {
      ok: false,
      error: { kind: "replace_forbidden", toolName: "tool_search", reason: "core_pipeline" },
    },
  );
  expect(
    h.runtime.tools.register("acme-files/main", replacement("read_tool_output", USER, [])),
  ).toMatchObject({ ok: false, error: { reason: "core_pipeline" } });
  // 없는 이름
  expect(
    h.runtime.tools.register("acme-files/main", replacement("nothing_here", USER, [])),
  ).toEqual({
    ok: false,
    error: { kind: "replace_forbidden", toolName: "nothing_here", reason: "no_target" },
  });
  // 확장 도구
  expectOk(h.runtime.tools.register("learning/main", replacement("learning_note", undefined, [])));
  expect(
    h.runtime.tools.register("acme-files/main", replacement("learning_note", USER, [])),
  ).toEqual({
    ok: false,
    error: { kind: "replace_forbidden", toolName: "learning_note", reason: "not_builtin" },
  });
  expect(h.runtime.tools.replacements()).toEqual([]);
});

test("removing the replacement restores the built-in and closes its open request", async () => {
  const { h } = await workspace();
  const added = expectOk(
    h.runtime.tools.register("acme-files/main", replacement("read", USER, [])),
  );
  await advertiseNames(h);
  const [request] = h.runtime.approvals.pending(h.thread);
  added();
  expect(h.runtime.tools.replacements()).toEqual([]);
  await until(() => h.runtime.approvals.pending(h.thread).length === 0);
  expect(h.session.events.filter((event) => event.kind === "approval.resolved").length).toBe(1);
  expect(request?.approvalId).toBeDefined();
  expect(h.runtime.tools.meta("read")?.capability?.id).toBe("workspace.files");
});

test("tool.call.before still cannot change arguments: the decision shape has no args", () => {
  expect(parse(ToolCallDecisionSchema, { block: true, reason: "no" }).ok).toBe(true);
  expect(parse(ToolCallDecisionSchema, { block: true, reason: "no", args: { path: "x" } }).ok).toBe(
    false,
  );
  expect(parse(ToolCallDecisionSchema, { args: { path: "x" } }).ok).toBe(false);
});

test("the registry floors the risk at the original and inherits its classes", () => {
  const registry = createRegistry();
  const original = {
    ...resourceEntry("core/main", replacement("send_it", undefined, [], "write")),
    capability: { id: "work.files" as const, method: "send" },
    classes: ["external_send" as const],
  };
  expectOk(registry.add([original]));
  const declared = {
    ...resourceEntry("acme/main", replacement("send_it", BUILTIN, [], "read")),
    classes: ["spawn" as const],
  };
  expectOk(registry.addReplacement("acme/main", declared, BUILTIN));
  registry.setReplacement("acme/main", "send_it", { status: "active", approvalId: "apr_1" });
  expect(registry.get("send_it")).toMatchObject({
    risk: "write",
    classes: ["external_send", "spawn"],
    replacesBuiltin: true,
  });
  expect(registry.replacements()).toMatchObject([
    { originalRisk: "write", effectiveRisk: "write" },
  ]);
});
