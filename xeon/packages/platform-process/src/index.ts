export {
  createInProcessPair,
  createInProcessPairWith,
  createLineFramer,
  createStdioTransport,
  createStdioTransportWith,
  encodeFrame,
  openProcessStdio,
  rejectionFrame,
  writableFromSink,
  type ByteSink,
  type ByteStreams,
  type EncodeError,
  type FrameEvent,
  type FrameProblem,
  type InProcessMode,
  type InProcessPairOptions,
  type LineFramer,
  type LineFramerOptions,
  type StdioTransportDeps,
} from "./transport/index.ts";
export {
  createHostShutdownHandler,
  watchChildLease,
  type ChildLeaseOptions,
  type HostShutdownHandlerOptions,
} from "./lease/child-lease.ts";
export {
  createProcessShutdown,
  type ProcessShutdown,
  type ProcessShutdownOptions,
  type ShutdownOutcome,
} from "./lease/shutdown.ts";
export {
  createBackgroundRegistry,
  DEFAULT_BACKGROUND_FORCE_WAIT_MS,
  DEFAULT_BACKGROUND_GRACE_MS,
  DEFAULT_BACKGROUND_RETENTION_MS,
  type BackgroundRegistryController,
  type BackgroundRegistryDeps,
} from "./registry.ts";
export {
  PROCESS_SERVICE_SETTINGS_DEFAULTS,
  PROCESS_SETTING_DEFS,
  PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS,
  type ProcessServiceSettings,
} from "./settings.ts";
export {
  createProcessService,
  processPlugin,
  type ProcessOsPort,
  type ProcessPlatformContext,
  type ProcessPlatformModule,
  type ProcessPluginOptions,
  type ProcessServiceDeps,
  type ProcessServiceHandle,
} from "./service.ts";
export {
  buildResumeOffers,
  type ResumeAction,
  type ResumeCandidate,
  type ResumeOffer,
  type ResumePolicyInput,
} from "./resume-offer.ts";
export {
  createLockFallbackPolicy,
  threadLockedDetails,
  type LockFallbackChoice,
  type LockFallbackContext,
  type LockFallbackDecision,
  type LockFallbackDefault,
  type LockFallbackPolicy,
  type ThreadLockedDetails,
} from "./lock-fallback.ts";
export { createHookRunner, type HookRunner, type HookRunnerDeps } from "./port/hook-run.ts";
export {
  detectProcessPlatform,
  selectProcessPlatform,
  type ProcessPlatformProvider,
  type ProcessSelectError,
  type TreeSignal,
} from "./select.ts";
