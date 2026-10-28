import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../src/base/index.ts";
import {
  ARTIFACT_EVENT_CATALOG,
  EVENT_CATALOG,
  SCHEDULE_EVENT_CATALOG,
  ownerOfKind,
  type CatalogEntry,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

// M3-REQ-14. L2.artifacts.spec §3.6, L2.schedule.spec §3.7의 payload 값 왕복과 문서 표 대조.
const local = (prefix: string, n: number): string => `${prefix}_${rawId("thr", n).slice(4)}`;
const SHA = "a".repeat(64);
const blob = { type: "blob", sha256: SHA, size: 10, mediaType: null };
const art = local("art", 1);
const rvw = local("rvw", 2);
const cmt = local("cmt", 3);
const lop = local("lop", 4);
const wak = local("wak", 5);
const tmr = local("tmr", 6);
const wch = local("wch", 7);

const SAMPLES: Record<string, Record<string, unknown>> = {
  "artifact.registered": {
    artifactId: art,
    kind: "markdown",
    title: "t",
    version: 1,
    content: blob,
    sourcePath: null,
    meta: { a: [1] },
    turnId: rawId("trn", 1),
    toolCallId: null,
    producer: "user",
  },
  "artifact.updated": {
    artifactId: art,
    version: 2,
    baseVersion: 1,
    title: null,
    content: blob,
    sourcePath: "a.md",
    meta: null,
  },
  "artifact.archived": { artifactId: art, reason: "retention" },
  "artifact.review_opened": {
    reviewId: rvw,
    artifactId: art,
    title: "r",
    basis: { type: "checkpoint", checkpointId: rawId("ckp", 1), paths: null },
    diff: blob,
    files: [
      {
        fileIndex: 0,
        path: "a.ts",
        oldPath: null,
        change: "modified",
        binary: false,
        hunks: [
          {
            hunkId: "f0h0",
            header: "@@ -1 +1 @@",
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            patchSha256: SHA,
          },
        ],
      },
    ],
    deliverAs: "followUp",
    approvalId: null,
  },
  "artifact.review_decided": {
    reviewId: rvw,
    round: 1,
    decisions: [{ hunkId: "f0h0", decision: "rejected" }],
    by: "user",
  },
  "artifact.review_commented": {
    reviewId: rvw,
    round: 1,
    commentId: cmt,
    target: { type: "hunk", hunkId: "f0h0", line: { side: "new", number: 3 } },
    body: "x",
    by: "remote",
  },
  "artifact.review_applied": {
    reviewId: rvw,
    round: 1,
    outcomes: [{ path: "a.ts", hunkIds: ["f0h0"], result: "reverted", method: "workspace_files" }],
  },
  "artifact.review_submitted": {
    reviewId: rvw,
    round: 1,
    delivery: { requestId: "review:x", when: "steer", commentIds: [cmt] },
  },
  "artifact.review_closed": { reviewId: rvw, reason: "done" },
  "artifact.session_labeled": { labels: ["a", "b"] },
  "artifact.handoff_sent": {
    handoffId: local("hof", 8),
    toThreadId: rawId("thr", 2),
    package: blob,
  },
  "artifact.handoff_received": {
    handoffId: local("hof", 8),
    fromThreadId: rawId("thr", 1),
    fromLeafEventId: rawId("evt", 1),
    package: blob,
  },
  "schedule.loop_started": {
    loopId: lop,
    prompt: "p",
    until: { type: "shell", command: "true", cwd: null, successExitCode: 0, timeoutSeconds: 5 },
    interval: { type: "self" },
    maxIterations: 10,
    expiresAt: 1_700_000_000_000,
    goalId: null,
    startedBy: "grp.helm",
  },
  "schedule.loop_iterated": { loopId: lop, iteration: 1, requestId: "r" },
  "schedule.loop_stopped": { loopId: lop, reason: "max_iterations", iterations: 3, detail: null },
  "schedule.wakeup_scheduled": {
    wakeupId: wak,
    dueAt: 1,
    prompt: "p",
    loopId: lop,
    toolCallId: null,
    replaces: null,
  },
  "schedule.wakeup_fired": { wakeupId: wak, requestId: "r", firedAt: 2 },
  "schedule.wakeup_cancelled": { wakeupId: wak, reason: "replaced" },
  "schedule.timer_created": {
    timerId: tmr,
    spec: { type: "cron", expr: "0 9 * * *", tz: "Asia/Seoul" },
    title: null,
    missed: "once",
  },
  "schedule.timer_cancelled": { timerId: tmr },
  "schedule.run_started": {
    timerId: tmr,
    dueAt: 1,
    firedAt: 2,
    missed: false,
    origin: "timer",
    requestId: `timer:${tmr}:1`,
  },
  "schedule.run_stalled": { timerId: tmr, dueAt: 1, idleSeconds: 60 },
  "schedule.run_finished": { timerId: tmr, dueAt: 1, outcome: "awaiting_approval" },
  "schedule.watch_started": {
    watchId: wch,
    source: { type: "process" },
    filter: { regex: "x" },
    notify: "next",
    maxMatches: 3,
  },
  "schedule.watch_matched": { watchId: wch, match: 1, requestId: "r", excerpt: "x" },
  "schedule.watch_stopped": { watchId: wch, reason: "source_ended" },
  "schedule.remote_responded": {
    approvalId: "apr_1",
    clientId: "c1",
    decision: "allow",
    remember: null,
  },
};

const ENTRIES: readonly CatalogEntry[] = [...ARTIFACT_EVENT_CATALOG, ...SCHEDULE_EVENT_CATALOG];

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("artifact and schedule catalogs (M3-REQ-14)", () => {
  test("12 artifact and 15 schedule kinds, all durable v1, merged into EVENT_CATALOG", () => {
    expect(ARTIFACT_EVENT_CATALOG.length).toBe(12);
    expect(SCHEDULE_EVENT_CATALOG.length).toBe(15);
    for (const entry of ENTRIES) {
      expect(entry.durable).toBe(true);
      expect(entry.version).toBe(1);
      expect(EVENT_CATALOG).toContain(entry);
    }
    expect(Object.keys(SAMPLES).toSorted()).toEqual(ENTRIES.map((e) => e.kind).toSorted());
  });

  test("owners follow the type prefix", () => {
    for (const entry of ARTIFACT_EVENT_CATALOG)
      expect(ownerOfKind(entry.kind)).toBe("cap.artifacts");
    for (const entry of SCHEDULE_EVENT_CATALOG)
      expect(ownerOfKind(entry.kind)).toBe("cap.schedule");
  });

  for (const entry of ENTRIES) {
    test(`${entry.kind}: value round trip, unknown key and missing field are rejected`, () => {
      const sample = SAMPLES[entry.kind] ?? {};
      const result = parse(entry.payload, roundTrip(sample));
      expect(result.ok ? result.value : undefined).toEqual(sample);
      expect(parse(entry.payload, { ...sample, extra: 1 }).ok).toBe(false);
      const first = Object.keys(sample)[0];
      if (first !== undefined) {
        const { [first]: _dropped, ...rest } = sample;
        expect(parse(entry.payload, rest).ok).toBe(false);
      }
    });
  }

  test("bad ids and enum values are rejected", () => {
    const archived = ENTRIES.find((e) => e.kind === "artifact.archived");
    const timer = ENTRIES.find((e) => e.kind === "schedule.run_started");
    expect(parse(archived?.payload ?? {}, { artifactId: "art_x", reason: "user" }).ok).toBe(false);
    expect(parse(archived?.payload ?? {}, { artifactId: art, reason: "other" }).ok).toBe(false);
    expect(
      parse(timer?.payload ?? {}, { ...SAMPLES["schedule.run_started"], origin: "user" }).ok,
    ).toBe(false);
  });
});

const SPECS: readonly { area: string; file: string; catalog: readonly CatalogEntry[] }[] = [
  { area: "artifact", file: "L2/artifacts/spec.md", catalog: ARTIFACT_EVENT_CATALOG },
  { area: "schedule", file: "L2/schedule/spec.md", catalog: SCHEDULE_EVENT_CATALOG },
];

describe("catalog doc tables", () => {
  for (const { area, file, catalog } of SPECS) {
    const path = join(import.meta.dir, "../../../../../docs/xeon", file);
    test.skipIf(!existsSync(path))(`${area} table kind and durable columns match the code`, () => {
      const text = readFileSync(path, "utf8");
      const start = text.indexOf(`<!-- catalog:${area}:start -->`);
      const end = text.indexOf(`<!-- catalog:${area}:end -->`);
      expect(start).toBeGreaterThan(-1);
      const rows = text
        .slice(start, end)
        .split("\n")
        .map((line) => /^\| `([a-z_.]+)` \| (예|아니오) \|/.exec(line))
        .filter((match) => match !== null)
        .map((match) => ({ kind: match[1], durable: match[2] === "예" }));
      expect(rows).toEqual(catalog.map((e) => ({ kind: e.kind, durable: e.durable })));
    });
  }
});
