import type { AssistantMessage, FetchFunction, JsonValue } from "@earendil-works/pi-ai";
import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { ModelRole } from "@xeon/contracts/services";
import {
  findSecrets,
  requestHashOf,
  scrubSecrets,
  summarizeRequest,
  type SecretFinding,
} from "./tape-wire.ts";
import type {
  ModelTape,
  ModelTapeHeader,
  ModelTapeTurn,
  TapeContent,
  TapeResponse,
  TapeWire,
  TapeWireChunk,
} from "./tape.ts";

// 실제 provider 호출을 테이프로 남기는 녹화기(eng.testing.guide TS-04, M2 마감 G4-06, 결정 D-e).
// pi-ai 요청 옵션 `fetch` 자리에 끼워 원본 SSE 덩어리와 도착 시각(ms)을 그대로 모은다. 요청 헤더는 저장하지 않고
// (키가 실리는 자리다), 응답 헤더는 허용 목록만 남기며, 쓰기 직전에 비밀 패턴을 다시 훑어 하나라도 남으면 쓰지 않는다.

/** 녹화기가 요청·응답 모양이 맞지 않을 때 던지는 시험 인프라 오류. 녹화는 사람이 손으로 돌리므로 바로 멈추는 편이 낫다 */
export class TapeRecordError extends Bug {
  override readonly name: string = "TapeRecordError";
}

/** 응답 헤더 허용 목록. 나머지는 버린다 */
const ALLOWED_RESPONSE_HEADERS: readonly string[] = [
  "content-type",
  "request-id",
  "x-request-id",
  "retry-after",
];

/** 한 번의 HTTP 교환. 비밀 치환 전의 원본이다 */
export interface RecordedExchange {
  readonly wire: TapeWire;
  /** 응답 본문을 끝까지 받았는가. 중간에 끊겼으면 거짓 */
  readonly complete: boolean;
}

export interface RecordingFetchOptions {
  /** 실제 요청을 보내는 fetch. 시험은 가짜를 넣는다 */
  readonly base: FetchFunction;
  /** 단조 증가 ms 시계 */
  readonly now: () => number;
  /** 환경에서 받은 실제 키 값들. 요청 본문에 있으면 녹화를 멈춘다 */
  readonly secrets?: readonly string[];
}

export interface RecordingFetch {
  /** pi-ai 요청 옵션 `fetch`에 넣는다 */
  readonly fetch: FetchFunction;
  /** 지난 호출 이후 끝난 교환을 꺼내고 비운다 */
  take(): readonly RecordedExchange[];
}

function allowedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ALLOWED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

async function requestBodyText(
  input: Request | URL | string,
  init: RequestInit | undefined,
): Promise<string> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return input instanceof Request ? await input.clone().text() : "";
  }
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  throw new TapeRecordError("the recorder can store only string or binary request bodies");
}

/**
 * 녹화 fetch. 요청에 `accept-encoding: identity`를 강제해 압축된 본문이 깨져 저장되는 일을 막는다. 본문은 원본 바이트를
 * 그대로 호출자에게 흘려보내면서 덩어리와 오프셋을 따로 모은다
 */
export function recordingFetch(options: RecordingFetchOptions): RecordingFetch {
  const done: RecordedExchange[] = [];

  const record = async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const started = options.now();
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    const body = await requestBodyText(input, init);
    if (findSecrets(body, options.secrets ?? []).length > 0) {
      throw new TapeRecordError(
        "the request body contains a secret pattern; keys must not go into prompts (a rotated key would leave it in the tape)",
      );
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.set("accept-encoding", "identity");
    const response = await options.base(input, { ...init, headers });
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.toLowerCase() !== "identity") {
      throw new TapeRecordError(
        `the provider answered with content-encoding ${encoding} although identity was requested`,
      );
    }
    const requestHash = requestHashOf(body);
    const request = summarizeRequest(body);
    const responseHeaders = allowedHeaders(response.headers);
    const chunks: TapeWireChunk[] = [];
    const decoder = new TextDecoder();
    const finish = (complete: boolean): void => {
      const tail = decoder.decode();
      if (tail.length > 0) chunks.push({ t: Math.round(options.now() - started), data: tail });
      done.push({
        complete,
        wire: {
          method,
          path,
          requestHash,
          request,
          status: response.status,
          headers: responseHeaders,
          chunks: [...chunks],
        },
      });
    };
    const source = response.body;
    if (source === null) {
      finish(true);
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const reader = source.getReader();
    const passthrough = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await reader.read();
        if (next.done) {
          finish(true);
          controller.close();
          return;
        }
        const value: unknown = next.value;
        if (!(value instanceof Uint8Array)) {
          throw new TapeRecordError("the provider body produced a chunk that is not bytes");
        }
        const data = decoder.decode(value, { stream: true });
        // 멀티바이트 문자가 덩어리 경계에 걸리면 앞 덩어리는 비고 다음 덩어리가 문자를 모두 담는다
        if (data.length > 0) chunks.push({ t: Math.round(options.now() - started), data });
        controller.enqueue(value);
      },
      async cancel(reason) {
        finish(false);
        await reader.cancel(reason);
      },
    });
    return new Response(passthrough, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  // @types/bun의 fetch 형은 preconnect를 함께 요구한다
  const wrapped: FetchFunction = Object.assign(record, { preconnect: () => undefined });
  return {
    fetch: wrapped,
    take() {
      return done.splice(0, done.length);
    },
  };
}

