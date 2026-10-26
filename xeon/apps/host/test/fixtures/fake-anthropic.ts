// 시험용 가짜 Anthropic Messages 서버(로컬 HTTP). 모델 호출이 실제 HTTP 경로로 나가 비밀 lease가 열려야만 키가 도착한다.
// 받은 요청의 키 헤더를 기록한다(가짜 값뿐이다). 응답은 짧은 텍스트 SSE 한 번이다.

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function textStream(text: string): string {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        usage: { input_tokens: 5, output_tokens: 1 },
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
      usage: { output_tokens: 2 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

export interface FakeAnthropic {
  /** `http://127.0.0.1:<port>`. `l1.models.providers`의 baseUrl로 쓴다 */
  readonly url: string;
  /** 호스트:포트. 비밀 사용 정책의 호스트 항목과 같은 값이다 */
  readonly hostPort: string;
  /** 받은 요청마다 키를 담은 헤더(`x-api-key` 또는 `authorization`)의 값 */
  keys(): readonly string[];
  stop(): Promise<void>;
}

export function startFakeAnthropic(reply: string): FakeAnthropic {
  const keys: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      keys.push(request.headers.get("x-api-key") ?? request.headers.get("authorization") ?? "");
      return new Response(textStream(reply), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    hostPort: `127.0.0.1:${server.port}`,
    keys: () => keys,
    stop: async () => {
      await server.stop(true);
    },
  };
}
