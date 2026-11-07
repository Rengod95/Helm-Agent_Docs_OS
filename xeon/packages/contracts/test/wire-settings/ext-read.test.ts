import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import type { TSchema } from "typebox";
import {
  HostStatusResultSchema,
  WIRE_ERRORS,
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
    // 기본 플러그인의 번들 판은 선택 필드다. 있으면 그대로 오가고, 문자열이 아니면 거절한다
    roundTrip(WIRE_METHODS["ext.versions"].result, { ...versions, bundledVersion: "1.0.1" });
    roundTrip(WIRE_METHODS["ext.versions"].result, { versions: [], bundledVersion: "1.0.1" });
    expect(
      parse(WIRE_METHODS["ext.versions"].result, { versions: [], bundledVersion: 101 }).ok,
    ).toBe(false);
    expect(
      parse(WIRE_METHODS["ext.versions"].result, { versions: [], bundledVersions: "1.0.1" }).ok,
    ).toBe(false);
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

  test("ext.disableConfirm takes a name and answers with the applied result", () => {
    expect(parse(WIRE_METHODS["ext.disableConfirm"].params, { name: "alpha" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.disableConfirm"].params, { name: "alpha", x: 1 }).ok).toBe(
      false,
    );
    roundTrip(WIRE_METHODS["ext.disableConfirm"].result, {
      appliesAt: "nextStepBoundary",
      diagnostics: [],
    });
  });

  test("hooks.disableConfirm and hooks.reenable take a hook and answer with the applied result", () => {
    for (const method of ["hooks.disableConfirm", "hooks.reenable"] as const) {
      expect(parse(WIRE_METHODS[method].params, { hook: "no-rm-rf" }).ok).toBe(true);
      expect(parse(WIRE_METHODS[method].params, {}).ok).toBe(false);
      expect(parse(WIRE_METHODS[method].params, { hook: "no-rm-rf", x: 1 }).ok).toBe(false);
      roundTrip(WIRE_METHODS[method].result, { appliesAt: "nextStepBoundary", diagnostics: [] });
    }
  });

  test("hooks.list carries the disable question and the off state of a hook", () => {
    const row = {
      hook: "no-rm-rf",
      fold: "first",
      handlers: 1,
      registrations: ["no-rm-rf"],
      external: true,
    };
    roundTrip(WIRE_METHODS["hooks.list"].result, {
      hooks: [
        { ...row, keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 } },
        { ...row, autoDisabled: true },
      ],
    });
    expect(
      parse(WIRE_METHODS["hooks.list"].result, {
        hooks: [{ ...row, keepOffQuestion: { rule: "other", consecutive: 5, windowFailures: 5 } }],
      }).ok,
    ).toBe(false);
  });

  test("ext.list carries the disable question while the extension is still on and rejects other shapes", () => {
    roundTrip(WIRE_METHODS["ext.list"].result, {
      extensions: [
        {
          ...entry,
          autoDisabled: true,
          keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
        },
      ],
    });
    const bad = parse(WIRE_METHODS["ext.list"].result, {
      extensions: [
        {
          ...entry,
          keepOffQuestion: { rule: "rate", consecutive: 1, windowFailures: 10, extra: 1 },
        },
      ],
    });
    expect(bad.ok).toBe(false);
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
          version: "1.2.0",
          trust: "managed",
          tree: { type: "Text" },
          issues: [],
        },
      ],
    });
    const post = { extension: "e", ui: "u", threadId: "thr_1", name: "n" };
    expect(parse(WIRE_METHODS["ext.ui.post"].params, post).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.ui.post"].params, { ...post, requestId: "r1" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["ext.ui.post"].params, { ...post, requestId: "" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["ext.ui.post"].params, { ...post, view: "u" }).ok).toBe(false);
    // threadId is required: a panel can outlive thread switching, so it is never inferred
    expect(
      parse(WIRE_METHODS["ext.ui.post"].params, { extension: "e", ui: "u", name: "n" }).ok,
    ).toBe(false);
    const approval = { extension: "e", ui: "u", threadId: "thr_1", method: "m" };
    expect(parse(WIRE_METHODS["ext.ui.requestApproval"].params, approval).ok).toBe(true);
    expect(
      parse(WIRE_METHODS["ext.ui.requestApproval"].params, { extension: "e", ui: "u", method: "m" })
        .ok,
    ).toBe(false);
  });

  test("ext.ui.list entries carry version, trust and appRoot by value, and reject bad ones", () => {
    const schema = WIRE_METHODS["ext.ui.list"].result;
    const base = {
      extension: "learning",
      id: "graph",
      placement: "page",
      mode: "app",
      title: "Graph",
      state: "ok",
      version: "1.2.0",
      trust: "user",
      app: { root: "./ui/graph", entry: "index.html", bridge: "^1.0.0", reason: "그래프 화면" },
      issues: [],
    };
    // appRoot is the install folder joined with the declared root (absolute on the wire)
    const withRoot = { ...base, appRoot: "/home/u/.fresnel/extensions/learning/1.2.0/ui/graph" };
    roundTrip(schema, { items: [withRoot] });
    roundTrip(schema, { items: [{ ...withRoot, version: "1.2.0-beta.1", trust: "project" }] });
    // builtin has no install folder, so the entry has no appRoot
    roundTrip(schema, { items: [{ ...base, trust: "builtin" }] });
    // the schema accepts a relative appRoot; the host documents and sends absolute paths only
    roundTrip(schema, { items: [{ ...withRoot, appRoot: "ui/graph" }] });

    expect(parse(schema, { items: [{ ...base, trust: "system" }] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...base, trust: "Managed" }] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...base, version: "1.2" }] }).ok).toBe(false);
    const { trust: _trust, ...noTrust } = base;
    expect(parse(schema, { items: [noTrust] }).ok).toBe(false);
    const { version: _version, ...noVersion } = base;
    expect(parse(schema, { items: [noVersion] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...withRoot, appRoot: "" }] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...withRoot, installDir: "/x" }] }).ok).toBe(false);

    const longRoot = `/${"a".repeat(1023)}`;
    expect(longRoot.length).toBe(1024);
    roundTrip(schema, { items: [{ ...withRoot, appRoot: longRoot }] });
    expect(parse(schema, { items: [{ ...withRoot, appRoot: `${longRoot}b` }] }).ok).toBe(false);
  });

  test("ext.ui.list card entries carry forKind by value, and reject an empty or over-long one", () => {
    const schema = WIRE_METHODS["ext.ui.list"].result;
    const card = {
      extension: "helm",
      id: "inquiry",
      placement: "card",
      mode: "native",
      title: "Inquiry",
      state: "ok",
      version: "1.2.0",
      trust: "user",
      forKind: "grp.helm.inquiry.finished",
      issues: [],
    };
    roundTrip(schema, { items: [card] });
    roundTrip(schema, { items: [{ ...card, forKind: "k".repeat(160) }] });
    expect(parse(schema, { items: [{ ...card, forKind: "" }] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...card, forKind: "k".repeat(161) }] }).ok).toBe(false);
    expect(parse(schema, { items: [{ ...card, forKind: 1 }] }).ok).toBe(false);
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

  test("hooks.order.* are M4 core methods, next to hooks.list", () => {
    const names = Object.keys(WIRE_METHODS).filter((name) => name.startsWith("hooks.order."));
    expect(names.toSorted()).toEqual([
      "hooks.order.get",
      "hooks.order.preview",
      "hooks.order.reset",
      "hooks.order.set",
    ]);
    expect(WIRE_METHODS["hooks.order.set"].stage).toBe("M4");
    expect(WIRE_METHODS["hooks.order.set"].stage).toBe(WIRE_METHODS["hooks.list"].stage);
    for (const name of names) {
      expect({ name, kind: classifyMethodName(name) }).toEqual({ name, kind: "core" });
    }
  });

  test("hooks.order.set, reset and preview params accept a valid value and reject bad ones", () => {
    const order = ["learning/review", "learning"];
    const tooLong = Array.from({ length: 257 }, (_, index) => `learning/h${index}`);
    const set = WIRE_METHODS["hooks.order.set"].params;
    expect(parse(set, { hook: "tool.call.before", order, _meta: {} }).ok).toBe(true);
    expect([
      parse(set, { hook: "tool.call.before", order, extra: 1 }).ok,
      parse(set, { hook: "tool.call.before", order: "learning" }).ok,
      parse(set, { hook: 3, order }).ok,
      parse(set, { hook: "tool.call.before", order: tooLong }).ok,
      parse(set, { hook: "tool.call.before" }).ok,
      parse(set, { hook: "", order }).ok,
    ]).toEqual([false, false, false, false, false, false]);

    const reset = WIRE_METHODS["hooks.order.reset"].params;
    expect([
      parse(reset, {}).ok,
      parse(reset, { hook: "tool.call.before" }).ok,
      parse(reset, { hook: "" }).ok,
      parse(reset, { hook: "tool.call.before", all: true }).ok,
    ]).toEqual([true, true, false, false]);

    const preview = WIRE_METHODS["hooks.order.preview"].params;
    expect(parse(preview, { hook: "tool.call.before", order }).ok).toBe(true);
    expect([
      parse(preview, { hook: "tool.call.before", order, extra: 1 }).ok,
      parse(preview, { hook: "tool.call.before", order: tooLong }).ok,
      parse(preview, { order }).ok,
    ]).toEqual([false, false, false]);

    expect([
      parse(WIRE_METHODS["hooks.order.get"].params, {}).ok,
      parse(WIRE_METHODS["hooks.order.get"].params, { hook: "tool.call.before" }).ok,
    ]).toEqual([true, false]);
  });

  test("hooks.order.get, set and reset results round trip and reject missing fields", () => {
    const ordered = {
      hook: "tool.call.before",
      saved: ["guard/a", "learning/review", "learning"],
      applied: ["guard/a", "learning/review", "learning"],
      pending: false,
    };
    const pendingHook = {
      hook: "input.user.before",
      saved: [],
      applied: ["x"],
      pending: true,
    };
    roundTrip(WIRE_METHODS["hooks.order.get"].result, { hooks: [ordered, pendingHook] });
    roundTrip(WIRE_METHODS["hooks.order.get"].result, { hooks: [] });
    const { pending: _pending, ...noPending } = ordered;
    expect(parse(WIRE_METHODS["hooks.order.get"].result, { hooks: [noPending] }).ok).toBe(false);
    // 옛 `pinned` 칸은 없다. 닫힌 객체라서 그 칸을 실은 값은 거부된다
    const withPinned = { ...ordered, pinned: ["guard/a"] };
    expect(parse(WIRE_METHODS["hooks.order.get"].result, { hooks: [withPinned] }).ok).toBe(false);

    const set = {
      hook: "tool.call.before",
      saved: ["learning/review", "learning"],
      appliesAt: "nextStepBoundary",
    };
    roundTrip(WIRE_METHODS["hooks.order.set"].result, set);
    expect(
      parse(WIRE_METHODS["hooks.order.set"].result, { hook: set.hook, saved: set.saved }).ok,
    ).toBe(false);
    expect(parse(WIRE_METHODS["hooks.order.set"].result, { ...set, appliesAt: "now" }).ok).toBe(
      false,
    );

    const reset = { hooks: ["tool.call.before"], appliesAt: "nextStepBoundary" };
    roundTrip(WIRE_METHODS["hooks.order.reset"].result, reset);
    roundTrip(WIRE_METHODS["hooks.order.reset"].result, {
      hooks: [],
      appliesAt: "nextStepBoundary",
    });
    expect(
      parse(WIRE_METHODS["hooks.order.reset"].result, { appliesAt: "nextStepBoundary" }).ok,
    ).toBe(false);
  });

  test("hooks.order.preview result round trips with guard risk notes and rejects the removed guard field", () => {
    const ref = { registrationId: "learning", extension: "learning", tier: 1 };
    const skip = {
      registrationId: "learning/review",
      extension: "learning",
      reason: "first_answer",
      by: [ref],
    };
    const valueChange = { registrationId: "guard/b", extension: "guard", by: [ref] };
    const risk = {
      registrationId: "guard/a",
      extension: "guard",
      mayBeSkipped: true,
      losesFirstPosition: true,
      by: [ref],
    };
    const withRisk = {
      hook: "tool.call.before",
      order: ["learning/review", "guard/a"],
      saveable: true,
      skips: [skip],
      valueChanges: [valueChange],
      autoDisable: [
        {
          registrationId: "learning",
          extension: "learning",
          affects: [{ registrationId: "learning/review", extension: "learning", tier: 2 }],
        },
      ],
      guardRisk: [risk],
    };
    const preview = WIRE_METHODS["hooks.order.preview"].result;
    roundTrip(preview, withRisk);
    roundTrip(preview, {
      ...withRisk,
      skips: [],
      valueChanges: [],
      autoDisable: [],
      guardRisk: [],
    });

    const { guardRisk: _risk, ...noRisk } = withRisk;
    expect(parse(preview, noRisk).ok).toBe(false);
    // 옛 `guard` 칸(규칙 위반 거절)은 없다. 닫힌 객체라서 거부한다
    expect(parse(preview, { ...withRisk, guard: null }).ok).toBe(false);
    expect(
      parse(preview, { ...withRisk, guardRisk: [{ ...risk, losesFirstPosition: "yes" }] }).ok,
    ).toBe(false);
    expect(
      parse(preview, { ...withRisk, guardRisk: [{ ...risk, mayBeSkipped: undefined }] }).ok,
    ).toBe(false);
    expect(parse(preview, { ...withRisk, skips: [{ ...skip, reason: "always_first" }] }).ok).toBe(
      false,
    );
    const fractionalTier = { ...valueChange, by: [{ ...ref, tier: 1.5 }] };
    expect(parse(preview, { ...withRisk, valueChanges: [fractionalTier] }).ok).toBe(false);
    const longSkips = Array.from({ length: 769 }, () => skip);
    expect(parse(preview, { ...withRisk, skips: longSkips }).ok).toBe(false);
  });
});

