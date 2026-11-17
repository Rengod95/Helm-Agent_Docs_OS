import { describe, expect, test } from "bun:test";
import type { Result } from "@fresnel/contracts";
import { wireError } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import {
  dismissFinding,
  getTurnRecord,
  listAllTurnRecords,
  listTurnRecords,
  markTurnRecord,
  metricsCatalog,
  turnRecordFailureOf,
} from "../../src/turn-record/index.ts";
import { summaryOf } from "./fixtures.ts";

/** 성공이 아니면 시험을 실패시킨다 */
function okValue<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("turnRecordFailureOf", () => {
  test("the four named wire codes map to their own kinds", () => {
    expect(turnRecordFailureOf(wireError("turnRecord.turnNotFound"))).toEqual({
      kind: "turnNotFound",
    });
    expect(turnRecordFailureOf(wireError("metrics.unknownMetric"))).toEqual({
      kind: "unknownMetric",
    });
    expect(turnRecordFailureOf(wireError("metrics.filterInvalid"))).toEqual({
      kind: "filterInvalid",
    });
    expect(turnRecordFailureOf(wireError("findings.notFound"))).toEqual({
      kind: "findingNotFound",
    });
  });

  test("another wire error is a host failure that keeps the error, and a non-wire cause is transport", () => {
    const other = wireError("profile.notFound");
    expect(turnRecordFailureOf(other)).toEqual({ kind: "host", error: other });
    const cause = new Error("closed");
    expect(turnRecordFailureOf(cause)).toEqual({ kind: "transport", cause });
  });
});

describe("readers", () => {
  test("a reader sends its method and params and returns the host answer", async () => {
    const host = fakeConnection({
      "turnRecord.get": () =>
        Promise.resolve({ enabled: true, level: "full", record: null, absent: "purged" }),
    });
    const result = await getTurnRecord(host.connection, { threadId: "thr_1", turnId: "trn_1" });
    expect(result).toEqual({
      ok: true,
      value: { enabled: true, level: "full", record: null, absent: "purged" },
    });
    expect(host.calls).toEqual([
      { method: "turnRecord.get", params: { threadId: "thr_1", turnId: "trn_1" } },
    ]);
  });

  test("metrics.catalog sends an empty params object", async () => {
    const host = fakeConnection({
      "metrics.catalog": () => Promise.resolve({ metrics: [] }),
    });
    expect(await metricsCatalog(host.connection)).toEqual({ ok: true, value: { metrics: [] } });
    expect(host.calls).toEqual([{ method: "metrics.catalog", params: {} }]);
  });

  test("a turn that is not in the log reads as turnNotFound", async () => {
    const host = fakeConnection({
      "turnRecord.get": () => Promise.reject(wireError("turnRecord.turnNotFound")),
    });
    const result = await getTurnRecord(host.connection, { threadId: "thr_1", turnId: "trn_9" });
    expect(result).toEqual({ ok: false, error: { kind: "turnNotFound" } });
  });

  test("a dismiss or mark answers with the empty value", async () => {
    const host = fakeConnection({
      "findings.dismiss": () => Promise.resolve({}),
      "turnRecord.mark": () => Promise.resolve({}),
    });
    expect(await dismissFinding(host.connection, { findingId: "f_1" })).toEqual({
      ok: true,
      value: {},
    });
    expect(
      await markTurnRecord(host.connection, {
        threadId: "thr_1",
        turnId: "trn_1",
        plugin: "notes",
        mark: "followed",
      }),
    ).toEqual({ ok: true, value: {} });
    expect(host.calls.map((call) => call.method)).toEqual(["findings.dismiss", "turnRecord.mark"]);
  });

  test("a closed connection reads as a transport failure with the cause", async () => {
    const cause = new Error("closed");
    const host = fakeConnection({
      "turnRecord.list": () => Promise.reject(cause),
    });
    const result = await listTurnRecords(host.connection, { threadId: "thr_1" });
    expect(result).toEqual({ ok: false, error: { kind: "transport", cause } });
  });
});

