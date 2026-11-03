import { expect, test } from "bun:test";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import type { GroupStatus } from "@fresnel/contracts/services";
import type { ExtListEntry, WireMethodName } from "@fresnel/contracts/wire";
import {
  createExtReadPort,
  EMPTY_EXT_READ_SOURCES,
  type ExtReadSources,
} from "../../src/assembly/m4/ext-read-port.ts";
import { createExtReadHandlers } from "../../src/handlers/m4/ext-read.ts";
import { isNotImplemented } from "../../src/handlers/not-implemented.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { recordingEnv } from "../fixtures/hook-order-env.ts";
import {
  catalogOfTest,
  createRecordedSources,
  layersOfTest,
  record,
  ALPHA,
  TEAM,
} from "../fixtures/ext-read-sources.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// spec-deltas/t-wa.md §4: 메서드마다 host 시험. 실제 처리기 표와 연결 위에서 포트 구현을 원천 대역으로 돌린다.

const EXT_READ_METHODS: readonly WireMethodName[] = [
  "ext.list",
  "ext.get",
  "ext.reenable",
  "ext.reload",
  "ext.health",
  "ext.timings",
  "ext.bindings",
  "group.list",
  "group.metrics",
  "group.promotion",
  "group.driveLock",
  "hooks.list",
  "settings.explain",
  "hooks.order.get",
  "hooks.order.set",
  "hooks.order.reset",
  "hooks.order.preview",
];

const EMPTY_TRACE: TraceReadPort = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};
function connect(sources: ExtReadSources, traceRead: TraceReadPort = EMPTY_TRACE) {
  const port = createExtReadPort({ traceRead, env: recordingEnv().env }, sources);
  const host = createFakeHost({
    override: (table) => ({ ...table, ...createExtReadHandlers(port) }),
  });
  return host.connect().connection;
}

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const ALPHA_ENTRY: ExtListEntry = {
  name: "alpha",
  displayName: "Alpha",
  layer: "L2",
  isGroup: false,
  version: "1.2.0",
  location: "/ext/alpha",
  origin: "user",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: "user",
  status: "enabled",
  enabledSource: "user",
  plugins: [
    {
      registrationId: "alpha",
      layer: "L2",
      status: "enabled",
      inGroup: false,
      enabledSource: "user",
    },
  ],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 1,
};

test("ext-read: the 17 handlers are listed in host.hello features instead of notImplemented", async () => {
  const connection = connect(createRecordedSources().sources);
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  expect(EXT_READ_METHODS.map((name) => [name, featured.has(name)])).toEqual(
    EXT_READ_METHODS.map((name) => [name, true]),
  );
  const handlers = createExtReadHandlers(
    createExtReadPort({ traceRead: EMPTY_TRACE, env: recordingEnv().env }, EMPTY_EXT_READ_SOURCES),
  );
  expect(Object.values(handlers).map((handler) => isNotImplemented(handler))).toEqual(
    EXT_READ_METHODS.map(() => false),
  );
  await connection.close();
});

test("ext.list: rows are extensions with Registrations underneath; threadId adds the thread status and source", async () => {
  const connection = connect(createRecordedSources().sources);
  await connection.request("host.hello", HELLO_PARAMS);
  const global = await connection.request("ext.list", {});
  expect(global.extensions).toEqual([
    ALPHA_ENTRY,
    {
      name: "team",
      displayName: "team",
      layer: "L3",
      isGroup: true,
      version: "0.3.0",
      location: "/ext/team",
      origin: "user",
      requestedGrade: "user",
      effectiveGrade: "user",
      tier: "user",
      status: "enabled",
      enabledSource: "user",
      plugins: [
        {
          registrationId: "team",
          layer: "L3",
          status: "enabled",
          inGroup: true,
          enabledSource: "user",
        },
        {
          registrationId: "team/scout",
          id: "scout",
          layer: "L2",
          status: "disabled",
          inGroup: true,
          enabledSource: "user",
        },
      ],
      diagnostics: [],
      autoDisabled: false,
      safeModeExcluded: null,
      hookCount: 2,
    },
  ]);
  const inThread = await connection.request("ext.list", { threadId: "thr_known" });
  expect(inThread.extensions[1]?.plugins).toEqual([
    {
      registrationId: "team",
      layer: "L3",
      status: "enabled",
      inGroup: true,
      enabledSource: "user",
    },
    {
      registrationId: "team/scout",
      id: "scout",
      layer: "L2",
      status: "disabled",
      thread: "enabled",
      inGroup: true,
      enabledSource: "thread",
    },
  ]);
  const unknown = await failureOf(connection.request("ext.list", { threadId: "thr_missing" }));
  expect(unknown).toMatchObject({ code: 3001, data: { details: { threadId: "thr_missing" } } });
  await connection.close();
});

