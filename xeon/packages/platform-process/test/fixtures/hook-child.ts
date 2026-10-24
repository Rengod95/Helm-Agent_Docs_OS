// 외부 훅 시험용 자식. 사용: bun hook-child.ts <mode> [값]
//   env        환경 변수 이름 목록을 JSON으로 stdout에 쓴다
//   stdin      stdin 전체를 읽어 대문자로 stdout에 쓴다
//   big <n>    stdout에 'x'를 n자 쓴다
//   exit <c>   stderr에 한 줄 쓰고 종료코드 c로 끝난다
//   tree <파일>  자식 + 손자(SIGTERM 무시)를 띄우고 두 pid를 JSON으로 파일에 쓴 뒤 죽을 때까지 산다
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [mode = "", value = ""] = process.argv.slice(2);

if (mode === "env") {
  process.stdout.write(JSON.stringify(Object.keys(process.env).toSorted()));
} else if (mode === "stdin") {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    text += chunk;
  });
  process.stdin.on("end", () => {
    process.stdout.write(text.toUpperCase());
  });
} else if (mode === "big") {
  process.stdout.write("x".repeat(Number(value)));
} else if (mode === "exit") {
  process.stderr.write("bye\n");
  process.exit(Number(value));
} else if (mode === "tree") {
  setInterval(() => undefined, 60_000);
  // 손자: 같은 파일을 leaf로 다시 실행한다. 손자는 SIGTERM을 무시하고, 부모는 SIGTERM에 죽는다
  const leaf = spawn(process.execPath, [import.meta.path, "leaf"], { stdio: "ignore" });
  leaf.once("spawn", () => {
    setTimeout(() => {
      writeFileSync(value, JSON.stringify({ parent: process.pid, leaf: leaf.pid }));
    }, 150);
  });
} else if (mode === "leaf") {
  process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 60_000);
} else if (mode === "wait") {
  setInterval(() => undefined, 60_000);
}
