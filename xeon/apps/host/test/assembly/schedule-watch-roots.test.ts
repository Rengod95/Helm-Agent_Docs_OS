import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import type { CreateError, ScheduleEntry, ScheduleService } from "@fresnel/cap-schedule";
import { WATCH_PATH_OUTSIDE_ROOTS_REASON } from "@fresnel/contracts/capabilities";
import { err, type Logger, type Result } from "@fresnel/contracts";
import type { LoopService, OsDirs, OsService, TaskService } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createHostSchedule, type ScheduleRunnerPorts } from "../../src/assembly/schedule.ts";
import { openFileLock } from "../fixtures/file-lock.ts";
import { partial } from "../fixtures/unsafe.ts";

// 감시 경로의 저장 검사(L2.schedule §4.4, 감시는 허용 루트 안만). 실제 폴더와 실제 상태 파일을 쓴다.
// 허용 루트는 설정·데이터·상태 폴더다. 밖의 경로는 저장하지 않고 `invalid_trigger`(사유 코드)로 거절한다.

const NOW = 1_000;
const lockDir = mkdtempSync(join(tmpdir(), "xh-sch-roots-lock-"));
const opened = await openFileLock(lockDir);
const roots: string[] = [lockDir];
afterAll(async () => {
  await opened.dispose();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** 시험마다 새 폴더와 새 서비스다. 상태 파일을 시험끼리 나누지 않으려고 저장 폴더도 따로 둔다 */
async function fixtureOf(seed: number): Promise<{
  readonly state: string;
  readonly outside: string;
  readonly service: ScheduleService;
}> {
  const root = mkdtempSync(join(tmpdir(), "xh-sch-roots-"));
  roots.push(root);
  const dirs = {
    config: join(root, "config"),
    data: join(root, "data"),
    state: join(root, "state"),
  };
  const outside = join(root, "elsewhere");
  for (const dir of [dirs.config, dirs.data, dirs.state, outside])
    mkdirSync(dir, { recursive: true });
  const service = createHostSchedule({
    os: partial<OsService>({ dirs: partial<OsDirs>(dirs) }),
    fileLock: opened.fileLock,
    clock: { now: () => NOW },
    ids: fixedIdFactory(seed),
    tasks: partial<TaskService>({}),
    loop: partial<LoopService>({}),
    ownerKind: "service",
    runnerPorts: () => partial<ScheduleRunnerPorts>({}),
    logger: partial<Logger>({}),
    overrides: { ticker: { every: () => () => undefined } },
  });
  expect((await service.open()).ok).toBe(true);
  return { state: dirs.state, outside, service };
}

/** 저장을 거절한 결과. `err`가 리터럴 종류를 지키도록 `create`의 결과 타입으로 받는다 */
const REJECTED: Result<ScheduleEntry, CreateError> = err({
  kind: "invalid_trigger",
  reason: WATCH_PATH_OUTSIDE_ROOTS_REASON,
});

test("a watch path inside the app's state folder is saved", async () => {
  const { state, service } = await fixtureOf(100);
  const created = await service.create({
    trigger: { kind: "file_watch", paths: [join(state, "notes")], debounceMs: 1000 },
    prompt: "요약",
    createdBy: "host",
  });
  expect(created.ok).toBe(true);
  expect(service.list()).toHaveLength(1);
});

test("a watch path outside the app's folders is refused and nothing is saved", async () => {
  const { outside, service } = await fixtureOf(200);
  const created = await service.create({
    trigger: { kind: "file_watch", paths: [outside], debounceMs: 1000 },
    prompt: "요약",
    createdBy: "host",
  });
  expect(created).toEqual(REJECTED);
  expect(service.list()).toHaveLength(0);
});

test("a path that climbs out of the state folder with .. is refused", async () => {
  const { state, service } = await fixtureOf(300);
  // 상태 폴더 아래에서 올라가 형제 폴더를 가리킨다. 풀면 허용 루트 밖이다
  const climbing = join(state, "..", "elsewhere");
  const created = await service.create({
    trigger: { kind: "file_watch", paths: [climbing], debounceMs: 1000 },
    prompt: "요약",
    createdBy: "host",
  });
  expect(created).toEqual(REJECTED);
  expect(service.list()).toHaveLength(0);
});

test("one outside path among inside paths refuses the whole entry", async () => {
  const { state, outside, service } = await fixtureOf(400);
  const created = await service.create({
    trigger: { kind: "file_watch", paths: [join(state, "a"), outside], debounceMs: 1000 },
    prompt: "요약",
    createdBy: "host",
  });
  expect(created).toEqual(REJECTED);
  expect(service.list()).toHaveLength(0);
});

test("the check touches only file-watch triggers", async () => {
  const { service } = await fixtureOf(500);
  const created = await service.create({
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "요약",
    createdBy: "host",
  });
  expect(created.ok).toBe(true);
});
