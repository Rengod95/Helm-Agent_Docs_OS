import { invalidationConcerns, type SettingsInvalidation } from "@fresnel/client/settings";
import type { MessageId } from "@fresnel/client/i18n";
import type { ModelThinkingLevel, ThreadId } from "@fresnel/contracts/conversation";
import { THINKING_LEVELS } from "@fresnel/contracts/services";
import type { ModelEntry } from "@fresnel/contracts/wire";

// 입력창 추론 레벨 고르기의 순수 판정. 화면 부품에서 떼어 React 밖에서 시험한다(thinking-level-model.test.ts).
// 레벨은 설정 `l1.models.thinkingLevel`의 대화 범위(`launch`) 값이고 다음 turn부터 적용된다(runtimeChange: nextTurn).

/** 추론 레벨 설정 키(L1.models). 세션 범위(`launch`)로 대화마다 정한다 */
export const THINKING_LEVEL_KEY = "l1.models.thinkingLevel";

/** `settings.get`이 준 값이 알려진 레벨이면 그 레벨, 아니면 null(모르는 값)이다. 값을 단언하지 않고 같은지만 본다 */
export function thinkingLevelOf(value: unknown): ModelThinkingLevel | null {
  return THINKING_LEVELS.find((level) => level === value) ?? null;
}

export const THINKING_LEVEL_LABEL_IDS: Readonly<Record<ModelThinkingLevel, MessageId>> = {
  off: "desktop.composer.thinking.level.off",
  minimal: "desktop.composer.thinking.level.minimal",
  low: "desktop.composer.thinking.level.low",
  medium: "desktop.composer.thinking.level.medium",
  high: "desktop.composer.thinking.level.high",
  xhigh: "desktop.composer.thinking.level.xhigh",
  max: "desktop.composer.thinking.level.max",
};

/**
 * 추론 레벨을 고를 수 있는 모델인가. 카탈로그가 그 모델을 추론 모델이 아니라고 하면 아니고,
 * 카탈로그에 없으면(자격 증명이 빠진 제공자 등) 모르므로 보인다
 */
export function thinkingSelectableOf(choices: readonly ModelEntry[], modelRef: string): boolean {
  const entry = choices.find((choice) => choice.ref === modelRef);
  return entry === undefined || entry.reasoning;
}

/** 설정 변경 알림이 이 대화의 추론 레벨을 다시 읽게 하는가(`modeChangeConcerns`와 같은 규칙, 키만 다르다) */
export function thinkingChangeConcerns(notice: SettingsInvalidation, threadId: ThreadId): boolean {
  const keyChanged = notice.keys.length === 0 || notice.keys.includes(THINKING_LEVEL_KEY);
  return keyChanged && invalidationConcerns(notice, threadId);
}
