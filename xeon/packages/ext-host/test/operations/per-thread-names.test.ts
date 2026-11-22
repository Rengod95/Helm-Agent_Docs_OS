import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  ToolsPortKey,
  type ToolRegisterOptions,
  type ToolResourceDef,
  type ToolsPort,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import {
  createToolNamesPolicy,
  exposeToolNames,
  NO_RESERVED_NAMES,
  toolNameKey,
  type ReservedNames,
  type ToolNameInput,
} from "../../src/operations/index.ts";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

// X.operations.spec §4.5.1 [결정: 2026-11-19, 사용자, AGE-56]: 도구 이름은 대화마다 정한다.

const RESERVED: ReservedNames = { ...NO_RESERVED_NAMES, tool: new Set(["read"]) };

function input(scopeId: string, owner: string, name: string, builtin = false): ToolNameInput {
  return { scopeId, owner, name, builtin };
}

function nameOf(
  names: ReadonlyMap<string, string>,
  scopeId: string,
  name: string,
): string | undefined {
  return names.get(toolNameKey(scopeId, name));
}

test("a draft counted under its real plugin name gets the short name an approved copy would get", () => {
  // 한 대화: 드래프트만 실려 있다. 주인 이름은 내부 이름이 아니라 실제 플러그인 이름이다
  const draftOnly = exposeToolNames([input("d7abc1-commit-msg", "commit-msg", "check")], RESERVED);
  expect(nameOf(draftOnly, "d7abc1-commit-msg", "check")).toBe("check");
  // 다른 대화: 승인본만 실려 있다. 승인본의 이름은 드래프트와 무관하다
  const approvedOnly = exposeToolNames([input("commit-msg", "commit-msg", "check")], RESERVED);
  expect(nameOf(approvedOnly, "commit-msg", "check")).toBe("check");
});

test("another plugin asking for the same short name still forces both to qualified names inside one conversation", () => {
  const names = exposeToolNames(
    [input("a", "plug-a", "check"), input("b", "plug-b", "check")],
    RESERVED,
  );
  expect(nameOf(names, "a", "check")).toBe("plug-a__check");
  expect(nameOf(names, "b", "check")).toBe("plug-b__check");
});

test("reserved names and builtin names are still qualified for external plugins", () => {
  const names = exposeToolNames(
    [input("e", "ext", "read"), input("c", "core-x", "search", true), input("f", "ext", "search")],
    RESERVED,
  );
  expect(nameOf(names, "e", "read")).toBe("ext__read");
  expect(nameOf(names, "c", "search")).toBe("search");
  expect(nameOf(names, "f", "search")).toBe("ext__search");
});

function toolDef(name: string): ToolResourceDef {
  return {
    name,
    description: name,
    parameters: Type.Object({}),
    replay: "safe",
    execute: () => Promise.resolve(name),
  };
}

async function harnessWithPort(perThreadToolNames: boolean) {
  const harness = await createOperationsHarness({
    reservedNames: RESERVED,
    ...(perThreadToolNames ? { resourcePolicy: createToolNamesPolicy() } : {}),
  });
  const calls: { readonly owner: string; readonly name: string; readonly perThread: boolean }[] =
    [];
  const port: ToolsPort = {
    toolMappedFor: () => false,
    executeForPlugin: () =>
      Promise.resolve(err({ kind: "unavailable", message: "test double: not used here" })),
    register(owner, def, options?: ToolRegisterOptions) {
      calls.push({ owner, name: def.name, perThread: options?.perThread === true });
      return ok(() => {});
    },
  };
  await harness.t.host.registerPlatform({
    name: "test-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, port);
    },
  });
  await harness.t.host.openThread(harness.t.newThread());
  return { ...harness, calls };
}

test("perThread mode: two external plugins with the same tool name register under the requested name and are not renamed", async () => {
  const { t, calls } = await harnessWithPort(true);
  await t.host.install(
    makeUnit({ name: "pt-a", builtin: false }, (g) => hostOf(g).registerTool(toolDef("check"))),
  );
  await t.host.install(
    makeUnit({ name: "pt-b", builtin: false }, (g) => hostOf(g).registerTool(toolDef("check"))),
  );
  expect(calls).toEqual([
    { owner: "pt-a", name: "check", perThread: true },
    { owner: "pt-b", name: "check", perThread: true },
  ]);
  expect(t.host.resources.list("tool").map((record) => record.exposed)).toEqual(["check", "check"]);
});

test("perThread mode keeps rejecting an external tool whose qualified name is too long", async () => {
  const { t } = await harnessWithPort(true);
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "pt-long", builtin: false }, (g) => {
      try {
        hostOf(g).registerTool(toolDef("y".repeat(58)));
        codes.push(undefined);
      } catch (error) {
        codes.push(error instanceof PrimitiveError ? error.code : "other");
      }
    }),
  );
  expect(codes).toEqual(["resource_name_invalid"]);
});

test("default mode is unchanged: the same two plugins are renamed globally and nothing is registered perThread", async () => {
  const { t, calls } = await harnessWithPort(false);
  await t.host.install(
    makeUnit({ name: "dm-a", builtin: false }, (g) => hostOf(g).registerTool(toolDef("check"))),
  );
  await t.host.install(
    makeUnit({ name: "dm-b", builtin: false }, (g) => hostOf(g).registerTool(toolDef("check"))),
  );
  expect(calls.every((call) => !call.perThread)).toBe(true);
  expect(
    t.host.resources
      .list("tool")
      .map((record) => record.exposed)
      .toSorted(),
  ).toEqual(["dm-a__check", "dm-b__check"]);
});
