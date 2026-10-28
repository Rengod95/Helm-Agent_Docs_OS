// 시험용 Anthropic 원시 SSE 이벤트 작성기. pi-ai 어댑터가 `onProviderStreamEvent`로 넘기는 모양과 같다.

interface SearchHitInput {
  readonly url: string;
  readonly title?: string;
  readonly pageAge?: string;
}

export interface SearchEventsInput {
  readonly query?: string;
  readonly hits?: readonly SearchHitInput[];
  readonly text?: string;
  /** 인용: 인용문과 url */
  readonly citations?: readonly {
    readonly url: string;
    readonly title?: string;
    readonly cited: string;
  }[];
  readonly stopReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly searchRequests?: number;
  /** 주면 결과 대신 web_search_tool_result_error 블록을 낸다 */
  readonly toolError?: string;
}

function resultEntry(hit: SearchHitInput, index: number): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: "web_search_result",
    url: hit.url,
    title: hit.title ?? null,
    encrypted_content: `ENCRYPTED-${index + 1}`,
  };
  if (hit.pageAge !== undefined) entry["page_age"] = hit.pageAge;
  return entry;
}

export function searchEvents(input: SearchEventsInput = {}): unknown[] {
  const query = input.query ?? "xeon";
  const half = Math.max(1, Math.floor(query.length / 2));
  const events: unknown[] = [
    {
      type: "message_start",
      message: { id: "msg_1", usage: { input_tokens: input.inputTokens ?? 120, output_tokens: 1 } },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: `{"query":"${query.slice(0, half)}` },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: `${query.slice(half)}"}` },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content:
          input.toolError === undefined
            ? (
                input.hits ?? [{ url: "https://example.org/a", title: "A", pageAge: "1 day ago" }]
              ).map(resultEntry)
            : { type: "web_search_tool_result_error", error_code: input.toolError },
      },
    },
    { type: "content_block_stop", index: 1 },
  ];
  if (input.text !== undefined || input.citations !== undefined) {
    events.push(
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "text_delta", text: input.text ?? "" },
      },
    );
    for (const citation of input.citations ?? []) {
      events.push({
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "citations_delta",
          citation: {
            type: "web_search_result_location",
            url: citation.url,
            title: citation.title ?? null,
            cited_text: citation.cited,
            encrypted_index: "ENC-IDX",
          },
        },
      });
    }
    events.push({ type: "content_block_stop", index: 2 });
  }
  events.push(
    {
      type: "message_delta",
      delta: { stop_reason: input.stopReason ?? "end_turn" },
      usage: {
        output_tokens: input.outputTokens ?? 30,
        server_tool_use: { web_search_requests: input.searchRequests ?? 1 },
      },
    },
    { type: "message_stop" },
  );
  return events;
}
