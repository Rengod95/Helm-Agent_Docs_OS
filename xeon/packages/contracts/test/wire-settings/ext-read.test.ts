import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import type { TSchema } from "typebox";
import {
  HostStatusResultSchema,
  WIRE_METHODS,
  classifyMethodName,
  extMethodName,
} from "../../src/wire-settings/wire/index.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

const plugin = {
  registrationId: "learning",
  layer: "L3",
  status: "enabled",
  thread: "enabling",
  inGroup: true,
  enabledSource: "thread",
};
const entry = {
  name: "learning",
  displayName: "Learning",
  layer: "L3",
  isGroup: true,
  version: "1.2.0",
  location: "/home/u/.fresnel/plugins/learning",
  origin: "project",
  requestedGrade: "builtin",
  effectiveGrade: "builtin",
  tier: "user",
  status: "enabled",
  registration: "enabling",
  enabledSource: "user",
  plugins: [
    plugin,
    {
      registrationId: "learning/review",
      id: "review",
      layer: "L2",
      status: "disabled",
      inGroup: false,
    },
  ],
  diagnostics: [{ severity: "warning", code: "x", message: "m", file: "a.ts", line: 3 }],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 2,
};

describe("M4 ext read methods", () => {
  test("ext.list and ext.get results round trip by value, Registration rows under the extension", () => {
    const list = { extensions: [entry] };
    roundTrip(WIRE_METHODS["ext.list"].result, list);
    const get = {
      entry,
      manifest: { name: "learning" },
      hooks: [
        {
          registrationId: "learning",
          hook: "input.user.before",
          budgetClass: "fast",
          budgetMs: 50,
        },
      ],
      bindings: [
        {
          registrationId: "learning/review",
          capability: "a.b",
          relation: "requires",
          peer: null,
          satisfied: false,
        },
      ],
    };
    roundTrip(WIRE_METHODS["ext.get"].result, get);
  });

  test("ext.list rejects the old shape: kind, scope, pointCount, no plugins", () => {
    const { plugins: _plugins, hookCount: _hookCount, isGroup: _isGroup, ...rest } = entry;
    const oldShape = { ...rest, kind: "plugin", scope: "enabling", pointCount: 2 };
    expect(parse(WIRE_METHODS["ext.list"].result, { extensions: [oldShape] }).ok).toBe(false);
    expect(
      parse(WIRE_METHODS["ext.list"].result, { extensions: [{ ...entry, plugins: [] }] }).ok,
    ).toBe(false);
    expect(
      parse(WIRE_METHODS["ext.list"].result, {
        extensions: [{ ...entry, enabledSource: "profile" }],
      }).ok,
    ).toBe(false);
  });

  test("params reject unknown keys and accept _meta", () => {
    expect(parse(WIRE_METHODS["ext.list"].params, { threadId: "thr_1", _meta: {} }).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.list"].params, { other: 1 }).ok).toBe(false);
    expect(parse(WIRE_METHODS["ext.get"].params, {}).ok).toBe(false);
    expect(parse(WIRE_METHODS["hooks.list"].params, {}).ok).toBe(true);
  });

  test("group.driveLock, metrics, timings and version history round trip", () => {
    const lock = {
      holder: "helm",
      leaseEpoch: 3,
      activeDriver: null,
      limits: { turns: 10, spawns: 2, tokens: null },
      used: { turns: 1, spawns: 0, tokens: 40 },
      candidates: [{ registrationId: "other", waits: 2, waitLimit: 5 }],
      lastRejected: { groupId: "other", reason: "wait_limit", requestSeq: 9 },
    };
    roundTrip(WIRE_METHODS["group.driveLock"].result, lock);
    const timings = {
      traceEnabled: true,
      timings: [
        {
          hook: "input.user.before",
          registrationId: "learning",
          count: 4,
          p50Ms: 1,
          p95Ms: 3,
          maxMs: 5,
          failures: 0,
        },
      ],
    };
    roundTrip(WIRE_METHODS["ext.timings"].result, timings);
    roundTrip(WIRE_METHODS["ext.timings"].result, { traceEnabled: false, timings: [] });
    const versions = {
      versions: [
        {
          version: "1.0.0",
          installedAt: "2026-10-31T00:00:00.000Z",
          source: "bundled",
          manifestHash: "abc",
          stateSchemaVersion: null,
          current: true,
        },
      ],
    };
    roundTrip(WIRE_METHODS["ext.versions"].result, versions);
    expect(
      parse(WIRE_METHODS["group.metrics"].result, { id: "g", metrics: null, since: null }).ok,
    ).toBe(true);
  });

  test("hooks.list and ext.health rows are per Hook and per Registration", () => {
    roundTrip(WIRE_METHODS["hooks.list"].result, {
      hooks: [
        {
          hook: "tool.call.before",
          fold: "first",
          handlers: 2,
          registrations: ["learning", "learning/review"],
          external: false,
          order: [
            {
              registrationId: "learning/review",
              extension: "learning",
              tier: 1,
              status: "enabled",
              error: null,
            },
            {
              registrationId: "learning",
              extension: "learning",
              tier: null,
              status: "disabled",
              error: "setup_failed",
            },
          ],
        },
      ],
    });
    roundTrip(WIRE_METHODS["group.metrics"].result, {
      id: "g",
      metrics: null,
      since: "2026-11-03T00:00:00.000Z",
      sinceIgnoredBy: ["inputTokens", "costUsd"],
    });
    roundTrip(WIRE_METHODS["ext.health"].result, {
      health: [
        {
          name: "learning",
          registrationId: "learning/review",
          consecutiveFailures: 2,
          windowFailures: 3,
          windowMs: 60000,
          windowCalls: 12,
          autoDisabled: false,
          lastFailureAt: null,
          lastError: null,
        },
      ],
    });
  });

  test("ext.ui.* replace ext.view.*", () => {
    const names = Object.keys(WIRE_METHODS);
    expect(names.filter((name) => name.startsWith("ext.ui."))).toEqual([
      "ext.ui.list",
      "ext.ui.post",
      "ext.ui.requestApproval",
    ]);
    expect(names.filter((name) => name.startsWith("ext.view."))).toEqual([]);
    roundTrip(WIRE_METHODS["ext.ui.list"].result, {
      items: [
        {
          extension: "learning",
          id: "status",
          placement: "panel",
          mode: "native",
          title: "Status",
          state: "ok",
          tree: { type: "Text" },
          issues: [],
        },
      ],
    });
    expect(
      parse(WIRE_METHODS["ext.ui.post"].params, { extension: "e", ui: "u", name: "n" }).ok,
    ).toBe(true);
    expect(
      parse(WIRE_METHODS["ext.ui.post"].params, { extension: "e", view: "u", name: "n" }).ok,
    ).toBe(false);
  });

  test("ext.validateComposition takes a composition and returns issues", () => {
    expect(parse(WIRE_METHODS["ext.validateComposition"].params, { composition: 1 }).ok).toBe(
      false,
    );
    const block = { id: "m", stage: "machine", op: "drive" };
    const withPlugins = {
      composition: { blocks: [block] },
      plugins: [{ layer: "L3", hooks: [], drives: true }],
    };
    expect(parse(WIRE_METHODS["ext.validateComposition"].params, withPlugins).ok).toBe(true);
    const issues = {
      issues: [{ severity: "error", code: "drive_duplicate", path: "/a", message: "m" }],
    };
    roundTrip(WIRE_METHODS["ext.validateComposition"].result, issues);
  });

  test("host.status carries safe mode cause and startup failures", () => {
    const base = {
      mode: "stdio",
      pid: 1,
      startedAt: "2026-10-31T00:00:00.000Z",
      connections: 1,
      liveTurns: 0,
      idleShutdownAt: null,
      safeMode: true,
      safeModeCause: "startupFailures",
      startupFailures: 3,
      suggestSafeMode: true,
    };
    roundTrip(HostStatusResultSchema, base);
    expect(parse(HostStatusResultSchema, { ...base, safeModeCause: "nope" }).ok).toBe(false);
  });

  test("ext.ui.* and ext.test.* are core, ext.<id>.<verb> is an extension method", () => {
    expect(classifyMethodName("ext.ui.list")).toBe("core");
    expect(classifyMethodName("ext.test.run")).toBe("core");
    expect(classifyMethodName("ext.list")).toBe("core");
    expect(classifyMethodName(extMethodName("acme-notes", "search"))).toBe("extension");
    expect(classifyMethodName("ext.acme-notes.Search")).toBeUndefined();
    expect(classifyMethodName("work.tasks.list")).toBe("core");
    expect(classifyMethodName("a.b.c.d")).toBeUndefined();
  });
});
