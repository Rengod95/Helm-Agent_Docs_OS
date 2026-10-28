// JSON Lines stdio 전송. 웹 스트림만 쓰므로 데스크톱 WebView와 CLI가 같은 구현을 쓴다.
// 줄 프레이밍은 서버 쪽(`@xeon/platform-process`, `@xeon/host`)도 같은 코드를 써야 해서 F `@xeon/contracts/wire`에 남아 있다
// (L0·호스트는 L4인 이 패키지를 import할 수 없다). 클라이언트는 이 경로로만 가져온다.
export { createStdioTransport } from "@xeon/contracts/wire";