test("ext.list: an extension left out of safe mode carries the same cause as host.status", async () => {
  const { sources } = createRecordedSources({
    safeMode: () => ({ active: true, cause: "startupFailures" }),
    extensions: () => [record(ALPHA, { loaded: false }), record(TEAM)],
  });
  const connection = connect(sources);
  await connection.request("host.hello", HELLO_PARAMS);
  const list = await connection.request("ext.list", {});
  expect(list.extensions.map((row) => [row.name, row.status, row.safeModeExcluded])).toEqual([
    ["alpha", "disabled", "startupFailures"],
    ["team", "enabled", null],
  ]);
  await connection.close();
});

test("ext.get: hooks with budgets, manifest and Registration-level binding edges", async () => {
  const connection = connect(createRecordedSources().sources);
  await connection.request("host.hello", HELLO_PARAMS);
  const alpha = await connection.request("ext.get", { name: "alpha" });
  expect(alpha).toEqual({
    entry: ALPHA_ENTRY,
    manifest: { ...ALPHA },
    hooks: [
      { registrationId: "alpha", hook: "input.user.before", budgetClass: "chain", budgetMs: 10000 },
    ],
    bindings: [
      {
        registrationId: "alpha",
        capability: "alpha.cap",
        relation: "provides",
        peer: null,
        satisfied: true,
      },
    ],
  });
  const team = await connection.request("ext.get", { name: "team" });
  expect({ hooks: team.hooks, bindings: team.bindings }).toEqual({
    hooks: [
      { registrationId: "team", hook: "input.user.before", budgetClass: "chain", budgetMs: 10000 },
      { registrationId: "team", hook: "input.bash.before", budgetClass: "chain", budgetMs: 30000 },
    ],
    bindings: [
      {
        registrationId: "team/scout",
        capability: "alpha.cap",
        relation: "requires",
        peer: "alpha",
        satisfied: true,
      },
      {
        registrationId: "team/scout",
        capability: "ghost.cap",
        relation: "optional",
        peer: null,
        satisfied: false,
      },
    ],
  });
  const missing = await failureOf(connection.request("ext.get", { name: "nope" }));
  expect(missing).toMatchObject({
    code: 3401,
    data: { kind: "extension.notFound", details: { name: "nope" } },
  });
  await connection.close();
});

test("ext.reenable: clears the auto-disable through the source; managed lock and safe mode are refused", async () => {
  const recorded = createRecordedSources({ managedLocked: (name) => name === "team" });
  const connection = connect(recorded.sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("ext.reenable", { name: "alpha" })).toEqual({
    appliesAt: "nextStepBoundary",
    diagnostics: [],
  });
  expect(recorded.reenabled).toEqual(["alpha"]);
  const locked = await failureOf(connection.request("ext.reenable", { name: "team" }));
  expect(locked).toMatchObject({
    code: 3104,
    data: { details: { key: "ext.team.enabled", lockedBy: "managed" } },
  });
  expect(recorded.reenabled).toEqual(["alpha"]);
  await connection.close();

  const safe = createRecordedSources({ safeMode: () => ({ active: true, cause: "user" }) });
  const safeConnection = connect(safe.sources);
  await safeConnection.request("host.hello", HELLO_PARAMS);
  const refused = await failureOf(safeConnection.request("ext.reenable", { name: "alpha" }));
  expect(refused).toMatchObject({
    code: 3403,
    data: { kind: "extension.safeModeActive" },
  });
  expect(safe.reenabled).toEqual([]);
  await safeConnection.close();
});

