import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  attemptAsync,
  canonicalJson,
  err,
  ok,
  parse,
  parseJson,
  type Result,
} from "@fresnel/contracts";
import {
  EMPTY_STATE,
  upgradeScheduleState,
  type ScheduleState,
  type ScheduleStore,
  type StoreFailure,
} from "@fresnel/cap-schedule";
import type { FileLock, FileLockError } from "@fresnel/platform-os";
import { Type, type TSchema } from "typebox";
import { messageOf } from "../util.ts";

// L2.schedule.spec §4.4.9. 예약 상태를 상태 디렉터리의 JSON 파일 하나로 둔다(`<dirs.state>/schedule/state.json`).
// 쓰기는 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다(원자 교체). 파일은 0600, 디렉터리는 0700이다.
// 호스트가 둘 이상이면 같은 파일을 함께 쓴다. 저장은 `fileLock`(프로세스 사이 잠금) 안에서 디스크를 다시 읽어 병합한 뒤 쓴다.
// 병합은 3자 비교다: 이 저장소가 마지막으로 읽거나 쓴 상태(base)에서 바뀐 항목만 내 것을 쓰고, 나머지는 디스크의 것을 둔다.
// 임시 파일 이름에는 pid를 넣는다. 읽을 때는 형태를 typebox로 검사한다. 손상된 파일은 `store_failed`이고 빈 상태로 덮어 쓰지 않는다(호출자가 정한다).

const STATE_FILE_NAME = "state.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const nullable = <Inner extends TSchema>(inner: Inner) => Type.Union([inner, Type.Null()]);

const TriggerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("interval"), everySeconds: Type.Number() }),
  Type.Object({ kind: Type.Literal("at"), atMs: Type.Number() }),
  Type.Object({
    kind: Type.Literal("file_watch"),
    paths: Type.Array(Type.String()),
    debounceMs: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("remote") }),
  Type.Object({
    kind: Type.Literal("repeat"),
    intervalSeconds: Type.Number(),
    maxIterations: Type.Number(),
    expiresAtMs: Type.Number(),
  }),
]);

const StopReasonSchema = Type.Union([
  Type.Literal("cancelled"),
  Type.Literal("completed"),
  Type.Literal("max_iterations"),
  Type.Literal("expired"),
  Type.Literal("host_exit"),
  Type.Literal("run_failed"),
]);

const EntrySchema = Type.Object({
  id: Type.String(),
  trigger: TriggerSchema,
  prompt: Type.String(),
  workspace: nullable(Type.String()),
  title: nullable(Type.String()),
  sessionKind: Type.Literal("cron"),
  enabled: Type.Boolean(),
  createdAt: Type.Number(),
  nextDueAt: nullable(Type.Number()),
  lastStartedAt: nullable(Type.Number()),
  iterations: Type.Number(),
  stoppedReason: nullable(StopReasonSchema),
  // 만든 쪽. 이 필드가 생기기 전의 파일에는 없다(선택 필드라 version을 올리지 않는다 [결정: 2026-11-03 사용자])
  createdBy: Type.Optional(Type.String()),
});

const RunSchema = Type.Object({
  runId: Type.String(),
  scheduleId: Type.String(),
  firedBy: Type.Union([
    Type.Literal("interval"),
    Type.Literal("at"),
    Type.Literal("file_watch"),
    Type.Literal("remote"),
    Type.Literal("repeat"),
  ]),
  dueAt: Type.Number(),
  claimedAt: Type.Number(),
  missed: Type.Boolean(),
  status: Type.Union([
    Type.Literal("claimed"),
    Type.Literal("started"),
    Type.Literal("finished"),
    Type.Literal("skipped"),
    Type.Literal("failed"),
  ]),
  threadId: nullable(Type.String()),
  startedAt: nullable(Type.Number()),
  endedAt: nullable(Type.Number()),
  outcome: nullable(
    Type.Union([
      Type.Literal("completed"),
      Type.Literal("aborted"),
      Type.Literal("failed"),
      Type.Literal("awaiting_approval"),
    ]),
  ),
  reason: nullable(
    Type.Union([
      Type.Literal("missed"),
      Type.Literal("too_old"),
      Type.Literal("min_interval"),
      Type.Literal("overlap"),
      Type.Literal("rate_limited"),
      Type.Literal("host_exit"),
      Type.Literal("start_failed"),
      Type.Literal("run_failed"),
    ]),
  ),
  skippedCount: Type.Number(),
});

const ScheduleStateSchema = Type.Object({
  version: Type.Literal(2),
  entries: Type.Array(EntrySchema),
  runs: Type.Array(RunSchema),
});

function codeOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : undefined;
}

function failure(message: string): Result<never, StoreFailure> {
  return err({ kind: "store_failed", message });
}

function lockMessage(error: FileLockError): string {
  if (error.kind === "timeout") return `state file lock timed out after ${error.waitedMs}ms`;
  if (error.kind === "cancelled") return "state file lock was cancelled";
  return `state file lock failed: ${error.code}`;
}

