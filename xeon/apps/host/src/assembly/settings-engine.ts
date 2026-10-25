import { readFile } from "node:fs/promises";
import { parseJson } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SessionSettingsStore } from "@xeon/contracts/records";
import {
  resolveSetting,
  type ScopeLayer,
  type ScopeStack,
  type SettingCatalog,
} from "@xeon/contracts/settings";
import type { SettingsChange } from "../types.ts";

// L4.host-service.spec §3.3.2 SettingsStorePort의 읽기 쪽. 설정 파일 범위의 위치·읽기·병합은 호스트 소유다
// (L1.persistence.spec §6.2 마지막 [제안]). M1은 사용자 파일 하나와 세션 범위를 읽는다:
// - managed: 위치가 OS별 관리 정책 파일이라 정해지지 않았다(F wire §3.9). M1은 읽지 않는다.
// - project·local: 신뢰 판정(X.loading-trust §4.7.4)이 구현되기 전에는 프로젝트 파일을 적용하지 않는다. pi 방식이다.
// 파일 형식은 평평한 객체이고 키는 전체 설정 키다(settingsJsonSchema의 파일 모양).
// project·local은 신뢰한 작업 폴더의 `.xeon/settings.json`, `.xeon/settings.local.json`이다(X.loading-trust.spec §4.7.2).
// layers가 동기라서 신뢰 판정과 파일 읽기는 설정 저장소(settings-store.ts)가 먼저 하고 결과를 `setWorkspaceFiles`로 넣는다.

/** 신뢰한 작업 폴더의 project·local 설정 파일 내용. 파일이 없으면 빈 맵이다 */
interface WorkspaceSettingFiles {
  readonly project: ReadonlyMap<string, unknown>;
  readonly projectPath: string;
  readonly local: ReadonlyMap<string, unknown>;
  readonly localPath: string;
}

export interface SettingsEngine {
  readonly catalog: SettingCatalog;
  /** 사용자 설정 파일을 읽는다. 없으면 빈 범위다. 읽을 수 없거나 JSON이 아니면 진단을 남기고 빈 범위다 */
  loadUserFile(path: string): Promise<void>;
  /** 세션 범위를 읽을 저장소. 세션 서비스가 올라온 뒤 연결한다 */
  bindSession(store: SessionSettingsStore): void;
  /** thread의 작업 폴더를 찾는 함수. thread를 만들고 여는 세션 서비스가 올라온 뒤 연결한다 */
  bindWorkspaces(lookup: (threadId: ThreadId) => string | undefined): void;
  layers(threadId: ThreadId | undefined): ScopeStack;
  /** 사용자 설정 파일의 경로. `loadUserFile` 전에는 undefined */
  userPath(): string | undefined;
  /** 사용자 범위 값을 메모리에 반영한다(파일에 쓴 뒤 부른다). value가 undefined면 키를 지운다 */
  setUserValue(key: string, value: unknown): void;
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

export function createSettingsEngine(catalog: SettingCatalog): SettingsEngine {
  const state: {
    user: ReadonlyMap<string, unknown>;
    userPath: string | undefined;
    session: SessionSettingsStore | undefined;
    workspaceOf: ((threadId: ThreadId) => string | undefined) | undefined;
  } = {
    user: new Map(),
    userPath: undefined,
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
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (caught) {
        const code = errorCode(caught);
        if (code !== "ENOENT") diagnostics.push(`settings.user_unreadable: ${code}`);
        state.user = new Map();
        return;
      }
      const decoded = parseJson(text);
      if (!decoded.ok) {
        diagnostics.push("settings.user_invalid_json");
        state.user = new Map();
        return;
      }
      const parsed = decoded.value;
      if (!isRecord(parsed)) {
        diagnostics.push("settings.user_not_object");
        state.user = new Map();
        return;
      }
      state.user = new Map(Object.entries(parsed));
    },
    bindSession(store) {
      state.session = store;
    },
    bindWorkspaces(lookup) {
      state.workspaceOf = lookup;
    },
    layers,
    userPath: () => state.userPath,
    setUserValue(key, value) {
      const next = new Map(state.user);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      state.user = next;
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
