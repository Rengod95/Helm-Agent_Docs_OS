import { Type } from "typebox";
import type { Clock, Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ExtensionName } from "@xeon/contracts/extensions";
import {
  EVENT_CATALOG,
  EXTENSION_KIND_PATTERN,
  type CatalogEntry,
  type ExtensionEventKind,
  type FaultInjector,
  type LeaseHolder,
  type LeaseToken,
  type StoreDb,
} from "@xeon/contracts/records";
import { workspacePlugin } from "@xeon/cap-workspace";
import type { AgentDefinition } from "@xeon/contracts/services";
import { agentsPlugin } from "@xeon/core-agents";
import { contextSettingsOf, createContextExtension } from "@xeon/core-context";
import { loopExtensionUnit } from "@xeon/core-loop";
import { createModelsExtension, type ModelsExtensionOptions } from "@xeon/core-models";
import { sessionPlugin } from "@xeon/core-persistence";
import { createTasksEntry, TASKS_MANIFEST } from "@xeon/core-tasks";
import { toolsPlugin } from "@xeon/core-tools";
import type { BuiltinExtensionModule, ExtHost, ExtensionUnit, InstallResult } from "@xeon/ext-host";
import type { HostMode } from "../types.ts";
import { openingChildThreads } from "./child-threads.ts";
import type { SettingsEngine } from "./settings-engine.ts";
import {
  agentsSource,
  loopSource,
  modelsSource,
  persistenceSource,
  tasksSource,
  toolsSource,
  workspaceSource,
} from "./settings-sources.ts";

// L4.host-service.spec §4.1 3단계. 기본 플러그인을 의존 순서로 싣는다: session → tasks → models → context → tools → loop → agents → workspace.
// 각 단위의 setup이 host.port(...)로 앞선 서비스를 동기로 찾으므로 순서가 곧 의존이다. X 로더의 내장 순서(층, 이름)는 이 의존을
// 보장하지 않아(core-context가 core-persistence보다 앞선다) M1은 조립 루트가 순서를 정한다. 외부 확장 로딩은 M2다.

export interface ExtensionDeps {
  readonly mode: HostMode;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly settings: SettingsEngine;
  readonly db: StoreDb;
  readonly faults: FaultInjector;
  readonly holder: LeaseHolder;
  /** 확장 호스트. 자식 thread를 열고 닫는 데 쓴다(core-agents) */
  readonly ext: Pick<ExtHost, "openThread" | "closeThread">;
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰. 엔진 포트가 만들어진 뒤에 채워진다(core-agents가 자식 thread의 소유를 부모에게서 이어받는다) */
  readonly parentToken: (threadId: ThreadId) => LeaseToken | undefined;
  readonly onLeaseLost: (threadId: ThreadId) => void;
  readonly reportSetting: (message: string) => void;
  /** AssembleOptions.agentDefinitions */
  readonly agentDefinitions?: readonly AgentDefinition[];
  /** 테스트 주입(AssembleOptions.buildModels) */
  readonly buildModels?: ModelsExtensionOptions["buildModels"];
}

/** 내장 확장 모듈(manifest + extension 엔트리) → ExtHost.install 단위. 내장이라 xeon.* 포트를 쓸 수 있다 */
export function unitOfModule(module: BuiltinExtensionModule, loadIndex: number): ExtensionUnit {
  return { manifest: module.manifest, entry: module.extension, loadIndex, builtin: true };
}

const PERMISSIVE_PAYLOAD = Type.Unknown();
const EXTENSION_KIND = new RegExp(EXTENSION_KIND_PATTERN);

function isExtensionKind(kind: string): kind is ExtensionEventKind {
  return EXTENSION_KIND.test(kind);
}

/**
 * 단계 경계 기여 초안의 kind 조회. 코어·도메인 kind는 카탈로그가 답하고, 확장 kind(x.*, grp.*)는 X의 kind 등록부가 답해야 하는데
 * 등록부 구현이 아직 없어(X.primitives M1 범위 밖) payload를 검사하지 않는 항목으로 통과시킨다 [미결].
 */
