import { readFile } from "node:fs/promises";
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
  ProfilesFileSchema,
  type Profile,
  type ProfileInput,
  type ProfileListResult,
  type Unsubscribe,
} from "@fresnel/contracts/wire";
import type { FileLock, FileLockError } from "@fresnel/platform-os";
import { replaceFileAtomically } from "../trust.ts";

// 프로필 저장소(X-18, 사용자 결정 2026-10-31 UX 5번: 호스트 설정 층에 저장). 사용자 설정 폴더의 `profiles.json` 하나다(형식은 F-6의 ProfilesFile).
// 같은 호스트에 붙은 모든 클라이언트가 같은 파일을 본다. 읽고-고치고-쓰기는 L0.os 파일 잠금 안에서, 임시 파일에 써서 이름을 바꾸는 원자 교체로 한다.
// 손상된 파일은 `corrupt` 오류 값으로 돌려주고 덮어쓰지 않는다(F.records.spec 7항 분류와 같은 태도). 프로젝트별 프로필 파일은 [미결](spec §12.1 28번)이라 다루지 않는다.

export type ProfileStoreFailure =
  /** 파일이 JSON이 아니거나 ProfilesFile 모양이 아니다. 덮어쓰지 않는다 */
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  | { readonly kind: "not_found"; readonly id: string }
  /** `baseRev`가 저장된 `rev`와 다르다. `rev`가 null이면 저장된 프로필이 없다 */
  | {
      readonly kind: "conflict";
      readonly id: string;
      readonly rev: number | null;
      readonly baseRev: number | null;
    }
  /** 프로필 개수 상한을 넘는다 */
  | { readonly kind: "limit"; readonly max: number };

export interface ProfilesChange {
  /** 목록 개정(`ProfileListResult.rev`) */
  readonly rev: number;
  readonly ids: readonly string[];
}

export interface ProfileStore {
  list(): Promise<Result<ProfileListResult, ProfileStoreFailure>>;
  get(id: string): Promise<Result<Profile, ProfileStoreFailure>>;
  /** 만들기(`baseRev` null)와 수정. 성공하면 `rev`를 올리고 변경을 알린다 */
  put(
    input: ProfileInput,
    baseRev: number | null,
  ): Promise<Result<{ readonly profile: Profile; readonly rev: number }, ProfileStoreFailure>>;
  remove(id: string): Promise<Result<{ readonly rev: number }, ProfileStoreFailure>>;
  /** 이 호스트가 파일을 바꿀 때마다 부른다. 외부 편집은 알리지 않는다 */
  onChange(listener: (change: ProfilesChange) => void): Unsubscribe;
}

