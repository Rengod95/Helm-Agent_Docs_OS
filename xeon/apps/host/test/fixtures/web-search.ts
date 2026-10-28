import { err, ok } from "@xeon/contracts";
import type { HostedSearchPort, HostedSearchRequest } from "@xeon/contracts/services";
import type { DnsResolver, HttpTransport } from "@xeon/cap-web";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// HOST.6 cap-web 검색 시험(int)이 쓰는 대역: web_search를 질의마다 한 번씩 부르는 모델 테이프, hosted 검색 포트 대역(내장 래퍼),
// 켰다 끌 수 있는 SearXNG 전송. 네트워크에 나가지 않는다.

/** 질의마다 web_search를 한 번 부르고 결과를 본 뒤 한 문장으로 끝내는 테이프. turn 하나가 질의 하나다 */
export function searchingModels(
  id: string,
  queries: readonly string[],
): NonNullable<AssembleOptions["buildModels"]> {
  const steps = queries.flatMap((query, index) => [
    {
      role: "main" as const,
      label: `searches ${query}`,
      response: {
        type: "message" as const,
        content: [t.toolCall("web_search", { query }, `call_${String(index)}`)],
        stopReason: "toolUse" as const,
      },
    },
    {
      role: "main" as const,
      label: `answers after ${query}`,
      response: {
        type: "message" as const,
        content: [t.text("found it.")],
        stopReason: "stop" as const,
      },
    },
  ]);
  return tapeBuildModels(tapeProvider(tapePlayer(tape(id, steps), { clock: realTapeClock() })));
}

export interface FakeHostedSearch {
  readonly port: HostedSearchPort;
  readonly requests: HostedSearchRequest[];
}

/** 모델 provider의 hosted 검색 대역. 호출마다 결과 하나를 돌려준다 */
export function fakeHostedSearch(): FakeHostedSearch {
  const requests: HostedSearchRequest[] = [];
  return {
    requests,
    port: {
      support: () => ({ supported: true, provider: "anthropic", modelId: "tape-small" }),
      search(request) {
        requests.push(request);
        return Promise.resolve(
          ok({
            stopReason: "end_turn" as const,
            text: "",
            results: [
              { url: "https://docs.example.org/wrapper", title: "Wrapper hit", pageAge: null },
            ],
            citations: [],
            usage: { inputTokens: 100, outputTokens: 10, searchRequests: 1 },
            model: { provider: "anthropic", modelId: "tape-small" },
            continuation: null,
          }),
        );
      },
    },
  };
}

/** 이름을 공개 주소로 푼다. 전송이 가짜라 실제로 접속하지 않는다 */
export const publicResolver: DnsResolver = {
  resolve: () => Promise.resolve(ok(["93.184.216.34"])),
};

export interface SearxngSwitch {
  readonly transport: HttpTransport;
  /** SearXNG가 떠 있는가. 꺼져 있으면 모든 요청이 연결 거부다 */
  up: boolean;
  /** SearXNG로 간 요청 수 */
  hits: number;
}

const SEARXNG_JSON = JSON.stringify({
  query: "q",
  results: [
    { url: "https://docs.example.org/searxng", title: "SearXNG hit", content: "from searxng" },
  ],
});

/** 루프백 SearXNG 대역. `up`이 거짓이면 연결 거부, 참이면 고정 결과를 돌려준다 */
export function searxngSwitch(initiallyUp: boolean): SearxngSwitch {
  const state: SearxngSwitch = {
    up: initiallyUp,
    hits: 0,
    transport: {
      send(request) {
        if (!state.up) {
          return Promise.resolve(err({ kind: "network", message: "connection refused" }));
        }
        state.hits += 1;
        return Promise.resolve(
          ok({
            status: 200,
            url: request.url,
            headers: { "content-type": "application/json" },
            body: new TextEncoder().encode(SEARXNG_JSON),
          }),
        );
      },
    },
  };
  return state;
}