function kindLookup(kind: string): CatalogEntry | undefined {
  const core = EVENT_CATALOG.find((entry) => entry.kind === kind);
  if (core !== undefined) return core;
  if (isExtensionKind(kind)) {
    return { kind, version: 1, durable: true, payload: PERMISSIVE_PAYLOAD };
  }
  return undefined;
}

/** 의존 순서로 늘어놓은 기본 확장 단위. loadIndex는 이 순서다 */
export function builtinUnits(deps: ExtensionDeps): readonly ExtensionUnit[] {
  const { settings } = deps;
  const modules: readonly (readonly [ExtensionName, (loadIndex: number) => ExtensionUnit])[] = [
    [
      "core-persistence",
      (loadIndex) =>
        sessionPlugin({
          db: deps.db,
          clock: deps.clock,
          ids: deps.ids,
          logger: deps.logger.child({ component: "core-persistence" }),
          faults: deps.faults,
          settings: persistenceSource(settings, deps.reportSetting),
          holder: deps.holder,
          onLeaseLost: deps.onLeaseLost,
          loadIndex,
        }),
    ],
    [
      "core-tasks",
      (loadIndex) => ({
        manifest: TASKS_MANIFEST,
        entry: createTasksEntry({
          ids: deps.ids,
          settings: tasksSource(settings),
          log: deps.logger.child({ component: "core-tasks" }),
        }),
        loadIndex,
        builtin: true,
      }),
    ],
    [
      "core-models",
      (loadIndex) =>
        unitOfModule(
          createModelsExtension({
            settings: modelsSource(settings),
            clock: deps.clock,
            ...(deps.buildModels === undefined ? {} : { buildModels: deps.buildModels }),
          }),
          loadIndex,
        ),
    ],
    [
      "core-context",
      (loadIndex) =>
        unitOfModule(
          // 설정과 id 발급기가 없으면 컴팩션이 꺼진 채 남는다(L1C.5 M-07)
          createContextExtension({
            ids: deps.ids,
            settings: () => contextSettingsOf((key) => settings.value(key)),
          }),
          loadIndex,
        ),
    ],
    [
      "core-tools",
      (loadIndex) =>
        toolsPlugin({
          clock: deps.clock,
          ids: deps.ids,
          settings: toolsSource(settings),
          logger: deps.logger.child({ component: "core-tools" }),
          loadIndex,
        }),
    ],
    [
      "core-loop",
      (loadIndex) =>
        loopExtensionUnit({
          ids: deps.ids,
          hostMode: deps.mode,
          settings: loopSource(settings),
          kindLookup,
          loadIndex,
        }),
    ],
    [
      "core-agents",
      (loadIndex) =>
        agentsPlugin({
          ids: deps.ids,
          settings: agentsSource(settings),
          log: deps.logger.child({ component: "core-agents" }),
          holder: deps.holder,
          parentToken: deps.parentToken,
          ...(deps.agentDefinitions === undefined
            ? {}
            : { builtinDefinitions: deps.agentDefinitions }),
          loop: (resolve) =>
            openingChildThreads(resolve, deps.ext, deps.logger.child({ component: "core-agents" })),
          loadIndex,
        }),
    ],
    [
      "cap-workspace",
      (loadIndex) => workspacePlugin({ settings: workspaceSource(settings), loadIndex }),
    ],
  ];
  return modules.map(([, make], index) => make(index));
}

export interface InstallFailure {
  readonly plugin: string;
  readonly message: string;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** InstallResult가 실패를 담고 있으면 사람이 읽을 이유를 돌려준다. 성공이면 undefined */
export function installFailureOf(result: InstallResult): InstallFailure | undefined {
  if (result.entryError !== undefined) {
    return { plugin: result.name, message: `entry threw: ${messageOf(result.entryError)}` };
  }
  if (result.scopes.length === 0) {
    return { plugin: result.name, message: "the extension defined no scope" };
  }
  for (const setup of result.setups) {
    if (setup.status === "failed") {
      const detail = setup.failure === undefined ? "unknown" : messageOf(setup.failure.error);
      return { plugin: result.name, message: `setup of ${setup.scopeId} failed: ${detail}` };
    }
  }
  const error = result.issues.find((issue) => issue.severity === "error");
  if (error !== undefined) return { plugin: result.name, message: error.message };
  return undefined;
}