export interface ProfileStoreDeps {
  /** `profiles.json`의 절대 경로 */
  readonly path: string;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`) */
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function lockFailureCode(failure: FileLockError): string {
  return failure.kind;
}

const MAX_PROFILES = 200;

interface Snapshot {
  readonly profiles: readonly Profile[];
  readonly text: string | null;
}

export function createProfileStore(deps: ProfileStoreDeps): ProfileStore {
  const { path } = deps;
  const listeners = new Set<(change: ProfilesChange) => void>();
  // 목록 개정은 이 프로세스가 센다: 파일 내용이 바뀐 것을 본 읽기와 이 프로세스의 쓰기마다 하나 오른다
  const state: { text: string | null | undefined; rev: number; tmp: number } = {
    text: undefined,
    rev: 0,
    tmp: 0,
  };

  function observe(text: string | null): void {
    if (state.text === undefined) {
      state.rev = text === null ? 0 : 1;
    } else if (state.text !== text) {
      state.rev += 1;
    }
    state.text = text;
  }

  async function read(): Promise<Result<Snapshot, ProfileStoreFailure>> {
    const raw = await attemptAsync(() => readFile(path, "utf8"));
    let text: string | null = null;
    if (raw.ok) {
      text = raw.value;
    } else {
      const code = errorCode(raw.error.cause);
      if (code !== "ENOENT") return err({ kind: "io", path, code });
    }
    if (text === null) {
      observe(null);
      return ok({ profiles: [], text: null });
    }
    const json = parseJson(text);
    if (!json.ok) return err({ kind: "corrupt", path, reason: "not JSON" });
    const file = parse(ProfilesFileSchema, json.value);
    if (!file.ok) {
      const first = file.error.issues[0];
      return err({
        kind: "corrupt",
        path,
        reason: first === undefined ? "schema" : `${first.path}: ${first.message}`,
      });
    }
    observe(text);
    return ok({ profiles: file.value.profiles, text });
  }

  function emit(change: ProfilesChange): void {
    for (const listener of listeners) listener(change);
  }

  /** 잠금 안에서 읽고, `change`가 만든 새 목록을 쓴다. `change`가 오류를 돌려주면 파일은 그대로다 */
  async function mutate<T>(
    change: (
      profiles: readonly Profile[],
    ) => Result<{ readonly profiles: readonly Profile[]; readonly value: T }, ProfileStoreFailure>,
  ): Promise<Result<{ readonly value: T; readonly rev: number }, ProfileStoreFailure>> {
    const locked = await deps.fileLock.withLock(
      path,
      async (): Promise<
        Result<{ readonly value: T; readonly rev: number }, ProfileStoreFailure>
      > => {
        const snapshot = await read();
        if (!snapshot.ok) return snapshot;
        const changed = change(snapshot.value.profiles);
        if (!changed.ok) return changed;
        if (changed.value.profiles.length > MAX_PROFILES) {
          return err({ kind: "limit", max: MAX_PROFILES });
        }
        const text = `${JSON.stringify({ schemaVersion: 1, profiles: changed.value.profiles }, null, 2)}\n`;
        state.tmp += 1;
        const written = await attemptAsync(() =>
          replaceFileAtomically(path, text, `${String(process.pid)}-p${String(state.tmp)}`),
        );
        if (!written.ok) return err({ kind: "io", path, code: errorCode(written.error.cause) });
        state.text = text;
        state.rev += 1;
        return ok({ value: changed.value.value, rev: state.rev });
      },
      { signal: deps.signal },
    );
    if (!locked.ok) return err({ kind: "io", path, code: lockFailureCode(locked.error) });
    return locked.value;
  }

  return {
    async list() {
      const snapshot = await read();
      if (!snapshot.ok) return snapshot;
      return ok({ profiles: snapshot.value.profiles, rev: state.rev });
    },
    async get(id) {
      const snapshot = await read();
      if (!snapshot.ok) return snapshot;
      const found = snapshot.value.profiles.find((profile) => profile.id === id);
      return found === undefined ? err({ kind: "not_found", id }) : ok(found);
    },
    async put(input, baseRev) {
      const done = await mutate((profiles) => {
        const existing = profiles.find((profile) => profile.id === input.id);
        const storedRev = existing === undefined ? null : existing.rev;
        if (storedRev !== baseRev) {
          return err({ kind: "conflict", id: input.id, rev: storedRev, baseRev });
        }
        const profile: Profile = {
          id: input.id,
          title: input.title,
          enable: input.enable,
          disable: input.disable,
          settings: input.settings,
          driver: input.driver,
          updatedAt: new Date(deps.clock.now()).toISOString(),
          rev: storedRev === null ? 1 : storedRev + 1,
        };
        const next =
          existing === undefined
            ? [...profiles, profile]
            : profiles.map((item) => (item.id === input.id ? profile : item));
        return ok({ profiles: next, value: profile });
      });
      if (!done.ok) return done;
      emit({ rev: done.value.rev, ids: [input.id] });
      return ok({ profile: done.value.value, rev: done.value.rev });
    },
    async remove(id) {
      const done = await mutate((profiles) => {
        if (!profiles.some((profile) => profile.id === id)) return err({ kind: "not_found", id });
        return ok({ profiles: profiles.filter((profile) => profile.id !== id), value: id });
      });
      if (!done.ok) return done;
      emit({ rev: done.value.rev, ids: [id] });
      return ok({ rev: done.value.rev });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
