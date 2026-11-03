import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, type Logger } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { startMeasurement } from "../../../src/assembly/measure/recorder.ts";
import { openMeasureStore } from "../../../src/assembly/measure/store.ts";

// T-MEAS-CALL·HOOK·CTX·CACHE: 기록기는 모델 호출, 핸들러 결과, 요청 구성, 캐시 사건을 같은 저장소에 다른 kind로 쓴다.
// 쓰기는 대화 커밋(turn.completed) 뒤에 한 묶음으로 하고, 꺼져 있으면 쓰지 않으며, 요청 본문은 저장하지 않는다.

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const TURN: TurnId = ids.next("trn");
const AT = Date.UTC(2026, 10, 4, 12, 0, 0);

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function event(
  seq: number,
  kind: "step.completed" | "turn.completed",
  payload: unknown,
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId: TURN,
    stepId: null,
    recordedAt: AT + seq,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

function call(startedAt: number, firstTokenAt: number | null, recordedAt: number): UsageRecord {
  return {
    threadId: THREAD,
    turnId: TURN,
    stepId: null,
    role: "main",
    scopeId: null,
    provider: "tape",
    modelId: "tape-1",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite: 20,
      totalTokens: 135,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
    },
    stopReason: "stop",
    aborted: false,
    recordedAt,
    startedAt,
    firstTokenAt,
  };
}

const COMPOSITION = {
  system: 10,
  tools: 40,
  sections: { memory: 3 },
  injected: 2,
  volatile: 5,
  history: 30,
  total: 50,
};

const TRACE: Pick<TraceReadPort, "turn"> = {
  turn: () => ({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 1,
        hook: "context",
        step: 1,
        handlers: [
          {
            registrationId: "ext:a",
            ms: 7,
            result: "modified",
            atMs: 12,
            size: 34,
            skippedBy: null,
            reason: null,
          },
          {
            registrationId: "ext:b",
            ms: 0,
            result: "skipped",
            atMs: 19,
            size: 0,
            skippedBy: "ext:a",
            reason: null,
          },
          {
            registrationId: "ext:c",
            ms: 2,
            result: "failed",
            atMs: 20,
            size: 0,
            skippedBy: null,
            reason: "threw",
          },
        ],
      },
    ],
  }),
};

/** 한 Turn의 커밋을 흘리고 그 Turn의 측정 행을 읽는다. 쓰기 시점은 `before`가 알려 준다 */
async function run(enabled: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "measure-recorder-"));
  const listeners = new Set<CommitListener>();
  let meterListener: ((record: UsageRecord) => void) | undefined;
  const { stop } = startMeasurement({
    dir,
    session: {
      feed: {
        onCommit: (listener: CommitListener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    usage: {
      subscribe: (listener) => {
        meterListener = listener;
        return () => {
          meterListener = undefined;
        };
      },
    },
    trace: TRACE,
    enabled: () => enabled,
    logger,
    now: () => AT,
  });
  try {
    // 호출은 Turn이 끝나기 전에 끝난다. 이때는 아직 아무것도 쓰지 않는다
    meterListener?.(call(AT + 100, AT + 180, AT + 400));
    const peek = openMeasureStore(join(dir, "measure.db"));
    if (!peek.ok) throw new Bug("the measure database must open");
    const beforeCommit = peek.value.rawCount();
    const commit = (events: readonly DurableEventEnvelope[]): void => {
      for (const listener of listeners) {
        listener({ firstSeq: 1, lastSeq: events.length, events });
      }
    };
    commit([
      event(1, "step.completed", {
        stepIndex: 1,
        status: "completed",
        stopReason: "stop",
        assistantItemId: null,
        toolResultItemIds: [],
        contextWarnings: [
          {
            code: "cache_prefix_reset",
            at: 0,
            changed: ["system", "sections"],
            owners: ["ext:a", "ext:b"],
            plugins: ["acme-notes", "helm"],
          },
          { code: "cache_reset_model_switch", from: "a/x", to: "b/y" },
          { code: "near_window", tokens: 9, contextWindow: 10 },
        ],
        composition: COMPOSITION,
      }),
      event(2, "turn.completed", { status: "completed", stepCount: 1, usage: null, error: null }),
    ]);
    await Promise.resolve();
    const rows = peek.value.turn(THREAD, TURN);
    peek.value.close();
    if (!rows.ok || !beforeCommit.ok) throw new Bug("the measure database must be readable");
    return { before: beforeCommit.value, rows: rows.value };
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a turn commit writes call, ctx, cache and hook rows next to the turn row, in one batch after the commit", async () => {
  const { before, rows } = await run(true);
  expect(before).toBe(0);
  const byKind = (kind: string) => rows.filter((row) => row.kind === kind);

  expect(byKind("call").map((row) => [row.metrics, row.tags])).toEqual([
    [
      {
        durationMs: 300,
        input: 10,
        output: 5,
        cacheRead: 100,
        cacheWrite: 20,
        totalTokens: 135,
        usd: 0.5,
        startedAt: AT + 100,
        firstTokenMs: 80,
      },
      { role: "main", provider: "tape", model: "tape-1", stopReason: "stop" },
    ],
  ]);

  expect(byKind("ctx").map((row) => row.metrics)).toEqual([
    {
      step: 1,
      system: 10,
      tools: 40,
      injected: 2,
      volatile: 5,
      history: 30,
      total: 50,
      "section.memory": 3,
    },
  ]);

  // 캐시를 깬 경고만 남고 near_window는 남지 않는다
  expect(byKind("cache").map((row) => row.tags)).toEqual([
    {
      code: "cache_prefix_reset",
      owner: "acme-notes",
      plugins: "acme-notes,helm",
      registrations: "ext:a,ext:b",
      changed: "system,sections",
    },
    { code: "cache_reset_model_switch", owner: "model", from: "a/x", to: "b/y" },
  ]);

  expect(byKind("hook").map((row) => [row.metrics, row.tags])).toEqual([
    [
      { ms: 7, seq: 1, step: 1, atMs: 12, size: 34 },
      { hook: "context", registrationId: "ext:a", result: "modified" },
    ],
    [
      { ms: 0, seq: 1, step: 1, atMs: 19, size: 0 },
      { hook: "context", registrationId: "ext:b", result: "skipped", skippedBy: "ext:a" },
    ],
    [
      { ms: 2, seq: 1, step: 1, atMs: 20, size: 0 },
      { hook: "context", registrationId: "ext:c", result: "failed", reason: "threw" },
    ],
  ]);
  // 앞 핸들러 때문에 건너뛴 횟수는 Turn 요약 행에 있다
  expect(byKind("turn").map((row) => row.metrics["hookSkippedByEarlier"])).toEqual([1]);
});

test("with measurement off no row of any kind is written", async () => {
  expect((await run(false)).rows).toEqual([]);
});
