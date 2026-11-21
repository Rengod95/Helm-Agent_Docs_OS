// @fresnel/orchestration-sdk/testing. 다른 패키지의 testing 서브패스를 import하지 않는다(DR-08).
export { autoAnswerApprovals, type AutoAnswerApprovals } from "./fake-approvals.ts";
export { checkOrchestration } from "./check-group.ts";
export {
  fakeAgents,
  type FakeAgents,
  type FakeAgentsOptions,
  type FakeCancel,
  type FakeDelegation,
} from "./fake-agents.ts";
export { orchestrationCatalogOf } from "./fakes.ts";
export {
  diffEffects,
  effectKindsOf,
  NO_EFFECTS,
  replayDrive,
  threadMismatches,
  type EffectCounts,
  type ReplayCut,
  type ReplayDriveOptions,
  type ReplayDriveReport,
  type ReplayHarness,
} from "./replay/replay-drive.ts";
export {
  createRuntimeReplayHarness,
  type CountingReplayHarness,
  type RuntimeReplayHarnessOptions,
} from "./replay/runtime-harness.ts";
export {
  scanDriveSource,
  type DriveScanCode,
  type DriveScanFinding,
  type DriveScanOptions,
} from "./scan/scan-drive.ts";
export {
  SMOKE_ORCHESTRATION_MANIFEST,
  smokeOrchestration,
  type SmokeOrchestration,
  type SmokeOrchestrationOptions,
  type SmokeOrchestrationProbe,
  type SmokeOrchestrationState,
} from "./smoke-group.ts";
