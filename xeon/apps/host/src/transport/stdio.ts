// L4.host-service.spec §3.3.4 "전송 구현" 표, F.wire-settings.spec §5. JSON Lines 전송은 F `@xeon/contracts/wire`로 옮겼다
// (런타임 중립, platform-process·데스크톱과 공유). 이 파일은 호스트 안의 기존 import 경로를 지키는 재노출이다.
export { createStdioTransport } from "@xeon/contracts/wire";
