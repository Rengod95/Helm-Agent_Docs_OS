import { createHash } from "node:crypto";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { canonicalJson, parseJson } from "@xeon/contracts";
import {
  TapeLeftoverError,
  TapeMismatchError,
  type ModelTape,
  type TapeWire,
  type TapeWireChunk,
} from "./tape.ts";

// 녹화 테이프의 HTTP 층. pi-ai의 요청 옵션 `fetch`(1.3.0 `ProviderRequestOptions.fetch`) 자리에 들어가서 녹화한 SSE 본문을
// 어댑터에 그대로 돌려준다. 전역 fetch를 바꾸지 않는다. 어댑터가 fetch 주입을 거부하는 provider(Google, Vertex, Bedrock)는
// 이 경로로 시험하지 않는다(L1.models.plan §4.1 녹화기).

// ── 요청 정규화와 열쇠 ───────────────────────────────────────────────────

/** 요청마다 달라지는 최상위 필드. 매칭 열쇠에서 뺀다 */
const VOLATILE_FIELDS: ReadonlySet<string> = new Set([
  "user",
  "prompt_cache_key",
  "safety_identifier",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutVolatile(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (VOLATILE_FIELDS.has(key)) continue;
    if (key === "metadata" && isRecord(member)) {
      const kept = Object.fromEntries(
        Object.entries(member).filter(([name]) => name !== "user_id"),
      );
      if (Object.keys(kept).length > 0) out[key] = kept;
      continue;
    }
    out[key] = member;
  }
  return out;
}

/** 정규화한 요청 본문의 sha256 hex. 키 순서와 휘발성 필드(`user`, `metadata.user_id` 등)는 해시에 영향이 없다 */
export function requestHashOf(body: string): string {
  const parsed = parseJson(body);
  const normalized = parsed.ok ? canonicalJson(withoutVolatile(parsed.value)) : body;
  return createHash("sha256").update(normalized).digest("hex");
}

/** 테이프 diff에서 알아볼 요청 요약. 본문은 담지 않는다 */
export function summarizeRequest(body: string): TapeWire["request"] {
  const parsed = parseJson(body);
  if (!parsed.ok || !isRecord(parsed.value)) return { tools: [] };
  const value = parsed.value;
  const items = Array.isArray(value["messages"]) ? value["messages"] : value["input"];
  const tools = Array.isArray(value["tools"]) ? value["tools"] : [];
  const names = tools.flatMap((tool: unknown) =>
    isRecord(tool) && typeof tool["name"] === "string" ? [tool["name"]] : [],
  );
  return {
    ...(typeof value["model"] === "string" ? { model: value["model"] } : {}),
    ...(Array.isArray(items) ? { messages: items.length } : {}),
    tools: names,
  };
}

// ── 비밀 ────────────────────────────────────────────────────────────────

interface SecretPattern {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
  { kind: "openai-project-key", pattern: /sk-proj-[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
  { kind: "sk-key", pattern: /sk-(?!ant-|proj-)[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
  {
    kind: "bearer-token",
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
    replacement: `Bearer ${REDACTED}`,
  },
  { kind: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, replacement: REDACTED },
  { kind: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  { kind: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{30,}/g, replacement: REDACTED },
];

/** 이보다 짧은 값은 비밀로 다루지 않는다(치환이 본문을 망가뜨린다). 녹화기는 이보다 짧은 키를 받지 않는다 */
export const MIN_SECRET_LENGTH = 8;

/** 발견 하나. 어디서 어떤 종류가 나왔는지만 있고 값은 없다 */
export interface SecretFinding {
  readonly kind: string;
  readonly at: number;
  /** 일치한 길이 */
  readonly length: number;
}

function knownValues(values: readonly string[]): string[] {
  return values
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .toSorted((a, b) => b.length - a.length);
}

/** 본문에 남은 비밀 패턴과 알려진 비밀 값의 위치. 값은 돌려주지 않는다 */
export function findSecrets(text: string, values: readonly string[]): readonly SecretFinding[] {
  const found: SecretFinding[] = [];
  for (const value of knownValues(values)) {
    let at = text.indexOf(value);
    while (at !== -1) {
      found.push({ kind: "secret-value", at, length: value.length });
      at = text.indexOf(value, at + value.length);
    }
  }
  for (const { kind, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern))
      found.push({ kind, at: match.index, length: match[0].length });
  }
  return found.toSorted((a, b) => a.at - b.at);
}

/** 알려진 비밀 값과 비밀 패턴을 `[REDACTED]`로 바꾼다 */
export function scrubSecrets(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of knownValues(values)) out = out.replaceAll(value, REDACTED);
  for (const { pattern, replacement } of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

// ── 재생 ────────────────────────────────────────────────────────────────

export interface TapeFetchOptions {
  /** 주면 덩어리 사이를 녹화한 간격만큼 기다린다. 기본은 기다리지 않는다(결정적 재생) */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** 짝이 없던 요청 하나 */
export interface TapeFetchMiss {
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  /** 그 시점에 남아 있던 항목의 요약. 차이를 보는 용도다 */
  readonly pending: readonly string[];
}

export interface TapeFetchHandle {
  /** pi-ai 요청 옵션 `fetch`에 넣는다 */
  readonly fetch: FetchFunction;
  /** 짝이 없던 요청. fetch가 던진 오류를 SDK가 삼켜도 여기 남는다 */
  misses(): readonly TapeFetchMiss[];
  /** 아직 소비되지 않은 항목 수 */
  remaining(): number;
  /** 짝 없는 요청이 있었으면 TapeMismatchError, 소비되지 않은 항목이 남았으면 TapeLeftoverError(allowLeftover면 통과) */
  assertExhausted(): void;
}

interface Pending {
  readonly key: string;
  readonly turn: number;
  readonly wire: TapeWire;
}

function keyOf(method: string, path: string, requestHash: string): string {
  return `${method} ${path} ${requestHash}`;
}

function describePending(entry: Pending): string {
  const { wire } = entry;
  return `turn ${entry.turn} ${wire.method} ${wire.path} ${wire.requestHash.slice(0, 12)} (${wire.request.model ?? "?"}, ${wire.request.messages ?? "?"} messages)`;
}

async function readBody(input: Request | URL | string, init: RequestInit | undefined) {
  const body = init?.body;
  if (body === undefined || body === null) {
    return input instanceof Request ? await input.clone().text() : "";
  }
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  throw new TapeMismatchError(
    "tapeFetch can match only string or binary request bodies, not a stream or form",
  );
}

function bodyStream(
  chunks: readonly TapeWireChunk[],
  signal: AbortSignal | null | undefined,
  sleep: ((ms: number) => Promise<void>) | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  let previous = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted === true) {
        controller.error(signal.reason ?? new DOMException("aborted", "AbortError"));
        return;
      }
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      if (sleep !== undefined && chunk.t > previous) await sleep(chunk.t - previous);
      previous = chunk.t;
      controller.enqueue(encoder.encode(chunk.data));
    },
  });
}

/**
 * 녹화 테이프의 `wire` 항목을 fetch로 재생한다. 요청은 (메서드, 경로, 정규화한 본문 해시)로 짝짓고, 같은 열쇠는 테이프
 * 순서대로 하나씩 소비한다. 짝이 없으면 TapeMismatchError를 던지고 `misses()`에도 남기므로, SDK가 오류를 삼켜도
 * `assertExhausted()`가 시험을 실패시킨다. 쓰이지 않은 항목이 남아도 실패한다
 */
export function tapeFetch(source: ModelTape, options: TapeFetchOptions = {}): TapeFetchHandle {
  const pending: Pending[] = source.turns.flatMap((turn) =>
    turn.wire === undefined
      ? []
      : [
          {
            key: keyOf(turn.wire.method, turn.wire.path, turn.wire.requestHash),
            turn: turn.n,
            wire: turn.wire,
          },
        ],
  );
  const misses: TapeFetchMiss[] = [];

  const respond = async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    const requestHash = requestHashOf(await readBody(input, init));
    const key = keyOf(method, path, requestHash);
    const at = pending.findIndex((entry) => entry.key === key);
    const [entry] = at === -1 ? [] : pending.splice(at, 1);
    if (entry === undefined) {
      const miss: TapeFetchMiss = {
        method,
        path,
        requestHash,
        pending: pending.map(describePending),
      };
      misses.push(miss);
      throw new TapeMismatchError(
        `tape ${source.header.tapeId}: no entry for ${method} ${path} ${requestHash.slice(0, 12)}; pending: ${miss.pending.join("; ") || "none"}`,
      );
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Response(bodyStream(entry.wire.chunks, signal, options.sleep), {
      status: entry.wire.status,
      headers: entry.wire.headers,
    });
  };
  // @types/bun의 fetch 형은 preconnect를 함께 요구한다
  const replayFetch: FetchFunction = Object.assign(respond, { preconnect: () => undefined });

  return {
    fetch: replayFetch,
    misses: () => [...misses],
    remaining: () => pending.length,
    assertExhausted() {
      const first = misses[0];
      if (first !== undefined) {
        throw new TapeMismatchError(
          `tape ${source.header.tapeId}: ${misses.length} request(s) had no entry, first ${first.method} ${first.path} ${first.requestHash.slice(0, 12)}`,
        );
      }
      if (pending.length > 0 && source.header.allowLeftover !== true) {
        throw new TapeLeftoverError(
          `tape ${source.header.tapeId} has ${pending.length} unused wire entr${pending.length === 1 ? "y" : "ies"}: ${pending.map(describePending).join("; ")}`,
        );
      }
    },
  };
}
