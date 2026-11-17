import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  PROFILE_LIMITS,
  ProfilesFileSchema,
  type CommonSet,
  type Profile,
  type ProfilesFile,
  type Unsubscribe,
} from "@fresnel/contracts/wire";
import type { FileLock, FileLockError } from "@fresnel/platform-os";
import { replaceFileAtomically } from "../trust.ts";
import { DEFAULT_PROFILE_ID, NEVER_EDITED_ISO } from "./profile-defaults.ts";
import {
  defaultProfileOf,
  migrateV1,
  V1ProfilesFileSchema,
  type LegacyInputs,
  type MigrationEntry,
  type V1ProfilesFile,
} from "./profile-migrate.ts";

// 프로필 저장소(M5c §3.2, §7.2·§7.3). 사용자 설정 폴더의 `profiles.json`이 형식 v2 `{schemaVersion: 2, common, profiles}`다.
// 저장되는 것은 내장 `default`를 포함한 프로필이지만, `default`는 처음 고칠 때까지 파일에 없고 공장 값으로 읽힌다(port가 채운다).
// 읽기와 쓰기는 파일 잠금 안에서 한다. 쓰기는 임시 파일에 쓰고 이름을 바꾼다(`replaceFileAtomically`).
// v1 파일을 만나면 잠금 안에서 옮긴다: `profiles.json.v1.bak`을 쓰고, `migration.log`에 한 줄씩 남기고, v2를 쓴다.
// 손상된 파일은 `corrupt`로 돌려주고 덮어쓰지 않는다.

export type ProfileStoreFailure =
  /** 파일이 JSON이 아니거나 v1·v2 어느 모양도 아니다. 덮어쓰지 않는다 */
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  | { readonly kind: "not_found"; readonly id: string }
  /** `baseRev`가 저장된 `rev`와 다르다. `rev`가 null이면 저장된 것이 없다. `id`가 `common`이면 공통 묶음이다 */
  | {
      readonly kind: "conflict";
      readonly id: string;
      readonly rev: number | null;
      readonly baseRev: number | null;
    }
  /** 프로필 개수 상한을 넘는다 */
  | { readonly kind: "limit"; readonly max: number };

/** 저장이 바뀌었을 때의 알림 내용. `profile.changed`의 원천이다 */
export interface ProfilesChange {
  /** 목록 개정 */
  readonly rev: number;
  /** 바뀐 프로필 id(추가, 수정, 삭제 모두) */
  readonly ids: readonly string[];
  /** 공통 묶음이 바뀌었는가 */
  readonly commonChanged: boolean;
}

/**
 * 쓴 직후의 저장 내용. `onWritten`이 `ProfilesChange`와 같은 순간에 준다. 켜짐 집합(E(T))의 메모리 복사가 이것으로
 * 호출한 쪽이 응답을 받기 전에 맞는다(읽기 전에 쓰기가 끝나 있어야 하므로 목록을 다시 읽는 비동기 경로를 두지 않는다)
 */
export interface ProfilesWritten {
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
}

/** 저장된 내용 전체(내장 `default`는 저장되어 있을 때만 `profiles`에 있다) */
export interface ProfileStoreSnapshot {
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
  /** 목록 개정. 파일 내용이 바뀌는 것을 이 프로세스가 본 읽기와 이 프로세스의 쓰기마다 하나 오른다 */
  readonly rev: number;
}

/** 잠금 안에서 만들어 쓸 새 내용 */
interface ProfileStoreChange<T> {
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
  readonly value: T;
}

/** 첫 시작 옮김의 프로필 부분이 한 일(§7.2). `unchanged`면 파일에 쓴 것이 없다 */
export type FirstStartProfileOutcome = "migrated" | "default_added" | "unchanged";

