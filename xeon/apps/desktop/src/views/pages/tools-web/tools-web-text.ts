import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { OrderUpdateError, WebRecommendation } from "@fresnel/client";
import type { WebProviderOrigin } from "@fresnel/contracts/wire";
import type { ProviderState } from "./tools-web-model.ts";

// 도구와 웹 화면의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다.

const PROVIDER_STATE_ID: Readonly<Record<ProviderState, MessageId>> = {
  ready: "desktop.tools.state.ready",
  "needs-key": "desktop.tools.state.needsKey",
  unavailable: "desktop.tools.state.unavailable",
};

export function providerStateIdOf(state: ProviderState): MessageId {
  return PROVIDER_STATE_ID[state];
}

const RECOMMENDATION_STATE_ID: Readonly<Record<WebRecommendation["state"], MessageId>> = {
  "not-installed": "desktop.tools.state.notInstalled",
  "needs-key": "desktop.tools.state.needsKey",
  ready: "desktop.tools.state.ready",
  unavailable: "desktop.tools.state.unavailable",
};

export function recommendationStateIdOf(state: WebRecommendation["state"]): MessageId {
  return RECOMMENDATION_STATE_ID[state];
}

const ORIGIN_ID: Readonly<Record<WebProviderOrigin, MessageId>> = {
  builtin: "desktop.tools.origin.builtin",
  plugin: "desktop.tools.origin.plugin",
  detected: "desktop.tools.origin.detected",
};

/** 행의 출처 글(내장, 플러그인, 사용자 설정) */
export function originIdOf(origin: WebProviderOrigin): MessageId {
  return ORIGIN_ID[origin];
}

/** 순서 저장 검사의 실패 문장. 어느 id가 문제인지는 문장에 넣지 않는다 */
export function orderErrorIdOf(error: OrderUpdateError): MessageId {
  switch (error.kind) {
    case "unknown_id":
      return "desktop.tools.order.error.unknownId";
    case "duplicate_id":
      return "desktop.tools.order.error.duplicateId";
    default:
      return assertNever(error, "OrderUpdateError");
  }
}
