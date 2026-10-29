// @xeon/host 공개 진입점(L4.host-service.spec §3.3). apps/cli가 쓴다. 엔진 없는 클라이언트는 "./client"다.
// 서비스 모드: startService, ensureHostService, serviceStatus, stopHostService는 service/ 아래다.
export { assemble, AssembleError } from "./assemble.ts";
export type {
  ActivityPort,
  ActivitySnapshot,
  ApprovalPort,
  AssembleIssue,
  AssembleOptions,
  CommitBatch,
  Engine,
  EngineDiagnostics,
  EnginePorts,
  EventFeedPort,
  HostLogPort,
  HostMode,
  HostPluginModule,
  LockOutcome,
  OwnerKind,
  SessionLockPort,
  SettingsStorePort,
  SubmitOutcome,
  ThreadPort,
  TurnPort,
  UserNotifyPort,
} from "./assemble.ts";
export {
  runHostCommand,
  startInProcessHost,
  startStdioHost,
  type CommandIo,
  type HostCommand,
  type HostExit,
  type InProcessHost,
  type StdioHostOptions,
} from "./main.ts";
export { renderSettingsSchema } from "./settings.ts";
export {
  resolveHostStatePaths,
  type HostStatePathError,
  type HostStatePaths,
  type ResolveHostStatePathsOptions,
} from "./state-paths.ts";
export { defaultServiceCommand } from "./service/commands.ts";
export { serviceStatus, stopHostService } from "./service/control.ts";
export type {
  ServiceControlOptions,
  ServiceStatusResult,
  ServiceStopResult,
} from "./service/control.ts";
export { connectServiceTransport } from "./service/connect.ts";
export type { ServiceEndpoint } from "./service/connect.ts";
export { ensureHostService } from "./service/ensure.ts";
export type {
  EnsureHostServiceError,
  EnsureHostServiceOptions,
  EnsuredService,
  ServiceCommand,
} from "./service/ensure.ts";
export { attachToService } from "./service/attach.ts";
export type {
  AttachError,
  AttachOptions,
  AttachTarget,
  ServiceAttachment,
} from "./service/attach.ts";
export { bridgeStdioToService } from "./service/bridge.ts";
export type { BridgeExit, BridgeOptions } from "./service/bridge.ts";
export { createSshTunnelPort } from "./service/tunnel.ts";
export type { SshTunnelPortOptions, TunnelCommand } from "./service/tunnel.ts";
export {
  REMOTE_TOKEN_ENV,
  resolveLaunchMode,
  resolveRemoteEndpoint,
} from "./service/launch-mode.ts";
export type { RemoteResolution } from "./service/launch-mode.ts";
export { SERVICE_STARTUP_GRACE_MS, startService } from "./service/lifetime.ts";
export type { ServiceHandle, ServiceOptions, ServiceStart } from "./service/lifetime.ts";
export { resolveServicePaths } from "./service/paths.ts";
export type { ServicePaths } from "./service/paths.ts";
export type { PendingSchedulesPort } from "./types.ts";
