import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

// F-09: 모델이 디스크를 뒤지지 않도록 도구와 메서드 등록의 짧은 코드 본보기가 가이드에 있다.

const REFERENCE = join(
  import.meta.dir,
  "../skills/fresnel-plugin-authoring/references/hooks-and-tools.md",
);

test("the authoring guide carries a minimal group with a tool and a method", () => {
  const text = readFileSync(REFERENCE, "utf8");
  const example = text.slice(text.indexOf("### Minimal tool and method"));
  expect(example).toContain("defineOrchestration({");
  expect(example).toContain("g.registerTool({");
  expect(example).toContain('g.registerMethod("hello"');
  expect(example).toContain("export default group;");
});
