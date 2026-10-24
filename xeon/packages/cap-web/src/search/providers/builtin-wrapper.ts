import { assertNever, repeatAsync, type Clock, type Logger } from "@xeon/contracts";
import type {
  ProviderAvailabilityWeb,
  ProviderSearchRequest,
  ProviderSearchResult,
  WebProviderManifest,
  WebSearchProvider,
} from "@xeon/contracts/capabilities";
import type {
  HostedSearchError,
  HostedSearchPort,
  HostedSearchResponse,
} from "@xeon/contracts/services";
import { computeCost } from "../../cost/meter.ts";
import { BUILTIN_WRAPPER_PRICING } from "../../cost/pricing.ts";
import type { WebFailure } from "../../errors.ts";
import { WebHttpError } from "../../policy/guarded-http.ts";
import { normalizeHostedSearch } from "../model-tool.ts";
import { renderQueryText } from "./query-text.ts";

// L2.web.spec §4.8.4, plan B9. 내장 검색 래퍼: 모델 provider의 hosted 검색(`HostedSearchPort`)을 단일 턴으로 불러
// 결과를 `ProviderSearchResult`로 바꾼다. 네트워크는 직접 쓰지 않는다. 호출은 모두 L1.models 포트를 지나므로
// 비밀, 재시도, 사용량 기록은 거기서 한다.

export const BUILTIN_WRAPPER_PROVIDER_ID = "builtin-wrapper";

/** 고정 시스템 프롬프트(§4.8.4 2번) */
export const WRAPPER_SYSTEM_PROMPT = "Search the web for the user's query and stop. Do not answer.";
export const WRAPPER_MAX_OUTPUT_TOKENS = 512;

/** `max_uses: 1` 한 번이 검색 한 건이다. 이어 요청마다 한 건씩 더 들 수 있어 이 값으로 상한을 알린다 */
export function wrapperManifest(): WebProviderManifest {
  return {
    name: "builtin-wrapper",
    displayName: "Built-in search (model provider)",
    services: ["search"],
    // 포트가 모델 provider로 보낸다. GuardedHttp를 쓰지 않으므로 endpoint가 없다
    endpoints: [],
    auth: { kind: "none", secrets: [] },
    pricing: BUILTIN_WRAPPER_PRICING,
    // Anthropic 약관은 확인하지 않았다. 확인 전에는 세션 안에서만 쓴다(§3.6.2, web-tools.md §4.7)
    termsFlags: { cachePolicy: "session", mayTrainOn: "unknown", redistribution: "unknown" },
    privacy: { zdr: "unknown", sendsTelemetry: false },
    // 도메인 필터는 allow 목록과 deny 목록을 함께 받지 못한다. 목록 크기 상한은 확인하지 못했다 [가정]
    limits: { domainFilter: { max: 20, mixAllowDeny: false } },
  };
}

export interface WrapperDeps {
  readonly hosted: HostedSearchPort;
  readonly clock: Clock;
  readonly logger: Logger;
  /** 호출 때마다 읽는 래퍼 설정(`l2.web.search.wrapper.*`) */
  readonly settings: () => { readonly model: string; readonly maxContinuations: number };
}

