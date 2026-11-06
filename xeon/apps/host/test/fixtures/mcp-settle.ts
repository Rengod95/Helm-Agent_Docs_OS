import type { StubServer } from "@fresnel/cap-mcp/testing";
import { parseJson } from "@fresnel/contracts";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapePlayer,
  type TapeResponse,
} from "@fresnel/core-models/testing";
import { callingPlayer, type ToolStep } from "./call-tape.ts";
import { realTapeClock } from "./tape-host.ts";
import { until } from "./wire-client.ts";
import type { AssembleOptions } from "../../src/types.ts";

// MCP 서버 도구를 부르는 시험의 도우미. 제품은 서버 연결을 세션 시작이나 turn 시작에서 기다리지 않는다. 서버가 tools/list 응답을 내고
// 클라이언트가 그 응답을 읽어 연결을 끝내면, 서버 도구는 그 뒤 첫 단계 경계(`boundary.step.before`, 단계마다 도구를 광고하기 전)에 도구 표에 오른다.
// 연결이 끝났음을 알리는 와이어 메서드나 이벤트는 없다. 예전에는 표지 뒤에 turn을 한 번(또는 두 번) 돌리면 반영된다고 가정했지만, 부하가 큰 러너에서는
// 그 turn이 끝나도 도구가 아직 표에 없는 경우가 있어 시험이 가끔 실패했다(도구를 부르는 turn이 도구 없이 끝나 승인 요청이 오지 않았다).
// 그래서 도구를 실제로 불러 본다: 시험용 모델은 서버 도구가 확인되기 전에는 테이프를 쓰지 않고 해 없는 탐침 호출만 낸다.
// 시험은 탐침이 성공할 때까지 turn을 돌리고(`warmUntilAdvertised`), 그 뒤에 도구를 부르는 turn을 시작한다.

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
async function settleMcpTools(
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

export interface GatedModels {
  readonly buildModels: NonNullable<AssembleOptions["buildModels"]>;
  /** 탐침 호출이 서버 도구의 결과(오류가 아닌 결과)를 받았다 */
  readonly connected: () => boolean;
}

const PROBE_PREFIX = "probe_";

/**
 * `callingModels`와 같은 테이프를 쓰되, 서버 도구가 도구 표에 오른 것이 확인되기 전의 요청에는 테이프를 소비하지 않는다.
 * 확인 전에는 turn마다 `probeTool`(해가 없고 승인을 묻지 않는 서버 도구)을 한 번 부르고, 그 결과가 오류가 아니면 도구가 올랐다고 본다.
 * 도구가 아직 표에 없으면 결과는 알 수 없는 도구 오류다. 확인된 뒤의 요청부터 `steps`와 `final`을 차례로 낸다.
 * 모델이 받는 맥락에는 도구 목록이 없고 제품에도 연결 완료 신호가 없어서, 도구를 실제로 불러 보는 것이 도구 표를 읽는 길이다.
 */
export function callingModelsAfterTool(
  id: string,
  probeTool: string,
  steps: readonly ToolStep[],
  final = "done.",
): GatedModels {
  const main = callingPlayer(id, steps, final, []);
  const state = { connected: false, probes: 0 };
  const player: TapePlayer = {
    ...main,
    stream(req) {
      // 도구 결과 뒤에 환경 안내 같은 user 메시지가 붙으므로 마지막 assistant 메시지 뒤의 도구 결과를 본다
      const afterAssistant = req.context.messages.slice(
        req.context.messages.findLastIndex((message) => message.role === "assistant") + 1,
      );
      const last = afterAssistant.find((message) => message.role === "toolResult");
      const probed = last?.role === "toolResult" && last.toolCallId.startsWith(PROBE_PREFIX);
      if (probed && !last.isError) state.connected = true;
      if (!probed && state.connected) return main.stream(req);
      if (!probed) state.probes += 1;
      const response: TapeResponse = probed
        ? { type: "message", content: [t.text("warming up.")], stopReason: "stop" }
        : {
            type: "message",
            content: [t.toolCall(probeTool, {}, `${PROBE_PREFIX}${String(state.probes)}`)],
            stopReason: "toolUse",
          };
      return tapePlayer(tape(`${id}-warm`, [{ role: req.role, label: "warm", response }]), {
        clock: realTapeClock(),
      }).stream(req);
    },
  };
  return {
    buildModels: tapeBuildModels(tapeProvider(player)),
    connected: () => state.connected,
  };
}

/**
 * 서버가 tools/list 응답을 낸 뒤, 탐침이 서버 도구의 결과를 받을 때까지 `turn`을 되풀이한다. 시한 안에 보이지 않으면 던진다.
 * 부르는 turn은 이 함수가 돌아온 뒤에 시작한다.
 */
export async function warmUntilAdvertised(
  gated: GatedModels,
  listed: () => boolean,
  turn: () => Promise<void>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await settleMcpTools(listed, async () => {
    while (!gated.connected()) {
      if (Date.now() >= deadline) {
        throw new Error(`the MCP tool did not answer the probe within ${String(timeoutMs)}ms`);
      }
      // eslint-disable-next-line no-await-in-loop -- 연결이 끝날 때까지 turn을 차례로 돌린다
      await turn();
    }
  });
}
