// @xeon/platform-process/testing: 다른 패키지 시험이 쓰는 대역(eng.testing.guide TS-05, 1.2절 표).
export {
  FAKE_ENGINE_DEFAULTS,
  parseFakeEngineArgs,
  runFakeEngine,
  spawnFakeEngine,
  type FakeEngine,
  type FakeEngineConfig,
  type FakeEngineDeps,
  type FakeEngineEvent,
  type SpawnFakeEngineOptions,
  type SpawnedFakeEngine,
} from "./fake-engine.ts";
export {
  serveConformanceHost,
  type ConformanceHostHandle,
  type ConformanceHostOptions,
} from "./conformance-host.ts";
