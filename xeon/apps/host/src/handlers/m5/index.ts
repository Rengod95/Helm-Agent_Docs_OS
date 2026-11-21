import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { wireError, type WireError, type WireHandler } from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../../connection-types.ts";
import type { Engine } from "../../types.ts";
import type { TurnReadError } from "../../assembly/measure/turn-read.ts";
import { wireErrorOfStore } from "../../store-error.ts";

// M5d 턴 기록과 지표의 처리기(문서 `review/m5/turn-record-metrics.md` §3.5, §3.8). 읽기 포트는 `engine.ports.measure.turnRecord`다.
// 계측이 꺼졌거나 저장소를 열지 못한 것은 오류가 아니다(`enabled`, `level`로 낸다). 없는 대화는 `thread.notFound`(3001)다.
// 구독(`turnRecord.watch`, `unwatch`)은 연결의 `turnWatches`에 둔다. 알림 `turnRecord.delta`는 `watch.ts`가 보낸다.
// 지난 턴에 돌려 보기(`backtest.*`)는 이 표에 없다. `m5/backtest.ts`의 `createBacktestHandlers`가 채우고 `handlers/index.ts`가 합친다.

/** 포트의 실패 값을 wire 오류로 옮긴다. 같은 kind는 같은 오류다 */
function wireErrorOfTurnRead(error: TurnReadError): WireError {
  switch (error.kind) {
    case "store":
      return wireError("store.io", { message: `turnRecord: ${error.cause.kind}` });
    case "corrupt":
      return wireError("store.io", { message: "turnRecord: stored record is not readable" });
    case "invalid_cursor":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [
            { path: "cursor", message: "cursor must be a next value from a previous response" },
          ],
        },
      });
    case "invalid_filter":
      return wireError("metrics.filterInvalid", { message: error.message });
    case "unknown_metric":
      return wireError("metrics.unknownMetric", { message: error.id });
    case "turn_missing":
      return wireError("turnRecord.turnNotFound", { message: "no such turn in the log" });
    case "log_read":
      return wireError("store.io", { message: `turnRecord log: ${error.reason}` });
    case "finding_not_found":
      return wireError("findings.notFound", { message: "no such finding in the latest result" });
    case "not_a_test_run":
      return wireError("testRun.notATestRun");
    default:
      return assertNever(error);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled turn read error: ${JSON.stringify(value)}`);
}

/** 동기 처리기의 결과를 Promise로 싼다. 던지는 오류는 호출 시점에 던진다(measure.ts와 같다) */
function done<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

export function createM5Handlers(
  engine: Engine,
  hub: () => ConnectionHub,
): {
  readonly "turnRecord.list": WireHandler<"turnRecord.list">;
  readonly "turnRecord.get": WireHandler<"turnRecord.get">;
  readonly "turnRecord.recent": WireHandler<"turnRecord.recent">;
  readonly "turnRecord.search": WireHandler<"turnRecord.search">;
  readonly "turnRecord.mark": WireHandler<"turnRecord.mark">;
  readonly "turnRecord.watch": WireHandler<"turnRecord.watch">;
  readonly "turnRecord.unwatch": WireHandler<"turnRecord.unwatch">;
  readonly "metrics.catalog": WireHandler<"metrics.catalog">;
  readonly "metrics.query": WireHandler<"metrics.query">;
  readonly "findings.list": WireHandler<"findings.list">;
  readonly "findings.evidence": WireHandler<"findings.evidence">;
  readonly "findings.dismiss": WireHandler<"findings.dismiss">;
  readonly "findings.bundle": WireHandler<"findings.bundle">;
  readonly "profileCost.get": WireHandler<"profileCost.get">;
  readonly "testRun.compare": WireHandler<"testRun.compare">;
} {
  const { threads, m4 } = engine.ports;
  const port = engine.ports.measure.turnRecord;

  /** 대화가 있는지 본다. 모양이 틀린 id도 없는 대화와 같다(3001) */
  function requireThread(raw: string): void {
    const threadId = parse(ThreadIdSchema, raw);
    if (!threadId.ok) throw wireError("thread.notFound", { details: { threadId: raw } });
    const exists = threads.exists(threadId.value);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "turnRecord thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId: raw } });
  }

  return {
    "turnRecord.list": (params) => {
      requireThread(params.threadId);
      const out = port.list({
        threadId: params.threadId,
        limit: params.limit ?? 50,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.scope === undefined ? {} : { scope: params.scope }),
        ...(params.flags === undefined ? {} : { flags: params.flags }),
      });
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "turnRecord.recent": (params) => {
      const out = port.recent({
        from: params.from ?? null,
        to: params.to ?? null,
        profileId: params.profileId ?? null,
        plugin: params.plugin ?? null,
        scopes: params.scopes ?? null,
        cursor: params.cursor ?? null,
        limit: params.limit ?? 50,
        titleOf: (raw) => {
          const threadId = parse(ThreadIdSchema, raw);
          if (!threadId.ok) return ok(undefined);
          const found = threads.titleOf(threadId.value);
          if (!found.ok) return err({ kind: "store", cause: { kind: "io", cause: found.error } });
          return ok(found.value);
        },
      });
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "turnRecord.get": (params) => {
      requireThread(params.threadId);
      const out = port.get(params.threadId, params.turnId);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "turnRecord.watch": (params, context) => {
      requireThread(params.threadId);
      const conn = hub().state(context.connectionId);
      if (conn === undefined) throw wireError("request.cancelled");
      const sub = conn.nextSubId();
      conn.turnWatches.set(sub, { sub, threadId: params.threadId });
      return done({ sub, level: port.status().level });
    },

    "turnRecord.unwatch": (params, context) => {
      // 모르는 구독은 오류가 아니다. 연결이 이미 없으면 가진 구독도 없다
      hub().state(context.connectionId)?.turnWatches.delete(params.sub);
      return done({});
    },

    "turnRecord.search": (params) => {
      const out = port.search({
        plugin: params.plugin,
        hook: params.hook ?? null,
        outcome: params.outcome ?? null,
        period: params.period,
        scopes: params.scopes ?? null,
        cursor: params.cursor ?? null,
        limit: params.limit ?? 50,
      });
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "turnRecord.mark": (params) => {
      requireThread(params.threadId);
      const out = port.mark(params.threadId, params.turnId, params.plugin, params.mark);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done({});
    },

    "metrics.catalog": () => done({ metrics: port.catalog() }),

    "metrics.query": (params) => {
      if (params.groupBy?.includes("pluginVersion") === true) {
        throw wireError("metrics.filterInvalid", {
          message: "grouping by pluginVersion is not computed yet",
        });
      }
      const out = port.metrics({
        metrics: params.metrics,
        filter: params.filter,
        groupBy: params.groupBy ?? [],
        compare: params.compare ?? null,
      });
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done({ window: out.value.window, rows: out.value.rows, notes: out.value.notes });
    },

    "findings.list": (params) => {
      const out = port.findingsList({
        profileId: params.profileId ?? null,
        period: params.period ?? null,
        state: params.state ?? null,
      });
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "findings.evidence": (params) => {
      const out = port.findingsEvidence(params.findingId, params.cursor ?? null);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "findings.dismiss": (params) => {
      const out = port.findingsDismiss(params.findingId, params.until ?? null);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done({});
    },

    "findings.bundle": (params) => {
      const out = port.findingsBundle(params.findingId);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },

    "profileCost.get": async (params) => {
      // 프로필이 없으면 기존 profile.notFound다. 턴이 없는 프로필은 정적 추정 칸(null)으로 돌려준다
      const profile = await m4.profileTestRun.get(params.profileId);
      if (!profile.ok) {
        if (profile.error.kind === "not_found") {
          throw wireError("profile.notFound", { details: { id: params.profileId } });
        }
        throw wireError("store.io", { message: `profileCost.get: ${profile.error.kind}` });
      }
      const out = port.profileCost(
        params.profileId,
        profile.value.plugins.map((plugin) => plugin.name),
      );
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return {
        profileId: params.profileId,
        rev: profile.value.rev,
        basis: out.value.basis,
        nTurns: out.value.nTurns,
        plugins: out.value.plugins,
        total: out.value.total,
      };
    },

    "testRun.compare": (params) => {
      const out = port.testRunCompare(params.threadIds);
      if (!out.ok) throw wireErrorOfTurnRead(out.error);
      return done(out.value);
    },
  };
}
