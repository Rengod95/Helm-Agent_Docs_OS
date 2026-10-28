import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// client-import-boundary: src/client.ts의 import는 @xeon/client(연결 구현)와 @xeon/contracts뿐이다. 연결 계층 코드에서 엔진 패키지가 끌려오지 않게 하기 위해서다
// (L4.host-service.plan §2, adr.0020).

const SOURCE = readFileSync(join(import.meta.dir, "..", "src", "client.ts"), "utf8");

function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/g)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

test("client.ts imports nothing but @xeon/client and @xeon/contracts", () => {
  const imports = specifiers(SOURCE);
  expect(imports.length).toBeGreaterThan(0);
  for (const specifier of imports) {
    expect(
      specifier === "@xeon/client" ||
        specifier === "@xeon/contracts" ||
        specifier.startsWith("@xeon/contracts/"),
    ).toBe(true);
  }
});

test("the scan sees relative and package imports (the check itself works)", () => {
  expect(
    specifiers('import { a } from "./x.ts";\nimport type { b } from "@xeon/core-loop";'),
  ).toEqual(["./x.ts", "@xeon/core-loop"]);
});
