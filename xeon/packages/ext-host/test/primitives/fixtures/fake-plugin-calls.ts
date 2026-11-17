// 주도 단계의 `tool`, `model` 명령이 쓰는 ToolsPort와 ModelsPort 대역(drive-step.test.ts). 요청을 기록하고 시험이 준 답을 돌려준다.
// 멱등, 정책, 한도는 흉내 내지 않는다. 그것은 core-tools와 core-models의 시험이 본다. 여기서는 엔진이 답을 어떻게 옮기는지만 본다.
import { err, type Result } from "@fresnel/contracts";
import type {
  PluginCallRequest,
  PluginModelError,
  PluginModelRequest,
  PluginModelResult,
  ToolError,
  ToolResultView,
} from "@fresnel/contracts/capabilities";
import {
  ModelsPortKey,
  ToolsPortKey,
  type ModelsPort,
  type ToolsPort,
} from "@fresnel/contracts/extensions";
import type { Host } from "./fake-approvals.ts";

export interface FakeToolsPort {
  readonly port: ToolsPort;
  /** `executeForPlugin`이 받은 요청을 받은 순서대로 */
  readonly requests: readonly PluginCallRequest[];
}

export interface FakeModelsPort {
  readonly port: ModelsPort;
  /** `completeForPlugin`이 받은 요청을 받은 순서대로 */
  readonly requests: readonly PluginModelRequest[];
}

/** 도구 호출 요청마다 `answer`가 정한 결과를 돌려주는 ToolsPort 대역. 등록은 거부한다 */
export function fakeTools(
  answer: (request: PluginCallRequest) => Result<ToolResultView, ToolError>,
): FakeToolsPort {
  const requests: PluginCallRequest[] = [];
  const port: ToolsPort = {
    register: () =>
      err({ kind: "replace_forbidden", toolName: "test-double", reason: "no_target" }),
    executeForPlugin(request) {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
  };
  return { port, requests };
}

/** 모델 호출 요청마다 `answer`가 정한 결과를 돌려주는 ModelsPort 대역. 공급자 등록은 무시한다 */
export function fakeModels(
  answer: (request: PluginModelRequest) => Result<PluginModelResult, PluginModelError>,
): FakeModelsPort {
  const requests: PluginModelRequest[] = [];
  const port: ModelsPort = {
    registerProvider: () => () => undefined,
    completeForPlugin(request) {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
  };
  return { port, requests };
}

export async function provideToolsPort(t: Host, port: ToolsPort): Promise<void> {
  await t.host.registerPlatform({
    name: "test-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, port);
    },
  });
}

export async function provideModelsPort(t: Host, port: ModelsPort): Promise<void> {
  await t.host.registerPlatform({
    name: "test-models-port",
    setup(ctx) {
      ctx.providePort(ModelsPortKey, port);
    },
  });
}