// ── 테이프 만들기 ────────────────────────────────────────────────────────

export interface RecordedTurn {
  readonly role: ModelRole;
  /** pi-ai가 돌려준 최종 응답 메시지 */
  readonly message: AssistantMessage;
  /** 이 차례가 만든 HTTP 교환. 정확히 하나여야 한다(재시도가 있었으면 녹화를 거절한다) */
  readonly exchanges: readonly RecordedExchange[];
  readonly label?: string;
}

export interface RecordedTapeInput {
  readonly scenario: string;
  readonly provider: string;
  readonly model: string;
  readonly piAi: string;
  /** ISO 8601 */
  readonly at: string;
  readonly turns: readonly RecordedTurn[];
  /** 환경에서 받은 실제 키 값들. 본문에 남으면 치환하고, 쓰기 직전에 다시 훑는다 */
  readonly secrets: readonly string[];
}

export type RecordFailure =
  | { readonly kind: "no_turns" }
  | { readonly kind: "turn_failed"; readonly turn: number; readonly message: string }
  | {
      readonly kind: "turn_exchange_count";
      readonly turn: number;
      readonly count: number;
    }
  | { readonly kind: "http_status"; readonly turn: number; readonly status: number }
  | { readonly kind: "incomplete_exchange"; readonly turn: number }
  | { readonly kind: "secret_remains"; readonly findings: readonly SecretFinding[] };

function scrubJson(value: JsonValue, secrets: readonly string[]): JsonValue {
  if (typeof value === "string") return scrubSecrets(value, secrets);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((member: JsonValue) => scrubJson(member, secrets));
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [key, scrubJson(member, secrets)]),
  );
}

function scrubBlock(
  block: AssistantMessage["content"][number],
  secrets: readonly string[],
): TapeContent {
  if (block.type === "text") return { ...block, text: scrubSecrets(block.text, secrets) };
  if (block.type === "thinking") {
    return {
      ...block,
      thinking: scrubSecrets(block.thinking, secrets),
      ...(block.thinkingSignature === undefined
        ? {}
        : { thinkingSignature: scrubSecrets(block.thinkingSignature, secrets) }),
    };
  }
  return {
    ...block,
    arguments: Object.fromEntries(
      Object.entries(block.arguments).map(([key, member]) => [key, scrubJson(member, secrets)]),
    ),
  };
}

function contentOf(message: AssistantMessage, secrets: readonly string[]): TapeContent[] {
  return message.content.map((block) => scrubBlock(block, secrets));
}

function responseOf(
  message: AssistantMessage,
  secrets: readonly string[],
): Result<TapeResponse, string> {
  const stopReason = message.stopReason;
  if (stopReason !== "stop" && stopReason !== "length" && stopReason !== "toolUse") {
    return err(message.errorMessage ?? `stopReason ${stopReason}`);
  }
  const { input, output, cacheRead, cacheWrite, totalTokens } = message.usage;
  return ok({
    type: "message",
    content: contentOf(message, secrets),
    stopReason,
    usage: { input, output, cacheRead, cacheWrite, totalTokens },
  });
}

/**
 * 덩어리 경계에 걸친 비밀. 덩어리마다 치환하면 앞뒤 조각이 남으므로 원본을 이어 붙여 찾고, 걸친 것이 있으면
 * 치환으로 고치지 않고 녹화를 거절한다
 */
