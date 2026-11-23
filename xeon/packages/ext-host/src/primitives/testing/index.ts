// 테스트 대역과 도우미(@fresnel/ext-host/testing). L0·L1을 import하지 않는다(review.decisions-2 D-05).
export { fixedIdFactory } from "./ids.ts";
export { fakeTimers, flushMicrotasks, type FakeTimers } from "./timers.ts";
export {
  fakeUsage,
  memoryInputQueue,
  memoryLoopPort,
  memoryPluginStore,
  memoryProjectorRegistry,
  memoryRecordStore,
  memoryScopedStore,
  type MemoryInputQueue,
  type MemoryLoopOptions,
  type MemoryLoopPort,
  type MemoryProjectorRegistry,
  type MemoryRecordStore,
} from "./ports.ts";
export {
  createTestHost,
  type BoundaryStep,
  type TestBoundary,
  type TestHost,
  type TestHostOptions,
} from "./host.ts";
export { runPortContract, type PortContractFactories } from "./port-contract.ts";
export {
  createSmokeOrchestration,
  SMOKE_ORCHESTRATION_MANIFEST,
  type SmokeOrchestrationOptions,
  type SmokeOrchestrationProbe,
} from "./smoke-group.ts";
