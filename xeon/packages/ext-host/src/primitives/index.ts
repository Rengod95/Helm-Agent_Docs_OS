// primitives 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
export { PrimitiveError, type ExtDiagnostic, type PrimitiveErrorCode } from "./errors.ts";
export {
  ExtHostPortKey,
  LeaseArbiterPortKey,
  InputQueuePortKey,
  LoopPortKey,
  ProcessPortKey,
  ProjectorRegistryPortKey,
  RecordCommitPortKey,
  ScopedStorePortKey,
  type InputQueuePort,
  type LeaseArbiterPort,
  type LoopPort,
  type PortKey,
  type PortLookup,
  type ProcessPort,
  type ProjectorRegistryPort,
  type RecordCommitPort,
  type ScopedStorePort,
} from "./ports.ts";
export { capabilityServiceName, isReservedServiceName, providerServiceName } from "./services.ts";
export {
  DEFAULT_DISPATCH_POLICY,
  type ChainOutcome,
  type DispatchOptions,
  type DispatchOutcome,
  type DispatchPolicy,
  type FirstOutcome,
  type HandlerEntryInfo,
  type HandlerFailure,
  type HandlerGate,
  type HandlerRef,
  type HandlerRunOutcome,
  type PayloadOf,
  type TapOutcome,
} from "./dispatch.ts";
export { type BoundaryContribution, type BoundaryHooks, type BoundarySignal } from "./boundary.ts";
export {
  createExtHost,
  hostInternalsOf,
  scopeToggleSourceOf,
  type ExtHost,
  type ExtHostDeps,
  type ExtensionUnit,
  type InstallResult,
  type PlatformContext,
  type PlatformModule,
  type PlatformSetupError,
  type ScopeToggleSourceOf,
} from "./host.ts";
export { hostOf, type ScopeHostApi } from "./host-api.ts";
export type { ScopeInfo, ScopeSetupOutcome } from "./scope.ts";
export {
  DEFAULT_DRIVE_LIMITS,
  withDriveDefaults,
  createStaticPrimitivesSettings,
  primitivesSettings,
} from "./settings.ts";
export {} from "./state.ts";
export {} from "./lease.ts";
export type {} from "./core.ts";
