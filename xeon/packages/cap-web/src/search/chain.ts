import { attemptAsync, eachAsync, err, ok, type Result } from "@xeon/contracts";
import type {
  ProviderAvailabilityWeb,
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
// 후보로 내려가고 `meta.fallbacks`에 남는다. auto이고 `parallel`이 2 이상이면 탐침을 통과한 앞의 `parallel`개를 동시에 부른다(여러 provider 동시 질의).

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

/** 동시 질의에서 첫 성공 뒤에 답한 provider 하나 */
export interface ChainAnswer {
  readonly candidate: SearchCandidate;
  readonly result: ProviderSearchResult;
}

export interface ChainSuccess {
  readonly candidate: SearchCandidate;
  readonly result: ProviderSearchResult;
  readonly selectedBy: WebCallMeta["selectedBy"];
  readonly fallbacks: readonly WebProviderFallback[];
  /** 시도 순서에서 몇 번째 후보가 답했는가(0이 첫 후보) */
  readonly index: number;
  /** 동시 질의에서 첫 성공 뒤에 답한 provider들을 시도 순서대로. 순차 체인이거나 하나만 답했으면 비어 있다 */
  readonly extras: readonly ChainAnswer[];
}

/** 동시 질의 묶음에 든 후보 하나(시도 순서 위치를 같이 든다) */
interface GroupMember {
  readonly candidate: SearchCandidate;
  readonly index: number;
}

/** 묶음에서 답한 후보 하나 */
interface GroupAnswer extends ChainAnswer {
  readonly index: number;
}

/** 묶음으로 호출한 결과. `failure`가 있으면 검색 전체가 그 실패로 끝난다 */
interface GroupCalls {
  readonly answered: readonly GroupAnswer[];
  readonly failure: WebFailure | undefined;
}

type ProbeFailure = Extract<ProviderAvailabilityWeb, { readonly ok: false }>;

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

/** 탐침 한 번. 가용하면 undefined, 아니면 실패 사유 */
async function probeOf(
  deps: WebDeps,
  candidate: SearchCandidate,
  signal: AbortSignal,
): Promise<ProbeFailure | undefined> {
  const available = await deps.probes.probe(candidate.provider, signal);
  return available.ok ? undefined : available;
}

function probeFallback(id: string, failed: ProbeFailure): WebProviderFallback {
  return {
    provider: id,
    stage: "probe",
    reason: failed.reason,
    ...(failed.detail === undefined ? {} : { detail: failed.detail.slice(0, 512) }),
  };
}

/** 호출 한 번. 던진 값은 provider ID가 붙은 실패로 바꾼다 */
async function callOf(
  deps: WebDeps,
  candidate: SearchCandidate,
  request: ProviderSearchRequest,
  signal: AbortSignal,
): Promise<Result<ProviderSearchResult, WebFailure>> {
  const id = candidate.provider.id;
  const called = await attemptAsync(() => candidate.provider.search(request, signal));
  if (called.ok) return ok(called.value);
  const thrown = failureOfThrown(called.error.cause, id);
  deps.logger.warn("web.search_provider_failed", { provider: id, reason: thrown.code });
  return err({ ...thrown, provider: id });
}

/**
 * 동시 질의 묶음을 고른다. 순서대로 탐침해 가용한 후보를 `parallel`개 모은다(탐침 실패는 `fallbacks`에 남긴다).
 * `next`는 묶음이 다 차서 멈춘 자리의 다음 위치이고, 순서를 끝까지 봤으면 `order.length`다.
 */
async function probeGroup(
  deps: WebDeps,
  byId: ReadonlyMap<string, SearchCandidate>,
  order: readonly string[],
  parallel: number,
  signal: AbortSignal,
  fallbacks: WebProviderFallback[],
): Promise<{ readonly members: readonly GroupMember[]; readonly next: number }> {
  const members: GroupMember[] = [];
  let next = order.length;
  await eachAsync(
    order.map((id, index) => ({ id, index })),
    async ({ id, index }) => {
      const candidate = byId.get(id);
      if (candidate === undefined) return undefined;
      const unavailable = await probeOf(deps, candidate, signal);
      if (unavailable !== undefined) {
        fallbacks.push(probeFallback(id, unavailable));
        return undefined;
      }
      members.push({ candidate, index });
      if (members.length < parallel) return undefined;
      next = index + 1;
      return { value: undefined };
    },
  );
  return { members, next };
}

/**
 * 묶음의 후보를 한꺼번에 부른다. 탐침은 모두 끝난 뒤에 부른다. 성공은 시도 순서를 지킨다.
 * 코드가 `FALLBACK_CODES`에 있는 실패는 `stage: "call"`로 남기고 무시하고, 그 밖의 실패는 검색 전체의 실패가 된다.
 */
async function callGroup(
  deps: WebDeps,
  members: readonly GroupMember[],
  request: ProviderSearchRequest,
  signal: AbortSignal,
  fallbacks: WebProviderFallback[],
): Promise<GroupCalls> {
  const calls = await Promise.all(
    members.map(async (member) => ({
      member,
      outcome: await callOf(deps, member.candidate, request, signal),
    })),
  );
  const answered: GroupAnswer[] = [];
  let failure: WebFailure | undefined;
  for (const { member, outcome } of calls) {
    if (outcome.ok) {
      answered.push({ candidate: member.candidate, result: outcome.value, index: member.index });
      continue;
    }
    const code = outcome.error.code;
    if (FALLBACK_CODES.has(code)) {
      fallbacks.push({
        provider: member.candidate.provider.id,
        stage: "call",
        reason: code.slice(0, 64),
      });
      continue;
    }
    if (failure === undefined) failure = outcome.error;
  }
  return { answered, failure };
}

/**
 * 계획한 순서대로 탐침하고 호출한다. 명시 선택은 실패를 그대로(탐침 실패는 `unavailable` + `detail.reason`) 돌려주고,
 * auto는 후보를 모두 시도한 뒤에도 실패하면 `unavailable`에 `detail.fallbacks`를 싣는다.
 * auto이고 `parallel`이 2 이상이면 앞의 `parallel`개를 동시에 부른다. 그 묶음이 하나도 답하지 못하면 남은 후보를 순차로 이어 간다.
 */
export async function runChain(
  deps: WebDeps,
  candidates: readonly SearchCandidate[],
  plan: ChainPlan,
  request: ProviderSearchRequest,
  signal: AbortSignal,
  parallel: number,
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
  // 순차 체인은 처음부터, 동시 질의 묶음이 있으면 묶음이 멈춘 다음 위치부터 이어 간다
  let from = 0;
  if (!explicit && parallel >= 2) {
    const group = await probeGroup(deps, byId, plan.order, parallel, signal, fallbacks);
    from = group.next;
    if (group.members.length > 0) {
      const called = await callGroup(deps, group.members, request, signal, fallbacks);
      if (called.failure !== undefined) return err(called.failure);
      const [primary, ...extras] = called.answered;
      if (primary !== undefined) {
        return ok({
          candidate: primary.candidate,
          result: primary.result,
          selectedBy: plan.selectedBy,
          fallbacks: [...fallbacks],
          index: primary.index,
          extras: extras.map(({ candidate, result }) => ({ candidate, result })),
        });
      }
    }
  }
  let failure: WebFailure | undefined;
  const steps = plan.order.map((id, index) => ({ id, index })).slice(from);
  const found = await eachAsync(steps, async ({ id, index }) => {
    const candidate = byId.get(id);
    if (candidate === undefined) return undefined;
    const unavailable = await probeOf(deps, candidate, signal);
    if (unavailable !== undefined) {
      fallbacks.push(probeFallback(id, unavailable));
      if (explicit) {
        failure = {
          code: "unavailable",
          message: `${id} is unavailable: ${unavailable.reason}`,
          retryable: true,
          provider: id,
          detail: { reason: unavailable.reason, fallbacks: fallbacks.map(plainFallback) },
        };
        return { value: undefined };
      }
      return undefined;
    }
    const called = await callOf(deps, candidate, request, signal);
    if (called.ok) {
      return {
        value: {
          candidate,
          result: called.value,
          selectedBy: plan.selectedBy,
          fallbacks: [...fallbacks],
          index,
          extras: [],
        },
      };
    }
    if (explicit || !FALLBACK_CODES.has(called.error.code)) {
      failure = called.error;
      return { value: undefined };
    }
    fallbacks.push({ provider: id, stage: "call", reason: called.error.code.slice(0, 64) });
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
