import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

// 돌려 보기 폴더의 구조 시험(§4.8 규칙 46, §3.7). 서비스가 실행하는 길은 주입된 실행기 하나뿐이고, 폴더는 플러그인 코드를 읽거나
// 동적으로 가져오지 않는다. 가져오기 목록은 정확히 고정한다. 목록이 바뀌면 이 시험을 함께 고친다(검토 신호).

const DIR = join(import.meta.dir, "../../../src/assembly/backtest");

function sourceOf(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

/** 한 파일의 가져오기 지정자 목록(등장 순서). `import … from "x"`와 `import "x"`를 본다 */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  for (const match of source.matchAll(/^import\s+"([^"]+)"/gm)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

test("the service imports exactly the modules it may use, and nothing that writes the turn record or runs plugin code", () => {
  expect(specifiersOf(sourceOf("service.ts"))).toEqual([
    "@fresnel/contracts",
    "@fresnel/contracts/conversation",
    "@fresnel/contracts/records",
    "@fresnel/contracts/wire",
    "@fresnel/ext-host",
    "./candidate.ts",
    "./classify.ts",
    "./isolation.ts",
    "./payload.ts",
    "./scope.ts",
    "./similar.ts",
  ]);
});

test("no file in the folder loads code dynamically or reaches the recorder, the turn writer or the plugin host", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(5);
  for (const name of files) {
    const source = sourceOf(name);
    expect({ name, dynamic: source.includes("import(") }).toEqual({ name, dynamic: false });
    for (const specifier of specifiersOf(source)) {
      expect({ name, specifier: forbiddenOf(specifier) }).toEqual({ name, specifier: null });
    }
  }
});

/** 쓰는 쪽 모듈이나 플러그인 코드를 실행하는 모듈이면 그 지정자를 돌려준다. 아니면 null */
function forbiddenOf(specifier: string): string | null {
  const forbidden = [
    "measure/recorder",
    "measure/turn-writer",
    "measure/turn-rows",
    "measure/store",
    "measure/turn-tables",
    "measure/turn-context",
    "plugin-host/",
    "core-tools",
    "core-loop",
    "handlers/",
    "@fresnel/cap-",
    "@fresnel/plugin-",
    "@fresnel/orchestration-sdk",
  ];
  return forbidden.some((part) => specifier.includes(part)) ? specifier : null;
}
