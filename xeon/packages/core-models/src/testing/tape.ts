import { createHash } from "node:crypto";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";
import { Bug, canonicalJson, parse, type Clock, type Scheduler } from "@xeon/contracts";
import type { ModelRole } from "@xeon/contracts/services";
import { Type } from "typebox";

// eng.testing.guide TS-04 `xeon.model-tape.v1`. 모델 호출을 녹화·작성한 응답으로 대신하는 테스트 가짜다.
// 형식은 spec 그대로이고 두 가지를 더했다: TapeRequest.target(응답 메시지에 싣는 api, provider, model)과
// TapeFormatError(테이프 파일 형식 오류). role은 ModelRole 6종이다(L1.models.plan §4).

export type TapeContent = TextContent | ThinkingContent | ToolCall;

export interface ModelTapeHeader {
  readonly kind: "header";
  readonly format: "xeon.model-tape.v1";
  /** 예: "core-loop/two-tool-calls" */
  readonly tapeId: string;
  readonly origin: "authored" | "recorded";
  readonly matching: "role-queue" | "context-hash";
  /** 기본 false */
  readonly allowLeftover?: boolean;
  /** origin = "recorded"일 때 필수 */
  readonly recordedFrom?: {
    readonly provider: string;
    readonly model: string;
    /** 예: "1.3.0" */
    readonly piAi: string;
    /** ISO 8601 */
    readonly at: string;
  };
}

export type TapeResponse =
  | {
      readonly type: "message";
      readonly content: readonly TapeContent[];
      readonly stopReason: "stop" | "length" | "toolUse";
      readonly usage?: Partial<Usage>;
    }
  /** 녹화한 스트림 그대로 */
  | { readonly type: "events"; readonly events: readonly AssistantMessageEvent[] }
  | {
      readonly type: "error";
      readonly reason: "error" | "aborted";
      readonly errorMessage: string;
      /** 콘텐츠를 일부 낸 뒤 오류 */
      readonly afterContent?: readonly TapeContent[];
      readonly usage?: Partial<Usage>;
    }
  /** signal이 abort될 때까지 응답 없음 */
  | { readonly type: "stall" };

export interface ModelTapeTurn {
  readonly kind: "turn";
  /** 1부터 */
  readonly n: number;
  readonly role: ModelRole;
  /** matching = "context-hash"일 때 필수 */
  readonly match?: { readonly contextHash?: string };
  readonly response: TapeResponse;
  /**
   * 어댑터가 낸 원시 provider 스트림 이벤트(녹화). 있으면 테이프 provider가 응답 앞에 `onProviderStreamEvent`로 흘린다.
   * pi-ai가 AssistantMessage에 싣지 않는 서버 도구 블록(hosted 검색)을 시험하는 데 쓴다
   */
  readonly rawEvents?: readonly unknown[];
  /** 녹화 테이프가 싣는 HTTP 교환. `response`는 같은 교환의 파싱 결과다(`tapeFetch`로 재생한 결과와 같아야 한다) */
  readonly wire?: TapeWire;
  /** 사람용 설명. 비교하지 않는다 */
  readonly label?: string;
}

/** 녹화한 SSE 본문의 한 덩어리. 어댑터가 받은 바이트 경계를 보존한다 */
export interface TapeWireChunk {
  /** 요청을 보낸 시점부터 이 덩어리를 받은 시점까지의 ms */
  readonly t: number;
  /** 원본 텍스트(비밀 패턴은 치환됨) */
  readonly data: string;
}

/**
 * 차례 하나가 provider와 주고받은 HTTP 교환(녹화). `tapeFetch`가 pi-ai의 `fetch` 옵션 자리에서 이 교환을 그대로 재생해
 * 어댑터의 SSE 파서까지 시험한다. 요청 헤더는 저장하지 않는다(키가 실리는 자리다)
 */