export interface ProfileStore {
  read(): Promise<Result<ProfileStoreSnapshot, ProfileStoreFailure>>;
  /**
   * 첫 시작 옮김의 프로필 부분(M5c §7.2·§7.3). 호출자가 사용자 파일에서 읽은 값으로 입력을 만든다.
   * 잠금 안에서 `profiles.json`이 v1이면 옮기고, 저장된 `default` 행이 없는데 옮길 사용자 값이 있으면 옮긴 기본 행을 더한다.
   * 그 밖에는 아무것도 쓰지 않는다.
   */
  migrateFirstStart(
    inputs: LegacyInputs,
  ): Promise<Result<FirstStartProfileOutcome, ProfileStoreFailure>>;
  /**
   * 잠금 안에서 읽고, `change`가 돌려준 새 내용을 쓴다. `change`가 오류를 돌려주면 파일은 그대로다.
   * 쓰고 나면 바뀐 것을 알린다(`ProfilesChange`).
   */
  transact<T, E>(
    change: (snapshot: ProfileStoreSnapshot) => Result<ProfileStoreChange<T>, E>,
  ): Promise<Result<{ readonly value: T; readonly rev: number }, E | ProfileStoreFailure>>;
  /** 이 호스트가 파일을 바꿀 때마다 부른다. 외부 편집은 알리지 않는다 */
  onChange(listener: (change: ProfilesChange) => void): Unsubscribe;
  /** `onChange`와 같은 순간에, 쓴 내용 전체를 준다. 바뀐 것이 없으면 부르지 않는다 */
  onWritten(listener: (written: ProfilesWritten) => void): Unsubscribe;
}

