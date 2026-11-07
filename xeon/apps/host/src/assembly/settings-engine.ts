import { readFile } from "node:fs/promises";
import { assertNever, attemptAsync, jsonErrorPosition, parseJson } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { SessionSettingsStore } from "@fresnel/contracts/records";
import {
  resolveSetting,
  type ScopeLayer,
  type ScopeStack,
  type SettingCatalog,
} from "@fresnel/contracts/settings";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";
import type { SettingsChange } from "../types.ts";

// L4.host-service.spec §3.3.2 SettingsStorePort의 읽기 쪽. 설정 파일 범위의 위치·읽기·병합은 호스트 소유다
// (L1.persistence.spec §6.2 마지막 [제안]). M1은 사용자 파일 하나와 세션 범위를 읽는다:
// - managed: 위치가 OS별 관리 정책 파일이라 정해지지 않았다(F wire §3.9). M1은 읽지 않는다.
// - project·local: 신뢰 판정(X.loading-trust §4.7.4)이 구현되기 전에는 프로젝트 파일을 적용하지 않는다. pi 방식이다.
// 파일 형식은 평평한 객체이고 키는 전체 설정 키다(settingsJsonSchema의 파일 모양).
// project·local은 신뢰한 작업 폴더의 `.fresnel/settings.json`, `.fresnel/settings.local.json`이다(X.loading-trust.spec §4.7.2).
// layers가 동기라서 신뢰 판정과 파일 읽기는 설정 저장소(settings-store.ts)가 먼저 하고 결과를 `setWorkspaceFiles`로 넣는다.

/**
 * 설정 파일 하나를 읽은 결과. 없는 파일은 빈 값이다. 문제는 이유와 위치만 싣고 파일의 값과 원문은 싣지 않는다
 * (F wire §3.3.1 `settingsProblems`).
 */
export type FileRead =
  | { readonly kind: "ok"; readonly values: ReadonlyMap<string, unknown> }
  | {
      readonly kind: "invalid";
      readonly reason: "invalid_json" | "not_object";
      /** 첫 문법 오류의 위치. JSON 문법 오류가 아니면(객체가 아닌 경우) null */
      readonly line: number | null;
      readonly column: number | null;
    }
  | { readonly kind: "unreadable"; readonly code: string };

/** 신뢰한 작업 폴더의 project·local 설정 파일 내용. 파일이 없으면 빈 맵이다 */
interface WorkspaceSettingFiles {
  readonly project: ReadonlyMap<string, unknown>;
  readonly projectPath: string;
  readonly local: ReadonlyMap<string, unknown>;
  readonly localPath: string;
}

