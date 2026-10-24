import { Bug, err, ok, parse, parseJson, type Logger, type Result } from "@xeon/contracts";
import type { AssistantMessage, ThreadId } from "@xeon/contracts/conversation";
import { ThreadIdSchema } from "@xeon/contracts/conversation";
import type {
  AssistantMessageEventStream,
  HostedSearchCitation,
  HostedSearchError,
  HostedSearchHit,
  HostedSearchModel,
  HostedSearchPort,
  HostedSearchRequest,
  HostedSearchResponse,
  HostedSearchStopReason,
  HostedSearchSupport,
  ModelError,
  ResolvedModel,
} from "@xeon/contracts/services";
import { Type } from "typebox";
import {
  createStreamAccumulator,
  isRecord,
  type AccumulatedMessage,
  type JsonRecord,
} from "./anthropic-stream.ts";
import type { CallSpec } from "./pipeline.ts";
import type { ThinkingBudgetSettings } from "./settings.ts";

// L2.web.spec §4.8.4, L1.models.plan L1C.3. 모델 provider의 서버 도구 검색(Anthropic web_search)을 단일 턴으로 요청하는
// HostedSearchPort 구현이다. 요청은 기존 호출 파이프라인(비밀 해석, 재시도, 사용량, 가드)을 지나고, pi-ai가 싣지 않는
// 서버 도구 블록은 어댑터의 원시 스트림 이벤트에서 다시 모은다. 대화 기록에 남지 않고 요청 지점도 발화하지 않는다.

const THREAD_SENTINEL = "thr_00000000000000000000000000";
const sentinel = parse(ThreadIdSchema, THREAD_SENTINEL);
if (!sentinel.ok) throw new Bug("hosted_search.thread_sentinel_invalid");

/** thread에 속하지 않는 hosted 검색 호출의 사용량을 모으는 예약 id. UsageMeter.totals({ threadId })로 읽는다 */
export const HOSTED_SEARCH_THREAD: ThreadId = sentinel.value;

/** Anthropic 서버 도구 버전. 한 번 검색(max_uses 1)만 허용한다 */
const WEB_SEARCH_TOOL = "web_search_20250305";

const CONTINUATION_PREFIX = "hs1:";
const MAX_CONTINUATION_BLOCKS = 256;
const ContinuationSchema = Type.Array(
  Type.Object(
    { type: Type.String({ minLength: 1, maxLength: 64 }) },
    { additionalProperties: true },
  ),
  { maxItems: MAX_CONTINUATION_BLOCKS },
);

/** 이어 요청용 불투명 문자열. 직전 응답의 content 블록(encrypted_content 포함)을 그대로 직렬화한다 */
export function encodeContinuation(blocks: readonly JsonRecord[]): string {
  return `${CONTINUATION_PREFIX}${Buffer.from(JSON.stringify(blocks), "utf8").toString("base64url")}`;
}

export function decodeContinuation(value: string): readonly JsonRecord[] | undefined {
  if (!value.startsWith(CONTINUATION_PREFIX)) return undefined;
  const text = Buffer.from(value.slice(CONTINUATION_PREFIX.length), "base64url").toString("utf8");
  const json = parseJson(text);
  if (!json.ok) return undefined;
  const parsed = parse(ContinuationSchema, json.value);
  if (!parsed.ok) return undefined;
  return parsed.value.filter(isRecord);
}

/** 모델이 Anthropic 서버 도구 검색을 쓸 수 있는지. anthropic-messages API를 Anthropic 본체가 받는 경우만이다 */
function supportsHostedSearch(model: ResolvedModel["model"]): boolean {
  if (model.api !== "anthropic-messages") return false;
  if (model.provider === "anthropic") return true;
  const host = URL.canParse(model.baseUrl) ? new URL(model.baseUrl).hostname : "";
  return host === "anthropic.com" || host.endsWith(".anthropic.com");
}

// ── 요청 페이로드 ────────────────────────────────────────────────────────

function toolOf(request: HostedSearchRequest): JsonRecord {
  const tool: JsonRecord = { type: WEB_SEARCH_TOOL, name: "web_search", max_uses: 1 };
  // Anthropic은 두 목록을 함께 받지 않는다. allow가 있으면 allow만 넘기고 호출자가 결과를 다시 거른다
  if (request.domains.allow.length > 0) tool["allowed_domains"] = [...request.domains.allow];
  else if (request.domains.deny.length > 0) tool["blocked_domains"] = [...request.domains.deny];
  return tool;
}

