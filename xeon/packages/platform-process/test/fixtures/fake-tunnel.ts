import { createServer } from "node:net";

// 터널 프로세스 대역. argv[2]는 만들 소켓 경로, argv[3]은 동작이다.
// listen: 소켓을 만들고 살아 있는다. dies: 소켓을 만들고 150ms 뒤 코드 3으로 끝난다. exit: 메시지를 stderr에 쓰고 코드 7로 끝난다. silent: 소켓을 만들지 않고 살아 있는다.
const path = process.argv[2];
const mode = process.argv[3];
if (path === undefined) throw new Error("socket path is required");
if (mode === "exit") {
  process.stderr.write("tunnel: permission denied (publickey)\n");
  process.exit(7);
}
if (mode === "listen" || mode === "dies") {
  const server = createServer();
  server.listen(path);
  if (mode === "dies") setTimeout(() => process.exit(3), 150);
}
setInterval(() => undefined, 1000);
