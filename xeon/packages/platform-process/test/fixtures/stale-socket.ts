import { createServer } from "node:net";

// 소켓 파일을 만든 채 SIGKILL로 죽는 서버 자식(낡은 소켓 파일 시험용). argv[2]는 소켓 경로. 준비되면 한 줄을 쓴다.
const path = process.argv[2];
if (path === undefined) throw new Error("socket path is required");
const server = createServer();
server.listen(path, () => {
  process.stdout.write("ready\n");
});
setInterval(() => undefined, 1000);
