// 다른 패키지 테스트와 이 패키지 테스트가 함께 쓰는 대역(L1.tools.plan §2 testing/). 운영 코드는 import하지 않는다.
export { sequentialIds } from "./ids.ts";
export {
  fakeSession,
  type FakeSession,
  type FakeSessionOptions,
  type RecordedCommit,
} from "./fake-session.ts";
export { fakeStore, type FakeStore } from "./fake-store.ts";
export { fakeOutputFiles, type FakeOutputFiles } from "./fake-output-files.ts";
export { fakeRedactor } from "./fake-secrets.ts";
export { fakeTruncator } from "./fake-truncator.ts";
export { fakeRunContext, type FakeRunOptions } from "./run-context.ts";
export { l2ApprovalsPort, type L2PortOptions } from "./l2-port.ts";
export { fakeSecretChecker, type FakeSecretChecker } from "./fake-secret-check.ts";
export { fakeApprovals, type FakeApprovals, type FakeApprovalsOptions } from "./fake-approvals.ts";
export { realTools, type RealTools, type RealToolsOptions } from "./real-runtime.ts";
export { type RunContextSession } from "./run-context.ts";
// 질문(dialog.ask) 시험 대역: 실제 승인 서비스 위의 질문 어댑터와 수동 타이머(층 D1에서 cap-dialog 시험과 함께 쓴다)
export { realApprovals, type RealApprovals } from "./real-approvals.ts";
export { manualTimers, type ManualTimers } from "./manual-timers.ts";
