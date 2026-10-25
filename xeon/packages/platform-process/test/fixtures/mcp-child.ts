export {};
// MCP stdio 서버 대역. 사용: bun mcp-child.ts <mode> [값]
//   echo          stdin 줄마다 "echo:<줄>"을 stdout에 쓴다. stdin이 닫히면 끝난다
//   env           env를 JSON({이름: 값})으로 stdout에 한 줄 쓰고 stdin이 닫힐 때까지 산다
//   last-words    "last\n"을 stdout에 쓰고 곧바로 종료코드 3으로 끝난다
//   stderr        stderr에 "oops\n"를 쓰고 stdin이 닫힐 때까지 산다
//   stubborn      stdin 닫힘과 SIGTERM을 각각 stdout에 한 줄로 알리고 둘 다 무시한 채 산다(SIGKILL만 멈춘다)
const mode: string = process.argv[2] ?? "";

if (mode === "echo") {
  let pending = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) process.stdout.write(`echo:${line}\n`);
  });
} else if (mode === "env") {
  process.stdout.write(`${JSON.stringify(process.env)}\n`);
  process.stdin.resume();
} else if (mode === "last-words") {
  process.stdout.write("last\n");
  process.exit(3);
} else if (mode === "stderr") {
  process.stderr.write("oops\n");
  process.stdin.resume();
} else if (mode === "stubborn") {
  setInterval(() => undefined, 60_000);
  process.stdin.on("end", () => {
    process.stdout.write("stdin-closed\n");
  });
  process.stdin.resume();
  process.on("SIGTERM", () => {
    process.stdout.write("sigterm\n");
  });
  process.stdout.write("ready\n");
}
