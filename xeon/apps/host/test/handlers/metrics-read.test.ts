import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import {
  createTurnRecordPort,
  type TurnRecordReadPort,
} from "../../src/assembly/measure/turn-read.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 지표 처리기(`metrics.catalog`, `metrics.query`)의 wire 값. 포트는 실제 `createTurnRecordPort`에 `metrics` 멤버만 바꿔 끼운다.
// 처리기는 `pluginVersion` 묶기를 포트에 닿기 전에 3512로 막고, 포트 결과의 창·행·주의만 돌려준다.

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

test("metrics.catalog answers the port's definitions, and hook.runs is the count of hook runs with its unit and kind", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const catalog = await connection.request("metrics.catalog", {});
  expect(Object.keys(catalog)).toEqual(["metrics"]);
  expect(catalog.metrics.find((metric) => metric.id === "hook.runs")).toEqual({
    id: "hook.runs",
    label: { ko: "훅 실행 수", en: "Hook runs" },
    unit: "runs",
    kind: "count",
    appliesTo: ["hook"],
    feasible: "exact",
    definitionNote: null,
  });
  await connection.close();
});

test("metrics.query passes the default group and compare as [] and null, answers the window, rows and notes of the port, and drops the rest", async () => {
  const asked: unknown[] = [];
  const answer = {
    window: { from: 100, to: 200 },
    rows: [
      {
        key: { model: "tape-1" },
        values: { "hook.runs": { value: 26, n: 26, state: "exact" as const } },
      },
    ],
    notes: [{ metric: "hook.runs", code: "partial_window" as const, text: null }],
  };
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          metrics: (query) => {
            asked.push(query);
            return ok(answer);
          },
        }),
      },
    },
  });
  const connection = await open(host);
  const plain = await connection.request("metrics.query", {
    metrics: ["hook.runs"],
    filter: { period: { days: 7 } },
  });
  expect(plain).toEqual(answer);
  const grouped = await connection.request("metrics.query", {
    metrics: ["hook.runs"],
    filter: { plugin: "cap-web", period: { from: 1, to: 2 } },
    groupBy: ["model"],
    compare: { by: "model", a: "tape-1", b: "tape-2" },
  });
  expect(grouped).toEqual(answer);
  expect(asked).toEqual([
    {
      metrics: ["hook.runs"],
      filter: { period: { days: 7 } },
      groupBy: [],
      compare: null,
    },
    {
      metrics: ["hook.runs"],
      filter: { plugin: "cap-web", period: { from: 1, to: 2 } },
      groupBy: ["model"],
      compare: { by: "model", a: "tape-1", b: "tape-2" },
    },
  ]);
  await connection.close();
});

test("metrics.query refuses grouping by pluginVersion before the port is read, and maps the port's unknown metric and filter errors", async () => {
  const asked: unknown[] = [];
  let next: ReturnType<TurnRecordReadPort["metrics"]> = err({
    kind: "unknown_metric",
    id: "nope.metric",
  });
  const host = createFakeHost({
    overrides: {
      measure: {
        turnRecord: portWith({
          metrics: (query) => {
            asked.push(query);
            return next;
          },
        }),
      },
    },
  });
  const connection = await open(host);

  const byVersion = await wireErrorOf(
    connection.request("metrics.query", {
      metrics: ["hook.runs"],
      filter: { period: { days: 7 } },
      groupBy: ["pluginVersion"],
    }),
  );
  expect([byVersion.code, byVersion.data.kind, byVersion.message]).toEqual([
    3512,
    "metrics.filterInvalid",
    "grouping by pluginVersion is not computed yet",
  ]);
  expect(asked).toEqual([]);

  const unknown = await wireErrorOf(
    connection.request("metrics.query", {
      metrics: ["nope.metric"],
      filter: { period: { days: 7 } },
    }),
  );
  expect([unknown.code, unknown.data.kind, unknown.message]).toEqual([
    3511,
    "metrics.unknownMetric",
    "nope.metric",
  ]);

  next = err({ kind: "invalid_filter", message: "compare by profileRev needs filter.profileId" });
  const needsProfile = await wireErrorOf(
    connection.request("metrics.query", {
      metrics: ["hook.runs"],
      filter: { period: { days: 7 } },
      compare: { by: "profileRev", a: "1", b: "2" },
    }),
  );
  expect([needsProfile.code, needsProfile.message]).toEqual([
    3512,
    "compare by profileRev needs filter.profileId",
  ]);
  await connection.close();
});
