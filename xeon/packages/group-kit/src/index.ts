export {
  GROUP_NAME_PATTERN,
  RESERVED_GROUP_NAMES,
  defineGroup,
  groupManifest,
  validateGroupDef,
  type GroupApi,
  type GroupDef,
  type GroupDefIssue,
  type GroupDefIssueCode,
  type GroupDefShape,
  type GroupManifest,
  type GroupModule,
  type GroupModuleSettings,
  type GroupSettingDefs,
  type GroupSettingNamespace,
  type GroupSettingValues,
  type NoSettings,
  type StateMigrations,
} from "./define-group.ts";
export {
  defaultDriveArbiter,
  leaseArbiterPort,
  type ArbiterDecision,
  type ArbiterInput,
  type ArbiterReason,
  type DriveArbiter,
  type DriveCandidate,
  type LeaseArbiterPortDeps,
} from "./arbiter.ts";
export {
  checkDelegateSpec,
  DELEGATE_REQUEST_ID_MAX,
  type CancelDelegatesResult,
  type DelegateCallOptions,
  type DelegateContextError,
  type DelegateError,
  type DelegateFork,
  type DelegateLimits,
  type DelegateReceipt,
  type DelegateReport,
  type DelegateResult,
  type DelegateSpec,
  type DelegateStatus,
  type DelegateStatusResult,
  type DelegateToolPolicy,
} from "./delegate.ts";
export type {
  GroupMetrics,
  GroupMetricsHandle,
  GroupMetricsSummary,
  GroupUsageDelta,
  MetricsRecordedPayload,
} from "./metrics/types.ts";
export {
  createMetricsRegistry,
  defaultMetricsRegistry,
  type MetricsRegistry,
} from "./metrics/registry.ts";
export { summarizeUsage, type ScopeUsage } from "./metrics/usage.ts";
export { gatherPromotionInput, type PromotionHostView } from "./promotion/gather.ts";
export {
  buildPromotionReport,
  type PromotionCandidate,
  type PromotionInput,
  type PromotionReport,
  type ToolConsumer,
} from "./promotion/report.ts";
export { GroupSettingsSourceKey, type GroupSettingsSource } from "./ports/settings.ts";
export {
  STATE_DOC_MAX_BYTES,
  checkStateCommit,
  migrationChain,
  stateUpcasters,
  type StateCheck,
  type StateCommittedPayload,
  type StateProjectionRow,
} from "./state.ts";
export { checkRecordKind, checkPostItem, kindVisibleTo, type RecordCheck } from "./records.ts";
export { groupKitSettings } from "./settings.ts";
export {
  GROUP_USAGE,
  groupCommand,
  parseGroupCommand,
  runGroupCommand,
  type CommandOutput,
  type GroupCommand,
  type GroupCommandParse,
  type GroupCommandRegistration,
  type GroupServiceWithSetting,
  type GroupServiceWithUsage,
} from "./commands.ts";
export { displayWidth, formatGroupStatusLine, type StatusLineOptions } from "./status-line.ts";
export {
  GroupServiceName,
  createGroupService,
  type GroupHostView,
  type GroupServiceDeps,
} from "./service.ts";
export type { GroupCatalogEntry, GroupCatalogPort } from "./ports/catalog.ts";
export type {
  DriveHolderSettingsPort,
  HolderSettingScope,
  HolderUnwritableReason,
  HolderWriteError,
} from "./ports/holder.ts";
export type {
  DriveHolderSetting,
  DriveRole,
  GroupCommandError,
  GroupError,
  GroupResult,
  GroupService,
  GroupStatus,
  HolderReceipt,
  ToggleReceipt,
} from "@xeon/contracts/services";
