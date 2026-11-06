import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// createWindow는 electron이 있어야 돌아 단위 시험으로 부를 수 없다. 창 옵션 줄의 값을 소스에서 읽어 비교한다.
describe("window minimum size", () => {
  const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  test("스펙 기본값 720×480", () => {
    expect(/minWidth:\s*(\d+)/.exec(source)?.[1]).toBe("720");
    expect(/minHeight:\s*(\d+)/.exec(source)?.[1]).toBe("480");
  });
});