export interface TapeWire {
  readonly method: string;
  /** 쿼리와 호스트를 뺀 경로. 예: "/v1/messages" */
  readonly path: string;
  /** 정규화한 요청 본문의 sha256 hex(`requestHashOf`). 재생이 요청을 짝짓는 열쇠다 */
  readonly requestHash: string;
  /** 사람이 diff에서 알아볼 요청 요약. 본문 자체는 담지 않는다 */
  readonly request: {
    readonly model?: string;
    readonly messages?: number;
    readonly tools: readonly string[];
  };
  readonly status: number;
  /** 허용 목록에 있는 응답 헤더만. 이름은 소문자 */
  readonly headers: Readonly<Record<string, string>>;
  readonly chunks: readonly TapeWireChunk[];
}

export type ModelTapeLine = ModelTapeHeader | ModelTapeTurn;

export interface ModelTape {
  readonly header: ModelTapeHeader;
  readonly turns: readonly ModelTapeTurn[];
}

/** 테이프 재생기가 받는 시계. 운영 Clock·Scheduler와 같은 인터페이스다 */
export type TapeClock = Clock & Scheduler;

/** 응답 메시지에 싣는 모델 식별 */
export interface TapeTarget {
  readonly api: string;
  readonly provider: string;
  readonly modelId: string;
}

export interface TapeRequest {
  readonly role: ModelRole;
  readonly context: Context;
  readonly signal?: AbortSignal;
  /** 없으면 api, provider, model 모두 "tape" */
  readonly target?: TapeTarget;
}

/** 재생 결과: 이벤트 열과 그 차례의 원시 provider 이벤트 */
export interface TapeStream extends AsyncIterable<AssistantMessageEvent> {
  readonly rawEvents: readonly unknown[];
}

export interface TapePlayer {
  /** 차례의 응답을 pi-ai AssistantMessageEvent 열로 낸다. 짝이 없으면 TapeMismatchError를 던진다 */
  stream(req: TapeRequest): TapeStream;
  remaining(): number;
  consumed(): readonly ModelTapeTurn[];
  /** 남은 응답이 있으면 TapeLeftoverError. allowLeftover면 통과 */
  assertExhausted(): void;
}

/** 테스트 인프라 오류. Bug를 상속하고 testing 경로에서만 선언·throw한다(eng.typescript.guide 4.3절) */
export class TapeMismatchError extends Bug {
  override readonly name: string = "TapeMismatchError";
}
export class TapeLeftoverError extends Bug {
  override readonly name: string = "TapeLeftoverError";
}
export class TapeFormatError extends Bug {
  override readonly name: string = "TapeFormatError";
}

// ── 내용 해시 ───────────────────────────────────────────────────────────

