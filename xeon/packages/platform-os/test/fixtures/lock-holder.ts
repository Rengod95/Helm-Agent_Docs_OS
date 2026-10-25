import { realFileLock } from "../support/file-lock.ts";

/** 자식이 첫 줄에 알리는 값 */
export type HolderSignal = "READY" | "FAILED";

// 인자: <대상 파일>. 잠금을 쥐고 READY를 알린 뒤 죽을 때까지 기다린다. 잠금을 얻지 못하면 FAILED를 알리고 끝난다
const [target] = process.argv.slice(2);
const lock = realFileLock();
if (target === undefined || lock === undefined) process.exit(2);
const result = await lock.withLock(target, async () => {
  const ready: HolderSignal = "READY";
  process.stdout.write(`${ready}\n`);
  await new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
});
if (!result.ok) {
  const failed: HolderSignal = "FAILED";
  process.stdout.write(`${failed}\n`);
}