/** 페이로드에 서버 도구를 넣고, 이어 요청이면 직전 응답 블록을 assistant 메시지로 덧붙인다 */
export function hostedSearchPayload(
  payload: unknown,
  request: HostedSearchRequest,
  previous: readonly JsonRecord[] | null,
): unknown {
  if (!isRecord(payload)) return payload;
  const messages = payload["messages"];
  const base: unknown[] = Array.isArray(messages) ? messages : [];
  return {
    ...payload,
    tools: [toolOf(request)],
    messages:
      previous === null
        ? base
        : [...base, { role: "assistant", content: structuredClone(previous) }],
  };
}

// ── 응답 해석 ────────────────────────────────────────────────────────────

function strOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stopReasonOf(raw: string | null): HostedSearchStopReason {
  if (raw === "pause_turn" || raw === "max_tokens" || raw === "refusal") return raw;
  return "end_turn";
}

interface Collected {
  readonly text: string;
  readonly results: readonly HostedSearchHit[];
  readonly citations: readonly HostedSearchCitation[];
  /** web_search_tool_result_error의 error_code. 없으면 null */
  readonly toolError: string | null;
}

function collect(blocks: readonly JsonRecord[]): Collected {
  const texts: string[] = [];
  const results: HostedSearchHit[] = [];
  const citations: HostedSearchCitation[] = [];
  let toolError: string | null = null;
  for (const block of blocks) {
    const type = strOf(block["type"]);
    if (type === "text") {
      texts.push(strOf(block["text"]) ?? "");
      const cited = block["citations"];
      if (!Array.isArray(cited)) continue;
      for (const entry of cited) {
        if (!isRecord(entry) || entry["type"] !== "web_search_result_location") continue;
        const url = strOf(entry["url"]);
        if (url === null) continue;
        citations.push({
          url,
          title: strOf(entry["title"]),
          citedText: strOf(entry["cited_text"]),
        });
      }
    } else if (type === "web_search_tool_result") {
      const content = block["content"];
      if (Array.isArray(content)) {
        for (const entry of content) {
          if (!isRecord(entry) || entry["type"] !== "web_search_result") continue;
          const url = strOf(entry["url"]);
          if (url === null) continue;
          // encrypted_content는 담지 않는다. 이어 요청에 필요한 원문은 continuation 안에만 있다
          results.push({ url, title: strOf(entry["title"]), pageAge: strOf(entry["page_age"]) });
        }
      } else if (isRecord(content) && content["type"] === "web_search_tool_result_error") {
        toolError = strOf(content["error_code"]) ?? "unknown";
      }
    }
  }
  return { text: texts.join(""), results, citations, toolError };
}

const ORG_DISABLED = /web[_ ]?search/i;
const ORG_DISABLED_WORDS = /organization|admin|disabled|not (?:enabled|allowed|available)/i;
const STATUS = /\b([1-5]\d\d)\b/;

function errorOfMessage(message: AssistantMessage): HostedSearchError {
  const text = message.errorMessage ?? "";
  if (message.stopReason === "aborted") return { kind: "cancelled" };
  const status = STATUS.exec(text);
  const code = status?.[1] === undefined ? null : Number(status[1]);
  if (code === 400 && ORG_DISABLED.test(text) && ORG_DISABLED_WORDS.test(text)) {
    return { kind: "org_disabled" };
  }
  if (text.startsWith("provider_unavailable:") || text.startsWith("model_not_found:")) {
    return { kind: "unsupported_model", provider: message.provider, modelId: message.model };
  }
  if (code === 429) return { kind: "rate_limited", retryAfterMs: null };
  return { kind: "upstream", status: code, message: text };
}