/** `turnRecord.list` 한 쪽의 응답 */
function pageOf(turnIds: readonly string[], next: string | null) {
  return {
    enabled: true,
    level: "full" as const,
    items: turnIds.map((turnId) => summaryOf(turnId)),
    next,
  };
}

function turnIdsOf(
  result: Result<{ readonly items: readonly { readonly turnId: string }[] }, unknown>,
): string[] {
  return okValue(result).items.map((item) => item.turnId);
}

describe("listAllTurnRecords", () => {
  test("follows the cursor to the last page and keeps the order of the items", async () => {
    const host = fakeConnection({
      "turnRecord.list": (params) => {
        if (params.cursor === undefined) return Promise.resolve(pageOf(["trn_1"], "c2"));
        if (params.cursor === "c2") return Promise.resolve(pageOf(["trn_2"], "c3"));
        return Promise.resolve(pageOf(["trn_3"], null));
      },
    });
    const result = await listAllTurnRecords(
      host.connection,
      { threadId: "thr_1" },
      { maxPages: 10, deadlineMs: 1000, now: () => 0 },
    );
    expect(turnIdsOf(result)).toEqual(["trn_1", "trn_2", "trn_3"]);
    expect(okValue(result).truncated).toBeNull();
    expect(host.calls.map((call) => call.params)).toEqual([
      { threadId: "thr_1" },
      { threadId: "thr_1", cursor: "c2" },
      { threadId: "thr_1", cursor: "c3" },
    ]);
  });

  test("stops at the page cap and says it was cut at the pages", async () => {
    const host = fakeConnection({
      "turnRecord.list": (params) =>
        Promise.resolve(
          params.cursor === undefined
            ? pageOf(["trn_1"], "c2")
            : params.cursor === "c2"
              ? pageOf(["trn_2"], "c3")
              : pageOf(["trn_3"], null),
        ),
    });
    const result = await listAllTurnRecords(
      host.connection,
      { threadId: "thr_1" },
      { maxPages: 2, deadlineMs: 1000, now: () => 0 },
    );
    expect(turnIdsOf(result)).toEqual(["trn_1", "trn_2"]);
    expect(okValue(result).truncated).toBe("pages");
    expect(host.calls).toHaveLength(2);
  });

  test("stops before the next page once the deadline has passed and says it was cut at the deadline", async () => {
    let clock = 0;
    const host = fakeConnection({
      "turnRecord.list": (params) => {
        clock += 50;
        return Promise.resolve(
          params.cursor === undefined ? pageOf(["trn_1"], "c2") : pageOf(["trn_2"], "c3"),
        );
      },
    });
    const result = await listAllTurnRecords(
      host.connection,
      { threadId: "thr_1" },
      { maxPages: 10, deadlineMs: 75, now: () => clock },
    );
    expect(turnIdsOf(result)).toEqual(["trn_1", "trn_2"]);
    expect(okValue(result).truncated).toBe("deadline");
    expect(host.calls).toHaveLength(2);
  });

  test("a failed page fails the whole read", async () => {
    const host = fakeConnection({
      "turnRecord.list": (params) =>
        params.cursor === undefined
          ? Promise.resolve(pageOf(["trn_1"], "c2"))
          : Promise.reject(new Error("closed")),
    });
    const result = await listAllTurnRecords(
      host.connection,
      { threadId: "thr_1" },
      { maxPages: 10, deadlineMs: 1000, now: () => 0 },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "transport", cause: new Error("closed") },
    });
  });

  test("a single page keeps every summary field", async () => {
    const host = fakeConnection({
      "turnRecord.list": () => Promise.resolve(pageOf(["trn_1"], null)),
    });
    const result = await listTurnRecords(host.connection, { threadId: "thr_1" });
    expect(result).toEqual({
      ok: true,
      value: { enabled: true, level: "full", items: [summaryOf("trn_1")], next: null },
    });
  });
});
