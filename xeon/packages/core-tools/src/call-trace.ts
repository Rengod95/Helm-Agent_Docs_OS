import { canonicalJson } from "@fresnel/contracts";
import type { ImageContent, TextContent } from "@fresnel/contracts/conversation";
import type { ToolCallTraceEvent, ToolCallVerdict } from "@fresnel/contracts/extensions";
import type { CallerId, RejectReason, ToolRunContext } from "@fresnel/contracts/services";
import type { CallTraceFacts, CallTraceOrigin, ToolEntry } from "./types.ts";
import { isJsonObject, sha256HexSync, utf8Bytes } from "./util.ts";

// 도구 호출 추적의 값 만들기(정본 docs/xeon/review/m5/turn-record-metrics.md §4.3). 순수 함수다: 시계와 싱크를 모른다.
// 파이프라인이 호출을 닫을 때만 부르고, 기록기가 없으면 부르지 않는다(값을 만드는 비용도 들지 않는다).

/** 추적 플러그인 이름 접두. 확장 도구의 소유자는 접두를 뺀 확장 이름이다 */
const EXTENSION_PREFIX = "ext.";
const PLUGIN_CALLER_PREFIX = "plugin:";

/** 문자열 인자 토큰 목록의 상한(개수, §5.1-②). 넘는 토큰은 버린다 */
const ARG_TOKEN_LIMIT = 64;
/** 토큰의 글자 범위: 이보다 짧은 토큰은 버리고, 긴 토큰은 이 글자 수에서 자른다 */
const ARG_TOKEN_MIN_CHARS = 2;
const ARG_TOKEN_MAX_CHARS = 64;
/** 글자, 결합 기호, 숫자가 아닌 곳에서 토큰을 나눈다 */
const TOKEN_SEPARATOR = /[^\p{L}\p{M}\p{N}]+/u;

/**
 * 문자열 인자의 토큰 목록(§5.1-②, 원본 값). 최상위 문자열 인자를 키 순서로 읽고, 글자·숫자가 아닌 곳에서 나누고, 소문자로 바꾸고,
 * 두 글자 미만을 버리고, 64글자로 자르고, 처음 나온 순서로 중복을 뺀 뒤 64개까지 남긴다. 인자가 객체가 아니면 빈 목록이다.
 * 이 값은 프로세스 안에서만 쓰이고, 호스트가 설치 소금으로 HMAC해 저장한다
 */
export function argTokensOf(args: unknown): string[] {
  if (!isJsonObject(args)) return [];
  const seen = new Set<string>();
  for (const key of Object.keys(args).toSorted()) {
    const value = args[key];
    if (typeof value !== "string") continue;
    for (const piece of value.split(TOKEN_SEPARATOR)) {
      const word = Array.from(piece.toLowerCase());
      if (word.length < ARG_TOKEN_MIN_CHARS) continue;
      seen.add(word.slice(0, ARG_TOKEN_MAX_CHARS).join(""));
      if (seen.size >= ARG_TOKEN_LIMIT) return [...seen];
    }
  }
  return [...seen];
}

/** 호출 주체를 저장 모양으로 옮긴다. `plugin:<이름>`은 이름을, 하위 대화는 `subagent`를 준다 */
function callerOf(caller: CallerId): Pick<CallTraceOrigin, "caller" | "callerPlugin"> {
  if (caller === "main") return { caller: "main", callerPlugin: null };
  if (caller.startsWith(PLUGIN_CALLER_PREFIX)) {
    return { caller: "plugin", callerPlugin: caller.slice(PLUGIN_CALLER_PREFIX.length) };
  }
  return { caller: "subagent", callerPlugin: null };
}

/** 실행 맥락에서 만든 추적 맥락. 모델 호출과 사용자 셸이 쓴다 */
export function originOfRun(
  run: ToolRunContext,
  toolCallId: string,
  via: CallTraceOrigin["via"],
): CallTraceOrigin {
  return {
    threadId: run.threadId,
    toolCallId,
    parentToolCallId: null,
    turnId: run.turnId,
    stepId: run.stepId,
    ...callerOf(run.caller),
    via,
  };
}

