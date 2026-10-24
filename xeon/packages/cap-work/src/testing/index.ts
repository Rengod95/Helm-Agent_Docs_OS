// @xeon/cap-work/testing: 다른 패키지의 테스트 파일에서만 import한다(DR-08). L2.artifacts 대역이다.
// 승인과 권한 모드는 대역을 두지 않는다. 시험은 core-tools의 `testing` 서브패스(`realTools`)로 실제 서비스를 쓴다.
export { createFakeArtifacts, type FakeArtifacts } from "./fake-artifacts.ts";
