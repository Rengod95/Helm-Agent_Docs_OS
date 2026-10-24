import { createPosixLockProvider } from "../../src/lock/posix.ts";
import { selectPlatformPolicy, toStorePlatform } from "../../src/select.ts";

/** 자식이 첫 줄에 알리는 값 */
export type HolderSignal = "READY" | "HELD";

// 인자: <잠금 디렉터리> <키>. 잠금을 쥐고 READY를 알린 뒤 죽을 때까지 기다린다
const [dir, key] = process.argv.slice(2);
const platform = toStorePlatform(process.platform);
if (dir === undefined || key === undefined || platform === undefined) process.exit(2);
const selection = selectPlatformPolicy(platform).lock;
if (selection.kind !== "flock") process.exit(2);
const provider = createPosixLockProvider({
  dir,
  libName: selection.libName,
  errnoSymbol: selection.errno.errnoSymbol,
  wouldBlockErrno: selection.errno.wouldBlockErrno,
});
if (!provider.ok) process.exit(2);
const acquired = provider.value.tryAcquire(key);
const signal: HolderSignal = acquired.ok ? "READY" : "HELD";
process.stdout.write(`${signal}\n`);
setInterval(() => {}, 1000);
