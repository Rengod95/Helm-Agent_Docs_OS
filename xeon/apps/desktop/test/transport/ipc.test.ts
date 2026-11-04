import { describe, expect, test } from "bun:test";
import {
  parseAttachResult,
  parseEngineState,
  parseRestoreReport,
  type RestoreReport,
} from "../../src/transport/ipc.ts";

const exit = { code: 1, signal: null, at: "2026-10-24T00:00:00.000Z" };

describe("engine-state-schema", () => {
  test("accepts the six shell states", () => {
    const states: unknown[] = [
      { kind: "starting", source: "sidecar", attempt: 0 },
      { kind: "running", source: "service", pid: null },
      { kind: "restarting", attempt: 1, retryAt: "2026-10-24T00:00:01.000Z", lastExit: exit },
      { kind: "stopping" },
      { kind: "failed", attempts: 3, lastExit: exit },
      { kind: "stopped" },
    ];
    for (const state of states) expect(parseEngineState(state).ok).toBe(true);
  });

  test("rejects an unknown kind and extra fields", () => {
    expect(parseEngineState({ kind: "paused" }).ok).toBe(false);
    expect(parseEngineState({ kind: "stopped", extra: 1 }).ok).toBe(false);
    expect(parseEngineState({ kind: "running", source: "sidecar", pid: 0 }).ok).toBe(false);
    expect(parseEngineState(null).ok).toBe(false);
  });

  test("attach result needs a positive epoch and a valid state", () => {
    expect(parseAttachResult({ epoch: 1, state: { kind: "stopped" } }).ok).toBe(true);
    expect(parseAttachResult({ epoch: 0, state: { kind: "stopped" } }).ok).toBe(false);
    expect(parseAttachResult({ epoch: 1, state: { kind: "nope" } }).ok).toBe(false);
  });
});

describe("restore-report-schema", () => {
  const report: RestoreReport = {
    dbPath: "/data/fresnel.db",
    backupDir: "/backups/export-1",
    blobsAdded: 3,
    missingBlobs: ["3f1a"],
    previousDir: "/data/restore-previous/20261104T000000",
    recovered: "rolled_back",
  };

  test("reads the report the CLI printed as it came", () => {
    expect(parseRestoreReport(JSON.stringify(report))).toEqual({ ok: true, value: report });
  });

  test("a null previous folder and no recovery are valid", () => {
    const fresh = { ...report, previousDir: null, recovered: null, missingBlobs: [] };
    expect(parseRestoreReport(JSON.stringify(fresh))).toEqual({ ok: true, value: fresh });
  });

  test("text that is not JSON, an unknown recovery, a missing field, and an extra field are rejected", () => {
    expect(parseRestoreReport("not json").ok).toBe(false);
    expect(parseRestoreReport(JSON.stringify({ ...report, recovered: "sideways" })).ok).toBe(false);
    expect(parseRestoreReport(JSON.stringify({ ...report, blobsAdded: -1 })).ok).toBe(false);
    expect(parseRestoreReport(JSON.stringify({ ...report, extra: true })).ok).toBe(false);
    const missing = {
      dbPath: report.dbPath,
      backupDir: report.backupDir,
      blobsAdded: 0,
      missingBlobs: [],
      previousDir: null,
    };
    expect(parseRestoreReport(JSON.stringify(missing)).ok).toBe(false);
  });
});
