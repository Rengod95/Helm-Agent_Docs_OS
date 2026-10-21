// @xeon/platform-exec/testing: 다른 패키지 시험이 쓰는 대역(eng.testing.guide TS-05, 1.2절 표).
export {
  fakeExec,
  type FakeExec,
  type FakeExecCall,
  type FakeExecOptions,
  type FakeExecReply,
  type FakeExecTable,
} from "./fake-exec.ts";
export { memoryFs, type MemoryFsOptions } from "./memory-fs.ts";
export {
  registerExecConformance,
  type ExecConformanceOptions,
  type ExecConformanceProvider,
} from "./conformance.ts";
