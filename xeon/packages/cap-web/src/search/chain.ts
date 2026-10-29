import { attemptAsync, eachAsync, err, ok, type Result } from "@xeon/contracts";
import type {
  ProviderSearchRequest,
  ProviderSearchResult,
  WebCallMeta,
  WebProviderFallback,
} from "@xeon/contracts/capabilities";
import type { WebDeps } from "../deps.ts";
import type { WebFailure } from "../errors.ts";
import type { SearchCandidate } from "../ports/providers.ts";
import { failureOfThrown } from "../provider-errors.ts";
import { planSelection, type SelectionPlan } from "../select/order.ts";

// L2.web.spec §4.8.2 선택 체인. 호출 인자 provider → 설정 provider → auto(사용자가 정한 `order` 목록 → 사용자가 주소를 설정한
// SearXNG → 내장 래퍼 → 플러그인). 순서 규칙은 `select/order.ts`다. 후보에는 사용자가 설정한 provider만 들어간다. 주소를 찾아 나서는 감지는 없다. 명시 선택(호출 인자, 설정)은 다른 후보로 내려가지 않는다. auto에서는 탐침 실패와 호출 중 일부 오류가 다음
// 후보로 내려가고 `meta.fallbacks`에 남는다.

/** auto 체인에서 다음 후보로 내려가는 호출 오류 코드. `invalid_input` 같은 입력 결함은 바로 실패한다 */
const FALLBACK_CODES: ReadonlySet<string> = new Set([
  "unavailable",
  "rate_limited",
  "upstream_error",
  "timeout",
]);

export type ChainPlan = SelectionPlan;

export function planChain(
  candidates: readonly SearchCandidate[],
  callProvider: string | undefined,
  settingProvider: string,
  order: readonly string[],
): ChainPlan {
  return planSelection({
    candidates: candidates.map((candidate) => ({
      id: candidate.provider.id,
      origin: candidate.origin,
    })),
    ...(callProvider === undefined ? {} : { callProvider }),
    settingProvider,
    order,
  });
}

export interface ChainSuccess {
  readonly candidate: SearchCandidate;
  readonly result: ProviderSearchResult;
  readonly selectedBy: WebCallMeta["selectedBy"];
  readonly fallbacks: readonly WebProviderFallback[];
  /** 시도 순서에서 몇 번째 후보가 답했는가(0이 첫 후보) */
  readonly index: number;
}

function plainFallback(item: WebProviderFallback): {
  provider: string;
  stage: string;
  reason: string;
} {
  return { provider: item.provider, stage: item.stage, reason: item.reason };
}

function summarize(fallbacks: readonly WebProviderFallback[]): string {
  return fallbacks.map((item) => `${item.provider} ${item.stage}:${item.reason}`).join(", ");
}

/**
 * 계획한 순서대로 탐침하고 호출한다. 명시 선택은 실패를 그대로(탐침 실패는 `unavailable` + `detail.reason`) 돌려주고,
 * auto는 후보를 모두 시도한 뒤에도 실패하면 `unavailable`에 `detail.fallbacks`를 싣는다.
 */
export async function runChain(
  deps: WebDeps,
  candidates: readonly SearchCandidate[],
  plan: ChainPlan,
  request: ProviderSearchRequest,
  signal: AbortSignal,
): Promise<Result<ChainSuccess, WebFailure>> {
  const explicit = plan.selectedBy !== "auto";
  if (plan.order.length === 0) {
    return err({
      code: "unavailable",
      message: explicit
        ? "The requested search provider is not registered or not configured."
        : "No search provider is registered.",
      retryable: false,
      detail: { reason: explicit ? "unknown_provider" : "no_provider", fallbacks: [] },
    });
  }
  const byId = new Map(candidates.map((candidate) => [candidate.provider.id, candidate]));
  const fallbacks: WebProviderFallback[] = [];
  let failure: WebFailure | undefined;
  let position = 0;
  const found = await eachAsync(plan.order, async (id) => {
    const index = position;
    position += 1;
    const candidate = byId.get(id);
    if (candidate === undefined) return undefined;
    const available = await deps.probes.probe(candidate.provider, signal);
    if (!available.ok) {
      fallbacks.push({
        provider: id,
        stage: "probe",
        reason: available.reason,
        ...(available.detail === undefined ? {} : { detail: available.detail.slice(0, 512) }),
      });
      if (explicit) {
        failure = {
          code: "unavailable",
          message: `${id} is unavailable: ${available.reason}`,
          retryable: true,
          provider: id,
          detail: { reason: available.reason, fallbacks: fallbacks.map(plainFallback) },
        };
        return { value: undefined };
      }
      return undefined;
    }
    const called = await attemptAsync(() => candidate.provider.search(request, signal));
    if (called.ok) {
      return {
        value: {
          candidate,
          result: called.value,
          selectedBy: plan.selectedBy,
          fallbacks: [...fallbacks],
          index,
        },
      };
    }
    const thrown = failureOfThrown(called.error.cause, id);
    deps.logger.warn("web.search_provider_failed", { provider: id, reason: thrown.code });
    if (explicit || !FALLBACK_CODES.has(thrown.code)) {
      failure = { ...thrown, provider: id };
      return { value: undefined };
    }
    fallbacks.push({ provider: id, stage: "call", reason: thrown.code.slice(0, 64) });
    return undefined;
  });
  if (found?.value !== undefined) return ok(found.value);
  if (failure !== undefined) return err(failure);
  return err({
    code: "unavailable",
    message: `Every search provider failed: ${summarize(fallbacks)}`,
    retryable: true,
    detail: { reason: "all_failed", fallbacks: fallbacks.map(plainFallback) },
  });
}
