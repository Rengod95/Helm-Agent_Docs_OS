import { assertNever } from "@xeon/contracts";

// L2.web.spec §4.8.1 ① 모델용 도구 경로. `cap-web`은 판정 함수만 제공한다(순수). hosted 서버 도구를 요청에 넣는 일,
// `encrypted_content` 반송, `pause_turn` 처리는 L1.models가 한다. 판정은 세션 첫 턴에 한 번 하고 세션 동안 고정한다.

export type ModelSearchSetting = "auto" | "hosted" | "function" | "off";
export type ModelSearchTool = "hosted" | "function" | "off";

export interface ModelToolInput {
  /** `l2.web.search.modelTool` */
  readonly setting: ModelSearchSetting;
  /** auto 체인의 첫 후보가 내장 래퍼뿐인가(플러그인도 SearXNG도 없다) */
  readonly wrapperOnlyChain: boolean;
  /** 현재 모델 provider·모델에 hosted 검색 서버 도구가 있는가 */
  readonly hostedSupported: boolean;
}

/**
 * - off: 도구를 광고하지 않는다.
 * - function: `web_search` 함수 도구만 광고한다(앞단 체인).
 * - hosted: 모델 provider의 내장 서버 도구. 현재 모델이 지원하지 않으면 function으로 내려간다.
 * - auto: 체인이 래퍼뿐이고 hosted를 지원하면 hosted(검색마다 모델 호출이 하나 더 드는 일을 피한다), 아니면 function.
 */
export function decideModelSearchTool(input: ModelToolInput): ModelSearchTool {
  switch (input.setting) {
    case "off":
      return "off";
    case "function":
      return "function";
    case "hosted":
      return input.hostedSupported ? "hosted" : "function";
    case "auto":
      return input.wrapperOnlyChain && input.hostedSupported ? "hosted" : "function";
    default:
      return assertNever(input.setting, "ModelSearchSetting");
  }
}
