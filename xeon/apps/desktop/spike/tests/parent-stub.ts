// S4 측정용 부모: 엔진을 stdin 파이프로 띄우고 pid를 알린 뒤 죽을 때까지 자는 척한다.
export {};
// 하네스(s4.ts)가 이 프로세스를 SIGKILL하면 OS가 엔진 stdin 파이프의 쓰기 끝을 닫는다.
const [enginePath, ...engineArgs] = process.argv.slice(2);
if (enginePath === undefined) {
  process.stderr.write("usage: parent-stub.ts <engine> [args...]\n");
  process.exit(2);
}
const child = Bun.spawn([enginePath, ...engineArgs], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "ignore",
});
// 엔진 stdout은 비워 준다(막히지 않게)
void (async (): Promise<void> => {
  for await (const chunk of child.stdout) {
    if (chunk.length < 0) return;
  }
})();
process.stdout.write(`engine=${String(child.pid)}\n`);
setInterval(() => undefined, 1000);