/** 원시 이벤트를 모은 결과와 pi-ai 종결 메시지를 HostedSearchResponse로 바꾼다 */
export function mapHostedResult(
  accumulated: AccumulatedMessage,
  message: AssistantMessage,
  resolved: Pick<ResolvedModel, "binding">,
): Result<HostedSearchResponse, HostedSearchError> {
  if (message.stopReason === "aborted") return err({ kind: "cancelled" });
  const sawStop = accumulated.stopReason !== null;
  // stop_reason을 받았으면 refusal 같은 정상 종료도 오류 종결로 오는 pi-ai 메시지보다 우선한다
  if (message.stopReason === "error" && !sawStop) return err(errorOfMessage(message));
  if (accumulated.streamError !== null) {
    return err({
      kind: "upstream",
      status: null,
      message: `${accumulated.streamError.type}: ${accumulated.streamError.message}`,
    });
  }
  const collected = collect(accumulated.blocks);
  if (collected.toolError !== null && collected.results.length === 0) {
    return collected.toolError === "too_many_requests"
      ? err({ kind: "rate_limited", retryAfterMs: null })
      : err({
          kind: "upstream",
          status: null,
          message: `web_search_tool_result_error: ${collected.toolError}`,
        });
  }
  const stopReason = stopReasonOf(accumulated.stopReason);
  return ok({
    stopReason,
    text: collected.text,
    results: collected.results,
    citations: collected.citations,
    usage: {
      inputTokens: accumulated.inputTokens > 0 ? accumulated.inputTokens : message.usage.input,
      outputTokens: accumulated.outputTokens > 0 ? accumulated.outputTokens : message.usage.output,
      searchRequests: accumulated.searchRequests,
    },
    model: { provider: resolved.binding.provider, modelId: resolved.binding.modelId },
    continuation: stopReason === "pause_turn" ? encodeContinuation(accumulated.blocks) : null,
  });
}

// ── 포트 ─────────────────────────────────────────────────────────────────

export interface HostedSearchDeps {
  /** `auto`는 역할 search의 모델, 아니면 모델 참조 문자열(검색 역할의 허용·차단 목록을 거친다) */
  readonly resolve: (model: HostedSearchModel) => Result<ResolvedModel, ModelError>;
  /** 호출 파이프라인. 스트림을 돌려준다 */
  readonly start: (spec: CallSpec) => AssistantMessageEventStream;
  /** 호출 시점의 레벨별 토큰 예산 설정 */
  readonly budgets: () => ThinkingBudgetSettings;
  readonly logger?: Logger;
}

export function createHostedSearch(deps: HostedSearchDeps): HostedSearchPort {
  return {
    support(model): HostedSearchSupport {
      const resolved = deps.resolve(model);
      if (!resolved.ok) return { supported: false, reason: "no_model" };
      if (!supportsHostedSearch(resolved.value.model)) {
        return { supported: false, reason: "no_hosted_search" };
      }
      return {
        supported: true,
        provider: resolved.value.binding.provider,
        modelId: resolved.value.binding.modelId,
      };
    },
    async search(request, signal) {
      if (signal.aborted) return err({ kind: "cancelled" });
      const resolved = deps.resolve(request.model);
      if (!resolved.ok) {
        return err({ kind: "unsupported_model", provider: null, modelId: null });
      }
      const { binding, model } = resolved.value;
      if (!supportsHostedSearch(model)) {
        return err({
          kind: "unsupported_model",
          provider: binding.provider,
          modelId: binding.modelId,
        });
      }
      let previous: readonly JsonRecord[] | null = null;
      if (request.continuation !== null) {
        previous = decodeContinuation(request.continuation) ?? null;
        if (previous === null) {
          return err({ kind: "upstream", status: null, message: "continuation is not valid" });
        }
      }
      if (request.domains.allow.length > 0 && request.domains.deny.length > 0) {
        deps.logger?.warn("hosted_search.deny_not_sent", {
          provider: binding.provider,
          deny: request.domains.deny.length,
        });
      }
      const accumulator = createStreamAccumulator();
      const stream = deps.start({
        ctx: {
          threadId: HOSTED_SEARCH_THREAD,
          turnId: null,
          stepId: null,
          role: "search",
          signal,
        },
        provider: binding.provider,
        modelId: binding.modelId,
        thinkingLevel: "off",
        cachePolicy: resolved.value.cachePolicy,
        context: {
          systemPrompt: request.system,
          messages: [{ role: "user", content: request.query, timestamp: 0 }],
        },
        options: { maxTokens: request.maxOutputTokens },
        selectSource: "route",
        budgets: deps.budgets(),
        providerRetries: true,
        internal: {
          payloadHook: (payload) => hostedSearchPayload(payload, request, previous),
          rawEventSink: (data) => {
            accumulator.push(data);
          },
          skipPoints: true,
        },
      });
      const message = await stream.result();
      return mapHostedResult(accumulator.snapshot(), message, resolved.value);
    },
  };
}
