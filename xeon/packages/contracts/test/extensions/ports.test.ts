import { describe, expect, test } from "bun:test";
import {
  LoopPortKey,
  InputQueuePortKey,
  McpPortKey,
  ModelsPortKey,
  ProcessPortKey,
  ProjectorRegistryPortKey,
  RecordCommitPortKey,
  ExtensionTablesPortKey,
  ScopedStorePortKey,
  ToolsPortKey,
  type PortKey,
} from "../../src/extensions/index.ts";
// F.extensions.spec §3.2.1 표: 서비스 이름과 member
const KEYS: ReadonlyArray<
  readonly [string, PortKey<unknown>, `fresnel.${string}`, string | undefined]
> = [
  ["LoopPortKey", LoopPortKey, "fresnel.loop", undefined],
  ["InputQueuePortKey", InputQueuePortKey, "fresnel.tasks", undefined],
  ["RecordCommitPortKey", RecordCommitPortKey, "fresnel.session", "ext"],
  ["ProjectorRegistryPortKey", ProjectorRegistryPortKey, "fresnel.session", "projectors"],
  ["ScopedStorePortKey", ScopedStorePortKey, "fresnel.store", undefined],
  ["ExtensionTablesPortKey", ExtensionTablesPortKey, "fresnel.store", "extensions"],
  ["ProcessPortKey", ProcessPortKey, "fresnel.process", undefined],
  ["ToolsPortKey", ToolsPortKey, "fresnel.tools", undefined],
  ["ModelsPortKey", ModelsPortKey, "fresnel.models", undefined],
  ["McpPortKey", McpPortKey, "fresnel.mcp", undefined],
];

describe("port keys", () => {
  test.each(KEYS)("%s names the service in the spec table", (_label, key, name, member) => {
    expect(key.name).toBe(name);
    expect(key.name.startsWith("fresnel.")).toBe(true);
    expect(key.member).toBe(member);
  });

  test("only the session and store service keys carry a member", () => {
    const withMember = KEYS.filter(([, key]) => key.member !== undefined).map(([label]) => label);
    expect(withMember).toEqual([
      "RecordCommitPortKey",
      "ProjectorRegistryPortKey",
      "ExtensionTablesPortKey",
    ]);
    expect(Object.keys(LoopPortKey)).toEqual(["name"]);
  });

  test("keys are unique by (name, member)", () => {
    const pairs = KEYS.map(([, key]) => `${key.name}#${key.member ?? ""}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("keys are plain values that can cross a lookup", () => {
    const registry = new Map<string, unknown>([["fresnel.loop", { status: () => "idle" }]]);
    const lookup = {
      get: (key: PortKey<unknown>): unknown => registry.get(key.name),
    };
    expect(lookup.get(LoopPortKey)).toBeDefined();
    expect(lookup.get(McpPortKey)).toBeUndefined();
  });
});
