import { canonicalJson } from "@xeon/contracts";
import type { ToolCallOutcome } from "@xeon/contracts/services";
import type { TurnNotice } from "@xeon/contracts/conversation";

// L1.loop.spec §4.10 반복 감지. 관찰만 하고 막지 않는다. 단계마다 도구 호출 서명(도구 이름 + 인자)과 결과를 한 쌍으로 묶어
// 직전 단계의 쌍과 같으면 연속 횟수를 늘린다. 임계에 이르는 단계에서 한 번 알림을 돌려준다(같은 되풀이에서 다시 알리지 않는다).

/** `l1.loop.repeat.*` 값. turn 시작 때 한 번 읽는다 */
export interface RepeatSettings {
  readonly enabled: boolean;
  /** 같은 행동-관찰 쌍의 연속 임계 */
  readonly actionObservation: number;
  /** 같은 행동-오류 쌍의 연속 임계 */
  readonly actionError: number;
}

export interface RepeatDetector {
  /** 한 단계가 끝날 때 그 단계의 도구 결과(호출 순서)를 넘긴다. 임계에 이르면 알림을 돌려준다 */
  observe(outcomes: readonly ToolCallOutcome[]): TurnNotice | null;
}

const NONE: RepeatDetector = { observe: () => null };

/** 쌍 키: 행동은 호출마다 (이름, 인자), 관찰은 결과 내용과 오류 여부. 인자 키 순서와 무관하게 같다 */
function pairKey(outcomes: readonly ToolCallOutcome[]): { key: string; error: boolean } {
  const action = outcomes.map((o) => [o.toolCall.name, o.toolCall.arguments]);
  const observation = outcomes.map((o) => [o.isError, o.message.content]);
  return {
    key: canonicalJson([action, observation]),
    error: outcomes.every((o) => o.isError),
  };
}

export function createRepeatDetector(settings: RepeatSettings): RepeatDetector {
  if (!settings.enabled) return NONE;
  let lastKey: string | null = null;
  let streak = 0;
  return {
    observe(outcomes) {
      // 도구 호출이 없는 단계는 되풀이를 끊는다
      if (outcomes.length === 0) {
        lastKey = null;
        streak = 0;
        return null;
      }
      const { key, error } = pairKey(outcomes);
      streak = key === lastKey ? streak + 1 : 1;
      lastKey = key;
      const threshold = error ? settings.actionError : settings.actionObservation;
      if (streak !== threshold) return null;
      return {
        code: "repeat_detected",
        detail: { kind: error ? "action_error" : "action_observation", count: streak },
      };
    },
  };
}
