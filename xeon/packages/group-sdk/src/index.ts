export {
  GROUP_NAME_PATTERN,
  RESERVED_GROUP_NAMES,
  checkGroupName,
  defineGroup,
  groupManifest,
  isGroupModule,
  validateGroupDef,
  type GroupApi,
  type GroupDef,
  type GroupNameError,
  type GroupDefIssue,
  type GroupDefIssueCode,
  type GroupDefShape,
  type GroupManifest,
  type GroupModule,
  type GroupModuleSettings,
  type GroupStartDriveResult,
  type GroupSettingDefs,
  type GroupSettingNamespace,
  type GroupSettingValues,
  type NoSettings,
  type RunScriptOptions,
  type StateMigrations,
} from "./define-group.ts";
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
export type { GroupSettingsSource } from "./ports/settings.ts";
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
export { groupSdkSettings } from "./settings.ts";
export {
  TEMPLATE_PLACEHOLDERS,
  TemplateIndexSchema,
  TemplateKindSchema,
  type TemplateEntry,
  type TemplateIndex,
  type TemplateKind,
  type TemplatePlaceholder,
} from "./templates.ts";
export {
  GroupServiceName,
  createGroupService,
  type GroupHostView,
  type GroupServiceWithUsage,
  type GroupServiceDeps,
} from "./service.ts";
export type { GroupCatalogEntry, GroupCatalogPort } from "./ports/catalog.ts";
export type { DriveRole, GroupError, GroupService, GroupStatus } from "@fresnel/contracts/services";
