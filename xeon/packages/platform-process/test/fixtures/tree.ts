// 자식 + 손자 프로세스 트리. 부모는 손자를 띄운 뒤 두 pid를 JSON 한 줄로 stdout에 쓴다.
// 사용: bun tree.ts [ignore-term]   (손자는 `leaf` 인자로 같은 파일을 다시 실행한다)
import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const ignoreTerm = args.has("ignore-term");
const isLeaf = args.has("leaf");

if (ignoreTerm) {
  process.on("SIGTERM", () => {});
}

// 이벤트 루프를 붙잡는 타이머. 죽을 때까지 산다
setInterval(() => {}, 60_000);

if (!isLeaf) {
  const leafArgs = ignoreTerm ? ["leaf", "ignore-term"] : ["leaf"];
  const leaf = spawn(process.execPath, [import.meta.path, ...leafArgs], { stdio: "ignore" });
  // 손자가 시그널 핸들러를 건 뒤에 알린다
  leaf.once("spawn", () => {
    setTimeout(() => {
      process.stdout.write(`${JSON.stringify({ parent: process.pid, leaf: leaf.pid })}\n`);
    }, 150);
  });
}
