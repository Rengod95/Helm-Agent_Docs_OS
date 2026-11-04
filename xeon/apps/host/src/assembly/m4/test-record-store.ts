import { readFile } from "node:fs/promises";
import { attemptAsync, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import type { ReplayReport } from "@fresnel/contracts/services";
import { ExtTestListResultSchema, type ExtTestRecord } from "@fresnel/contracts/wire";
import type { FileLock } from "@fresnel/platform-os";
import { Type } from "typebox";
import { replaceFileAtomically } from "../trust.ts";

// 시험 기록 저장소(W-29, `ext.test.run`·`ext.test.list`). 사용자 설정 폴더의 `ext-tests.json` 하나다(`{ schemaVersion: 1, tests }`).
// 읽고-고치고-쓰기는 L0.os 파일 잠금 안에서, 임시 파일에 써서 이름을 바꾸는 원자 교체로 한다(`profile-store.ts`와 같은 방식).
// 손상된 파일은 `corrupt` 오류 값으로 돌려주고 덮어쓰지 않는다. 이 프로세스가 처음 파일을 읽을 때 `running`으로 남은 기록은
// 앞 프로세스가 끝내지 못한 것이므로 `failed`(중단됨, `durationMs`는 null)로 바꿔 저장한다. 기록은 시작 순서대로 두고
// 최대 `EXT_TEST_RECORD_CAP`개를 넘으면 오래된 것부터 버린다. 목록의 모양은 와이어 `ExtTestListResultSchema`가 정한다.

/** 기록 개수 상한. 와이어 목록의 `maxItems`와 같다 */
export const EXT_TEST_RECORD_CAP = 500;
export const EXT_TEST_FILE_NAME = "ext-tests.json";

export type ExtTestStoreFailure =
  /** 파일이 JSON이 아니거나 모양이 아니다. 덮어쓰지 않는다 */
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  /** 상한에 밀려 버려졌거나 없는 기록 ID다 */
  | { readonly kind: "not_found"; readonly testId: string };

/** 끝난 기록에 채울 값. `running`인 기록을 `passed`나 `failed`로 바꾼다 */
interface ExtTestFinish {
  readonly state: "passed" | "failed";
  readonly durationMs: number;
  readonly replay: ReplayReport | null;
}

export interface ExtTestRecordStore {
  /** 저장된 기록을 시작 순서대로 돌려준다. 파일이 없으면 빈 목록이다 */
  list(): Promise<Result<readonly ExtTestRecord[], ExtTestStoreFailure>>;
  /** 기록 하나를 끝에 더한다. 상한을 넘으면 가장 오래된 것부터 버린다 */
  begin(record: ExtTestRecord): Promise<Result<void, ExtTestStoreFailure>>;
  /** 기록 하나를 끝낸다. 없는 ID면 `not_found`다 */
  finish(
    testId: string,
    finish: ExtTestFinish,
  ): Promise<Result<ExtTestRecord, ExtTestStoreFailure>>;
}

export interface ExtTestRecordStoreDeps {
  /** `ext-tests.json`의 절대 경로 */
  readonly path: string;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`) */
  readonly fileLock: FileLock;
  readonly signal: AbortSignal;
}

// 파일 모양. 목록 항목은 와이어 스키마로 검사한다(상한과 항목 모양이 한곳에 있도록)
const FileSchema = Type.Object(
  { schemaVersion: Type.Literal(1), tests: Type.Array(Type.Unknown()) },
  { additionalProperties: false },
);

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function isRunning(record: ExtTestRecord): boolean {
  return record.state === "running";
}

/** 앞 프로세스가 끝내지 못한 기록. 끝난 시각을 모르므로 소요 시간은 null이다 */
function interruptedOf(record: ExtTestRecord): ExtTestRecord {
  return isRunning(record) ? { ...record, state: "failed", durationMs: null } : record;
}

function parseFile(path: string, text: string): Result<ExtTestRecord[], ExtTestStoreFailure> {
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "corrupt", path, reason: "not JSON" });
  const file = parse(FileSchema, json.value);
  if (!file.ok) {
    const first = file.error.issues[0];
    return err({
      kind: "corrupt",
      path,
      reason: first === undefined ? "schema" : `${first.path}: ${first.message}`,
    });
  }
  const list = parse(ExtTestListResultSchema, { tests: file.value.tests });
  if (!list.ok) {
    const first = list.error.issues[0];
    return err({
      kind: "corrupt",
      path,
      reason: first === undefined ? "schema" : `${first.path}: ${first.message}`,
    });
  }
  return ok([...list.value.tests]);
}

export function createExtTestRecordStore(deps: ExtTestRecordStoreDeps): ExtTestRecordStore {
  const { path } = deps;
  // 이 프로세스가 파일을 처음 읽었는가. 처음 읽을 때만 앞 프로세스의 `running`을 중단으로 고친다
  const state: { recovered: boolean; tmp: number } = { recovered: false, tmp: 0 };

  /** 파일 원문. 파일이 없으면 null이다 */
  async function readText(): Promise<Result<string | null, ExtTestStoreFailure>> {
    const raw = await attemptAsync(() => readFile(path, "utf8"));
    if (raw.ok) return ok(raw.value);
    const code = errorCode(raw.error.cause);
    return code === "ENOENT" ? ok(null) : err({ kind: "io", path, code });
  }

  async function write(
    tests: readonly ExtTestRecord[],
  ): Promise<Result<void, ExtTestStoreFailure>> {
    const text = `${JSON.stringify({ schemaVersion: 1, tests }, null, 2)}\n`;
    state.tmp += 1;
    const written = await attemptAsync(() =>
      replaceFileAtomically(path, text, `${String(process.pid)}-t${String(state.tmp)}`),
    );
    return written.ok
      ? ok(undefined)
      : err({ kind: "io", path, code: errorCode(written.error.cause) });
  }

  /** 잠금 안에서 현재 기록을 읽는다. 이 프로세스의 첫 읽기면 중단된 기록을 고쳐 저장한다(저장이 실패하면 다음 읽기가 다시 한다) */
  async function current(): Promise<Result<ExtTestRecord[], ExtTestStoreFailure>> {
    const text = await readText();
    if (!text.ok) return text;
    if (text.value === null) {
      state.recovered = true;
      return ok([]);
    }
    const parsed = parseFile(path, text.value);
    if (!parsed.ok) return parsed;
    if (state.recovered || !parsed.value.some(isRunning)) {
      state.recovered = true;
      return parsed;
    }
    const tests = parsed.value.map(interruptedOf);
    const saved = await write(tests);
    if (!saved.ok) return saved;
    state.recovered = true;
    return ok(tests);
  }

  /** 잠금 안에서 읽고, `edit`가 돌려준 새 목록이 있으면 쓴다. 바뀌지 않으면 파일을 건드리지 않는다 */
  async function transact<T>(
    edit: (
      tests: readonly ExtTestRecord[],
    ) => Result<
      { readonly next: readonly ExtTestRecord[] | null; readonly value: T },
      ExtTestStoreFailure
    >,
  ): Promise<Result<T, ExtTestStoreFailure>> {
    const locked = await deps.fileLock.withLock(
      path,
      async (): Promise<Result<T, ExtTestStoreFailure>> => {
        const read = await current();
        if (!read.ok) return err(read.error);
        const edited = edit(read.value);
        if (!edited.ok) return err(edited.error);
        if (edited.value.next !== null) {
          const saved = await write(edited.value.next);
          if (!saved.ok) return err(saved.error);
        }
        return ok(edited.value.value);
      },
      { signal: deps.signal },
    );
    if (!locked.ok) return err({ kind: "io", path, code: locked.error.kind });
    return locked.value;
  }

  return {
    list: () => transact((tests) => ok({ next: null, value: tests })),
    begin: (record) =>
      transact((tests) =>
        ok({ next: [...tests, record].slice(-EXT_TEST_RECORD_CAP), value: undefined }),
      ),
    finish: (testId, finish) =>
      transact((tests) => {
        const found = tests.find((record) => record.testId === testId);
        if (found === undefined) return err({ kind: "not_found", testId });
        const updated: ExtTestRecord = {
          ...found,
          state: finish.state,
          durationMs: finish.durationMs,
          replay: finish.replay,
        };
        const next = tests.map((record) => (record.testId === testId ? updated : record));
        return ok({ next, value: updated });
      }),
  };
}
