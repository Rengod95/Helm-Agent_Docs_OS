import { attemptAsync, eachAsync } from "@xeon/contracts";
import {
  orderProviderCandidates,
  type FetchFormat,
  type ProviderFetchResult,
  type RenderMode,
  type WebProviderFallback,
} from "@xeon/contracts/capabilities";
import type { WebDeps } from "../deps.ts";
import { failureOfThrown } from "../provider-errors.ts";
import type { FetchCandidate } from "../ports/providers.ts";

// L2.web.spec §4.9.1 6단계 승격. 로컬 결과가 비었거나 챌린지를 만났거나 로컬 변환기가 없는 형식이면 fetch 능력의
// 플러그인 후보를 `l2.web.fetch.pluginOrder` 순으로 쓴다. 브라우저 승격은 web.browse가 들어오는 B10에서 연결한다.
// 챌린지를 우회하지 않는다(UA를 바꿔 다시 시도하지 않고 승격만 한다).

export interface PromotionRequest {
  readonly url: string;
  readonly format: FetchFormat;
  readonly render: RenderMode;
  readonly maxBytes: number;
  readonly pluginOrder: readonly string[];
  readonly signal: AbortSignal;
}

interface PromotionSuccess {
  readonly candidate: FetchCandidate;
  readonly result: ProviderFetchResult;
}

export interface PromotionOutcome {
  readonly success: PromotionSuccess | undefined;
  readonly fallbacks: WebProviderFallback[];
}

export async function promote(deps: WebDeps, request: PromotionRequest): Promise<PromotionOutcome> {
  const candidates = deps.catalog.fetchCandidates();
  const byId = new Map(candidates.map((candidate) => [candidate.provider.id, candidate]));
  const order = orderProviderCandidates({
    candidates: candidates.map((candidate) => ({
      id: candidate.provider.id,
      origin: candidate.origin,
    })),
    settingProvider: "auto",
    pluginOrder: request.pluginOrder,
  }).order;
  const fallbacks: WebProviderFallback[] = [];
  const found = await eachAsync(order, async (id) => {
    const candidate = byId.get(id);
    if (candidate === undefined) return undefined;
    const available = await deps.probes.probe(candidate.provider, request.signal);
    if (!available.ok) {
      fallbacks.push({
        provider: id,
        stage: "probe",
        reason: available.reason,
        ...(available.detail === undefined ? {} : { detail: available.detail }),
      });
      return undefined;
    }
    const called = await attemptAsync(() =>
      candidate.provider.fetch(
        {
          url: request.url,
          format: request.format,
          render: request.render,
          maxBytes: request.maxBytes,
        },
        request.signal,
      ),
    );
    if (!called.ok) {
      const failure = failureOfThrown(called.error.cause, id);
      deps.logger.warn("web.promote_failed", { provider: id, reason: failure.code });
      fallbacks.push({ provider: id, stage: "call", reason: failure.code.slice(0, 64) });
      return undefined;
    }
    if (called.value.markdown.trim() === "") {
      fallbacks.push({ provider: id, stage: "call", reason: "empty_content" });
      return undefined;
    }
    return { value: { candidate, result: called.value } };
  });
  return { success: found?.value, fallbacks };
}