export interface SettingsEngine {
  readonly catalog: SettingCatalog;
  /** 사용자 설정 파일을 읽는다. 없으면 빈 범위다. 읽을 수 없거나 JSON이 아니면 진단과 문제를 남기고 빈 범위다 */
  loadUserFile(path: string): Promise<void>;
  /** 세션 범위를 읽을 저장소. 세션 서비스가 올라온 뒤 연결한다 */
  bindSession(store: SessionSettingsStore): void;
  /** thread의 작업 폴더를 찾는 함수. thread를 만들고 여는 세션 서비스가 올라온 뒤 연결한다 */
  bindWorkspaces(lookup: (threadId: ThreadId) => string | undefined): void;
  layers(threadId: ThreadId | undefined): ScopeStack;
  /** 사용자 설정 파일의 경로. `loadUserFile` 전에는 undefined */
  userPath(): string | undefined;
  /** 사용자 설정 파일을 읽지 못한 이유(`settingsProblems`의 원천). 읽었거나 파일이 없으면 undefined. 값은 싣지 않는다 */
  userProblem(): SettingsFileProblem | undefined;
  /** 사용자 범위의 문제를 바꾼다. 파일을 읽거나 쓴 뒤에 부른다. undefined면 문제가 없다 */
  setUserProblem(problem: SettingsFileProblem | undefined): void;
  /** 사용자 범위 값을 메모리에 반영한다(파일에 쓴 뒤 부른다). value가 undefined면 키를 지운다 */
  setUserValue(key: string, value: unknown): void;
  /** 지금 메모리에 있는 사용자 범위 값 */
  userValues(): ReadonlyMap<string, unknown>;
  /** 사용자 범위 값 전체를 바꾼다(파일 통째 쓰기, 외부 변경 반영). 경로는 그대로 둔다 */
  replaceUserValues(values: ReadonlyMap<string, unknown>): void;
  /** 작업 폴더의 project·local 층을 정한다. `undefined`는 층을 거둔다(신뢰하지 않는 폴더) */
  setWorkspaceFiles(workspace: string, files: WorkspaceSettingFiles | undefined): void;
  hasWorkspaceFiles(workspace: string): boolean;
  /** 모든 작업 폴더의 project·local 층을 거둔다. 신뢰 결정이 바뀐 뒤 다음 `prepare`가 판정을 다시 해 읽게 한다 */
  clearWorkspaceFiles(): void;
  /** 설정이 바뀔 때마다 부른다(범위와 무관). 돌려주는 함수로 구독을 푼다. 확장(cap-web의 탐침 기억)과 wire 알림(`settings.invalidated`)이 같은 신호를 듣는다 */
  onChange(listener: (change: SettingsChange) => void): () => void;
  /** 설정이 바뀌었음을 알린다. 설정 저장소가 쓰기 뒤에, 신뢰 결정이 층을 다시 읽은 뒤에 부른다 */
  notifyChanged(change: SettingsChange): void;
  /** 카탈로그 키의 유효 값. 모르는 키는 undefined다 */
  value(key: string, threadId?: ThreadId): unknown;
  /**
   * 선언을 아직 내놓지 않은 패키지(`l0.store.`, `l1.persistence.` 등)가 읽을 값: 사용자 파일에서 prefix로 시작하는 키를
   * prefix를 뗀 이름의 객체로 돌려준다. 값 검사는 읽는 패키지의 resolve 함수가 한다.
   */
  raw(prefix: string): Readonly<Record<string, unknown>>;
  /** 파일을 읽으며 생긴 진단(값은 싣지 않는다) */
  readonly diagnostics: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** 파일 원문을 JSON 객체로 읽는다. JSON 문법 오류는 첫 오류의 줄과 칸을, 객체가 아니면 위치 없이 이유를 싣는다 */
export function fileReadOfText(text: string): FileRead {
  const decoded = parseJson(text);
  if (!decoded.ok) {
    const position = jsonErrorPosition(text);
    return {
      kind: "invalid",
      reason: "invalid_json",
      line: position?.line ?? null,
      column: position?.column ?? null,
    };
  }
  if (!isRecord(decoded.value)) {
    return { kind: "invalid", reason: "not_object", line: null, column: null };
  }
  return { kind: "ok", values: new Map(Object.entries(decoded.value)) };
}

/** 설정 파일을 읽는다. 없으면 빈 값이다. 읽기 오류는 OS 오류 코드를 싣는다(값과 원문은 싣지 않는다) */
export async function readSettingsFile(path: string): Promise<FileRead> {
  const read = await attemptAsync(() => readFile(path, "utf8"));
  if (!read.ok) {
    const code = errorCode(read.error.cause);
    return code === "ENOENT" ? { kind: "ok", values: new Map() } : { kind: "unreadable", code };
  }
  return fileReadOfText(read.value);
}

/** 읽은 결과가 문제면 그 파일의 `settingsProblems` 값을 만든다. 잘 읽었으면 undefined다 */
export function problemOfRead(
  scope: "user",
  path: string,
  read: FileRead,
): SettingsFileProblem | undefined {
  switch (read.kind) {
    case "ok":
      return undefined;
    case "invalid":
      return { scope, path, reason: read.reason, line: read.line, column: read.column };
    case "unreadable":
      return {
        scope,
        path,
        reason: "unreadable",
        line: null,
        column: null,
        code: read.code.slice(0, 64),
      };
    default:
      return assertNever(read, "FileRead");
  }
}

export function createSettingsEngine(catalog: SettingCatalog): SettingsEngine {
  const state: {
    user: ReadonlyMap<string, unknown>;
    userPath: string | undefined;
    userProblem: SettingsFileProblem | undefined;
    session: SessionSettingsStore | undefined;
    workspaceOf: ((threadId: ThreadId) => string | undefined) | undefined;
  } = {
    user: new Map(),
    userPath: undefined,
    userProblem: undefined,
    session: undefined,
    workspaceOf: undefined,
  };
  const workspaceFiles = new Map<string, WorkspaceSettingFiles>();
  const listeners = new Set<(change: SettingsChange) => void>();
  const diagnostics: string[] = [];

  function layers(threadId: ThreadId | undefined): ScopeStack {
    const stack: ScopeLayer[] = [
      {
        scope: "user",
        values: state.user,
        ...(state.userPath === undefined ? {} : { path: state.userPath }),
      },
    ];
    const workspace = threadId === undefined ? undefined : state.workspaceOf?.(threadId);
    const files = workspace === undefined ? undefined : workspaceFiles.get(workspace);
    if (files !== undefined) {
      stack.push(
        { scope: "project", values: files.project, path: files.projectPath },
        { scope: "local", values: files.local, path: files.localPath },
      );
    }
    if (threadId !== undefined && state.session !== undefined) {
      stack.push(state.session.layer(threadId));
    }
    return stack;
  }

  return {
    catalog,
    diagnostics,
    async loadUserFile(path) {
      state.userPath = path;
      const read = await readSettingsFile(path);
      state.userProblem = problemOfRead("user", path, read);
      if (read.kind === "ok") {
        state.user = read.values;
        return;
      }
      // 읽지 못한 범위는 비운다. 이유는 진단과 문제로 알린다(값과 원문은 싣지 않는다)
      state.user = new Map();
      if (read.kind === "unreadable") diagnostics.push(`settings.user_unreadable: ${read.code}`);
      else if (read.reason === "invalid_json") diagnostics.push("settings.user_invalid_json");
      else diagnostics.push("settings.user_not_object");
    },
    bindSession(store) {
      state.session = store;
    },
    bindWorkspaces(lookup) {
      state.workspaceOf = lookup;
    },
    layers,
    userPath: () => state.userPath,
    userProblem: () => state.userProblem,
    setUserProblem(problem) {
      state.userProblem = problem;
    },
    setUserValue(key, value) {
      const next = new Map(state.user);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      state.user = next;
    },
    userValues: () => state.user,
    replaceUserValues(values) {
      state.user = new Map(values);
    },
    setWorkspaceFiles(workspace, files) {
      if (files === undefined) workspaceFiles.delete(workspace);
      else workspaceFiles.set(workspace, files);
    },
    hasWorkspaceFiles: (workspace) => workspaceFiles.has(workspace),
    clearWorkspaceFiles() {
      workspaceFiles.clear();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notifyChanged(change) {
      for (const listener of Array.from(listeners)) listener(change);
    },
    value(key, threadId) {
      const def = catalog.get(key);
      if (def === undefined) return undefined;
      return resolveSetting(def, layers(threadId)).setting.value;
    },
    raw(prefix) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of state.user) {
        if (key.startsWith(prefix) && key.length > prefix.length) {
          out[key.slice(prefix.length)] = value;
        }
      }
      return out;
    },
  };
}
