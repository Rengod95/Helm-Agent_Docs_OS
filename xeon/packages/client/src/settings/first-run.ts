import type { ToolsWebView, WebRecommendation } from "../web/index.ts";
import { readyToChat, setupSteps, type SetupInput, type SetupStep } from "./model.ts";

// 첫 실행 권장 상태(L4.settings-ui §4.10, M3). 설정 단계 점검과 검색 키 권장 목록을 한 값으로 모은다.
// 검색 provider 순서는 `@xeon/client/web`이 정한 값을 그대로 보인다. 이 함수는 순위를 다시 계산하지 않는다.

export interface FirstRunSearch {
  /** 권장 안내를 보일지. 닫았으면 거짓이고, 권장 키 중 준비되지 않은 것이 있어야 참이다 */
  readonly show: boolean;
  /** 현재 검색 provider 설정 값. `"auto"` 또는 provider id */
  readonly provider: string;
  /** 사용자가 끌어 옮긴 자동 선택 순서 */
  readonly order: readonly string[];
  readonly recommendations: readonly WebRecommendation[];
}

export interface FirstRunView {
  readonly steps: readonly SetupStep[];
  /** 모델 키와 기본 모델이 모두 끝났는가 */
  readonly readyToChat: boolean;
  /** 아직 끝나지 않은 첫 단계의 id. 점검 결과를 못 받은 단계는 건너뛴다. 모두 끝났으면 null */
  readonly next: SetupStep["id"] | null;
  /** 웹 도구 점검 결과가 없으면 null */
  readonly search: FirstRunSearch | null;
}

export interface FirstRunInput {
  readonly setup: SetupInput;
  readonly web: ToolsWebView | null;
  /** 사용자가 "다시 보지 않음"을 눌렀는가(desktop 원천 키 `l4.desktop.firstRun.searchHintDismissed`) */
  readonly searchHintDismissed: boolean;
}

export function firstRunView(input: FirstRunInput): FirstRunView {
  const steps = setupSteps(input.setup);
  const next = steps.find((step) => !step.done && !step.unknown)?.id ?? null;
  const web = input.web;
  const search: FirstRunSearch | null =
    web === null
      ? null
      : {
          show:
            !input.searchHintDismissed &&
            web.recommendations.some((entry) => entry.state !== "ready"),
          provider: web.search.provider,
          order: web.search.order,
          recommendations: web.recommendations,
        };
  return { steps, readyToChat: readyToChat(input.setup), next, search };
}
