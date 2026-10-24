import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

// adr.0009: 어느 패키지도 pi-agent-core를 import하지 않고 package.json에도 적지 않는다.
const SRC = join(import.meta.dir, "..", "..", "src");
const PACKAGE_JSON = join(import.meta.dir, "..", "..", "package.json");
const NAME = ["@earendil-works", "pi-agent-core"].join("/");

test("F source does not reference pi-agent-core", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.ts").scan({ cwd: SRC })) {
    const text = await Bun.file(join(SRC, file)).text();
    if (text.includes(NAME)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test("contracts package.json does not depend on pi-agent-core", async () => {
  const text = await Bun.file(PACKAGE_JSON).text();
  expect(text.includes(NAME)).toBe(false);
});
