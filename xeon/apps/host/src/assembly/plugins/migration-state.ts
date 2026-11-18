import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  type Logger,
  type Result,
  type Thrown,
} from "@fresnel/contracts";

// 가져오기 상태 파일 `migration-state.json`(migration.md §6.5, §8.4 [제안]). 지금은 감지 표지를 숨긴 기록만 둔다(`migration.dismiss`).
// 상태 디렉터리 바로 아래에 두고, 임시 파일을 쓴 뒤 이름을 바꿔 덮는다. 쓰기는 한 줄로 세운다.
// 손상된 파일은 빈 기록으로 읽고 경고를 남긴다(숨김이 풀리는 쪽이라 안전하다). 읽지 못하는 것(권한 등)은 실패다.

const MIGRATION_STATE_FILE = "migration-state.json";

/** 숨긴 표지 하나. `root`는 프로젝트 루트의 정규 절대 경로, `at`은 숨긴 시각(ISO)이다 */
interface DismissRecord {
  readonly root: string;
  readonly marker: string;
  readonly at: string;
}

const DismissRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  marker: Type.String({ minLength: 1 }),
  at: Type.String({ minLength: 1 }),
});
const StateFileSchema = Type.Object({
  version: Type.Literal(1),
  dismissed: Type.Array(DismissRecordSchema),
});

/** 상태 파일을 읽거나 쓰지 못했다. `code`는 시스템 오류 코드다(경로는 싣지 않는다) */
interface MigrationStateFailure {
  readonly kind: "io";
  readonly code: string;
}

export interface MigrationState {
  /** 숨긴 (root, marker)의 키 집합 */
  dismissedKeys(): Promise<Result<ReadonlySet<string>, MigrationStateFailure>>;
  /** 숨김 하나를 기록한다. 같은 키가 있으면 시각을 새로 한다 */
  dismiss(record: DismissRecord): Promise<Result<void, MigrationStateFailure>>;
}

/** 숨김 키. JSON 배열로 묶어 `root`와 `marker` 사이의 구분자가 값에 나와도 섞이지 않게 한다 */
export function dismissKeyOf(root: string, marker: string): string {
  return JSON.stringify([root, marker]);
}

function codeOfThrown(thrown: Thrown): string {
  const cause = thrown.cause;
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "unknown";
}

function isMissing(thrown: Thrown): boolean {
  return codeOfThrown(thrown) === "ENOENT";
}

/** 상태 파일 `<stateDir>/migration-state.json`을 쓰는 구현 */
export function createMigrationState(deps: {
  readonly stateDir: string;
  readonly log: Logger;
}): MigrationState {
  const file = join(deps.stateDir, MIGRATION_STATE_FILE);
  // 읽은 기록의 메모리 복사. 쓰기가 성공한 뒤에만 바뀐다
  let cache: readonly DismissRecord[] | undefined;
  // 쓰기와 읽기를 한 줄로 세운다. 각 작업은 실패를 값으로 돌려주므로 사슬이 끊기지 않는다
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Result<readonly DismissRecord[], MigrationStateFailure>> {
    if (cache !== undefined) return ok(cache);
    const text = await attemptAsync(() => readFile(file, "utf8"));
    if (!text.ok) {
      if (isMissing(text.error)) {
        cache = [];
        return ok(cache);
      }
      return err({ kind: "io", code: codeOfThrown(text.error) });
    }
    const json = parseJson(text.value);
    const checked = json.ok ? parse(StateFileSchema, json.value) : undefined;
    if (checked === undefined || !checked.ok) {
      deps.log.warn("migration.state.corrupt", {});
      cache = [];
      return ok(cache);
    }
    cache = checked.value.dismissed;
    return ok(cache);
  }

  async function write(
    records: readonly DismissRecord[],
  ): Promise<Result<void, MigrationStateFailure>> {
    const body = `${JSON.stringify({ version: 1, dismissed: records }, null, 2)}\n`;
    const temp = `${file}.tmp`;
    const done = await attemptAsync(async () => {
      await mkdir(deps.stateDir, { recursive: true });
      await writeFile(temp, body, { mode: 0o600 });
      await rename(temp, file);
    });
    return done.ok ? ok(undefined) : err({ kind: "io", code: codeOfThrown(done.error) });
  }

  /** 작업 하나를 앞선 작업이 끝난 뒤에 돌린다 */
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run;
    return run;
  }

  return {
    async dismissedKeys() {
      const loaded = await load();
      if (!loaded.ok) return loaded;
      return ok(new Set(loaded.value.map((record) => dismissKeyOf(record.root, record.marker))));
    },

    dismiss(record) {
      return serialized(async () => {
        const loaded = await load();
        if (!loaded.ok) return loaded;
        const key = dismissKeyOf(record.root, record.marker);
        const next = [
          ...loaded.value.filter((item) => dismissKeyOf(item.root, item.marker) !== key),
          record,
        ];
        const written = await write(next);
        if (written.ok) cache = next;
        return written;
      });
    },
  };
}
