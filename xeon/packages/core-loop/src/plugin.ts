import type { IdFactory } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type PortKey,
} from "@xeon/contracts/extensions";
import { EVENT_CATALOG, SessionServiceName, type SessionService } from "@xeon/contracts/records";
import {
  ApprovalServiceName,
  ContextServiceName,
  LoopServiceName,
  ModelServiceName,
  OsServiceName,
  TaskServiceName,
  ToolServiceName,
  type ApprovalService,
  type ContextService,
  type LoopService,
  type ModelService,
  type OsService,
  type TaskService,
  type ToolService,
} from "@xeon/contracts/services";
import { ExtHostPortKey, hostOf, type ExtensionUnit } from "@xeon/ext-host";
import { createLoopService } from "./service.ts";
import { DEFAULT_LOOP_SETTINGS, type LoopSettingsSource } from "./settings.ts";
import type { HostMode, LoopDeps } from "./types.ts";

// L1.loop.plan §2 plugin.ts. ext-host의 내장 확장 API로 `xeon.loop`를 제공하고,
// 필요한 서비스(xeon.tasks·session·tools·context·models·ext·os)는 포트로 주입받는다(DR-14 예외 4).

/** 확장 이름. 서비스 이름 `xeon.loop`와 별개다 */
export const LOOP_EXTENSION_NAME = "core-loop";

export const LOOP_MANIFEST: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: LOOP_EXTENSION_NAME,
  version: "0.1.0",
  displayName: "Agent loop",
  description:
    "L1 agent loop: runs the own agent loop (adr.0009), commits step boundaries, fires extension points.",
  defaultEnabled: true,
  layer: "L1",
  kind: "plugin",
  entry: "./src/index.ts",
  points: [],
  usesDrive: false,
  trust: { level: "builtin" },
});

const LOOP_SERVICE_KEY: PortKey<LoopService> = { name: LoopServiceName };
const TASKS_KEY: PortKey<TaskService> = { name: TaskServiceName };
const SESSION_KEY: PortKey<SessionService> = { name: SessionServiceName };
const TOOLS_KEY: PortKey<ToolService> = { name: ToolServiceName };
const CONTEXT_KEY: PortKey<ContextService> = { name: ContextServiceName };
const MODELS_KEY: PortKey<ModelService> = { name: ModelServiceName };
const OS_KEY: PortKey<OsService> = { name: OsServiceName };
const APPROVALS_KEY: PortKey<ApprovalService> = { name: ApprovalServiceName };

/** 기본 시스템 프롬프트. 조립 루트가 설정으로 덮어쓴다 */
export const DEFAULT_BASE_PROMPT = "You are Xeon, a helpful coding assistant.";

export interface LoopPluginOptions {
  /** IdFactory 구현은 L0 platform-os에 있고 조립 루트가 넘긴다 */
  readonly ids: IdFactory;
  readonly hostMode: HostMode;
  readonly settings?: LoopSettingsSource;
  readonly basePrompt?: string;
  /** `user_bash` 지점 페이로드의 작업 디렉터리를 대화별로 돌려준다 */
  readonly workingDirectory?: LoopDeps["workingDirectory"];
  readonly kindLookup?: LoopDeps["kindLookup"];
  readonly cancelledByOwner?: LoopDeps["cancelledByOwner"];
  readonly loadIndex?: number;
}

/** 조립 루트(`apps/host`)가 `ExtHost.install`에 넘기는 내장 확장 단위 */
export function loopExtensionUnit(options: LoopPluginOptions): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      const host = hostOf(g);
      const os = host.port(OS_KEY);
      const ext = host.port(ExtHostPortKey);
      // 승인 서비스는 core-tools가 올린다. 있으면 `await_input` 재개 전에 미해결 승인 요청을 메모리 대기로 되살린다
      // (L1.tools.spec §4.7 재개 절차). 없는 구성(도구 없이 루프만 쓰는 시험)은 되살릴 것이 없다
      const approvals = ext.ports.get(APPROVALS_KEY);
      const service = createLoopService({
        clock: os.time.clock,
        scheduler: os.time.scheduler,
        ids: options.ids,
        logger: os.logger(LOOP_EXTENSION_NAME),
        session: host.port(SESSION_KEY),
        tasks: host.port(TASKS_KEY),
        tools: host.port(TOOLS_KEY),
        context: host.port(CONTEXT_KEY),
        models: host.port(MODELS_KEY),
        ext,
        ...(approvals === undefined ? {} : { approvals }),
        settings: options.settings ?? DEFAULT_LOOP_SETTINGS,
        basePrompt: options.basePrompt ?? DEFAULT_BASE_PROMPT,
        ...(options.workingDirectory === undefined
          ? {}
          : { workingDirectory: options.workingDirectory }),
        hostMode: options.hostMode,
        kindLookup:
          options.kindLookup ?? ((kind) => EVENT_CATALOG.find((catalog) => catalog.kind === kind)),
        cancelledByOwner: options.cancelledByOwner ?? (() => false),
      });
      host.providePort(LOOP_SERVICE_KEY, service);
      g.onDispose(() => {
        service.dispose();
      });
    });
  };
  return {
    manifest: LOOP_MANIFEST,
    entry,
    loadIndex: options.loadIndex ?? 0,
    builtin: true,
  };
}
