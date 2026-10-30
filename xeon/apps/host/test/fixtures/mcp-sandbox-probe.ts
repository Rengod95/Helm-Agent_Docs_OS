// 샌드박스 시험용 stdio 서버 대역. 사용: bun mcp-sandbox-probe.ts <읽기 대상> <밖 쓰기 대상> <루프백 포트>
// 뜨면 다섯 가지를 시도하고 결과를 JSON 한 줄로 표준 출력에 쓴 뒤, 표준 입력이 닫힐 때까지 산다.
//   read          <읽기 대상>을 읽는다(ok | denied)
//   write         <밖 쓰기 대상>에 쓴다(ok | denied)
//   write_inside  작업 폴더(cwd)의 inside.txt에 쓴다(ok | denied)
//   net           curl로 루프백 서버에 HTTP 요청을 보낸다. 프록시 환경 변수를 따른다. 응답 코드, 실패는 error
//   net_direct    node:net으로 루프백 서버에 직접 TCP 연결한다(connected | denied)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { attempt } from "@xeon/contracts";

const vaultFile = process.argv[2];
const outsideFile = process.argv[3];
const port = process.argv[4];
if (vaultFile === undefined || outsideFile === undefined || port === undefined) {
  process.stderr.write("usage: mcp-sandbox-probe.ts <vault> <outside> <port>\n");
  process.exit(2);
}

function attemptOk(action: () => void): "ok" | "denied" {
  return attempt(action).ok ? "ok" : "denied";
}

function directConnect(): Promise<"connected" | "denied"> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: Number(port) });
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve("denied");
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", () => {
      resolve("denied");
    });
  });
}

function httpCode(): string {
  const run = spawnSync(
    "curl",
    [
      "-s",
      "--noproxy",
      "",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      "8",
      `http://127.0.0.1:${port}/`,
    ],
    { encoding: "utf8" },
  );
  const out = run.stdout.trim();
  return run.error === undefined && out.length > 0 ? out : "error";
}

const result = {
  read: attemptOk(() => readFileSync(vaultFile, "utf8")),
  write: attemptOk(() => writeFileSync(outsideFile, "outside\n")),
  write_inside: attemptOk(() => writeFileSync(join(process.cwd(), "inside.txt"), "inside\n")),
  net: httpCode(),
  net_direct: await directConnect(),
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  process.exit(0);
});