/** 같은 id의 항목끼리 3자 병합한다. 순서는 디스크 순서를 지키고 내가 새로 만든 항목을 뒤에 붙인다 */
function mergeById<Item>(
  base: readonly Item[],
  mine: readonly Item[],
  disk: readonly Item[],
  idOf: (item: Item) => string,
): Item[] {
  const baseById = new Map(base.map((item) => [idOf(item), item]));
  const mineById = new Map(mine.map((item) => [idOf(item), item]));
  const diskById = new Map(disk.map((item) => [idOf(item), item]));
  const merged: Item[] = [];
  const seen = new Set<string>();
  const decide = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const before = baseById.get(id);
    const now = mineById.get(id);
    const there = diskById.get(id);
    const changed =
      before === undefined || now === undefined
        ? before !== now
        : canonicalJson(before) !== canonicalJson(now);
    // 내가 바꾸지 않았으면 다른 호스트가 쓴 것(삭제 포함)을 따른다. 바꿨으면 내 것이고, 내가 지웠으면 지운다
    const winner = changed ? now : there;
    if (winner !== undefined) merged.push(winner);
  };
  for (const item of disk) decide(idOf(item));
  for (const item of mine) decide(idOf(item));
  return merged;
}

function mergeStates(base: ScheduleState, mine: ScheduleState, disk: ScheduleState): ScheduleState {
  return {
    version: 2,
    entries: mergeById(base.entries, mine.entries, disk.entries, (entry) => entry.id),
    runs: mergeById(base.runs, mine.runs, disk.runs, (run) => run.runId),
  };
}

/**
 * 파일 저장소. `dir`은 상태 디렉터리 아래의 예약 폴더다. 같은 저장소 안의 저장은 호출 순서대로 하나씩 돌고(예약 서비스가 직렬화한다),
 * 다른 호스트와는 `fileLock` 안에서 읽기-병합-쓰기로 겹치지 않게 한다. 병합 결과는 디스크에만 있고 이 저장소를 쓰는 서비스의
 * 메모리는 다음 재시작에 읽는다. 실패는 `store_failed`로 돌려준다. 실패한 쓰기가 남긴 임시 파일은 지운다.
 */
export function createFileScheduleStore(dir: string, fileLock: FileLock): ScheduleStore {
  const path = join(dir, STATE_FILE_NAME);
  const tempPath = `${path}.${process.pid}.tmp`;
  /** 이 저장소가 마지막으로 읽었거나 쓴 상태. 3자 병합의 기준이다 */
  let base: ScheduleState = EMPTY_STATE;

  async function readState(): Promise<Result<ScheduleState, StoreFailure>> {
    const read = await attemptAsync(() => readFile(path, "utf8"));
    if (!read.ok) {
      // 파일이 없으면 처음 상태다
      if (codeOf(read.error.cause) === "ENOENT") return ok(EMPTY_STATE);
      return failure(`state file cannot be read: ${codeOf(read.error.cause) ?? "io"}`);
    }
    const json = parseJson(read.value);
    if (!json.ok) return failure("state file is not JSON");
    // version 1 파일(예약 종류 "loop")은 읽을 때 한 번 version 2로 올린다(L2.schedule.spec §4.4.9)
    const parsed = parse(ScheduleStateSchema, upgradeScheduleState(json.value));
    if (!parsed.ok) {
      const paths = parsed.error.issues
        .slice(0, 3)
        .map((issue) => issue.path || "/")
        .join(", ");
      return failure(`state file has an invalid shape at ${paths}`);
    }
    return ok(parsed.value);
  }

  async function writeState(state: ScheduleState): Promise<Result<void, StoreFailure>> {
    const text = `${JSON.stringify(state)}\n`;
    const written = await attemptAsync(async () => {
      const handle = await open(tempPath, "w", FILE_MODE);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(tempPath, FILE_MODE);
      await rename(tempPath, path);
    });
    if (written.ok) return ok(undefined);
    const cleaned = await attemptAsync(() => rm(tempPath, { force: true }));
    const cleanup = cleaned.ok ? "" : `; temp file not removed: ${messageOf(cleaned.error.cause)}`;
    return failure(
      `state file cannot be written: ${codeOf(written.error.cause) ?? messageOf(written.error.cause)}${cleanup}`,
    );
  }

  return {
    async load(): Promise<Result<ScheduleState, StoreFailure>> {
      const state = await readState();
      if (state.ok) base = state.value;
      return state;
    },

    async save(state: ScheduleState): Promise<Result<void, StoreFailure>> {
      const prepared = await attemptAsync(async () => {
        await mkdir(dir, { recursive: true, mode: DIR_MODE });
        await chmod(dir, DIR_MODE);
      });
      if (!prepared.ok) {
        return failure(
          `state file cannot be written: ${codeOf(prepared.error.cause) ?? messageOf(prepared.error.cause)}`,
        );
      }
      const done = await fileLock.withLock(path, async (): Promise<Result<void, StoreFailure>> => {
        const disk = await readState();
        if (!disk.ok) return disk;
        return writeState(mergeStates(base, state, disk.value));
      });
      if (!done.ok) return failure(lockMessage(done.error));
      if (done.value.ok) base = state;
      return done.value;
    },
  };
}
