import type {
  AfterProviderResponseInput,
  BeforeProviderHeadersInput,
  ModelSelectInput,
  ProviderDispatcher,
  ProviderStreamEventInput,
  ThinkingLevelSelectInput,
} from "../../src/index.ts";

/** 모든 지점의 호출을 모으는 대역. beforeProviderHeaders의 결과는 patch 함수가 정한다 */
export function spyDispatcher(
  patch: (headers: Readonly<Record<string, string>>) => Record<string, string> = (h) => ({ ...h }),
): {
  readonly dispatcher: ProviderDispatcher;
  readonly headers: BeforeProviderHeadersInput[];
  readonly responses: AfterProviderResponseInput[];
  readonly rawEvents: ProviderStreamEventInput[];
  readonly selects: ModelSelectInput[];
  readonly levels: ThinkingLevelSelectInput[];
} {
  const headers: BeforeProviderHeadersInput[] = [];
  const responses: AfterProviderResponseInput[] = [];
  const rawEvents: ProviderStreamEventInput[] = [];
  const selects: ModelSelectInput[] = [];
  const levels: ThinkingLevelSelectInput[] = [];
  const dispatcher: ProviderDispatcher = {
    beforeProviderRequest: (input) => Promise.resolve(input.payload),
    beforeProviderHeaders(input) {
      headers.push(input);
      return Promise.resolve(patch(input.headers));
    },
    afterProviderResponse(input) {
      responses.push(input);
      return Promise.resolve();
    },
    providerStreamEvent(input) {
      rawEvents.push(input);
      return Promise.resolve();
    },
    modelSelect(input) {
      selects.push(input);
      return Promise.resolve();
    },
    thinkingLevelSelect(input) {
      levels.push(input);
      return Promise.resolve();
    },
  };
  return { dispatcher, headers, responses, rawEvents, selects, levels };
}
