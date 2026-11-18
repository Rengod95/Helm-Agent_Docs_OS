import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  createTurnRecordPort,
  type TurnRecordReadPort,
} from "../../src/assembly/measure/turn-read.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 턴 기록 읽기 처리기(`turnRecord.list`, `search`, `mark`, `findings.*`, `profileCost.get`, `testRun.compare`)의 wire 값.
// 포트는 실제 `createTurnRecordPort`에 시험이 맡은 멤버만 바꿔 끼운다. 처리기는 params를 포트 인자로 옮기고, 포트 오류를 wire 오류로 옮긴다.

/** 저장소와 계측이 없는 실제 포트의 나머지 멤버. 시험이 바꾸지 않는 멤버는 이것을 그대로 쓴다 */
const basePort = createTurnRecordPort({
  store: () => undefined,
  enabled: () => false,
  retentionDays: () => 30,
  logTurnStartedAt: () => ok(undefined),
  events: { subscribe: () => () => undefined },
  now: () => 0,
  metrics: () => ({
    minSample: 20,
    defaultWindowDays: 30,
    findingsEnabled: true,
    findingOverrides: {},
  }),
});

function portWith(overrides: Partial<TurnRecordReadPort>): TurnRecordReadPort {
  return { ...basePort, ...overrides };
}

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

test("turnRecord.list asks for the default limit of 50 with only the filters the caller sent, and answers the port's page", async () => {
  const asked: unknown[] = [];
  const page = { enabled: true, level: "full" as const, items: [], next: "42" };
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          list: (query) => {
            asked.push(query);
            return ok(page);
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const threadId = host.fake.seedThread();
  expect(await connection.request("turnRecord.list", { threadId })).toEqual(page);
  expect(
    await connection.request("turnRecord.list", {
      threadId,
      limit: 2,
      cursor: "9",
      scope: ["live"],
      flags: ["asked"],
    }),
  ).toEqual(page);
  expect(asked).toEqual([
    { threadId, limit: 50 },
    { threadId, limit: 2, cursor: "9", scope: ["live"], flags: ["asked"] },
  ]);
  await connection.close();
});

test("turnRecord.list refuses an unknown thread before the port is read, and maps the port's list errors to wire errors", async () => {
  const asked: unknown[] = [];
  let next: ReturnType<TurnRecordReadPort["list"]> = err({ kind: "invalid_cursor" });
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          list: (query) => {
            asked.push(query);
            return next;
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const unknown = fixedIdFactory(77).next("thr");
  const missing = await wireErrorOf(connection.request("turnRecord.list", { threadId: unknown }));
  expect([missing.code, missing.data.kind, missing.data.details]).toEqual([
    3001,
    "thread.notFound",
    { threadId: unknown },
  ]);
  expect(asked).toEqual([]);

  const threadId = host.fake.seedThread();
  const badCursor = await wireErrorOf(
    connection.request("turnRecord.list", { threadId, cursor: "x" }),
  );
  expect(badCursor.data.kind).toBe("jsonrpc.invalidParams");
  expect(badCursor.data.details).toEqual({
    issues: [{ path: "cursor", message: "cursor must be a next value from a previous response" }],
  });

  next = err({ kind: "store", cause: { kind: "closed" } });
  const storeDown = await wireErrorOf(connection.request("turnRecord.list", { threadId }));
  expect([storeDown.code, storeDown.data.kind, storeDown.message]).toEqual([
    5006,
    "store.io",
    "turnRecord: closed",
  ]);

  next = err({ kind: "corrupt" });
  const corrupt = await wireErrorOf(connection.request("turnRecord.list", { threadId }));
  expect([corrupt.data.kind, corrupt.message]).toEqual([
    "store.io",
    "turnRecord: stored record is not readable",
  ]);
  await connection.close();
});

test("turnRecord.search passes the defaults for the optional filters and answers the port's page, and maps invalid filters to metrics.filterInvalid", async () => {
  const asked: unknown[] = [];
  const page = {
    items: [
      {
        threadId: "thr_a",
        turnId: "trn_a",
        hookSeq: 2,
        plugin: "cap-web",
        outcome: "pass" as const,
        at: 5,
      },
    ],
    next: null,
  };
  let next: ReturnType<TurnRecordReadPort["search"]> = ok(page);
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          search: (query) => {
            asked.push(query);
            return next;
          },
        }),
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("turnRecord.search", { plugin: "cap-web", period: { days: 7 } }),
  ).toEqual(page);
  expect(
    await connection.request("turnRecord.search", {
      plugin: "cap-web",
      hook: "input.user.before",
      outcome: "pass",
      period: { from: 10, to: 20 },
      scopes: ["test"],
      cursor: "7",
      limit: 3,
    }),
  ).toEqual(page);
  expect(asked).toEqual([
    {
      plugin: "cap-web",
      hook: null,
      outcome: null,
      period: { days: 7 },
      scopes: null,
      cursor: null,
      limit: 50,
    },
    {
      plugin: "cap-web",
      hook: "input.user.before",
      outcome: "pass",
      period: { from: 10, to: 20 },
      scopes: ["test"],
      cursor: "7",
      limit: 3,
    },
  ]);

  next = err({ kind: "invalid_filter", message: "period.from must be less than period.to" });
  const backwards = await wireErrorOf(
    connection.request("turnRecord.search", { plugin: "cap-web", period: { from: 9, to: 1 } }),
  );
  expect([backwards.code, backwards.data.kind, backwards.message]).toEqual([
    3512,
    "metrics.filterInvalid",
    "period.from must be less than period.to",
  ]);
  await connection.close();
});