describe("M4 MCP server methods", () => {
  const connected = {
    server: "fixture",
    source: "settings:user",
    origin: "settings",
    state: "connected",
    transport: "stdio",
    toolCount: 1,
    tools: [{ name: "echo", exposed: true, declared: { readOnlyHint: true } }],
    alwaysBlocked: false,
    editable: true,
    definition: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "fixture-server"],
      env: { TOKEN: "secret://token" },
      enabled: true,
    },
  };
  const approval = {
    server: "remote",
    source: "mcpjson:project",
    origin: "mcpjson",
    state: "blocked",
    blockedReason: "approval_required",
    transport: "stdio",
    toolCount: 0,
    lastError: { code: "approval_required", message: "waiting for approval", at: 1762473600000 },
    stderrTail: ["starting"],
    hiddenTools: [{ name: "dup", reason: "name_conflict" }],
    tools: [],
    alwaysBlocked: true,
    editable: false,
  };

  test("mcp.servers result round trips rows by value and rejects bad origin, state and extra fields", () => {
    const result = WIRE_METHODS["mcp.servers"].result;
    roundTrip(result, { servers: [connected, approval] });
    roundTrip(result, { servers: [] });
    expect(parse(result, { servers: [{ ...approval, origin: "user" }] }).ok).toBe(false);
    expect(parse(result, { servers: [{ ...approval, state: "stopped" }] }).ok).toBe(false);
    expect(parse(result, { servers: [{ ...approval, blockedReason: "other" }] }).ok).toBe(false);
    expect(parse(result, { servers: [{ ...approval, guessed: true }] }).ok).toBe(false);
    expect(
      parse(result, { servers: [{ ...connected, tools: [{ name: "x", exposed: "yes" }] }] }).ok,
    ).toBe(false);
    expect(
      parse(result, {
        servers: [{ ...connected, definition: { transport: "ws", command: "npx" } }],
      }).ok,
    ).toBe(false);
  });

  test("mcp.servers takes an optional threadId and nothing else", () => {
    const params = WIRE_METHODS["mcp.servers"].params;
    roundTrip(params, {});
    roundTrip(params, { threadId: "thr_01HZX3QK0EXAMPLE" });
    expect(parse(params, { server: "fixture" }).ok).toBe(false);
  });

  test("mcp.serverAction takes a server, one of three actions and an optional thread, and answers one row", () => {
    const params = WIRE_METHODS["mcp.serverAction"].params;
    roundTrip(params, { server: "fixture", action: "restart" });
    roundTrip(params, {
      server: "fixture",
      action: "blockAlways",
      threadId: "thr_01HZX3QK0EXAMPLE",
    });
    roundTrip(params, { server: "fixture", action: "unblock" });
    // 대화별 끄기는 서버마다 없다(전체 MCP 연결 한 단위만 대화별로 끈다). 그 행동은 거절한다
    expect(parse(params, { server: "fixture", action: "disableForThread" }).ok).toBe(false);
    expect(parse(params, { server: "fixture", action: "enableForThread" }).ok).toBe(false);
    expect(parse(params, { server: "fixture", action: "disable" }).ok).toBe(false);
    expect(parse(params, { action: "restart" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["mcp.serverAction"].result, approval);
  });

  test("mcp.servers and mcp.serverAction are core methods and the unknown-server error is 3406", () => {
    expect(classifyMethodName("mcp.servers")).toBe("core");
    expect(classifyMethodName("mcp.serverAction")).toBe("core");
    expect(WIRE_ERRORS["mcp.serverNotFound"].code).toBe(3406);
    expect(WIRE_ERRORS["mcp.serverNotFound"].retryable).toBe(false);
  });
});
