import { Type } from "typebox";
import type { Clock, Logger, Scheduler } from "@fresnel/contracts";
import {
  isId,
  type IdFactory,
  type LocalIdFactory,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import type { ExtensionName } from "@fresnel/contracts/extensions";
import {
  EVENT_CATALOG,
  EXTENSION_KIND_PATTERN,
  type CatalogEntry,
  type ExtensionEventKind,
  type FaultInjector,
  type LeaseHolder,
  type LeaseToken,
  type StoreDb,
} from "@fresnel/contracts/records";
import {
  ArtifactsRegistry,
  ArtifactsReviews,
  ArtifactsSessions,
  DialogAsk,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  McpClient,
  ScheduleEntries,
  WebBrowse,
  WebFetch,
  WebSearch,
  WorkPlans,
  WorkTasks,
  type AnyCapabilityDef,
} from "@fresnel/contracts/capabilities";
import { artifactsPlugin } from "@fresnel/cap-artifacts";
import {
  schedulePlugin,
  type ScheduleService,
  type ScheduleSettingsSource,
} from "@fresnel/cap-schedule";
import { dialogPlugin, type ChunkNumbering } from "@fresnel/cap-dialog";
import { knowledgePlugin } from "@fresnel/cap-knowledge";
import { APPROVAL_SOURCE } from "@fresnel/group-learning";
import { workPlugin } from "@fresnel/cap-work";
import { workspacePlugin } from "@fresnel/cap-workspace";
import { readUnattendedTimeoutMs } from "@fresnel/platform-exec";
import type { AgentDefinition } from "@fresnel/contracts/services";
import { agentsPlugin } from "@fresnel/core-agents";
import { contextSettingsOf, createContextExtension } from "@fresnel/core-context";
import { cancelledByOwnerOf } from "./owner-cancel.ts";
import { loopExtensionUnit } from "@fresnel/core-loop";
import { createModelsExtension, type ModelsExtensionOptions } from "@fresnel/core-models";
import { sessionPlugin } from "@fresnel/core-persistence";
import { createTasksEntry, TASKS_MANIFEST } from "@fresnel/core-tasks";
import { toolsPlugin } from "@fresnel/core-tools";
import type {
  BuiltinExtensionModule,
  ExtHost,
  ExtensionUnit,
  InstallResult,
} from "@fresnel/ext-host";
import type { AssembleOptions, HostMode, SettingsStorePort } from "../types.ts";
import type { McpProcessPort } from "@fresnel/cap-mcp";
import { hostMcpPlugin } from "./cap-mcp.ts";
import { hostGroupsPlugin } from "./groups.ts";
import {
  learningLoaded,
  learningUnit,
  proposalsBridgePlugin,
  type LearningWiring,
} from "./learning.ts";
import { authoringLoaded, authoringUnit, type AuthoringWiring } from "./authoring.ts";
import { hostWebPlugin } from "./cap-web.ts";
import { openingChildThreads } from "./child-threads.ts";
import { createBareL2ApprovalsPort } from "./l2-approvals.ts";
import { dialogBridgePlugin, type CommandRegistryHolder, lazyCommandRegistry } from "./l2-units.ts";
import { dialogAreaBridgePlugin, type DialogAreaHolder } from "./m4/dialog-area-bridge.ts";
import type { WebStatusHolder } from "./web-providers.ts";
import type { ProjectTrust } from "./trust.ts";
import type { GroupCatalogEntry, GroupServiceWithUsage } from "@fresnel/group-sdk";
import type { SettingCatalog } from "@fresnel/contracts/settings";
import type { SettingsEngine } from "./settings-engine.ts";
import {
  agentsSource,
  layersSource,
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
  /** 계정 회전의 간격·한도 대기가 쓰는 타이머. 시계를 따로 넘기면 core-models가 OS 타이머를 쓰지 않으므로 함께 넘긴다 */
  readonly scheduler: Scheduler;
  readonly ids: IdFactory;
  /** `dialog.status`와 `scope.handler_failed`가 나누는 조각 번호 발급기(한 (thread, turn) 안에서 번호가 겹치지 않는다) */
  readonly chunkNumbering: ChunkNumbering;
  /** 로컬 id(원장, 캐시 행). L0.os의 createLocalIdFactory */
  readonly localIds: LocalIdFactory;
  readonly logger: Logger;
  /** 프로젝트 신뢰 판정(프로젝트 스킬, MCP 서버 정의). 결정 D6 */
  readonly trust: ProjectTrust;
  /** 엔진 수명 신호 */
  readonly signal: AbortSignal;
  /** 엔진 빌드 버전(MCP 서버에 알리는 클라이언트 버전) */
  readonly engineVersion: string;
  readonly settings: SettingsEngine;
  /** 명령 등록부 자리. 조립 루트가 만들고 엔진 포트(`command.*`)도 같은 자리를 읽는다 */
  readonly commands: CommandRegistryHolder;
  /** 대화 영역 wire가 읽는 목표·작업 기능 API 자리(T-WC) */
  readonly dialogArea: DialogAreaHolder;
  /** 웹 런타임 자리(`web.providers`). cap-web 확장이 채운다 */
  readonly web: WebStatusHolder;
  /** thread의 작업 디렉터리(없으면 undefined). `input.bash.before` 지점 페이로드의 cwd가 된다 */
  readonly workspaceOf: (threadId: ThreadId) => string | undefined;
  readonly db: StoreDb;
  readonly faults: FaultInjector;
  readonly holder: LeaseHolder;
  /** 확장 호스트. 자식 thread를 열고 닫고(core-agents), 호출 때 서비스 포트를 찾는다(cap-dialog, cap-work) */
  readonly ext: ExtHost;
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰. 엔진 포트가 만들어진 뒤에 채워진다(core-agents가 자식 thread의 소유를 부모에게서 이어받는다) */
  readonly parentToken: (threadId: ThreadId) => LeaseToken | undefined;
  readonly onLeaseLost: (threadId: ThreadId) => void;
  readonly reportSetting: (message: string) => void;
  /** 그룹 서비스(`fresnel.groups`) 연결: 카탈로그, 설정 저장소, 현재 thread */
  readonly groups: {
    readonly catalog: SettingCatalog;
    readonly store: () => SettingsStorePort | undefined;
    readonly currentThread: () => ThreadId | null;
    readonly heldThreads: () => readonly ThreadId[];
    readonly entries: () => readonly GroupCatalogEntry[];
    /** `/group on` 뒤에 부른다. 실패 장부를 비운다(X-4) */
    readonly onEnabled: (id: string) => void;
    /** 그룹 서비스가 올라올 때 부른다 */
    readonly onService: (service: GroupServiceWithUsage) => void;
  };
  /** 학습 그룹과 L2 제안 대기열 어댑터를 잇는 자리(`proposal.*` 처리기가 읽는다) */
  readonly learning: LearningWiring;
  /** 제작 그룹이 쓰는 devkit 포트 자리(엔진 포트가 만들어진 뒤에 읽는다) */
  readonly authoring: AuthoringWiring;
  /** AssembleOptions.defaultGroups. false면 L3 기본 그룹(학습)을 싣지 않는다 */
  readonly defaultGroups?: boolean;
  /** AssembleOptions.safeMode. 참이면 L3 내장 그룹을 싣지 않는다 */
  readonly safeMode?: boolean;
  /** stdio MCP 서버를 띄우는 포트(L0 platform-process). 없으면 stdio 서버는 연결에 실패한다 */
  readonly mcpProcess?: McpProcessPort;
  /** AssembleOptions.webPorts */
  readonly webPorts?: AssembleOptions["webPorts"];
  /** AssembleOptions.agentDefinitions */
  readonly agentDefinitions?: readonly AgentDefinition[];
  /** 테스트 주입(AssembleOptions.buildModels) */
  readonly buildModels?: ModelsExtensionOptions["buildModels"];
  /** 최종 요청 본문을 측정 기록기로 넘긴다(T-MEAS-REC) */
  readonly offerBody?: ModelsExtensionOptions["offerBody"];
}

/** 내장 확장 모듈(manifest + extension 엔트리) → ExtHost.install 단위. 내장이라 fresnel.* 포트를 쓸 수 있다 */
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

/** 도구를 올리는 L2 기능. core-tools가 호출 때 공급자를 찾으려면 이 기능이 매니페스트에 선언되어 있어야 한다 */
export const L2_TOOL_CAPABILITIES: readonly AnyCapabilityDef[] = [
  WebSearch,
  WebFetch,
  WebBrowse,
  KnowledgeSkills,
  KnowledgeMemory,
  KnowledgeSearch,
  WorkTasks,
  WorkPlans,
  DialogAsk,
  McpClient,
  ArtifactsRegistry,
  ArtifactsReviews,
  ArtifactsSessions,
  ScheduleEntries,
];

/**
 * MCP 서버 도구가 쓰면 안 되는 기계 이름: 도구를 올리는 L2 기능의 도구와 코어 내장 도구. 같은 이름을 낸 서버 도구는 `name_conflict`로 숨는다
 */
function reservedToolNames(): ReadonlySet<string> {
  const names = new Set<string>(["read", "ls", "bash", "read_tool_output", "tool_search", "agent"]);
  for (const def of L2_TOOL_CAPABILITIES) for (const tool of def.tools) names.add(tool.name);
  return names;
}

/**
 * 예약 플러그인(L2 cap-schedule)의 단위. 예약 서비스는 tasks·loop 포트로 만들어져 이 목록을 만드는 시점에는 없으므로
 * 조립 루트가 서비스를 만든 뒤 올린다. 도구를 올리는 core-tools는 그 앞에 올라와 있어야 한다(`L2_TOOL_CAPABILITIES`).
 * `settings`는 직접 호출의 만들기 방식(`l2.schedule.entries.directCreate`)을 읽는 설정 층이다.
 */
export function scheduleUnit(
  service: ScheduleService,
  loadIndex: number,
  settings: ScheduleSettingsSource,
  serviceModeOff: () => boolean,
): ExtensionUnit {
  return schedulePlugin({ service, settings, loadIndex, serviceModeOff });
}

/** 의존 순서로 늘어놓은 기본 확장 단위. loadIndex는 이 순서다 */
export function builtinUnits(deps: ExtensionDeps): readonly ExtensionUnit[] {
  const { settings } = deps;
  // cap-dialog의 동작 명령 등록부와 명령 서비스 API. 브리지 확장이 채우고 cap-work와 호스트의 command.* 처리기가 읽는다
  const commandRegistry = deps.commands;
  // L2 패키지는 대화 id를 문자열로 받는다. thread id 모양이 아니면 작업 폴더가 없는 것이다
  const workspaceOfId = (threadId: string): string | undefined =>
    isId("thr", threadId) ? deps.workspaceOf(threadId) : undefined;
  const learning = learningLoaded({ defaultGroups: deps.defaultGroups, safeMode: deps.safeMode });
  const authoring = authoringLoaded({ defaultGroups: deps.defaultGroups, safeMode: deps.safeMode });
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
            scheduler: deps.scheduler,
            ...(deps.buildModels === undefined ? {} : { buildModels: deps.buildModels }),
            ...(deps.offerBody === undefined ? {} : { offerBody: deps.offerBody }),
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
          // 이 기능들의 도구를 부르려면 core-tools가 매니페스트 optional로 선언해야 한다(RegistrationHostApi.capability)
          capabilities: L2_TOOL_CAPABILITIES,
          loadIndex,
        }),
    ],
    [
      "core-loop",
      (loadIndex) =>
        loopExtensionUnit({
          ids: deps.ids,
          hostMode: deps.mode,
          workingDirectory: deps.workspaceOf,
          settings: loopSource(settings),
          kindLookup,
          cancelledByOwnerOf,
          loadIndex,
        }),
    ],
    [
      "host-groups",
      (loadIndex) =>
        hostGroupsPlugin({
          ext: deps.ext,
          catalog: deps.groups.catalog,
          settings,
          store: deps.groups.store,
          currentThread: deps.groups.currentThread,
          heldThreads: deps.groups.heldThreads,
          groups: deps.groups.entries,
          onEnabled: deps.groups.onEnabled,
          onService: deps.groups.onService,
          report: (cause) => {
            deps.logger.error("groups.listener_failed", { message: messageOf(cause) });
          },
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
      (loadIndex) =>
        workspacePlugin({
          settings: workspaceSource(settings),
          // 무인 호출(예약·루프)의 명령 시간 상한. 설정은 호출마다 읽는다(M3-16, l0.exec.unattendedTimeoutMs)
          unattendedTimeoutMs: () => readUnattendedTimeoutMs((key) => settings.value(key)),
          loadIndex,
        }),
    ],
    [
      "cap-dialog",
      (loadIndex) =>
        dialogPlugin({
          settings: layersSource(settings),
          ids: deps.ids,
          // 호출 문맥이 사람이 없다고 밝힌 호출(백그라운드, 비대화형 서브에이전트)에는 묻지 않는다. 생략은 대화형이다
          interactive: (context) => context.interactive !== false,
          // 프로젝트 명령(.fresnel/commands)은 신뢰한 프로젝트에서만 읽는다(G1-03, 결정 D6). 폴더는 대화의 작업 폴더다(HS-76)
          projectTrust: (projectDir) => deps.trust.isTrusted(projectDir, deps.signal),
          workspaceOf: workspaceOfId,
          chunkNumbering: deps.chunkNumbering,
          loadIndex,
        }),
    ],
    [
      "cap-artifacts",
      (loadIndex) =>
        artifactsPlugin({
          ids: deps.ids,
          localIds: deps.localIds,
          approvals: (service) => createBareL2ApprovalsPort(service),
          settings: layersSource(settings),
          // 리뷰 본문 읽기(`review.get`, W-02)의 자리. 확장이 내려가면 undefined가 와서 포트는 unavailable을 낸다
          onReviews: (reader) => {
            deps.dialogArea.reviews = reader;
          },
          loadIndex,
        }),
    ],
    ["host-dialog-bridge", (loadIndex) => dialogBridgePlugin(commandRegistry, loadIndex)],
    [
      "cap-work",
      (loadIndex) =>
        workPlugin({
          ids: deps.ids,
          settings: layersSource(settings),
          commands: lazyCommandRegistry(commandRegistry),
          loadIndex,
        }),
    ],
    [
      "cap-mcp",
      (loadIndex) =>
        hostMcpPlugin({
          layers: (threadId) => settings.layers(isId("thr", threadId) ? threadId : undefined),
          trust: deps.trust,
          signal: deps.signal,
          version: deps.engineVersion,
          reservedToolNames: reservedToolNames,
          workspaceOf: workspaceOfId,
          ...(deps.mcpProcess === undefined ? {} : { process: deps.mcpProcess }),
          loadIndex,
        }),
    ],
    [
      "cap-web",
      (loadIndex) =>
        hostWebPlugin({
          ids: deps.localIds,
          layers: (threadId) => settings.layers(isId("thr", threadId) ? threadId : undefined),
          settingValue: (key) => settings.value(key),
          resources: () => deps.ext.resources,
          status: deps.web,
          onSettingsChange: (listener) => settings.onChange(() => listener()),
          heldThreads: deps.groups.heldThreads,
          ...(deps.webPorts?.resolver === undefined ? {} : { resolver: deps.webPorts.resolver }),
          ...(deps.webPorts?.transport === undefined ? {} : { transport: deps.webPorts.transport }),
          ...(deps.webPorts?.hostedSearch === undefined
            ? {}
            : { hostedSearch: deps.webPorts.hostedSearch }),
          ...(deps.webPorts?.browserEngine === undefined
            ? {}
            : { browserEngine: deps.webPorts.browserEngine }),
          loadIndex,
        }),
    ],
    [
      "cap-knowledge",
      (loadIndex) =>
        knowledgePlugin({
          settings: layersSource(settings),
          ids: deps.localIds,
          // 프로젝트 스킬(.fresnel/skills)은 신뢰한 프로젝트에서만 싣는다(결정 D6, X.loading-trust §4.7)
          projectTrust: (projectDir) => deps.trust.isTrusted(projectDir, deps.signal),
          // 프로젝트 폴더는 그 대화의 작업 폴더다. 작업 폴더가 없는 대화에는 프로젝트 스킬이 없다(HS-76)
          workspaceOf: workspaceOfId,
          // 학습 그룹을 싣는 구성에서만 그 대기열의 승인 증거를 믿는다(M3-REQ-104)
          trustedEvidenceSources: learning ? [APPROVAL_SOURCE] : [],
          loadIndex,
        }),
    ],
    // 대화 영역 브리지는 목표·작업·계획(cap-work)과 스킬(cap-knowledge) 뒤에 올라와야 그 기능 API를 얻는다
    ["host-dialog-area-bridge", (loadIndex) => dialogAreaBridgePlugin(deps.dialogArea, loadIndex)],
    [
      "host-proposals-bridge",
      (loadIndex) => proposalsBridgePlugin(deps.learning.knowledge, loadIndex),
    ],
    ...(learning
      ? [
          [
            "learning",
            (loadIndex: number) =>
              learningUnit(
                {
                  wiring: deps.learning,
                  clock: deps.clock,
                  logger: deps.logger.child({ component: "learning" }),
                },
                loadIndex,
              ),
          ] as const,
        ]
      : []),
    ...(authoring
      ? [["authoring", (loadIndex: number) => authoringUnit(deps.authoring, loadIndex)] as const]
      : []),
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
  if (result.registrations.length === 0) {
    return { plugin: result.name, message: "the extension registered no plugin" };
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
