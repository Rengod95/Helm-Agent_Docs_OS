// @xeon/group-kit/testing. 다른 패키지의 testing 서브패스를 import하지 않는다(DR-08).
export { checkGroup } from "./check-group.ts";
export {
  fakeAgents,
  type FakeAgents,
  type FakeAgentsOptions,
  type FakeCancel,
  type FakeDelegation,
} from "./fake-agents.ts";
export {
  groupCatalogOf,
  memoryDriveHolderSettings,
  type MemoryDriveHolderSettings,
  type MemoryDriveHolderSettingsOptions,
} from "./fakes.ts";
export {
  diffEffects,
  effectKindsOf,
  NO_EFFECTS,
  replayDrive,
  type EffectCounts,
  type ReplayCut,
  type ReplayDriveOptions,
  type ReplayDriveReport,
  type ReplayHarness,
} from "./replay/replay-drive.ts";
export {
  scanDriveSource,
  type DriveScanCode,
  type DriveScanFinding,
  type DriveScanOptions,
} from "./scan/scan-drive.ts";
export {
  SMOKE_GROUP_MANIFEST,
  smokeGroup,
  type SmokeGroup,
  type SmokeGroupOptions,
  type SmokeGroupProbe,
  type SmokeGroupState,
} from "./smoke-group.ts";
