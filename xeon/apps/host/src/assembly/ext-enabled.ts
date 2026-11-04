import { detach, type Logger } from "@fresnel/contracts";
import type { ExtensionLoader, OperationsPolicy } from "@fresnel/ext-host";
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
  const apply = async (name: string): Promise<void> => {
    const key = ownerKeyOf(name);
    const pending =
      deps.autoDisabler.disabled().includes(key) ||
      deps.autoDisabler.questions().some((question) => question.key === key);
    await deps.loader()?.settingChanged(name, deps.signal);
    if (pending) deps.autoDisabler.reenable(key);
  };
  return deps.onChange((change) => {
    for (const settingKey of change.keys) {
      const name = extNameOfEnabledKey(settingKey);
      if (name === undefined || deps.value(settingKey) !== true) continue;
      detach(apply(name), (caught) => {
        deps.logger.warn("ext.enable_follow_failed", {
          extension: name,
          reason: caught instanceof Error ? caught.message : String(caught),
        });
      });
    }
  });
}
