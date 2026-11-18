import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";

// 대화하는 빌더(플러그인)는 제작 코어(`@fresnel/core-authoring`)나 다른 코어를 import하지 않는다. 코어는 contracts의 `fresnel.devkit`
// 서비스 계약으로만 쓴다. 같은 규칙을 `just check-layers`(DR-15)도 지키고, 이 시험이 소스 쪽을 값으로 고정한다.

const SRC = join(import.meta.dir, "..", "src");
const FORBIDDEN = /from\s+"@fresnel\/(core-[a-z-]+|platform-[a-z-]+)(\/[^"]*)?"/;

test("plugin-builder 소스는 core-*와 platform-*를 import하지 않는다", () => {
  const files = readdirSync(SRC).filter((name) => name.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(5);
  const offenders = files.filter((name) => FORBIDDEN.test(readFileSync(join(SRC, name), "utf8")));
  expect(offenders).toEqual([]);
});

test("plugin-builder는 core-authoring을 devDependencies로만 선언한다(시험이 쓴다)", () => {
  const parsed = parseJson(readFileSync(join(SRC, "..", "package.json"), "utf8"));
  expect(parsed.ok).toBe(true);
  const manifest = parsed.ok ? parsed.value : null;
  expect(manifest).toMatchObject({ devDependencies: { "@fresnel/core-authoring": "workspace:*" } });
  expect(manifest).not.toMatchObject({
    dependencies: { "@fresnel/core-authoring": "workspace:*" },
  });
});