function failureOf(error: HostedSearchError): WebFailure {
  switch (error.kind) {
    case "unsupported_model":
      return {
        code: "unavailable",
        message: "The current model does not support hosted web search.",
        retryable: false,
        detail: { reason: "unsupported-model" },
      };
    case "org_disabled":
      return {
        code: "unavailable",
        message: "Hosted web search is turned off by the organization administrator.",
        retryable: false,
        detail: { reason: "org-disabled" },
      };
    case "rate_limited":
      return {
        code: "rate_limited",
        message: "The model provider rate limited the search.",
        retryable: true,
        ...(error.retryAfterMs === null ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    case "upstream":
      return {
        code: "upstream_error",
        message: `The model provider failed the search: ${error.message.slice(0, 200)}`,
        retryable: true,
      };
    case "cancelled":
      return { code: "aborted", message: "The operation was aborted." };
    default:
      return assertNever(error, "HostedSearchError");
  }
}

export function createWrapperProvider(deps: WrapperDeps): WebSearchProvider {
  const manifest = wrapperManifest();
  /** 조직 차단 400을 받은 모델. 프로세스 수명 동안 기억하고, 설정의 모델이 바뀌면 지운다 */
  let orgDisabledModel: string | undefined;

  function isAvailable(): Promise<ProviderAvailabilityWeb> {
    const { model } = deps.settings();
    const support = deps.hosted.support(model);
    if (!support.supported) {
      return Promise.resolve({ ok: false, reason: "unsupported-model", detail: support.reason });
    }
    if (orgDisabledModel !== undefined) {
      if (orgDisabledModel === model) return Promise.resolve({ ok: false, reason: "org-disabled" });
      orgDisabledModel = undefined;
    }
    return Promise.resolve({ ok: true });
  }

  async function search(
    request: ProviderSearchRequest,
    signal: AbortSignal,
  ): Promise<ProviderSearchResult> {
    const { model, maxContinuations } = deps.settings();
    const query = renderQueryText(request, { includeDates: true });
    const responses: HostedSearchResponse[] = [];
    const warnings: string[] = [];
    let continuation: string | null = null;
    let reRequests = 0;
    // 이어 요청은 앞 응답의 continuation이 있어야 보낼 수 있다. 순차 호출이 이 반복의 목적이다
    await repeatAsync(async () => {
      const answered = await deps.hosted.search(
        {
          model,
          system: WRAPPER_SYSTEM_PROMPT,
          query,
          maxOutputTokens: WRAPPER_MAX_OUTPUT_TOKENS,
          domains: request.domains,
          continuation,
        },
        signal,
      );
      if (!answered.ok) {
        if (answered.error.kind === "org_disabled") orgDisabledModel = model;
        throw new WebHttpError(failureOf(answered.error));
      }
      const response = answered.value;
      responses.push(response);
      if (response.stopReason === "max_tokens") warnings.push("wrapper_max_tokens");
      if (response.stopReason === "refusal") warnings.push("wrapper_refusal");
      if (response.stopReason !== "pause_turn" || response.continuation === null) {
        return { value: undefined };
      }
      if (reRequests >= maxContinuations) {
        warnings.push("wrapper_continuation_limit");
        return { value: undefined };
      }
      reRequests += 1;
      continuation = response.continuation;
      return undefined;
    });
    const usage = responses.reduce(
      (sum, response) => ({
        searchRequests: sum.searchRequests + response.usage.searchRequests,
        inputTokens: sum.inputTokens + response.usage.inputTokens,
        outputTokens: sum.outputTokens + response.usage.outputTokens,
      }),
      { searchRequests: 0, inputTokens: 0, outputTokens: 0 },
    );
    // 가격표 단가로 추정한 값이다. 앞단이 같은 가격표로 다시 계산해 basis를 estimated로 둔다
    const priced = computeCost(
      {
        provider: BUILTIN_WRAPPER_PROVIDER_ID,
        pricing: BUILTIN_WRAPPER_PRICING,
        units: [
          { name: "search", count: usage.searchRequests },
          { name: "tokens_in", count: usage.inputTokens },
          { name: "tokens_out", count: usage.outputTokens },
        ],
        contextChars: 0,
      },
      deps.clock.now(),
    );
    deps.logger.info("web.wrapper_searched", {
      requests: responses.length,
      searchRequests: usage.searchRequests,
    });
    return {
      items: normalizeHostedSearch(responses),
      // 도메인 조건은 포트가 hosted 도구의 필터로 넘긴다. 앞단이 목록을 줄이지 않은 요청만 네이티브로 본다
      appliedNatively:
        request.domains.allow.length > 0 && request.domains.deny.length > 0 ? [] : ["domains"],
      cost: priced.cost,
      warnings,
    };
  }

  return { id: BUILTIN_WRAPPER_PROVIDER_ID, manifest, isAvailable, search };
}
