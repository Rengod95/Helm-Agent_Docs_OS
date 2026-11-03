import type { StubServer } from "@fresnel/cap-mcp/testing";
import { parseJson } from "@fresnel/contracts";
import { until } from "./wire-client.ts";

// MCP 서버 도구를 부르는 시험의 도우미. 제품은 서버 연결을 세션 시작이나 turn 시작에서 기다리지 않는다. 서버가 tools/list 응답을 내고
// 클라이언트가 그 응답을 읽어 연결을 끝내면, 서버 도구는 그 뒤 첫 단계 경계(`boundary.step.before`, 단계마다 도구를 광고하기 전)에 도구 표에 오른다.
// 연결이 끝났음을 알리는 와이어 메서드나 이벤트는 없다(host.status와 status.list는 다른 것을 본다). 그래서 시험은 서버가 목록을 낸 표지를 기다린 뒤
// turn을 한 번 돌리고, 도구를 부르는 turn은 그 뒤에 시작한다. 이것은 확정이 아니라 가정이다: 표지 뒤에 호스트가 응답을 읽어 연결을 끝내는 일이
// turn 하나가 도는 동안 끝난다고 본다. 부하가 큰 Linux 러너에서 시험해 확인했다. 연결 완료를 알리는 신호가 제품에 생기면 turn 대신 그 신호를 기다린다.

export interface ServedMcpStub {
  /** 서버 설정에 적을 주소 */
  readonly url: string;
  /** 스텁이 tools/list 요청에 응답을 낸 뒤 참이다. 요청을 받은 때가 아니라 응답을 낸 때다 */
  readonly listed: () => boolean;
  readonly stop: () => Promise<void>;
}

/**
 * 서버가 tools/list 응답을 냈다는 표지(`listed`)를 기다린 뒤 `settle`로 turn을 한 번 돌린다. 표지가 제때 서지 않으면 던진다.
 * 도구를 부르는 turn은 이 함수가 돌아온 뒤에 시작한다.
 */
export async function settleMcpTools(
  listed: () => boolean,
  settle: () => Promise<void>,
  timeoutMs = 10_000,
): Promise<void> {
  if (!(await until(listed, timeoutMs))) {
    throw new Error(`the MCP server did not answer tools/list within ${String(timeoutMs)}ms`);
  }
  await settle();
}

/** 루프백 HTTP 스텁 서버를 띄운다. 요청 본문이 tools/list면 응답을 낸 뒤 `listed()`가 참이 된다 */
export function serveMcpStub(stub: StubServer): ServedMcpStub {
  const state = { listed: false };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const body = await request.clone().text();
      const response = await stub.http(request);
      if (response.ok && methodOf(body) === "tools/list") state.listed = true;
      return response;
    },
  });
  return {
    url: `http://127.0.0.1:${String(server.port)}/mcp`,
    listed: () => state.listed,
    async stop() {
      await server.stop(true);
    },
  };
}

function methodOf(body: string): unknown {
  const parsed = parseJson(body);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return undefined;
  return "method" in parsed.value ? parsed.value.method : undefined;
}
