import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceShellKey,
  type ServiceKey,
  type CallContext,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import { Bug, type Clock, type Result } from "@xeon/contracts";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  AssistantMessage,
  JsonValue,
  ThreadId,
} from "@xeon/contracts/conversation";
import type { ExtensionManifest, ScopeSetup } from "@xeon/contracts/extensions";
import type { ScopeLayer, ScopeStack } from "@xeon/contracts/settings";
import type { ToolCallOutcome, ToolRunContext, ToolService } from "@xeon/contracts/services";
import { Type } from "typebox";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import type { ExtensionUnit } from "@xeon/ext-host";
import type { ToolsDeps } from "../../src/deps.ts";
import { configReader } from "../../src/plugin.ts";
import { createToolRuntime, type ToolRuntime } from "../../src/runtime.ts";
import type { SecretChecker } from "../../src/secret-gate.ts";
import type { ToolsSettingsSource } from "../../src/settings.ts";
import {
  fakeRedactor,
  fakeRunContext,
  fakeSession,
  fakeStore,
  fakeTruncator,
  sequentialIds,
  type FakeSession,
  type FakeStore,
} from "../../src/testing/index.ts";
import { fakeTasks, type FakeTasks } from "./fake-tasks.ts";

// 테스트 조립. 실제 ext-host 테스트 호스트(디스패치)에 대역 세션·저장소·비밀·태스크를 붙인다.

export const NOW = 1_767_571_200_000;

export interface HarnessOptions {
  readonly secrets?: Readonly<Record<string, string>>;
  readonly layers?: ScopeStack;
  readonly withTasks?: boolean;
  /** `tools` 풀 슬롯 수. 생략하면 제한이 없다 */
  readonly toolsCapacity?: number;
  /** `xeon.secrets.check` 대역. 없으면 secretEnv를 쓰는 호출은 거부된다 */
  readonly secretChecker?: SecretChecker;
}

export interface Harness {
  readonly clock: Clock;
  readonly session: FakeSession;
  readonly store: FakeStore;
  readonly tasks: FakeTasks;
  readonly host: TestHost;
  readonly runtime: ToolRuntime;
  readonly deps: ToolsDeps;
  readonly thread: ThreadId;
  /** 능력 서비스 API 대역 표(능력 id → API 객체) */
  readonly apis: Map<string, unknown>;
  /** 파일 범위 설정 층을 바꾼다 */
  setLayers(layers: ScopeStack): void;
  run(overrides?: { interactive?: boolean; signal?: AbortSignal }): ToolRunContext;
}

let unitCounter = 0;

/** 지점 핸들러를 가진 확장 하나를 올린다 */
export async function installHandlers(
  harness: Harness,
  name: string,
  points: ExtensionManifest["points"],
  setup: ScopeSetup<unknown>,
): Promise<void> {
  unitCounter += 1;
  const manifest: ExtensionManifest = {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points,
    usesDrive: false,
  };
  const unit: ExtensionUnit = {
    manifest,
    entry: ({ scope }) => {
      scope(name, {}, setup);
    },
    loadIndex: unitCounter,
    builtin: true,
  };
  await harness.host.host.install(unit);
  await harness.host.host.openThread(harness.thread);
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const clock: Clock = { now: () => NOW };
  const ids = sequentialIds(1000);
  const session = fakeSession({ clock, ids });
  const store = fakeStore();
  const tasks = fakeTasks(
    options.toolsCapacity === undefined ? {} : { toolsCapacity: options.toolsCapacity },
  );
  const host = await createTestHost();
  const apis = new Map<string, unknown>();
  let fileLayers: ScopeStack = options.layers ?? [];
  const source: ToolsSettingsSource = { layers: () => fileLayers };
  const thread = ids.next("thr");
  await host.host.openThread(thread);
  const deps: ToolsDeps = {
    session,
    producer: session.producer("core.tools"),
    store,
    tasks: options.withTasks === false ? undefined : tasks,
    lockEnv: undefined,
    truncator: fakeTruncator(),
    redactor: fakeRedactor(options.secrets),
    secrets: options.secretChecker,
    ext: host.host,
    resolveCapability: (key: ServiceKey<unknown>) => apis.get(key.capability),
    config: configReader(source, session),
    clock,
    ids,
    logger: undefined,
  };
  const runtime = createToolRuntime(deps);
  return {
    clock,
    session,
    store,
    tasks,
    host,
    runtime,
    deps,
    thread,
    apis,
    setLayers: (layers) => {
      fileLayers = layers;
    },
    run: (overrides) => {
      const run = fakeRunContext({
        session,
        ids,
        threadId: thread,
        ...(overrides?.interactive === undefined ? {} : { interactive: overrides.interactive }),
        ...(overrides?.signal === undefined ? {} : { signal: overrides.signal }),
      });
      tasks.addTurn(run.turnId);
      return run;
    },
  };
}