function secretsAcrossChunks(
  chunks: readonly TapeWireChunk[],
  secrets: readonly string[],
): readonly SecretFinding[] {
  const boundaries: number[] = [];
  let end = 0;
  for (const chunk of chunks) {
    end += chunk.data.length;
    boundaries.push(end);
  }
  return findSecrets(chunks.map((chunk) => chunk.data).join(""), secrets).filter((finding) =>
    boundaries.some((b) => finding.at < b && b < finding.at + finding.length),
  );
}

function scrubbedWire(wire: TapeWire, secrets: readonly string[]): TapeWire {
  return {
    method: wire.method,
    path: wire.path,
    requestHash: wire.requestHash,
    request: {
      ...(wire.request.model === undefined
        ? {}
        : { model: scrubSecrets(wire.request.model, secrets) }),
      ...(wire.request.messages === undefined ? {} : { messages: wire.request.messages }),
      tools: wire.request.tools.map((name) => scrubSecrets(name, secrets)),
    },
    status: wire.status,
    headers: Object.fromEntries(
      Object.entries(wire.headers)
        .toSorted(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, value]) => [name, scrubSecrets(value, secrets)]),
    ),
    chunks: wire.chunks.map((chunk) => ({ t: chunk.t, data: scrubSecrets(chunk.data, secrets) })),
  };
}

/**
 * 녹화한 차례를 `origin: "recorded"` 테이프로 만든다. 응답이 오류이거나, 2xx가 아니거나, 차례마다 교환이 하나가 아니면
 * 실패다(성공한 호출만 테이프가 된다). 매칭은 `role-queue`이고 요청 열쇠는 `wire.requestHash`다
 */
export function buildRecordedTape(input: RecordedTapeInput): Result<ModelTape, RecordFailure> {
  if (input.turns.length === 0) return err({ kind: "no_turns" });
  const header: ModelTapeHeader = {
    kind: "header",
    format: "xeon.model-tape.v1",
    tapeId: `recorded/${input.scenario}`,
    origin: "recorded",
    matching: "role-queue",
    recordedFrom: {
      provider: input.provider,
      model: input.model,
      piAi: input.piAi,
      at: input.at,
    },
  };
  const turns: ModelTapeTurn[] = [];
  for (const [index, turn] of input.turns.entries()) {
    const n = index + 1;
    const [exchange, ...extra] = turn.exchanges;
    if (exchange === undefined || extra.length > 0) {
      return err({ kind: "turn_exchange_count", turn: n, count: turn.exchanges.length });
    }
    if (!exchange.complete) return err({ kind: "incomplete_exchange", turn: n });
    const straddling = secretsAcrossChunks(exchange.wire.chunks, input.secrets);
    if (straddling.length > 0) return err({ kind: "secret_remains", findings: straddling });
    if (exchange.wire.status < 200 || exchange.wire.status >= 300) {
      return err({ kind: "http_status", turn: n, status: exchange.wire.status });
    }
    const response = responseOf(turn.message, input.secrets);
    if (!response.ok) return err({ kind: "turn_failed", turn: n, message: response.error });
    turns.push({
      kind: "turn",
      n,
      role: turn.role,
      response: response.value,
      wire: scrubbedWire(exchange.wire, input.secrets),
      ...(turn.label === undefined ? {} : { label: turn.label }),
    });
  }
  return ok({ header, turns });
}

/**
 * 테이프를 JSONL 텍스트로 만든다. 키 순서는 고정이라 같은 내용이면 같은 텍스트다. 쓰기 직전에 전체를 다시 훑어
 * 비밀 패턴이나 알려진 키 값이 남아 있으면 텍스트를 내지 않는다
 */
export function renderRecordedTape(
  source: ModelTape,
  secrets: readonly string[],
): Result<string, RecordFailure> {
  const lines = [source.header, ...source.turns].map((line) => JSON.stringify(line));
  const text = `${lines.join("\n")}\n`;
  // 덩어리 경계에 걸친 비밀은 덩어리마다 훑어서는 못 찾으므로 본문을 이어 붙여서도 훑는다
  const joined = source.turns.map((turn) => (turn.wire?.chunks ?? []).map((c) => c.data).join(""));
  const findings = [text, ...joined].flatMap((part) => findSecrets(part, secrets));
  if (findings.length > 0) return err({ kind: "secret_remains", findings });
  return ok(text);
}