/** 추적 사실의 빈 값. 호출 상태를 만들 때 쓴다 */
export function newCallTraceFacts(): CallTraceFacts {
  return { afterUntrusted: undefined, blockedBy: null, policy: null, approval: null };
}

/**
 * 도구의 소유자. 기능 도구는 기능 id, 확장 도구는 확장 이름이고, 그 밖(MCP 서버 등)은 등록 순서 키를 그대로 쓴다
 */
function ownerOf(entry: ToolEntry): string {
  const capability = entry.ref.capability;
  return capability.startsWith(EXTENSION_PREFIX)
    ? capability.slice(EXTENSION_PREFIX.length)
    : capability;
}

/**
 * 선언한 대상 경로 집합의 정규화 값(SHA-256 hex). 선언이 없거나 비면 null. 경로 자체는 싣지 않는다
 */
function targetHashOf(entry: ToolEntry, args: unknown): string | null {
  if (entry.locks === undefined || !isJsonObject(args)) return null;
  const paths = [...new Set(entry.locks(args).map((declaration) => declaration.path))].toSorted();
  return paths.length === 0 ? null : sha256HexSync(canonicalJson(paths));
}

/** 결과 본문의 모양. 토큰은 글자 수의 4분의 1 올림이고 바이트는 텍스트의 UTF-8 길이다 */
export function resultOf(
  content: readonly (TextContent | ImageContent)[],
  input: { readonly isError: boolean; readonly truncated: boolean; readonly itemId: string | null },
): NonNullable<ToolCallTraceEvent["result"]> {
  const text = content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  return {
    tokens: Math.ceil(text.length / 4),
    bytes: utf8Bytes(text).length,
    truncated: input.truncated,
    isError: input.isError,
    itemId: input.itemId,
  };
}

/** 실행하지 않고 닫는 이유를 판정으로 옮긴다. 중단이 아닌 `not_executed`는 턴이 멈춘 것이다 */
export function verdictOfReject(reason: RejectReason): ToolCallVerdict {
  return reason === "truncated" ? "invalid_args" : "aborted";
}

/** 한 호출을 닫을 때 넘기는 값의 입력. 모델 호출, 플러그인 호출, 닫힌 준비 단계가 같은 모양을 쓴다 */
export interface CallTraceParts {
  readonly origin: CallTraceOrigin;
  readonly tool: string;
  /** 검증을 마친 인자이거나(호출 상태), 검증 전의 원래 인자다 */
  readonly args: unknown;
  /** 등록된 도구 항목. 등록되지 않은 도구면 undefined */
  readonly entry: ToolEntry | undefined;
  readonly facts: CallTraceFacts | undefined;
  readonly verdict: ToolCallVerdict;
  readonly afterUntrusted: boolean;
  readonly exec: ToolCallTraceEvent["exec"];
  readonly result: ToolCallTraceEvent["result"];
  readonly closedAt: number;
}

/** 호출 하나의 추적 줄. 인자는 정규화 JSON의 해시와 글자 수만 남긴다 */
export function traceEventOf(parts: CallTraceParts): ToolCallTraceEvent {
  const { origin, entry, facts } = parts;
  const canonical = canonicalJson(parts.args);
  return {
    threadId: origin.threadId,
    turnId: origin.turnId,
    stepId: origin.stepId,
    toolCallId: origin.toolCallId,
    parentToolCallId: origin.parentToolCallId,
    tool: parts.tool,
    plugin: entry === undefined ? null : ownerOf(entry),
    caller: origin.caller,
    callerPlugin: origin.callerPlugin,
    via: origin.via,
    risk: entry === undefined ? null : entry.risk,
    capability:
      entry?.capability === undefined
        ? null
        : { id: entry.capability.id, method: entry.capability.method },
    argsHash: sha256HexSync(canonical),
    argTokenCount: Math.ceil(canonical.length / 4),
    argTokens: argTokensOf(parts.args),
    targetHash: entry === undefined ? null : targetHashOf(entry, parts.args),
    afterUntrusted: parts.afterUntrusted,
    verdict: parts.verdict,
    blockedBy: facts?.blockedBy ?? null,
    policy: facts?.policy ?? null,
    approval: facts?.approval ?? null,
    exec: parts.exec,
    result: parts.result,
    closedAt: parts.closedAt,
  };
}