/** 오류 값을 받지 않는 시험 호출의 결과를 꺼낸다 */
export function expectOk<T>(result: Result<T, { readonly kind: string }>): T {
  if (!result.ok)
    throw new Bug(`unexpected failure: ${result.error.kind}`, { cause: result.error });
  return result.value;
}

export function layer(
  scope: ScopeLayer["scope"],
  values: Readonly<Record<string, unknown>>,
  path?: string,
): ScopeLayer {
  return {
    scope,
    values: new Map(Object.entries(values)),
    ...(path === undefined ? {} : { path }),
  };
}

/** bash·read·ls 능력 도구를 올리고 API 호출 기록을 돌려준다 */
export interface WorkspaceProbe {
  readonly calls: {
    readonly method: string;
    readonly input: unknown;
    /** 능력 메서드가 받은 `CallOptions.context` */
    readonly context?: CallContext;
  }[];
  /** run(bash) 응답을 바꾼다 */
  setShellOutput(output: string, exitCode?: number): void;
}

export function registerWorkspace(harness: Harness): WorkspaceProbe {
  const calls: { method: string; input: unknown; context?: CallContext }[] = [];
  let shellOutput = "ok\n";
  let shellExit = 0;
  harness.apis.set(WorkspaceShell.id, {
    run: (input: unknown, options?: CallOptions) => {
      calls.push({
        method: "run",
        input,
        ...(options?.context === undefined ? {} : { context: options.context }),
      });
      return Promise.resolve({
        exitCode: shellExit,
        output: shellOutput,
        truncated: false,
        durationMs: 3,
        sandboxed: false,
      });
    },
  });
  harness.apis.set(WorkspaceFiles.id, {
    read: (input: unknown) => {
      calls.push({ method: "read", input });
      return Promise.resolve({
        kind: "text",
        path: "a.txt",
        text: "hello",
        startLine: 1,
        endLine: 1,
        totalLines: 1,
      });
    },
    list: (input: unknown) => {
      calls.push({ method: "list", input });
      return Promise.resolve({ path: ".", entries: [{ name: "a.txt", kind: "file" }] });
    },
  });
  harness.runtime.tools.register({
    kind: "capability",
    def: WorkspaceFiles,
    key: WorkspaceFilesKey,
  });
  harness.runtime.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: WorkspaceShellKey,
  });
  return {
    calls,
    setShellOutput: (output, exitCode = 0) => {
      shellOutput = output;
      shellExit = exitCode;
    },
  };
}

export const ASSISTANT: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: NOW,
};

export interface CallResult {
  /** 준비 단계에서 실행하지 않고 닫았으면 모델에 보인 사유 */
  readonly blocked: string | undefined;
  readonly result: AgentToolResult | undefined;
  readonly isError: boolean;
  /** 마감한 호출의 최종 결과(준비 단계에서 닫은 것도 포함) */
  readonly outcome: ToolCallOutcome;
}

/** 루프가 도구 호출 하나를 처리하는 순서를 흉내 낸다: prepare → execute */
export async function callTool(
  service: ToolService,
  run: ToolRunContext,
  call: { readonly id: string; readonly name: string; readonly args: Record<string, JsonValue> },
  onUpdate: AgentToolUpdateCallback = () => {},
): Promise<CallResult> {
  const toolCall = {
    type: "toolCall" as const,
    id: call.id,
    name: call.name,
    arguments: call.args,
  };
  const prepared = await service.prepare(toolCall, ASSISTANT, run);
  if (prepared.kind === "settled") {
    return {
      blocked: textOf(prepared.outcome.result),
      result: undefined,
      isError: true,
      outcome: prepared.outcome,
    };
  }
  const outcome = await service.execute(prepared.call, onUpdate, run);
  return {
    blocked: undefined,
    result: outcome.result,
    isError: outcome.isError,
    outcome,
  };
}

export function textOf(result: AgentToolResult | undefined): string {
  if (result === undefined) return "";
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** 조건이 참이 될 때까지 이벤트 루프를 양보한다. 고정 지연 대신 조건 대기(TS-03) */
export async function until(condition: () => boolean, attempts: number = 5000): Promise<void> {
  if (condition()) return;
  if (attempts <= 0) throw new Error("condition was not met");
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return until(condition, attempts - 1);
}

/** 거부된 이유를 돌려준다. 거부되지 않으면 undefined. bun의 rejects 매처는 await-thenable 규칙과 맞지 않아 쓴다 */
export async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function directTool(
  name: string,
  execute: AgentTool["execute"],
  extra: Partial<Pick<AgentTool, "replay" | "executionMode">> = {},
): AgentTool {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: Type.Record(Type.String(), Type.Unknown()),
    execute,
    ...extra,
  };
}
