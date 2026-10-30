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
import type { Result } from "../../src/base/index.ts";
import type { ModelThinkingLevel, ThreadId } from "../../src/conversation/index.ts";
import type {
  ApprovalRequest,
  ApprovalResolution,
  GroupCommandError,
  GroupService,
  GroupSettingUnwritableReason,
  LoopService,
  McpService,
  ModelBinding,
  ModelService,
  ProcessService,
  SandboxService,
  SandboxedArgv,
  SandboxWrapError,
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

/** setDriveHolder는 쓸 thread를 옵션으로 받는다(L3.group-kit.spec §3.8, 통합 검토 L8) */
type HolderOptions = NonNullable<Parameters<GroupService["setDriveHolder"]>[1]>;
export type HolderOptionTargetsThread = Expect<
  Equal<HolderOptions["threadId"], ThreadId | undefined>
>;

/** 쓸 수 없었던 이유 여섯 가지가 group.settingUnwritable 오류의 reason이다 */
export type UnwritableReasons = Expect<
  Equal<
    GroupSettingUnwritableReason,
    | "no_thread"
    | "ambiguous_thread"
    | "not_owner"
    | "project_unavailable"
    | "invalid_value"
    | "storage"
  >
>;
export type UnwritableErrorCarriesReason = Expect<
  Equal<
    Extract<GroupCommandError, { readonly kind: "group.settingUnwritable" }>,
    {
      readonly kind: "group.settingUnwritable";
      readonly key: string;
      readonly reason: GroupSettingUnwritableReason;
    }
  >
>;

/** SandboxService.wrapShell은 Shell을 받아 Shell을 돌려준다 */
export type WrapShellKeepsShell = Expect<
  Equal<ReturnType<SandboxService["wrapShell"]>, Parameters<SandboxService["wrapShell"]>[0]>
>;

/** SandboxService.wrapArgv는 실패를 던지지 않고 Result 값으로 돌려준다 */
export type WrapArgvReturnsResult = Expect<
  Equal<ReturnType<SandboxService["wrapArgv"]>, Promise<Result<SandboxedArgv, SandboxWrapError>>>
>;

test("type assertions compile", () => {});
