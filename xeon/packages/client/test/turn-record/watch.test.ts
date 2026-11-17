import { describe, expect, test } from "bun:test";
import type { TurnRecordDeltaParams } from "@fresnel/contracts/wire";
import { fakeConnection } from "../settings/fixtures.ts";
import { watchTurnRecord } from "../../src/turn-record/index.ts";
import { deltaNotice } from "./fixtures.ts";

describe("watchTurnRecord", () => {
  test("delivers this subscription's deltas and skips the deltas of another subscription", async () => {
    const received: TurnRecordDeltaParams[] = [];
    const host = fakeConnection({
      "turnRecord.watch": () => Promise.resolve({ sub: "sub_1", level: "full" }),
    });
    const watched = await watchTurnRecord(host.connection, "thr_1", (params) => {
      received.push(params);
    });
    expect(watched.ok && watched.value.sub).toBe("sub_1");
    expect(watched.ok && watched.value.level).toBe("full");
    expect(host.calls).toEqual([{ method: "turnRecord.watch", params: { threadId: "thr_1" } }]);

    host.emit(
      "turnRecord.delta",
      deltaNotice("sub_1", "trn_1", [{ kind: "turn", status: "completed", complete: true }]),
    );
    host.emit("turnRecord.delta", deltaNotice("sub_2", "trn_1", []));
    expect(received).toEqual([
      deltaNotice("sub_1", "trn_1", [{ kind: "turn", status: "completed", complete: true }]),
    ]);
  });

  test("deltas that arrive before the watch answer are delivered after it, for this subscription only", async () => {
    const received: TurnRecordDeltaParams[] = [];
    const host = fakeConnection({
      "turnRecord.watch": () => {
        host.emit("turnRecord.delta", deltaNotice("sub_1", "trn_early"));
        host.emit("turnRecord.delta", deltaNotice("sub_9", "trn_other"));
        return Promise.resolve({ sub: "sub_1", level: "full" });
      },
    });
    await watchTurnRecord(host.connection, "thr_1", (params) => {
      received.push(params);
    });
    expect(received.map((params) => params.turnId)).toEqual(["trn_early"]);
  });

  test("unwatch stops delivery and sends turnRecord.unwatch once", async () => {
    const received: TurnRecordDeltaParams[] = [];
    const host = fakeConnection({
      "turnRecord.watch": () => Promise.resolve({ sub: "sub_1", level: "full" }),
      "turnRecord.unwatch": () => Promise.resolve({}),
    });
    const watched = await watchTurnRecord(host.connection, "thr_1", (params) => {
      received.push(params);
    });
    if (!watched.ok) throw new Error("watch should succeed");

    expect(await watched.value.unwatch()).toEqual({ ok: true, value: undefined });
    expect(await watched.value.unwatch()).toEqual({ ok: true, value: undefined });
    host.emit("turnRecord.delta", deltaNotice("sub_1", "trn_1"));

    expect(received).toEqual([]);
    expect(host.calls.filter((call) => call.method === "turnRecord.unwatch")).toEqual([
      { method: "turnRecord.unwatch", params: { sub: "sub_1" } },
    ]);
  });

  test("a failed unwatch returns its failure and still stops delivery", async () => {
    const received: TurnRecordDeltaParams[] = [];
    const host = fakeConnection({
      "turnRecord.watch": () => Promise.resolve({ sub: "sub_1", level: "full" }),
      "turnRecord.unwatch": () => Promise.reject(new Error("closed")),
    });
    const watched = await watchTurnRecord(host.connection, "thr_1", (params) => {
      received.push(params);
    });
    if (!watched.ok) throw new Error("watch should succeed");

    const released = await watched.value.unwatch();
    expect(released).toEqual({
      ok: false,
      error: { kind: "transport", cause: new Error("closed") },
    });
    host.emit("turnRecord.delta", deltaNotice("sub_1", "trn_1"));
    expect(received).toEqual([]);
  });

  test("a failed watch returns the failure and delivers nothing", async () => {
    const received: TurnRecordDeltaParams[] = [];
    const host = fakeConnection({
      "turnRecord.watch": () => Promise.reject(new Error("closed")),
    });
    const watched = await watchTurnRecord(host.connection, "thr_1", (params) => {
      received.push(params);
    });
    expect(watched).toEqual({
      ok: false,
      error: { kind: "transport", cause: new Error("closed") },
    });
    host.emit("turnRecord.delta", deltaNotice("sub_1", "trn_1"));
    expect(received).toEqual([]);
  });
});