test("ext.reload: returns the diagnostic position; refused in safe mode", async () => {
  const recorded = createRecordedSources();
  const connection = connect(recorded.sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("ext.reload", { name: "alpha" })).toEqual({
    appliesAt: "nextStepBoundary",
    diagnostics: [
      {
        severity: "warning",
        code: "unused_hook",
        message: "unused",
        file: "src/index.ts",
        line: 7,
      },
    ],
  });
  expect(recorded.reloaded).toEqual(["alpha"]);
  await connection.close();

  const safe = createRecordedSources({ safeMode: () => ({ active: true, cause: "flag" }) });
  const safeConnection = connect(safe.sources);
  await safeConnection.request("host.hello", HELLO_PARAMS);
  const refused = await failureOf(safeConnection.request("ext.reload", { name: "alpha" }));
  expect(refused).toMatchObject({ code: 3403, data: { kind: "extension.safeModeActive" } });
  expect(safe.reloaded).toEqual([]);
  await safeConnection.close();
});

test("ext.health: ledger numbers per extension, filtered by name", async () => {
  const { sources } = createRecordedSources({
    health: (name) => ({
      consecutiveFailures: name === "team" ? 4 : 0,
      windowFailures: name === "team" ? 6 : 0,
      windowCalls: name === "team" ? 9 : 0,
      windowMs: 60000,
      lastFailureAt: name === "team" ? "2026-11-02T00:00:00.000Z" : null,
      lastError: name === "team" ? "boom" : null,
    }),
    autoDisabled: (name) => name === "team",
  });
  const connection = connect(sources);
  await connection.request("host.hello", HELLO_PARAMS);
  const all = await connection.request("ext.health", {});
  expect(all.health).toEqual([
    {
      name: "alpha",
      registrationId: "alpha",
      consecutiveFailures: 0,
      windowFailures: 0,
      windowCalls: 0,
      windowMs: 60000,
      autoDisabled: false,
      lastFailureAt: null,
      lastError: null,
    },
    {
      name: "team",
      registrationId: "team",
      consecutiveFailures: 4,
      windowFailures: 6,
      windowCalls: 9,
      windowMs: 60000,
      autoDisabled: true,
      lastFailureAt: "2026-11-02T00:00:00.000Z",
      lastError: "boom",
    },
  ]);
  const one = await connection.request("ext.health", { name: "team" });
  expect(one.health.map((row) => row.name)).toEqual(["team"]);
  await connection.close();
});

test("ext.timings: empty distribution with traceEnabled false, and a populated distribution filtered to the extension", async () => {
  const empty = connect(createRecordedSources().sources);
  await empty.request("host.hello", HELLO_PARAMS);
  expect(await empty.request("ext.timings", { name: "alpha" })).toEqual({
    traceEnabled: false,
    timings: [],
  });
  await empty.close();

  const traced: TraceReadPort = {
    ...EMPTY_TRACE,
    enabled: () => true,
    timings: () => ({
      traceEnabled: true,
      timings: [
        {
          hook: "input.user.before",
          registrationId: "alpha",
          count: 10,
          p50Ms: 2,
          p95Ms: 9,
          maxMs: 12,
          failures: 1,
        },
        {
          hook: "input.user.before",
          registrationId: "team",
          count: 3,
          p50Ms: 1,
          p95Ms: 1,
          maxMs: 1,
          failures: 0,
        },
      ],
    }),
  };
  const connection = connect(createRecordedSources().sources, traced);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("ext.timings", { name: "alpha" })).toEqual({
    traceEnabled: true,
    timings: [
      {
        hook: "input.user.before",
        registrationId: "alpha",
        count: 10,
        p50Ms: 2,
        p95Ms: 9,
        maxMs: 12,
        failures: 1,
      },
    ],
  });
  await connection.close();
});