/** systemPrompt, messages, tools(name, description, parameters)의 정규화 JSON sha256 hex */
export function contextHash(context: Context): string {
  const normalized = {
    systemPrompt: context.systemPrompt ?? null,
    messages: context.messages,
    tools: (context.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

// ── 작성 도우미 ─────────────────────────────────────────────────────────

export const t: {
  text(s: string): TextContent;
  thinking(s: string): ThinkingContent;
  toolCall(name: string, args: ToolCall["arguments"], id: string): ToolCall;
} = {
  text: (s) => ({ type: "text", text: s }),
  thinking: (s) => ({ type: "thinking", thinking: s }),
  toolCall: (name, args, id) => ({ type: "toolCall", id, name, arguments: { ...args } }),
};

export function tape(
  id: string,
  turns: readonly Omit<ModelTapeTurn, "kind" | "n">[],
  opts: Partial<Pick<ModelTapeHeader, "matching" | "allowLeftover">> = {},
): ModelTape {
  return {
    header: {
      kind: "header",
      format: "xeon.model-tape.v1",
      tapeId: id,
      origin: "authored",
      matching: opts.matching ?? "role-queue",
      ...(opts.allowLeftover === undefined ? {} : { allowLeftover: opts.allowLeftover }),
    },
    turns: turns.map((turn, index) => ({ ...turn, kind: "turn", n: index + 1 })),
  };
}

// ── 파일 읽기 ───────────────────────────────────────────────────────────

const EVENT_TYPES = [
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error",
];

// F의 TUnsafe 패턴(ModelBindingSchema)과 같다. 런타임 검사는 느슨하고 정적 타입은 pi-ai 타입이다
const ContentSchema = Type.Unsafe<TapeContent>(
  Type.Object(
    {
      type: Type.Union([Type.Literal("text"), Type.Literal("thinking"), Type.Literal("toolCall")]),
    },
    { additionalProperties: true },
  ),
);
const EventSchema = Type.Unsafe<AssistantMessageEvent>(
  Type.Object({ type: Type.String({ enum: EVENT_TYPES }) }, { additionalProperties: true }),
);
const UsageSchema = Type.Unsafe<Partial<Usage>>(Type.Object({}, { additionalProperties: true }));

const HeaderSchema = Type.Unsafe<ModelTapeHeader>(
  Type.Object(
    {
      kind: Type.Literal("header"),
      format: Type.Literal("xeon.model-tape.v1"),
      tapeId: Type.String({ minLength: 1 }),
      origin: Type.Union([Type.Literal("authored"), Type.Literal("recorded")]),
      matching: Type.Union([Type.Literal("role-queue"), Type.Literal("context-hash")]),
      allowLeftover: Type.Optional(Type.Boolean()),
      recordedFrom: Type.Optional(
        Type.Object(
          {
            provider: Type.String(),
            model: Type.String(),
            piAi: Type.String(),
            at: Type.String(),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

const ResponseSchema = Type.Unsafe<TapeResponse>(
  Type.Union([
    Type.Object(
      {
        type: Type.Literal("message"),
        content: Type.Array(ContentSchema),
        stopReason: Type.Union([
          Type.Literal("stop"),
          Type.Literal("length"),
          Type.Literal("toolUse"),
        ]),
        usage: Type.Optional(UsageSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { type: Type.Literal("events"), events: Type.Array(EventSchema) },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("error"),
        reason: Type.Union([Type.Literal("error"), Type.Literal("aborted")]),
        errorMessage: Type.String(),
        afterContent: Type.Optional(Type.Array(ContentSchema)),
        usage: Type.Optional(UsageSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object({ type: Type.Literal("stall") }, { additionalProperties: false }),
  ]),
);

const WireSchema = Type.Unsafe<TapeWire>(
  Type.Object(
    {
      method: Type.String({ minLength: 1 }),
      path: Type.String({ minLength: 1 }),
      requestHash: Type.String({ minLength: 1 }),
      request: Type.Object(
        {
          model: Type.Optional(Type.String()),
          messages: Type.Optional(Type.Integer({ minimum: 0 })),
          tools: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
      status: Type.Integer({ minimum: 100, maximum: 599 }),
      headers: Type.Record(Type.String(), Type.String()),
      chunks: Type.Array(
        Type.Object(
          { t: Type.Number({ minimum: 0 }), data: Type.String() },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
);

const TurnSchema = Type.Unsafe<ModelTapeTurn>(
  Type.Object(
    {
      kind: Type.Literal("turn"),
      n: Type.Integer({ minimum: 1 }),
      role: Type.String({ enum: ["main", "review", "summary", "subagent", "judge", "search"] }),
      match: Type.Optional(
        Type.Object({ contextHash: Type.Optional(Type.String()) }, { additionalProperties: false }),
      ),
      response: ResponseSchema,
      rawEvents: Type.Optional(Type.Array(Type.Unknown())),
      wire: Type.Optional(WireSchema),
      label: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
);

/** `*.tape.jsonl`을 읽는다. 첫 줄은 헤더, 나머지는 차례다. 형식이 틀리면 TapeFormatError */
export async function loadTape(path: string): Promise<ModelTape> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const [first, ...rest] = lines;
  if (first === undefined) throw new TapeFormatError(`tape ${path} is empty`);
  const header = parse(HeaderSchema, parseLine(path, 1, first));
  if (!header.ok)
    throw new TapeFormatError(`tape ${path} line 1 is not a header`, { cause: header.error });
  if (header.value.origin === "recorded" && header.value.recordedFrom === undefined) {
    throw new TapeFormatError(`tape ${path} is recorded but has no recordedFrom`);
  }
  const turns: ModelTapeTurn[] = [];
  for (const [index, line] of rest.entries()) {
    const turn = parse(TurnSchema, parseLine(path, index + 2, line));
    if (!turn.ok) {
      throw new TapeFormatError(`tape ${path} line ${index + 2} is not a turn`, {
        cause: turn.error,
      });
    }
    if (turn.value.n !== index + 1) {
      throw new TapeFormatError(
        `tape ${path} line ${index + 2}: expected n=${index + 1}, got ${turn.value.n}`,
      );
    }
    if (header.value.matching === "context-hash" && turn.value.match?.contextHash === undefined) {
      throw new TapeFormatError(
        `tape ${path} line ${index + 2}: context-hash tape needs match.contextHash`,
      );
    }
    turns.push(turn.value);
  }
  return { header: header.value, turns };
}

function parseLine(path: string, lineNo: number, line: string): unknown {
  try {
    const value: unknown = JSON.parse(line);
    return value;
  } catch (cause) {
    throw new TapeFormatError(`tape ${path} line ${lineNo} is not JSON`, { cause });
  }
}

// ── 재생 ────────────────────────────────────────────────────────────────

const DEFAULT_TARGET: TapeTarget = { api: "tape", provider: "tape", modelId: "tape" };

function usageOf(partial: Partial<Usage> | undefined): Usage {
  const input = partial?.input ?? 0;
  const output = partial?.output ?? 0;
  const cacheRead = partial?.cacheRead ?? 0;
  const cacheWrite = partial?.cacheWrite ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(partial?.cacheWrite1h === undefined ? {} : { cacheWrite1h: partial.cacheWrite1h }),
    ...(partial?.reasoning === undefined ? {} : { reasoning: partial.reasoning }),
    totalTokens: partial?.totalTokens ?? input + output + cacheRead + cacheWrite,
    cost: partial?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function messageOf(
  target: TapeTarget,
  timestamp: number,
  content: readonly TapeContent[],
  stopReason: AssistantMessage["stopReason"],
  usage: Usage,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [...content],
    api: target.api,
    provider: target.provider,
    model: target.modelId,
    usage,
    stopReason,
    timestamp,
    ...(errorMessage === undefined ? {} : { errorMessage }),
  };
}

/** 콘텐츠 블록을 start → delta → end 순서의 이벤트로 바꾼다. partial은 블록이 자라는 대로 갱신한다 */
function contentEvents(
  target: TapeTarget,
  timestamp: number,
  blocks: readonly TapeContent[],
): AssistantMessageEvent[] {
  const events: AssistantMessageEvent[] = [];
  const partialOf = (done: readonly TapeContent[], current?: TapeContent): AssistantMessage =>
    messageOf(
      target,
      timestamp,
      current === undefined ? done : [...done, current],
      "pending",
      usageOf(undefined),
    );
  for (const [index, block] of blocks.entries()) {
    const done = blocks.slice(0, index);
    if (block.type === "text") {
      events.push({
        type: "text_start",
        contentIndex: index,
        partial: partialOf(done, { type: "text", text: "" }),
      });
      events.push({
        type: "text_delta",
        contentIndex: index,
        delta: block.text,
        partial: partialOf(done, block),
      });
      events.push({
        type: "text_end",
        contentIndex: index,
        content: block.text,
        partial: partialOf(done, block),
      });
    } else if (block.type === "thinking") {
      events.push({
        type: "thinking_start",
        contentIndex: index,
        partial: partialOf(done, { type: "thinking", thinking: "" }),
      });
      events.push({
        type: "thinking_delta",
        contentIndex: index,
        delta: block.thinking,
        partial: partialOf(done, block),
      });
      events.push({
        type: "thinking_end",
        contentIndex: index,
        content: block.thinking,
        partial: partialOf(done, block),
      });
    } else {
      events.push({
        type: "toolcall_start",
        contentIndex: index,
        partial: partialOf(done, { ...block, arguments: {} }),
      });
      events.push({
        type: "toolcall_delta",
        contentIndex: index,
        delta: JSON.stringify(block.arguments),
        partial: partialOf(done, block),
      });
      events.push({
        type: "toolcall_end",
        contentIndex: index,
        toolCall: block,
        partial: partialOf(done, block),
      });
    }
  }
  return events;
}

function responseEvents(
  response: Exclude<TapeResponse, { readonly type: "stall" }>,
  target: TapeTarget,
  timestamp: number,
): AssistantMessageEvent[] {
  if (response.type === "events") return [...response.events];
  const start: AssistantMessageEvent = {
    type: "start",
    partial: messageOf(target, timestamp, [], "pending", usageOf(undefined)),
  };
  if (response.type === "message") {
    const final = messageOf(
      target,
      timestamp,
      response.content,
      response.stopReason,
      usageOf(response.usage),
    );
    return [
      start,
      ...contentEvents(target, timestamp, response.content),
      { type: "done", reason: response.stopReason, message: final },
    ];
  }
  const partialContent = response.afterContent ?? [];
  const failed = messageOf(
    target,
    timestamp,
    partialContent,
    response.reason,
    usageOf(response.usage),
    response.errorMessage,
  );
  return [
    start,
    ...contentEvents(target, timestamp, partialContent),
    { type: "error", reason: response.reason, error: failed },
  ];
}

async function* stalled(
  target: TapeTarget,
  timestamp: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<AssistantMessageEvent> {
  yield { type: "start", partial: messageOf(target, timestamp, [], "pending", usageOf(undefined)) };
  if (signal === undefined) {
    throw new TapeMismatchError("a stall turn needs a request signal that the test aborts");
  }
  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  }
  yield {
    type: "error",
    reason: "aborted",
    error: messageOf(target, timestamp, [], "aborted", usageOf(undefined), "aborted"),
  };
}

/** 배열을 비동기 이터러블로 낸다. 소비자는 실제 스트림처럼 이벤트를 하나씩 비동기로 받는다 */
function replay(
  events: readonly AssistantMessageEvent[],
  rawEvents: readonly unknown[],
): TapeStream {
  return {
    rawEvents,
    [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      let index = 0;
      return {
        next(): Promise<IteratorResult<AssistantMessageEvent>> {
          const event = events[index];
          if (event === undefined) return Promise.resolve({ done: true, value: undefined });
          index += 1;
          return Promise.resolve({ done: false, value: event });
        },
      };
    },
  };
}

export function tapePlayer(source: ModelTape, opts: { readonly clock: TapeClock }): TapePlayer {
  const queues = new Map<ModelRole, ModelTapeTurn[]>();
  for (const turn of source.turns) {
    const queue = queues.get(turn.role) ?? [];
    queue.push(turn);
    queues.set(turn.role, queue);
  }
  const used: ModelTapeTurn[] = [];

  return {
    stream(req) {
      const queue = queues.get(req.role);
      const next = queue?.shift();
      if (next === undefined) {
        throw new TapeMismatchError(
          `tape ${source.header.tapeId} has no turn left for role ${req.role}`,
        );
      }
      used.push(next);
      if (source.header.matching === "context-hash") {
        const expected = next.match?.contextHash;
        const actual = contextHash(req.context);
        if (expected !== actual) {
          throw new TapeMismatchError(
            `tape ${source.header.tapeId} turn ${next.n}: context hash ${actual} (${req.context.messages.length} messages) does not match ${expected ?? "none"}`,
          );
        }
      }
      const target = req.target ?? DEFAULT_TARGET;
      const timestamp = opts.clock.now();
      const raw = next.rawEvents ?? [];
      if (next.response.type === "stall") {
        const pending = stalled(target, timestamp, req.signal);
        return { rawEvents: raw, [Symbol.asyncIterator]: () => pending };
      }
      return replay(responseEvents(next.response, target, timestamp), raw);
    },
    remaining: () => [...queues.values()].reduce((sum, queue) => sum + queue.length, 0),
    consumed: () => [...used],
    assertExhausted() {
      const left = [...queues.values()].reduce((sum, queue) => sum + queue.length, 0);
      if (left > 0 && source.header.allowLeftover !== true) {
        throw new TapeLeftoverError(`tape ${source.header.tapeId} has ${left} unused turn(s)`);
      }
    },
  };
}