test("turnRecord.mark passes the thread, turn, plugin and mark to the port, answers {}, and refuses an unknown turn or thread", async () => {
  const asked: unknown[] = [];
  let next: ReturnType<TurnRecordReadPort["mark"]> = ok(true);
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          mark: (threadId, turnId, plugin, mark) => {
            asked.push([threadId, turnId, plugin, mark]);
            return next;
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const threadId = host.fake.seedThread();
  expect(
    await connection.request("turnRecord.mark", {
      threadId,
      turnId: "trn_one",
      plugin: "cap-dialog",
      mark: "followed",
    }),
  ).toEqual({});
  expect(asked).toEqual([[threadId, "trn_one", "cap-dialog", "followed"]]);

  next = err({ kind: "turn_missing" });
  const turnMissing = await wireErrorOf(
    connection.request("turnRecord.mark", {
      threadId,
      turnId: "trn_gone",
      plugin: "cap-dialog",
      mark: "not_followed",
    }),
  );
  expect([turnMissing.code, turnMissing.data.kind]).toEqual([3501, "turnRecord.turnNotFound"]);

  const unknown = fixedIdFactory(78).next("thr");
  const threadMissing = await wireErrorOf(
    connection.request("turnRecord.mark", {
      threadId: unknown,
      turnId: "trn_one",
      plugin: "cap-dialog",
      mark: "followed",
    }),
  );
  expect([threadMissing.code, threadMissing.data.kind]).toEqual([3001, "thread.notFound"]);
  // 없는 대화는 포트에 닿기 전에 거른다
  expect(asked).toHaveLength(2);
  await connection.close();
});

test("findings.list passes the empty filters as null, answers the port's list, and findings.evidence/bundle/dismiss map finding_not_found to findings.notFound", async () => {
  const asked: unknown[] = [];
  const list = {
    asOf: 1000,
    dataRevision: 4,
    findings: [],
  };
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          findingsList: (query) => {
            asked.push(query);
            return ok(list);
          },
          findingsEvidence: (findingId, cursor) => {
            asked.push(["evidence", findingId, cursor]);
            return ok({ items: [], next: null });
          },
          findingsDismiss: (findingId, until) => {
            asked.push(["dismiss", findingId, until]);
            return ok(true);
          },
          findingsBundle: (findingId) => {
            asked.push(["bundle", findingId]);
            return err({ kind: "finding_not_found" });
          },
        }),
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("findings.list", {})).toEqual(list);
  expect(
    await connection.request("findings.list", { state: "dismissed", profileId: "work" }),
  ).toEqual(list);
  expect(asked).toEqual([
    { profileId: null, period: null, state: null },
    { profileId: "work", period: null, state: "dismissed" },
  ]);

  expect(await connection.request("findings.evidence", { findingId: "f1" })).toEqual({
    items: [],
    next: null,
  });
  expect(await connection.request("findings.dismiss", { findingId: "f1" })).toEqual({});
  expect(await connection.request("findings.dismiss", { findingId: "f1", until: 500 })).toEqual({});
  expect(asked.slice(2)).toEqual([
    ["evidence", "f1", null],
    ["dismiss", "f1", null],
    ["dismiss", "f1", 500],
  ]);

  // 없는 발견은 findings.notFound(3531)다. 증거, 묶음, 해제 모두 같다
  const bundle = await wireErrorOf(connection.request("findings.bundle", { findingId: "f9" }));
  expect([bundle.code, bundle.data.kind]).toEqual([3531, "findings.notFound"]);
  await connection.close();
});

