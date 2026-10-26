import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JsonRpcMessage } from "@xeon/contracts/wire";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type ModelTapeTurn,
} from "@xeon/core-models/testing";
import type { AssembleOptions } from "@xeon/host";
import { connectEngine } from "../../src/engine.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";
import { createScenarioHome, realTapeClock, type ScenarioHome } from "./scenario.ts";

// 실제 호스트 위의 CLI 시험 도구(L4.cli.plan §5.2). 가짜 서버 대신 `connectEngine`이 실제 @xeon/host를 같은 프로세스에 세우고,
// 모델은 테이프다. 엔진 홈(XEON_HOME)은 임시 디렉터리 하나이고 작업 폴더는 그 안의 work다. 입출력은 harness의 가짜 CliIo를 그대로 쓴다.

/** 테이프 한 단계(`tape()`가 받는 모양) */
export type TapeStep = Omit<ModelTapeTurn, "kind" | "n">;

type BuildModels = NonNullable<AssembleOptions["buildModels"]>;

/** 모델이 부른 순서대로 정해진 텍스트 답을 내는 테이프. 대화 turn과 요약 호출이 같은 큐(`main`)에서 차례로 꺼낸다 */
export function answeringModels(id: string, answers: readonly string[]): BuildModels {
  return modelsOf(
    id,
    answers.map((answer, index) => ({
      role: "main",
      label: `answer ${String(index + 1)}`,
      response: { type: "message", content: [t.text(answer)], stopReason: "stop" },
    })),
  );
}

/** 단계 목록(도구 호출 단계를 섞을 수 있다)으로 모델 모음을 만든다 */
export function modelsOf(id: string, steps: readonly TapeStep[]): BuildModels {
  return tapeBuildModels(
    tapeProvider(tapePlayer(tape(id, [...steps]), { clock: realTapeClock() })),
  );
}

interface SentRequest {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface RealCliOptions {
  /** 엔진의 모델 모음. 없으면 모델을 부르지 않는 시험이다 */
  readonly models?: BuildModels;
  /** 사용자 설정 파일에 더할 값. 테이프 provider 설정은 항상 들어 있다 */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** 작업 폴더 안에 만들 파일. 키는 작업 폴더 기준 상대 경로다 */
  readonly files?: Readonly<Record<string, string>>;
  readonly harness?: Omit<HarnessOptions, "connect" | "cwd" | "stateFile">;
  /** 이미 만든 홈을 쓴다(같은 저장소를 다른 프로세스가 먼저 썼을 때). 지우는 일은 만든 쪽이 한다 */
  readonly home?: ScenarioHome;
}

export interface RealCli {
  readonly home: ScenarioHome;
  readonly harness: Harness;
  /** 지금까지 클라이언트(CLI)가 호스트에 보낸 요청. 이름을 주면 그 메서드만 */
  sent(method?: string): readonly SentRequest[];
  dispose(): void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** 클라이언트가 보낸 요청이면 메서드와 params를 돌려준다. 응답과 서버 알림(id 없음)은 거른다 */
function requestOf(message: JsonRpcMessage): SentRequest | undefined {
  if (!("method" in message) || !("id" in message)) return undefined;
  const params: unknown = message.params;
  return { method: message.method, params: isRecord(params) ? params : {} };
}

export function createRealCli(options: RealCliOptions = {}): RealCli {
  const home = options.home ?? createScenarioHome();
  const settingsFile = join(home.root, "config", "settings.json");
  if (options.settings !== undefined && options.home === undefined) {
    // createScenarioHome이 쓴 테이프 설정 위에 시험의 값을 더한다
    writeFileSync(
      settingsFile,
      JSON.stringify({
        "l1.models.default": "tape/tape-1",
        "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
        ...options.settings,
      }),
      { mode: 0o600 },
    );
  }
  for (const [relative, text] of Object.entries(options.files ?? {})) {
    const target = join(home.work, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  const previousHome = process.env["XEON_HOME"];
  process.env["XEON_HOME"] = home.root;
  const messages: JsonRpcMessage[] = [];
  const harness = createHarness({
    env: { NO_COLOR: "1" },
    ...options.harness,
    cwd: home.work,
    connect: (connectOptions) =>
      connectEngine({
        ...connectOptions,
        stateFile: home.stateFile,
        assemble: {
          defaultGroups: false,
          ...(options.models === undefined ? {} : { buildModels: options.models }),
        },
        observe: (message) => {
          messages.push(message);
          connectOptions.observe?.(message);
        },
      }),
  });
  return {
    home,
    harness,
    sent: (method) =>
      messages
        .map(requestOf)
        .filter((request): request is SentRequest => request !== undefined)
        .filter((request) => method === undefined || request.method === method),
    dispose() {
      harness.dispose();
      if (previousHome === undefined) delete process.env["XEON_HOME"];
      else process.env["XEON_HOME"] = previousHome;
      if (options.home === undefined) home.dispose();
    },
  };
}
