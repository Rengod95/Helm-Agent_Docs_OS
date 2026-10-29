// M3-REQ-64(서버 측정 부분), M3-29, M3-new-18 (M3b B5-PERF). 저장소 커밋 한 건의 시간(store_commit_event), 활성 가지 item 1000개를
// Reader로 읽는 시간(thread_read_1k_items), 이벤트 10000개의 투영기 재생성 시간(projector_rebuild_10k_events)을 잰다.
// 실행(xeon/에서): bash ../scripts/guard.sh run -- bun packages/core-persistence/test/bench/store.bench.ts
// 출력은 scripts/bench-server.ts의 줄 프로토콜이다. stdout에는 JSON 한 줄씩만 쓴다. 판정은 bench-server.ts와 bench-gate.ts가 한다.
// DB는 tempDbPath가 만든 임시 디렉터리의 디스크 파일이다. fsync 비용을 재는 것이 목적이라 메모리 DB를 쓰지 않는다.
// 쓰기 연결의 PRAGMA(synchronous=FULL, WAL)는 platform-store가 연다. 시작 때 쓰기 연결에서 값을 읽어 note에 싣는다.
// 재지 않는 값: store_commit_event_sync_normal(쓰기 연결의 synchronous를 바꿀 길이 없다), process_start_fingerprint(platform-os 의존이 필요하다).
import { Bug } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, StampedDraft } from "@xeon/contracts/records";
import { createCoreProjector } from "../../src/projector/core.ts";
import { rebuildProjector } from "../../src/projector/rebuild.ts";
import { createKindCatalog } from "../../src/upcast.ts";
import {
  commitOrThrow,
  draftOf,
  expectOk,
  newThread,
  openHarness,
  startTurn,
  tempDbPath,
  type Harness,
} from "../support/harness.ts";

type Line =
  | {
      readonly metric: string;
      readonly unit: "ms";
      readonly samples: readonly number[];
      readonly note: string;
    }
  | {
      readonly metric: string;
      readonly unit: "count";
      readonly value: number;
      readonly note: string;
    };

function emit(line: Line): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** 마이크로초 자리까지 남긴다. JSON이 부동소수 긴 꼬리를 싣지 않게 한다 */
function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** bench-server.ts의 stats와 같은 순위 규칙(ceil(0.5·n)번째)으로 중앙값을 고른다 */
function medianOf(samples: readonly number[]): number {
  const sorted = samples.toSorted((a, b) => a - b);
  const value = sorted[Math.min(sorted.length - 1, Math.ceil(0.5 * sorted.length) - 1)];
  if (value === undefined) throw new Bug("store bench: median of an empty sample list");
  return value;
}

const COMMIT_WARMUPS = 10;
const COMMIT_RUNS = 150;
const READ_WARMUPS = 3;
const READ_RUNS = 25;
const READ_ITEMS = 1000;
const REBUILD_WARMUPS = 2;
const REBUILD_RUNS = 5;
const REBUILD_EVENTS = 10_000;
/** 준비 커밋 하나에 든 초안 수. 준비 시간을 60초 아래로 두려고 한 커밋에 여러 개를 넣는다 */
const SETUP_CHUNK = 500;
/** 100k 외삽의 기준 크기(L1.persistence §4.5.3 chunk 임계) */
const CHUNK_THRESHOLD_EVENTS = 100_000;

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userItem(h: Harness, text: string): unknown {
  return {
    item: {
      itemId: h.ids.next("itm"),
      status: "completed",
      kind: "user",
      message: { role: "user", content: text, timestamp: h.clock.now() },
      requestId: null,
    },
  };
}

function assistantItem(h: Harness, text: string): unknown {
  return {
    item: {
      itemId: h.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "test",
        provider: "test",
        model: "tape",
        usage: USAGE,
        stopReason: "stop",
        timestamp: h.clock.now(),
      },
      partIds: [],
    },
  };
}

function itemDraft(h: Harness, threadId: ThreadId, turnId: TurnId, payload: unknown): StampedDraft {
  return draftOf(h, h.loop, "item.recorded", threadId, { turnId, stepId: null }, payload);
}

/** 짝수 번째는 user, 홀수 번째는 assistant로 item.recorded 초안을 `count`개 만든다 */
function itemDrafts(
  h: Harness,
  threadId: ThreadId,
  turnId: TurnId,
  from: number,
  count: number,
): StampedDraft[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = from + offset;
    const payload =
      index % 2 === 0
        ? userItem(h, `input ${String(index)}`)
        : assistantItem(h, `reply ${String(index)}`);
    return itemDraft(h, threadId, turnId, payload);
  });
}