test("ext.bindings: Registration-level edges, who provides and who uses each capability", async () => {
  const connection = connect(createRecordedSources().sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("ext.bindings", {})).toEqual({
    capabilities: [
      {
        capability: "alpha.cap",
        provider: { registrationId: "alpha", version: "1.0.0" },
        consumers: [{ registrationId: "team/scout", relation: "requires" }],
        unmet: false,
      },
      {
        capability: "ghost.cap",
        provider: null,
        consumers: [{ registrationId: "team/scout", relation: "optional" }],
        unmet: false,
      },
    ],
  });
  await connection.close();
});

const TEAM_GROUP: GroupStatus = {
  id: "team",
  displayName: "Team",
  scope: "enabled",
  pendingToggle: null,
  usesDrive: true,
  drive: "holder",
  leaseId: "lease_1",
  lastError: { kind: "group.driveThrew", message: "boom", atSeq: 3 },
  recordKinds: [],
  metrics: { denies: 1, posts: 2, spawns: 3, delegates: 4, costUsd: 0.5, leaseMs: 900 },
};

test("group.list, group.metrics, group.promotion pass the group service values through", async () => {
  const full = {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    costUsd: 0.5,
    leaseMs: 900,
    leases: 5,
    denies: 1,
    chainPatches: 6,
    handlerErrors: 7,
    posts: 2,
    spawns: 3,
    delegates: 4,
    commits: 8,
    records: 9,
  };
  const { sources } = createRecordedSources({
    groups: () => [TEAM_GROUP],
    groupMetrics: (id) => Promise.resolve(id === "team" ? full : id === "quiet" ? null : undefined),
    promotion: (threadIds) =>
      Promise.resolve({
        throughSeq: 40,
        threads: threadIds?.length ?? 0,
        candidates: [{ tool: "grep", owner: "team", consumers: ["alpha"], userCalls: 3 }],
      }),
  });
  const connection = connect(sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("group.list", {})).toEqual({
    groups: [
      {
        id: "team",
        displayName: "Team",
        scope: "enabled",
        pendingToggle: null,
        usesDrive: true,
        drive: "holder",
        lastError: { kind: "group.driveThrew", message: "boom" },
        metrics: { denies: 1, posts: 2, spawns: 3, delegates: 4, costUsd: 0.5, leaseMs: 900 },
      },
    ],
  });
  expect(
    await connection.request("group.metrics", { id: "team", since: "2026-11-01T00:00:00.000Z" }),
  ).toMatchObject({
    id: "team",
    metrics: full,
    since: "2026-11-01T00:00:00.000Z",
    // 이벤트에서 접는 값(leases, leaseMs)만 since를 지킨다
    sinceIgnoredBy: expect.not.arrayContaining(["leases", "leaseMs"]),
  });
  const unfiltered = await connection.request("group.metrics", { id: "team" });
  expect(unfiltered.sinceIgnoredBy).toEqual([]);
  expect(await connection.request("group.metrics", { id: "quiet" })).toEqual({
    id: "quiet",
    metrics: null,
    since: null,
    sinceIgnoredBy: [],
  });
  const unknown = await failureOf(connection.request("group.metrics", { id: "nope" }));
  expect(unknown).toMatchObject({
    code: 3402,
    data: { kind: "group.notFound", details: { id: "nope" } },
  });
  expect(await connection.request("group.promotion", { threadIds: ["thr_a", "thr_b"] })).toEqual({
    throughSeq: 40,
    threads: 2,
    candidates: [{ tool: "grep", owner: "team", consumers: ["alpha"], userCalls: 3 }],
  });
  await connection.close();
});

test("group.promotion: an empty candidate list when the learning group is off", async () => {
  const connection = connect(createRecordedSources().sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("group.promotion", {})).toEqual({
    throughSeq: 0,
    threads: 0,
    candidates: [],
  });
  await connection.close();
});

