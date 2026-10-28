import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

// `bun build --compile --bytecode`는 최상위 await를 받지 못한다(L4.cli.plan §4.3). 파일이 oxfmt로 정리돼 있으므로
// 들여쓰기 없는 줄(0열)에서 시작하는 await 식을 찾는다. 함수 안의 await는 들여쓰기가 있다.
const TOP_LEVEL_AWAIT =
  /^(?:await\b|for await\b|(?:export\s+)?(?:const|let|var)\s[^=\n]*=\s*await\b|void\s+await\b)/u;

const SRC = join(import.meta.dir, "..", "src");

test("no source file of the CLI uses top-level await", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.ts").scan({ cwd: SRC })) {
    const text = await Bun.file(join(SRC, file)).text();
    for (const [index, line] of text.split("\n").entries()) {
      if (TOP_LEVEL_AWAIT.test(line)) offenders.push(`${file}:${index + 1}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the detector recognizes top-level await forms", () => {
  for (const line of [
    "await main();",
    "const x = await f();",
    "export const y = await g();",
    "for await (const c of s) {",
  ]) {
    expect(TOP_LEVEL_AWAIT.test(line)).toBe(true);
  }
  for (const line of ["  await main();", "  const x = await f();", "async function f() {"]) {
    expect(TOP_LEVEL_AWAIT.test(line)).toBe(false);
  }
});
