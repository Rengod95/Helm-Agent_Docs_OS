import { eachAsync } from "@xeon/contracts";
import { realFileLock } from "../support/file-lock.ts";

/** 자식이 끝에 알리는 값. 실패하면 `FAILED <횟수>`다 */
export type UpdaterSignal = "DONE";

// 인자: <대상 파일> <내 이름> <횟수>. 읽기-수정-쓰기로 "<이름>\n"을 횟수만큼 덧붙인다. 끝나면 DONE을 알린다
const [target, name, count] = process.argv.slice(2);
const lock = realFileLock();
if (target === undefined || name === undefined || count === undefined || lock === undefined) {
  process.exit(2);
}
let failed = 0;
// 순차 실행이 이 시험의 목적이다: 각 갱신이 앞 갱신이 쓴 내용을 읽어야 한다
await eachAsync(Array.from({ length: Number(count) }), async () => {
  const result = await lock.updateText(target, (current) => `${current ?? ""}${name}\n`);
  if (!result.ok) failed += 1;
  return undefined;
});
const done: UpdaterSignal = "DONE";
process.stdout.write(failed === 0 ? `${done}\n` : `FAILED ${String(failed)}\n`);