test("group.driveLock: the drive lock holder, waiting candidates, activeDriver and the last rejection", async () => {
  const snapshot = {
    holder: "team",
    leaseEpoch: 4,
    activeDriver: "team",
    limits: { turns: 20, spawns: 5, tokens: null },
    used: { turns: 2, spawns: 0, tokens: 1500 },
    candidates: [{ registrationId: "alpha", waits: 1, waitLimit: 3 }],
    lastRejected: { groupId: "alpha", reason: "wait_limit", requestSeq: 11 },
  };
  const { sources } = createRecordedSources({ driveLock: () => Promise.resolve(snapshot) });
  const connection = connect(sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("group.driveLock", { threadId: "thr_known" })).toEqual(snapshot);
  const unknown = await failureOf(
    connection.request("group.driveLock", { threadId: "thr_missing" }),
  );
  expect(unknown).toMatchObject({ code: 3001 });
  await connection.close();
});

test("hooks.list: fold, handler count, hooking Registrations and the external marker per hook", async () => {
  const connection = connect(createRecordedSources().sources);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.list", {})).toEqual({
    hooks: [
      {
        hook: "input.bash.before",
        fold: "first",
        handlers: 1,
        registrations: ["team"],
        external: false,
        order: [
          { registrationId: "team", extension: "team", tier: 0, status: "enabled", error: null },
        ],
      },
      {
        hook: "input.user.before",
        fold: "chain",
        handlers: 2,
        registrations: ["team", "alpha"],
        external: false,
        order: [
          { registrationId: "team", extension: "team", tier: 0, status: "enabled", error: null },
          { registrationId: "alpha", extension: "alpha", tier: 1, status: "enabled", error: null },
        ],
      },
    ],
  });
  await connection.close();
});

const settingsOf = (values: { user?: number; launch?: number }): Partial<ExtReadSources> => ({
  settings: { catalog: catalogOfTest(), layers: () => layersOfTest(values) },
});

test("settings.explain: winning scope and who wrote the value (default, user, session, profile)", async () => {
  const key = "l4.host-service.maxReplayEvents";
  const ask = async (patch: Partial<ExtReadSources>) => {
    const connection = connect(createRecordedSources(patch).sources);
    await connection.request("host.hello", HELLO_PARAMS);
    const result = await connection.request("settings.explain", { key, threadId: "thr_known" });
    await connection.close();
    return result;
  };
  expect(await ask(settingsOf({}))).toEqual({
    key,
    value: 5000,
    winningScope: null,
    writer: "default",
  });
  expect(await ask(settingsOf({ user: 7000 }))).toEqual({
    key,
    value: 7000,
    winningScope: "user",
    writer: "user",
  });
  expect(await ask(settingsOf({ user: 7000, launch: 9 }))).toEqual({
    key,
    value: 9,
    winningScope: "launch",
    writer: "session",
  });
  expect(
    await ask({
      settings: {
        catalog: catalogOfTest(),
        layers: () => layersOfTest({ user: 7000 }),
        writerContext: () => ({ writer: "profile", profileId: "prof_1" }),
      },
    }),
  ).toEqual({ key, value: 7000, winningScope: "user", writer: "profile", profileId: "prof_1" });

  const connection = connect(createRecordedSources(settingsOf({})).sources);
  await connection.request("host.hello", HELLO_PARAMS);
  const unknown = await failureOf(
    connection.request("settings.explain", {
      key: "l4.host-service.nothing",
      threadId: "thr_known",
    }),
  );
  expect(unknown).toMatchObject({
    code: 3101,
    data: { details: { key: "l4.host-service.nothing" } },
  });
  await connection.close();
});

test("without sources the port reads as a host with no extensions", async () => {
  const connection = connect(EMPTY_EXT_READ_SOURCES);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("ext.list", {})).toEqual({ extensions: [] });
  expect(await connection.request("hooks.list", {})).toEqual({ hooks: [] });
  expect(await connection.request("group.list", {})).toEqual({ groups: [] });
  await connection.close();
});
