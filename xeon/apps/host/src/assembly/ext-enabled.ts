import { detach, type Logger } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  ExtHost,
  ExtensionLoader,
  OperationsPolicy,
  RegistrationToggleSourceOf,
} from "@fresnel/ext-host";
import type { SettingsChange } from "../types.ts";

// 일반 켜기 스위치(`settings.set ext.<이름>.enabled true`)를 "다시 켜기"(`ext.reenable`)와 같은 결과로 만든다.
// 설정 쓰기만으로는 로더가 `settingChanged`를 받지 못해 아직 싣지 않은 확장은 재시작 전까지 켜지지 않고,
// 자동으로 꺼진 확장의 실패 장부와 "끌까요" 질문과 꺼짐 표시도 남는다. 조립 루트 코드(DR-14 예외 2).

/** 자동 끄기 장부의 주체 키(`ext:<이름>`) */
type OwnerKey = ReturnType<OperationsPolicy["autoDisabler"]["disabled"]>[number];

function ownerKeyOf(name: string): OwnerKey {
  return `ext:${name}`;
}

const ENABLED_KEY = /^ext\.(.+)\.enabled$/;

/** 설정 키가 `ext.<이름>.enabled`면 그 이름, 아니면 undefined */
export function extNameOfEnabledKey(key: string): string | undefined {
  return ENABLED_KEY.exec(key)?.[1];
}

export interface ExtEnabledFollowDeps {
  /** 설정이 바뀔 때마다 부른다. 돌려주는 함수로 구독을 푼다 */
  readonly onChange: (listener: (change: SettingsChange) => void) => () => void;
  /** 카탈로그 키의 유효 값 */
  readonly value: (key: string) => unknown;
  /** 외부 확장 로더. 외부 확장을 싣지 않는 조립이면 아직 없다 */
  readonly loader: () => ExtensionLoader | undefined;
  readonly autoDisabler: Pick<
    OperationsPolicy["autoDisabler"],
    "disabled" | "questions" | "reenable"
  >;
  readonly logger: Logger;
  /** 엔진 수명 신호 */
  readonly signal: AbortSignal;
}

/**
 * `ext.<이름>.enabled`의 유효 값이 참이 된 변경을 따라간다. 로더의 `settingChanged`(싣지 않은 확장을 싣고, 실행 중이면 켜고, 실패 장부를 비운다)를 부르고,
 * 자동으로 꺼졌거나 질문이 떠 있던 확장이면 "다시 켜기"(`autoDisabler.reenable`)도 부른다. 꺼짐 쪽은 건드리지 않는다.
 * 돌려주는 함수로 구독을 푼다. 끝나지 않은 적용은 신호가 끊기면 로더가 멈춘다
 */
export function followExtEnabled(deps: ExtEnabledFollowDeps): () => void {
  const apply = async (name: string, enabled: boolean): Promise<void> => {
    const key = ownerKeyOf(name);
    const pending =
      enabled &&
      (deps.autoDisabler.disabled().includes(key) ||
        deps.autoDisabler.questions().some((question) => question.key === key));
    await deps.loader()?.settingChanged(name, deps.signal);
    if (pending) deps.autoDisabler.reenable(key);
  };
  return deps.onChange((change) => {
    // 대화에서만 바꾼 값(`launch`)은 그 대화의 등록 요청이다(`followThreadEnabled`)
    if (change.threadId !== null) return;
    for (const settingKey of change.keys) {
      const name = extNameOfEnabledKey(settingKey);
      const value = name === undefined ? undefined : deps.value(settingKey);
      if (name === undefined || typeof value !== "boolean") continue;
      // 끄기도 로더가 받는다. 등록의 끄기는 다음 단계 경계에서 적용되어 재시작 없이 멈춘다(X.loading-trust §4.4.7)
      detach(apply(name, value), (caught) => {
        deps.logger.warn("ext.enable_follow_failed", {
          extension: name,
          reason: caught instanceof Error ? caught.message : String(caught),
        });
      });
    }
  });
}

export interface BuiltinEnabledFollowDeps {
  readonly onChange: (listener: (change: SettingsChange) => void) => () => void;
  /** 카탈로그 키의 유효 값 */
  readonly value: (key: string) => unknown;
  readonly host: Pick<ExtHost, "registrations" | "registration">;
  /** 설정 값을 따라 켜고 끄는 내장 단위의 이름(내장 그룹). 핵심 부품은 설정으로 끄지 않는다 */
  readonly names: () => readonly string[];
  /** 켜기를 요청한 직후 부른다(실패 장부 비우기) */
  readonly onEnabled?: (name: string) => void;
}

/**
 * 내장 그룹(`authoring`, `learning`)의 `ext.<이름>.enabled` 변경을 등록의 켜기·끄기로 옮긴다. 외부 확장은 로더가 하지만(`followExtEnabled`)
 * 내장 단위는 로더를 거치지 않아 값만 바뀌고 켜지지 않았다(rtC R-3). 켜기·끄기는 다음 단계 경계에서 적용된다.
 */
export function followBuiltinEnabled(deps: BuiltinEnabledFollowDeps): () => void {
  return deps.onChange((change) => {
    if (change.threadId !== null) return;
    const names = deps.names();
    for (const settingKey of change.keys) {
      const name = extNameOfEnabledKey(settingKey);
      if (name === undefined || !names.includes(name)) continue;
      const value = deps.value(settingKey);
      if (typeof value !== "boolean") continue;
      for (const info of deps.host.registrations().filter((scope) => scope.extension === name)) {
        const handle = deps.host.registration(info.id);
        if (value) handle?.enable();
        else handle?.disable();
      }
      if (value) deps.onEnabled?.(name);
    }
  });
}

/** 설정 값(`ext.<이름>.enabled`)이 켜짐을 정하는 내장 그룹. 정적 카탈로그에 예약 키가 있는 것만이다(HS-113). 시험이 더하는 단위는 매니페스트 기본을 따른다 */
export const BUILTIN_GROUP_NAMES: readonly string[] = ["learning", "authoring"];

export interface ThreadEnabledFollowDeps {
  readonly onChange: (listener: (change: SettingsChange) => void) => () => void;
  /** 대화에서 본 카탈로그 키의 유효 값 */
  readonly value: (key: string, threadId: ThreadId) => unknown;
  /** 그 대화만의 켜기·끄기 요청 통로. 다음 단계 경계에서 적용된다 */
  readonly toggles: RegistrationToggleSourceOf;
}

/**
 * 이 대화에서 끄기·켜기(`settings.set ext.<이름>.enabled`, 범위 `launch`)를 그 대화의 등록 요청으로 옮긴다.
 * 값만 저장하고 등록에는 닿지 않아, 성공이라고 했는데 스위치가 켜진 채였다(rtC R-4). 적용은 다음 단계 경계이고 목록은 그동안 `disabling`·`enabling`을 보인다.
 */
export function followThreadEnabled(deps: ThreadEnabledFollowDeps): () => void {
  return deps.onChange((change) => {
    const threadId = change.threadId;
    if (threadId === null) return;
    for (const settingKey of change.keys) {
      const name = extNameOfEnabledKey(settingKey);
      if (name === undefined) continue;
      const value = deps.value(settingKey, threadId);
      if (typeof value !== "boolean") continue;
      for (const scope of deps.toggles.scopes().filter((entry) => entry.extension === name)) {
        deps.toggles.request(scope.id, value, "request", threadId);
      }
    }
  });
}
