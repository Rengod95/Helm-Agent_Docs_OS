import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  ensureResidentDrive,
  type ResidentDriveDeps,
} from "../../src/assembly/m4/resident-drive.ts";

// M5c §4.8.6 [제안]: 테스트 대화(`craftChat` 표지)는 사용자 입력 앞에서 주도 스택에 플러그인 프레임이 없으면 프로필의 시작 Drive를
// 다시 요청한다. 일반 대화, 프레임이 이미 있는 대화, 시작 Drive가 없는 대화는 아무것도 하지 않는다.

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

interface Fake {
  readonly deps: ResidentDriveDeps;
  /** `startDrive` 호출의 기록 */
  readonly started: { threadId: ThreadId; scopeId: string; trigger: string }[];
  /** `startDriveOf` 호출 수. 일반 대화는 묻지 않는다 */
  startDriveReads: number;
  reports: string[];
}

/** 시험마다 다른 값을 고르는 가짜 의존. `refuse`가 있으면 `startDrive`가 그 종류로 거절한다 */
function fakeOf(options: {
  readonly craftChat: boolean;
  readonly frames?: readonly string[];
  readonly scopeId?: string | undefined;
  readonly refuse?: string;
}): Fake {
  const started: Fake["started"] = [];
  const reports: string[] = [];
  const fake: Fake = {
    started,
    startDriveReads: 0,
    reports,
    deps: {
      isCraftChat: () => options.craftChat,
      framePlugins: () => options.frames ?? [],
      startDriveOf: () => {
        fake.startDriveReads += 1;
        return Promise.resolve(options.scopeId);
      },
      startDrive: (id, scopeId, requested): Result<void, { readonly kind: string }> => {
        started.push({ threadId: id, scopeId, trigger: requested.trigger });
        return options.refuse === undefined ? ok(undefined) : err({ kind: options.refuse });
      },
      report: (message) => {
        reports.push(message);
      },
    },
  };
  return fake;
}

test("테스트 대화에 주도 프레임이 없으면 시작 Drive를 사용자 계기로 한 번 요청한다", async () => {
  const fake = fakeOf({ craftChat: true, scopeId: "authoring" });
  const id = threadId();
  expect(await ensureResidentDrive(fake.deps, id)).toBe(true);
  expect(fake.started).toEqual([{ threadId: id, scopeId: "authoring", trigger: "user" }]);
  expect(fake.reports).toEqual([]);
});

test("테스트 대화라도 플러그인 프레임이 이미 있으면 아무것도 요청하지 않는다", async () => {
  const fake = fakeOf({ craftChat: true, frames: ["authoring"], scopeId: "authoring" });
  expect(await ensureResidentDrive(fake.deps, threadId())).toBe(false);
  expect(fake.started).toEqual([]);
  expect(fake.startDriveReads).toBe(0);
});

test("일반 대화는 프레임이 없어도 요청하지 않는다(시작 Drive는 첫 턴 앞에서만 쌓인다)", async () => {
  const fake = fakeOf({ craftChat: false, scopeId: "authoring" });
  expect(await ensureResidentDrive(fake.deps, threadId())).toBe(false);
  expect(fake.started).toEqual([]);
  expect(fake.startDriveReads).toBe(0);
});

test("시작 Drive가 없는 테스트 대화는 요청하지 않는다", async () => {
  const fake = fakeOf({ craftChat: true, scopeId: undefined });
  expect(await ensureResidentDrive(fake.deps, threadId())).toBe(false);
  expect(fake.started).toEqual([]);
  expect(fake.startDriveReads).toBe(1);
});

test("요청이 거절되면 입력을 막지 않고 거절 종류를 알린다", async () => {
  const fake = fakeOf({ craftChat: true, scopeId: "authoring", refuse: "not_drive" });
  expect(await ensureResidentDrive(fake.deps, threadId())).toBe(false);
  expect(fake.started).toHaveLength(1);
  expect(fake.reports).toEqual(["craft.drive_start_failed"]);
});
