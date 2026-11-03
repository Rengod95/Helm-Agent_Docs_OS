import { err, ok } from "@fresnel/contracts";
import type { HostedSearchPort, HostedSearchRequest } from "@fresnel/contracts/services";
import type { DnsResolver, HttpTransport } from "@fresnel/cap-web";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// HOST.6 cap-web 검색 시험(int)이 쓰는 대역: web_search를 질의마다 한 번씩 부르는 모델 테이프, hosted 검색 포트 대역(내장 래퍼),
// 네트워크로 나간 요청을 세는 전송. 네트워크에 나가지 않는다.

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

/** 네트워크로 나간 요청을 세는 전송 대역. 이 시험에서는 아무 요청도 나가지 않아야 한다 */
export interface RecordingTransport {
  readonly transport: HttpTransport;
  /** 전송으로 들어온 요청 수 */
  hits: number;
}

/** 요청을 세고 연결하지 않는다. 받은 요청은 실패로 돌려준다 */
export function recordingTransport(): RecordingTransport {
  const state: RecordingTransport = {
    hits: 0,
    transport: {
      send() {
        state.hits += 1;
        return Promise.resolve(
          err({ kind: "network", message: "the test transport does not connect" }),
        );
      },
    },
  };
  return state;
}
