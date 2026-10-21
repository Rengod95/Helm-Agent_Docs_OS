export {
  createInProcessPair,
  createInProcessPairWith,
  type InProcessMode,
  type InProcessPairOptions,
} from "./transport/index.ts";
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
