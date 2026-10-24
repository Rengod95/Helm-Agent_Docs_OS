import { test } from "bun:test";
import type {
  InputQueuePort,
  LeaseArbiterPort,
  LoopPort,
  McpPort,
  ModelsPort,
  ProcessPort,
  ProjectorRegistryPort,
  RecordCommitPort,
  ScopedStorePort,
  ToolsPort,
} from "../../src/extensions/index.ts";
import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  SessionService,
  StepCheckpoint,
  StoreService,
} from "../../src/records/index.ts";
import type { ModelThinkingLevel } from "../../src/conversation/index.ts";
import type {
  ApprovalRequest,
  ApprovalResolution,
  GroupService,
  LoopService,
  McpService,
  ModelBinding,
  ModelService,
  ProcessService,
  SandboxService,
  TaskService,
  ToolService,
} from "../../src/services/index.ts";
import type { SettingScope } from "../../src/wire-settings/settings/index.ts";
import type { Assignable, DeepMutable, Equal, Expect } from "../types/expect.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.

/** F.extensions.spec §9 13: 서비스 인터페이스는 같은 이름의 X 포트에 대입할 수 있다 */
export type LoopServiceIsLoopPort = Expect<Assignable<LoopService, LoopPort>>;
export type TaskServiceIsInputQueuePort = Expect<Assignable<TaskService, InputQueuePort>>;
export type ProcessServiceIsProcessPort = Expect<Assignable<ProcessService, ProcessPort>>;
export type ToolServiceIsToolsPort = Expect<Assignable<ToolService, ToolsPort>>;
export type ModelServiceIsModelsPort = Expect<Assignable<ModelService, ModelsPort>>;
export type McpServiceIsMcpPort = Expect<Assignable<McpService, McpPort>>;
export type GroupServiceIsLeaseArbiter = Expect<Assignable<GroupService, LeaseArbiterPort>>;

/** records의 서비스는 포트를 그대로 만족한다 */
export type StoreServiceIsScopedStore = Expect<Assignable<StoreService, ScopedStorePort>>;
export type SessionExtIsRecordPort = Expect<Assignable<SessionService["ext"], RecordCommitPort>>;
export type SessionProjectorsIsRegistryPort = Expect<
  Assignable<SessionService["projectors"], ProjectorRegistryPort>
>;

/** 서비스가 더하는 메서드는 포트에 없다 */
export type LoopServiceAddsMethods = Expect<Equal<Assignable<LoopPort, LoopService>, false>>;

/** ToolService.register는 두 모양을 모두 받는다(ToolsPort 등록과 L1 등록) */
export type ToolRegisterOverloads = Expect<
  Equal<ToolService["register"] extends (...args: never[]) => unknown ? true : false, true>
>;

/** ModelBinding에서 role을 뺀 것이 StepCheckpoint.model과 같다(L1.models.spec 수용 기준 7) */
export type BindingMatchesCheckpoint = Expect<
  Equal<DeepMutable<Omit<ModelBinding, "role">>, StepCheckpoint["model"]>
>;
export type ThinkingLevelIsShared = Expect<
  Equal<ModelBinding["thinkingLevel"], ModelThinkingLevel>
>;

/** 승인 요청·해결은 records payload와 같은 모양에 envelope id만 다르다 */
export type RequestIsPayloadPlusId = Expect<
  Assignable<DeepMutable<Omit<ApprovalRequest, "approvalId">>, ApprovalRequestedPayload>
>;
export type ResolutionIsPayload = Expect<
  Assignable<
    ApprovalResolution,
    Omit<ApprovalResolvedPayload, "approvalId"> & { approvalId: string }
  >
>;

/** GroupService의 설정 범위는 SettingScope와 서로 대입 가능하다(L3.group-kit.spec §9 20) */
type HolderScope = NonNullable<Parameters<GroupService["setDriveHolder"]>[1]>["scope"];
export type HolderScopeIsSettingScope = Expect<Equal<NonNullable<HolderScope>, SettingScope>>;

/** SandboxService.wrapShell은 Shell을 받아 Shell을 돌려준다 */
export type WrapShellKeepsShell = Expect<
  Equal<ReturnType<SandboxService["wrapShell"]>, Parameters<SandboxService["wrapShell"]>[0]>
>;

test("type assertions compile", () => {});
