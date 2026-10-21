// @xeon/host 공개 진입점(L4.host-service.spec §3.3). apps/cli가 쓴다. 엔진 없는 클라이언트는 "./client"다.
// startService, ensureService는 서비스 모드(M3)라 아직 없다.
export { assemble, AssembleError } from "./assemble.ts";
export type {
  ActivityPort,
  ActivitySnapshot,
  ApprovalPort,
  AssembleIssue,
  AssembleOptions,
  CommitBatch,
  Engine,
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