function commitDrafts(
  h: Harness,
  threadId: ThreadId,
  key: string,
  drafts: readonly StampedDraft[],
): void {
  commitOrThrow(h, threadId, key, () => ({ kind: "append", drafts, checkpoint: null }));
}

/** 검사용 연결로 행 수를 센다. 쓰기 연결과 같은 파일을 본다 */
function countRows(h: Harness, sql: string): number {
  return h.store.raw.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

/** 쓰기 연결의 PRAGMA 값(platform-store가 연 그대로). 측정이 운영 설정으로 도는지 note에 남긴다 */
function writerPragmas(h: Harness): string {
  const read = h.store.db.write((tx) => ({
    synchronous: tx.get("PRAGMA synchronous"),
    journal: tx.get("PRAGMA journal_mode"),
  }));
  if (!read.ok) throw new Bug("store bench: the writer pragma read was refused");
  const sync = read.value.synchronous?.["synchronous"] ?? "unknown";
  const journal = read.value.journal?.["journal_mode"] ?? "unknown";
  return `synchronous=${String(sync)} journal_mode=${String(journal)}`;
}

// ── 1. 커밋 한 건 ──────────────────────────────────────────────────────────

async function measureCommit(): Promise<void> {
  const file = tempDbPath();
  const h = await openHarness({ path: file.path });
  try {
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const pragmas = writerPragmas(h);
    const eventsBefore = countRows(h, "SELECT COUNT(*) AS n FROM events");
    const samples: number[] = [];
    for (let run = 0; run < COMMIT_WARMUPS + COMMIT_RUNS; run += 1) {
      // 초안은 시간을 재기 전에 만든다. 잰 시간은 커밋 한 건(검증, 이벤트 기록, 투영, 요청 기록, 쓰기 트랜잭션)이다
      const drafts = [itemDraft(h, threadId, turn.turnId, userItem(h, `input ${String(run)}`))];
      const started = performance.now();
      commitDrafts(h, threadId, `bench-commit-${String(run)}`, drafts);
      const elapsed = performance.now() - started;
      if (run >= COMMIT_WARMUPS) samples.push(ms(elapsed));
    }
    const eventsAfter = countRows(h, "SELECT COUNT(*) AS n FROM events");
    if (eventsAfter - eventsBefore !== COMMIT_WARMUPS + COMMIT_RUNS) {
      throw new Bug("store bench: a commit did not record exactly one event");
    }
    emit({
      metric: "store_commit_event",
      unit: "ms",
      samples,
      note: `커밋 1건 = item.recorded(user) 초안 1개(요청 기록 포함). 워밍업 ${String(COMMIT_WARMUPS)}회 뺌. 쓰기 연결 ${pragmas}(synchronous 2 = FULL, 운영 값). 디스크 파일 DB(tempDbPath)`,
    });
  } finally {
    await h.store.close();
    file.cleanup();
  }
}

// ── 2. 활성 가지 item 1000개 읽기 ─────────────────────────────────────────

/** Reader(service.readBranch)로 활성 가지를 끝까지 읽고 item.recorded 이벤트마다 hydrate를 건다. 읽은 item 수를 돌려준다 */
async function readBranchItems(h: Harness, threadId: ThreadId): Promise<number> {
  const pending: Promise<DurableEventEnvelope>[] = [];
  for await (const read of h.service.readBranch(threadId)) {
    const event = expectOk(read);
    if (event.kind === "item.recorded") pending.push(h.service.hydrate(event));
  }
  return (await Promise.all(pending)).length;
}

async function measureRead(): Promise<void> {
  const file = tempDbPath();
  const h = await openHarness({ path: file.path });
  try {
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    // startTurn이 user item 하나를 남기므로 나머지를 채운다. 준비 시간은 잰 시간 밖이다
    let written = 1;
    while (written < READ_ITEMS) {
      const count = Math.min(SETUP_CHUNK, READ_ITEMS - written);
      commitDrafts(
        h,
        threadId,
        `bench-read-setup-${String(written)}`,
        itemDrafts(h, threadId, turn.turnId, written, count),
      );
      written += count;
    }
    const projected = h.store.raw
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM p_items WHERE thread_id = ?")
      .get(threadId)?.n;
    if (projected !== READ_ITEMS) {
      throw new Bug(
        `thread read bench: ${String(projected)} items projected, ${String(READ_ITEMS)} written`,
      );
    }
    const samples: number[] = [];
    for (let run = 0; run < READ_WARMUPS + READ_RUNS; run += 1) {
      const started = performance.now();
      // oxlint-disable-next-line no-await-in-loop -- 읽기 표본은 하나씩 순서대로 잰다 (eng.testing.guide TS-05)
      const count = await readBranchItems(h, threadId);
      const elapsed = performance.now() - started;
      if (count !== READ_ITEMS) {
        throw new Bug(
          `thread read bench: ${String(count)} items read, ${String(READ_ITEMS)} written`,
        );
      }
      if (run >= READ_WARMUPS) samples.push(ms(elapsed));
    }
    emit({
      metric: "thread_read_1k_items",
      unit: "ms",
      samples,
      note: `Reader readBranch로 활성 가지 전체를 읽고 item.recorded ${String(READ_ITEMS)}개를 hydrate. 파싱은 뺌. 워밍업 ${String(READ_WARMUPS)}회 뺌. 준비(커밋)는 잰 시간 밖`,
    });
  } finally {
    await h.store.close();
    file.cleanup();
  }
}

// ── 3. 이벤트 10000개의 투영기 재생성 ─────────────────────────────────────

async function measureRebuild(): Promise<void> {
  const file = tempDbPath();
  const h = await openHarness({ path: file.path });
  try {
    const setupStarted = performance.now();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    let total = countRows(h, "SELECT COUNT(*) AS n FROM events");
    while (total < REBUILD_EVENTS) {
      const count = Math.min(SETUP_CHUNK, REBUILD_EVENTS - total);
      commitDrafts(
        h,
        threadId,
        `bench-rebuild-setup-${String(total)}`,
        itemDrafts(h, threadId, turn.turnId, total, count),
      );
      total += count;
    }
    const setupSeconds = (performance.now() - setupStarted) / 1000;
    if (countRows(h, "SELECT COUNT(*) AS n FROM events") !== REBUILD_EVENTS) {
      throw new Bug("projector rebuild bench: the setup did not reach the event count");
    }

    // 재생성은 ensureProjectors가 부르는 rebuildProjector 그대로다: DROP, DDL, seq 순 재생, projector_state 갱신.
    // 한 쓰기 트랜잭션 안에서 부르고, 트랜잭션 커밋(fsync)까지 잰다
    const core = createCoreProjector();
    const catalog = createKindCatalog();
    const samples: number[] = [];
    for (let run = 0; run < REBUILD_WARMUPS + REBUILD_RUNS; run += 1) {
      const started = performance.now();
      const written = h.store.db.write((tx) => rebuildProjector(tx, core, catalog));
      const elapsed = performance.now() - started;
      if (!written.ok) throw new Bug("projector rebuild bench: the write transaction was refused");
      if (!written.value.ok) throw new Bug("projector rebuild bench: the rebuild stopped on a row");
      if (run >= REBUILD_WARMUPS) samples.push(ms(elapsed));
    }
    const projectedItems = countRows(h, "SELECT COUNT(*) AS n FROM p_items");
    const itemEvents = countRows(
      h,
      "SELECT COUNT(*) AS n FROM events WHERE kind = 'item.recorded'",
    );
    if (projectedItems !== itemEvents) {
      throw new Bug(
        `projector rebuild bench: ${String(projectedItems)} projected items, ${String(itemEvents)} item events`,
      );
    }

    const median = medianOf(samples);
    emit({
      metric: "projector_rebuild_10k_events",
      unit: "ms",
      samples,
      note: `core 투영기 재생성(rebuildProjector, 한 쓰기 트랜잭션, 쪽 5000개). 이벤트 ${String(REBUILD_EVENTS)}개(item.recorded). 워밍업 ${String(REBUILD_WARMUPS)}회 뺌. 준비 ${setupSeconds.toFixed(1)} s는 잰 시간 밖`,
    });
    const eventsPerSecond = REBUILD_EVENTS / (median / 1000);
    const extrapolatedSeconds = CHUNK_THRESHOLD_EVENTS / eventsPerSecond;
    emit({
      metric: "projector_rebuild_events_per_sec",
      unit: "count",
      value: Math.round(eventsPerSecond),
      note: `이벤트 ${String(REBUILD_EVENTS)}개 / 중앙값 ${String(median)} ms. extrapolation to 100k events = ${extrapolatedSeconds.toFixed(2)} s (spec L1.persistence §4.5.3 chunk threshold 100k)`,
    });
  } finally {
    await h.store.close();
    file.cleanup();
  }
}

async function main(): Promise<void> {
  await measureCommit();
  await measureRead();
  await measureRebuild();
}

await main();