test("testRun.compare answers the port's comparison, and a thread that is not a test run is testRun.notATestRun (3312)", async () => {
  const asked: unknown[] = [];
  let next: ReturnType<TurnRecordReadPort["testRunCompare"]> = ok({
    sameInput: false,
    columns: [{ threadId: "thr_a", label: "#1", versionIds: [] }],
    rows: [],
  });
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          testRunCompare: (threadIds) => {
            asked.push(threadIds);
            return next;
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const compared = await connection.request("testRun.compare", {
    threadIds: ["thr_a", "thr_b"],
  });
  expect(compared).toEqual({
    sameInput: false,
    columns: [{ threadId: "thr_a", label: "#1", versionIds: [] }],
    rows: [],
  });
  expect(asked).toEqual([["thr_a", "thr_b"]]);

  next = err({ kind: "not_a_test_run" });
  const notTest = await wireErrorOf(
    connection.request("testRun.compare", { threadIds: ["thr_a", "thr_b"] }),
  );
  expect([notTest.code, notTest.data.kind]).toEqual([3312, "testRun.notATestRun"]);
  await connection.close();
});

test("profileCost.get asks the port with the profile's plugin names and answers the profile's rev with the port's figures", async () => {
  const asked: unknown[] = [];
  const figures = {
    profileId: "default",
    basis: "measured" as const,
    nTurns: 2,
    plugins: [
      {
        plugin: "cap-web",
        always: 120,
        drive: 0,
        onDemand: 0,
        toolCount: 4,
        basis: "measured" as const,
        shared: false,
      },
    ],
    total: {
      plugin: "total",
      always: 120,
      drive: 0,
      onDemand: 0,
      toolCount: 4,
      basis: "measured" as const,
      shared: false,
    },
  };
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          profileCost: (profileId, plugins) => {
            asked.push([profileId, plugins]);
            return ok(figures);
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const stored = await connection.request("profile.get", { id: "default" });
  const answer = await connection.request("profileCost.get", { profileId: "default" });
  expect(answer).toEqual({
    profileId: "default",
    rev: stored.profile.rev,
    basis: "measured",
    nTurns: 2,
    plugins: figures.plugins,
    total: figures.total,
  });
  expect(asked).toEqual([["default", stored.profile.plugins.map((plugin) => plugin.name)]]);

  // 없는 프로필은 기존 profile.notFound다. 포트는 부르지 않는다
  const before = asked.length;
  const missing = await wireErrorOf(connection.request("profileCost.get", { profileId: "nope" }));
  expect([missing.code, missing.data.kind, missing.data.details]).toEqual([
    3301,
    "profile.notFound",
    { id: "nope" },
  ]);
  expect(asked).toHaveLength(before);
  await connection.close();
});
