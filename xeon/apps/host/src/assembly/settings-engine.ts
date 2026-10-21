import { readFile } from "node:fs/promises";
import { Bug } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SessionSettingsStore } from "@xeon/contracts/records";
import {
  resolveSetting,
  type ScopeLayer,
  type ScopeStack,
  type SettingCatalog,
} from "@xeon/contracts/settings";

// L4.host-service.spec §3.3.2 SettingsStorePort의 읽기 쪽. 설정 파일 범위의 위치·읽기·병합은 호스트 소유다
// (L1.persistence.spec §6.2 마지막 [제안]). M1은 사용자 파일 하나와 세션 범위를 읽는다:
// - managed: 위치가 OS별 관리 정책 파일이라 정해지지 않았다(F wire §3.9). M1은 읽지 않는다.
// - project·local: 신뢰 판정(X.loading-trust §4.7.4)이 구현되기 전에는 프로젝트 파일을 적용하지 않는다. pi 방식이다.
// 파일 형식은 평평한 객체이고 키는 전체 설정 키다(settingsJsonSchema의 파일 모양).

export interface SettingsEngine {
  readonly catalog: SettingCatalog;
  /** 사용자 설정 파일을 읽는다. 없으면 빈 범위다. 읽을 수 없거나 JSON이 아니면 진단을 남기고 빈 범위다 */
  loadUserFile(path: string): Promise<void>;
  /** 세션 범위를 읽을 저장소. 세션 서비스가 올라온 뒤 연결한다 */
  bindSession(store: SessionSettingsStore): void;
  layers(threadId: ThreadId | undefined): ScopeStack;
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
    sessionNoticeGiven: boolean;
  } = { user: new Map(), userPath: undefined, session: undefined, sessionNoticeGiven: false };
  const diagnostics: string[] = [];

  function layers(threadId: ThreadId | undefined): ScopeStack {
    const stack: ScopeLayer[] = [
      {
        scope: "user",
        values: state.user,
        ...(state.userPath === undefined ? {} : { path: state.userPath }),
      },
    ];
    if (threadId !== undefined && state.session !== undefined) {
      try {
        stack.push(state.session.layer(threadId));
      } catch (caught) {
        // core-persistence의 세션 범위 설정(sessionSettings.layer, PS-14)은 M2다. 그 전에는 세션 범위 없이 파일 범위만 본다 [미결]
        if (!(caught instanceof Bug) || !/^[a-z]+\.not_implemented:/.test(caught.message))
          throw caught;
        if (!state.sessionNoticeGiven) {
          state.sessionNoticeGiven = true;
          diagnostics.push("settings.session_scope_unavailable");
        }
      }
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        diagnostics.push("settings.user_invalid_json");
        state.user = new Map();
        return;
      }
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
    layers,
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
