import { appendFileSync } from "node:fs";
import { createServer } from "node:net";

// 터널 프로세스 대역. argv[2]는 만들 소켓 경로, argv[3]은 동작이다.
// listen: 소켓을 만들고 살아 있는다. dies: 소켓을 만들고 150ms 뒤 코드 3으로 끝난다. exit: 메시지를 stderr에 쓰고 코드 7로 끝난다. silent: 소켓을 만들지 않고 살아 있는다.
// ignore-term: 소켓을 만들고, SIGTERM을 받아도 끝나지 않는다(SIGKILL만 끝낸다). argv[4]는 받은 SIGTERM을 한 줄씩 적을 파일이다.
const path = process.argv[2];
const mode = process.argv[3];
if (path === undefined) throw new Error("socket path is required");
if (mode === "exit") {
  process.stderr.write("tunnel: permission denied (publickey)\n");
  process.exit(7);
}
if (mode === "ignore-term") {
  // 소켓이 생기기 전에 핸들러를 달아 둔다. 핸들러가 있으면 기본 동작인 종료가 일어나지 않는다
  const signalLog = process.argv[4];
  if (signalLog === undefined) throw new Error("signal log path is required");
  process.on("SIGTERM", () => {
    appendFileSync(signalLog, "SIGTERM\n");
  });
}
if (mode === "listen" || mode === "dies" || mode === "ignore-term") {
  const server = createServer();
  server.listen(path);
  if (mode === "dies") setTimeout(() => process.exit(3), 150);
}
setInterval(() => undefined, 1000);
