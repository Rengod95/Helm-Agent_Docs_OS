import type { FetchFunction } from "@earendil-works/pi-ai";

// 시험용 Anthropic Messages SSE 본문과 가짜 provider fetch. 네트워크 호출은 없다.

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function textSse(text: string, usage: { input: number; output: number }): string {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        usage: { input_tokens: usage.input, output_tokens: 1 },
      },
    }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: usage.output },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

export function toolSse(name: string, args: Readonly<Record<string, string>>): string {
  const json = JSON.stringify(args);
  const mid = Math.floor(json.length / 2);
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        usage: { input_tokens: 30, output_tokens: 1 },
      },
    }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: json.slice(0, mid) },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: json.slice(mid) },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 12 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

export interface SeenRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FakeProviderResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** 본문을 이 크기의 덩어리로 나눠 보낸다. 없으면 이벤트 경계마다 */
  readonly chunkSize?: number;
  readonly body: string;
}

/** 요청마다 handler가 응답을 고르는 가짜 provider. 받은 요청(헤더 포함)을 모은다 */
export function fakeProvider(handler: (request: SeenRequest) => FakeProviderResponse): {
  readonly fetch: FetchFunction;
  readonly seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const respond = (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    const request: SeenRequest = {
      url: input instanceof Request ? input.url : String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    };
    seen.push(request);
    const reply = handler(request);
    const encoder = new TextEncoder();
    const parts =
      reply.chunkSize === undefined
        ? reply.body.split(/(?<=\n\n)/)
        : (reply.body.match(new RegExp(`[^]{1,${reply.chunkSize}}`, "g")) ?? []);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status: reply.status ?? 200,
        headers: { "content-type": "text/event-stream", ...reply.headers },
      }),
    );
  };
  return { fetch: Object.assign(respond, { preconnect: () => undefined }), seen };
}
