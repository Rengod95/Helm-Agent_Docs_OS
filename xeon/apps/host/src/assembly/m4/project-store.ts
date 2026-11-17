import { readFile } from "node:fs/promises";
import { Type, type Static } from "typebox";
import {
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  type Clock,
  type Result,
} from "@fresnel/contracts";
import {
  PROJECT_LIMITS,
  ProjectSchema,
  type Project,
  type Unsubscribe,
} from "@fresnel/contracts/wire";
import type { FileLock } from "@fresnel/platform-os";
import { replaceFileAtomically } from "../trust.ts";

// 프로젝트 저장소(review m5 §3.2). 사용자 설정 폴더의 `projects.json`이 `{schemaVersion: 1, projects, rev}`다.
// 읽기와 쓰기는 파일 잠금 안에서 한다. 쓰기는 임시 파일에 쓰고 이름을 바꾼다(`replaceFileAtomically`).
// 손상된 파일은 `corrupt`로 돌려주고 덮어쓰지 않는다. 같은 내용을 쓰면 `rev`를 올리지 않고 알리지도 않는다.

/** 저장소 자체의 실패. 규칙 위반(없는 프로젝트, 같은 루트)은 포트가 정한다 */
export type ProjectStoreFailure =
  /** 파일이 JSON이 아니거나 모양이 틀리다. 덮어쓰지 않는다 */
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string };

/** 저장이 바뀌었을 때의 알림 내용. `project.changed`의 원천이다 */
export interface ProjectsChange {
  /** 목록 개정 */
  readonly rev: number;
  /** 추가, 수정, 삭제된 프로젝트 id */
  readonly ids: readonly string[];
}

interface ProjectStoreSnapshot {
  readonly projects: readonly Project[];
  /** 파일의 목록 개정. 파일이 없으면 0이다 */
  readonly rev: number;
}

export interface ProjectStore {
  read(): Promise<Result<ProjectStoreSnapshot, ProjectStoreFailure>>;
  /**
   * 잠금 안에서 읽고, `change`가 돌려준 새 목록을 쓴다. `change`가 오류를 돌려주면 파일은 그대로다.
   * 목록이 바뀌었을 때만 쓰고 알린다.
   */
  transact<T, E>(
    change: (
      snapshot: ProjectStoreSnapshot,
    ) => Result<{ readonly projects: readonly Project[]; readonly value: T }, E>,
  ): Promise<Result<{ readonly value: T; readonly rev: number }, E | ProjectStoreFailure>>;
  onChange(listener: (change: ProjectsChange) => void): Unsubscribe;
}

export interface ProjectStoreDeps {
  /** `projects.json`의 절대 경로 */
  readonly path: string;
  /** 프로세스 사이 파일 잠금 */
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

/** `projects.json`의 모양(v1). 항목은 `ProjectSchema`를 그대로 쓴다 */
const ProjectsFileSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    projects: Type.Array(ProjectSchema, { maxItems: PROJECT_LIMITS.projects }),
    rev: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
type ProjectsFile = Static<typeof ProjectsFileSchema>;

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function serialize(file: ProjectsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** 바뀐 프로젝트 id(추가, 수정, 삭제 모두) */
function changedIds(before: readonly Project[], after: readonly Project[]): string[] {
  const previous = new Map(
    before.map((project) => [project.projectId, JSON.stringify(project)] as const),
  );
  const next = new Map(
    after.map((project) => [project.projectId, JSON.stringify(project)] as const),
  );
  const ids = new Set<string>();
  for (const [id, json] of next) if (previous.get(id) !== json) ids.add(id);
  for (const id of previous.keys()) if (!next.has(id)) ids.add(id);
  return [...ids];
}

export function createProjectStore(deps: ProjectStoreDeps): ProjectStore {
  const { path } = deps;
  const listeners = new Set<(change: ProjectsChange) => void>();
  let tmp = 0;

  /** 파일을 읽고 모양을 가린다. 없으면 빈 목록이다 */
  async function load(): Promise<Result<ProjectsFile | null, ProjectStoreFailure>> {
    const raw = await attemptAsync(() => readFile(path, "utf8"));
    if (!raw.ok) {
      const code = errorCode(raw.error.cause);
      if (code === "ENOENT") return ok(null);
      return err({ kind: "io", path, code });
    }
    const json = parseJson(raw.value);
    if (!json.ok) return err({ kind: "corrupt", path, reason: "not JSON" });
    const file = parse(ProjectsFileSchema, json.value);
    if (!file.ok) {
      const first = file.error.issues[0];
      return err({
        kind: "corrupt",
        path,
        reason: first === undefined ? "schema" : `${first.path}: ${first.message}`,
      });
    }
    return ok(file.value);
  }

  async function persist(file: ProjectsFile): Promise<Result<void, ProjectStoreFailure>> {
    tmp += 1;
    const written = await attemptAsync(() =>
      replaceFileAtomically(path, serialize(file), `${String(process.pid)}-j${String(tmp)}`),
    );
    if (!written.ok) return err({ kind: "io", path, code: errorCode(written.error.cause) });
    return ok(undefined);
  }

  return {
    async read() {
      const loaded = await load();
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return ok({ projects: [], rev: 0 });
      return ok({ projects: loaded.value.projects, rev: loaded.value.rev });
    },
    async transact<T, E>(
      change: (
        snapshot: ProjectStoreSnapshot,
      ) => Result<{ readonly projects: readonly Project[]; readonly value: T }, E>,
    ) {
      const locked = await deps.fileLock.withLock(
        path,
        async (): Promise<
          Result<
            { readonly value: T; readonly rev: number; readonly ids: readonly string[] },
            E | ProjectStoreFailure
          >
        > => {
          const loaded = await load();
          if (!loaded.ok) return loaded;
          const before = loaded.value?.projects ?? [];
          const rev = loaded.value?.rev ?? 0;
          const next = change({ projects: before, rev });
          if (!next.ok) return next;
          const ids = changedIds(before, next.value.projects);
          if (ids.length === 0) return ok({ value: next.value.value, rev, ids });
          const written = await persist({
            schemaVersion: 1,
            projects: [...next.value.projects],
            rev: rev + 1,
          });
          if (!written.ok) return written;
          return ok({ value: next.value.value, rev: rev + 1, ids });
        },
        { signal: deps.signal },
      );
      if (!locked.ok) return err({ kind: "io", path, code: locked.error.kind });
      if (!locked.value.ok) return locked.value;
      const done = locked.value.value;
      if (done.ids.length > 0) {
        const event: ProjectsChange = { rev: done.rev, ids: [...done.ids] };
        for (const listener of listeners) listener(event);
      }
      return ok({ value: done.value, rev: done.rev });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
