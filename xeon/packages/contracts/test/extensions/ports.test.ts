import { describe, expect, test } from "bun:test";
import {
  LeaseArbiterPortKey,
  LoopPortKey,
  InputQueuePortKey,
  McpPortKey,
  ModelsPortKey,
  ProcessPortKey,
  ProjectorRegistryPortKey,
  RecordCommitPortKey,
  ScopedStorePortKey,
  ToolsPortKey,
  type LeaseArbiterPort,
  type LeaseCandidate,
  type PortKey,
} from "../../src/extensions/index.ts";
import { ThreadIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";

const THREAD = must(ThreadIdSchema, rawId("thr", 1));

// F.extensions.spec §3.2.1 표: 서비스 이름과 member
const KEYS: ReadonlyArray<
  readonly [string, PortKey<unknown>, `xeon.${string}`, string | undefined]
> = [
  ["LoopPortKey", LoopPortKey, "xeon.loop", undefined],
  ["InputQueuePortKey", InputQueuePortKey, "xeon.tasks", undefined],
  ["RecordCommitPortKey", RecordCommitPortKey, "xeon.session", "ext"],
  ["ProjectorRegistryPortKey", ProjectorRegistryPortKey, "xeon.session", "projectors"],
  ["ScopedStorePortKey", ScopedStorePortKey, "xeon.store", undefined],
  ["ProcessPortKey", ProcessPortKey, "xeon.process", undefined],
  ["LeaseArbiterPortKey", LeaseArbiterPortKey, "xeon.groups", undefined],
  ["ToolsPortKey", ToolsPortKey, "xeon.tools", undefined],
  ["ModelsPortKey", ModelsPortKey, "xeon.models", undefined],
  ["McpPortKey", McpPortKey, "xeon.mcp", undefined],
];

describe("port keys", () => {
  test.each(KEYS)("%s names the service in the spec table", (_label, key, name, member) => {
    expect(key.name).toBe(name);
    expect(key.name.startsWith("xeon.")).toBe(true);
    expect(key.member).toBe(member);
  });

  test("only xeon.session keys carry a member", () => {
    const withMember = KEYS.filter(([, key]) => key.member !== undefined).map(([label]) => label);
    expect(withMember).toEqual(["RecordCommitPortKey", "ProjectorRegistryPortKey"]);
    expect(Object.keys(LoopPortKey)).toEqual(["name"]);
  });

  test("keys are unique by (name, member)", () => {
    const pairs = KEYS.map(([, key]) => `${key.name}#${key.member ?? ""}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("keys are plain values that can cross a lookup", () => {
    const registry = new Map<string, unknown>([["xeon.loop", { status: () => "idle" }]]);
    const lookup = {
      get: (key: PortKey<unknown>): unknown => registry.get(key.name),
    };
    expect(lookup.get(LoopPortKey)).toBeDefined();
    expect(lookup.get(McpPortKey)).toBeUndefined();
  });
});

const candidate = (scopeId: string, enabledAtSeq: number | null): LeaseCandidate => ({
  scopeId,
  extension: scopeId,
  loadIndex: 0,
  defaultEnabled: true,
  enabledAtSeq,
});

describe("LeaseCandidate", () => {
  test("enabledAtSeq is a seq or null and an arbiter can order by it", () => {
    const arbiter: LeaseArbiterPort = {
      choose: (_threadId, candidates) =>
        candidates.toSorted(
          (a, b) =>
            (a.enabledAtSeq ?? Number.MAX_SAFE_INTEGER) -
            (b.enabledAtSeq ?? Number.MAX_SAFE_INTEGER),
        )[0]?.scopeId ?? null,
    };
    const picked = arbiter.choose(THREAD, [
      candidate("late", 9),
      candidate("none", null),
      candidate("early", 3),
    ]);
    expect(picked).toBe("early");
  });
});
