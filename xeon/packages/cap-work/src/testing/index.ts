// @xeon/cap-work/testing: 다른 패키지의 테스트 파일에서만 import한다(DR-08). L1.tools·L2.artifacts 대역이다.
export { createFakeApprovals, type FakeApprovals, type FakeRequest } from "./fake-approvals.ts";
export { createFakeArtifacts, type FakeArtifacts } from "./fake-artifacts.ts";
export { createFakePermissionMode, type FakePermissionMode } from "./fake-permission-mode.ts";
export { createFakeWriter, type FakeWriter } from "./fake-writer.ts";