export interface ProfileStoreDeps {
  /** `profiles.json`의 절대 경로 */
  readonly path: string;
  /** 옮김 기록 파일(`migration.log`)의 절대 경로. 호스트 상태 폴더 아래다 */
  readonly migrationLogPath: string;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`) */
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  /** 옮김 입력. 옮김이 필요할 때만 부른다 */
  readonly legacy: () => LegacyInputs;
}

/** 공통 묶음을 한 번도 쓰지 않았을 때의 값(rev 0) */
function emptyCommon(): CommonSet {
  return { plugins: [], settings: [], updatedAt: NEVER_EDITED_ISO, rev: 0 };
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

const MAX_PROFILES = PROFILE_LIMITS.profiles;

type Raw =
  | { readonly kind: "absent" }
  | { readonly kind: "current"; readonly text: string; readonly file: ProfilesFile }
  | { readonly kind: "legacy"; readonly text: string; readonly file: V1ProfilesFile };

function serialize(file: ProfilesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** 저장된 프로필이 바뀌었는지와 어느 id가 바뀌었는지를 셈한다. 알림 내용이다 */
function changedIds(before: readonly Profile[], after: readonly Profile[]): string[] {
  const previous = new Map(before.map((profile) => [profile.id, JSON.stringify(profile)] as const));
  const next = new Map(after.map((profile) => [profile.id, JSON.stringify(profile)] as const));
  const ids = new Set<string>();
  for (const [id, json] of next) if (previous.get(id) !== json) ids.add(id);
  for (const id of previous.keys()) if (!next.has(id)) ids.add(id);
  return [...ids];
}

export function createProfileStore(deps: ProfileStoreDeps): ProfileStore {
  const { path } = deps;
  const listeners = new Set<(change: ProfilesChange) => void>();
  const writtenListeners = new Set<(written: ProfilesWritten) => void>();
  // 목록 개정은 이 프로세스가 센다. `text`는 마지막으로 본 파일 내용(없으면 null)이다
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

  /** 파일을 읽고 모양을 가린다. 잠금 밖에서도 부를 수 있다 */
  async function load(): Promise<Result<Raw, ProfileStoreFailure>> {
    const raw = await attemptAsync(() => readFile(path, "utf8"));
    if (!raw.ok) {
      const code = errorCode(raw.error.cause);
      if (code === "ENOENT") return ok({ kind: "absent" });
      return err({ kind: "io", path, code });
    }
    const text = raw.value;
    const json = parseJson(text);
    if (!json.ok) return err({ kind: "corrupt", path, reason: "not JSON" });
    const current = parse(ProfilesFileSchema, json.value);
    if (current.ok) return ok({ kind: "current", text, file: current.value });
    const legacy = parse(V1ProfilesFileSchema, json.value);
    if (legacy.ok) return ok({ kind: "legacy", text, file: legacy.value });
    const first = current.error.issues[0];
    return err({
      kind: "corrupt",
      path,
      reason: first === undefined ? "schema" : `${first.path}: ${first.message}`,
    });
  }

  /** v1을 옮긴다: 백업 → 옮김 기록 → v2 쓰기. 중간에 실패하면 파일은 v1 그대로라 다시 돌면 된다 */
  async function migrate(
    text: string,
    legacy: V1ProfilesFile,
    inputs: LegacyInputs,
  ): Promise<Result<ProfilesFile, ProfileStoreFailure>> {
    const moved = migrateV1(legacy, inputs, new Date(deps.clock.now()).toISOString());
    const backup = await attemptAsync(() => writeFile(`${path}.v1.bak`, text, { flag: "wx" }));
    if (!backup.ok && errorCode(backup.error.cause) !== "EEXIST") {
      return err({ kind: "io", path, code: errorCode(backup.error.cause) });
    }
    const logged = await attemptAsync(async () => {
      await mkdir(dirname(deps.migrationLogPath), { recursive: true });
      await appendFile(deps.migrationLogPath, migrationLines(moved.log, deps.clock.now()));
    });
    if (!logged.ok) return err({ kind: "io", path, code: errorCode(logged.error.cause) });
    const written = await persist(moved.file);
    if (!written.ok) return written;
    return ok(moved.file);
  }

  /** 잠금 밖의 옮김 확인. v1이 아니면 아무것도 하지 않는다 */
  async function ensureCurrent(): Promise<Result<void, ProfileStoreFailure>> {
    const first = await load();
    if (!first.ok) return first;
    if (first.value.kind !== "legacy") return ok(undefined);
    const locked = await deps.fileLock.withLock(
      path,
      async (): Promise<Result<void, ProfileStoreFailure>> => {
        const again = await load();
        if (!again.ok) return again;
        if (again.value.kind !== "legacy") return ok(undefined);
        const migrated = await migrate(again.value.text, again.value.file, deps.legacy());
        return migrated.ok ? ok(undefined) : migrated;
      },
      { signal: deps.signal },
    );
    if (!locked.ok) return err({ kind: "io", path, code: lockFailureCode(locked.error) });
    return locked.value;
  }

  /** 잠금 안에서 현재 내용을 읽는다. 옛 모양이면 여기서도 옮긴다 */
  async function snapshotLocked(): Promise<Result<ProfileStoreSnapshot, ProfileStoreFailure>> {
    const raw = await load();
    if (!raw.ok) return raw;
    if (raw.value.kind === "absent") {
      observe(null);
      return ok({ profiles: [], common: emptyCommon(), rev: state.rev });
    }
    if (raw.value.kind === "legacy") {
      const migrated = await migrate(raw.value.text, raw.value.file, deps.legacy());
      if (!migrated.ok) return migrated;
      observe(serialize(migrated.value));
      return ok({
        profiles: migrated.value.profiles,
        common: migrated.value.common,
        rev: state.rev,
      });
    }
    observe(raw.value.text);
    return ok({
      profiles: raw.value.file.profiles,
      common: raw.value.file.common,
      rev: state.rev,
    });
  }

  async function persist(file: ProfilesFile): Promise<Result<void, ProfileStoreFailure>> {
    state.tmp += 1;
    const text = serialize(file);
    const written = await attemptAsync(() =>
      replaceFileAtomically(path, text, `${String(process.pid)}-p${String(state.tmp)}`),
    );
    if (!written.ok) return err({ kind: "io", path, code: errorCode(written.error.cause) });
    state.text = text;
    state.rev += 1;
    return ok(undefined);
  }

  /**
   * 저장된 `default` 행이 없을 때 옮긴 기본 행을 더한다. 파일이 없으면 공통 묶음은 빈 값이다. 있으면 다른 프로필과 공통 묶음을 그대로 둔다.
   * 잠금 안에서 부른다.
   */
  async function addDefaultRow(
    stored: ProfilesFile | undefined,
    inputs: LegacyInputs,
  ): Promise<Result<FirstStartProfileOutcome, ProfileStoreFailure>> {
    const now = new Date(deps.clock.now()).toISOString();
    const row = defaultProfileOf(inputs, now);
    const others = stored?.profiles ?? [];
    if (others.length + 1 > MAX_PROFILES) return err({ kind: "limit", max: MAX_PROFILES });
    const next: ProfilesFile = {
      schemaVersion: 2,
      common: stored?.common ?? { plugins: [], settings: [], updatedAt: now, rev: 0 },
      profiles: [row, ...others],
    };
    const written = await persist(next);
    if (!written.ok) return written;
    const logged = await attemptAsync(async () => {
      await mkdir(dirname(deps.migrationLogPath), { recursive: true });
      await appendFile(
        deps.migrationLogPath,
        `${JSON.stringify({
          at: new Date(deps.clock.now()).toISOString(),
          step: "default_added",
          profileId: DEFAULT_PROFILE_ID,
          plugins: row.plugins.length,
        })}\n`,
      );
    });
    if (!logged.ok) return err({ kind: "io", path, code: errorCode(logged.error.cause) });
    return ok("default_added");
  }

  function emit(change: ProfilesChange, written: ProfilesWritten): void {
    for (const listener of listeners) listener(change);
    for (const listener of writtenListeners) listener(written);
  }

  return {
    async migrateFirstStart(inputs) {
      const locked = await deps.fileLock.withLock(
        path,
        async (): Promise<Result<FirstStartProfileOutcome, ProfileStoreFailure>> => {
          const raw = await load();
          if (!raw.ok) return raw;
          if (raw.value.kind === "legacy") {
            const moved = await migrate(raw.value.text, raw.value.file, inputs);
            return moved.ok ? ok("migrated") : moved;
          }
          const stored = raw.value.kind === "current" ? raw.value.file : undefined;
          const hasDefault = stored?.profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID);
          // 공장 값과 같은 기본은 쓸 것이 없다. 저장된 기본이 있으면 이미 옮겼거나 고친 것이라 건드리지 않는다
          if (hasDefault === true || inputs.userEnabled.size === 0) return ok("unchanged");
          return addDefaultRow(stored, inputs);
        },
        { signal: deps.signal },
      );
      if (!locked.ok) return err({ kind: "io", path, code: lockFailureCode(locked.error) });
      return locked.value;
    },
    async read() {
      const migrated = await ensureCurrent();
      if (!migrated.ok) return migrated;
      const raw = await load();
      if (!raw.ok) return raw;
      if (raw.value.kind === "absent") {
        observe(null);
        return ok({ profiles: [], common: emptyCommon(), rev: state.rev });
      }
      if (raw.value.kind === "legacy")
        return err({ kind: "corrupt", path, reason: "v1 after migration" });
      observe(raw.value.text);
      return ok({
        profiles: raw.value.file.profiles,
        common: raw.value.file.common,
        rev: state.rev,
      });
    },
    async transact<T, E>(
      change: (snapshot: ProfileStoreSnapshot) => Result<ProfileStoreChange<T>, E>,
    ) {
      const migrated = await ensureCurrent();
      if (!migrated.ok) return migrated;
      const locked = await deps.fileLock.withLock(
        path,
        async (): Promise<
          Result<
            {
              readonly value: T;
              readonly rev: number;
              readonly ids: readonly string[];
              readonly commonChanged: boolean;
              readonly profiles: readonly Profile[];
              readonly common: CommonSet;
            },
            E | ProfileStoreFailure
          >
        > => {
          const snapshot = await snapshotLocked();
          if (!snapshot.ok) return snapshot;
          const next = change(snapshot.value);
          if (!next.ok) return next;
          if (next.value.profiles.length > MAX_PROFILES) {
            return err({ kind: "limit", max: MAX_PROFILES });
          }
          const written = await persist({
            schemaVersion: 2,
            common: next.value.common,
            profiles: next.value.profiles,
          });
          if (!written.ok) return written;
          return ok({
            value: next.value.value,
            rev: state.rev,
            ids: changedIds(snapshot.value.profiles, next.value.profiles),
            commonChanged:
              JSON.stringify(snapshot.value.common) !== JSON.stringify(next.value.common),
            profiles: next.value.profiles,
            common: next.value.common,
          });
        },
        { signal: deps.signal },
      );
      if (!locked.ok) return err({ kind: "io", path, code: lockFailureCode(locked.error) });
      if (!locked.value.ok) return locked.value;
      const done = locked.value.value;
      if (done.ids.length > 0 || done.commonChanged) {
        emit(
          { rev: done.rev, ids: [...done.ids], commonChanged: done.commonChanged },
          { profiles: done.profiles, common: done.common },
        );
      }
      return ok({ value: done.value, rev: done.rev });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onWritten(listener) {
      writtenListeners.add(listener);
      return () => {
        writtenListeners.delete(listener);
      };
    },
  };
}

function migrationLines(entries: readonly MigrationEntry[], nowMs: number): string {
  const at = new Date(nowMs).toISOString();
  return entries.map((entry) => `${JSON.stringify({ at, from: 1, to: 2, ...entry })}\n`).join("");
}
