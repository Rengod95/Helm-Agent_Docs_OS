import { expect, test } from "bun:test";
import { scanAll, scanSource, summarizeExceptions, type SourceFile } from "./check-ts-rules.ts";

function scan(path: string, text: string): string[] {
  return scanSource({ path, text }).violations.map((v) => `${v.line} ${v.rule}`);
}

const BRAND_OK =
  "// oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성 (eng.typescript.guide TY-06)";

test("an assertion exception inside its allowlist row passes", () => {
  expect(scan("packages/platform-os/src/ids.ts", `${BRAND_OK}\nreturn x as Id;`)).toEqual([]);
  expect(scan("packages/core-tasks/test/support/ids.ts", `${BRAND_OK}\nreturn x as Id;`)).toEqual(
    [],
  );
});

test("an assertion exception outside its allowlist row fails", () => {
  expect(scan("packages/core-loop/src/turn.ts", `${BRAND_OK}\nreturn x as Id;`)).toEqual([
    "1 xeon/as-location",
  ]);
});

test("an assertion exception without a row id fails", () => {
  const text =
    "// oxlint-disable-next-line typescript/consistent-type-assertions -- 타입이 맞음 (eng.typescript.guide TY-06)\nreturn x as Id;";
  expect(scan("packages/platform-os/src/ids.ts", text)).toEqual(["1 xeon/as-location"]);
});

test("the exceptions of a row are bound to that row's files", () => {
  const a3 =
    "// oxlint-disable-next-line typescript/consistent-type-assertions -- 허용 목록 A3 키 레지스트리 조회 (eng.typescript.guide TY-06)\nx";
  expect(scan("packages/ext-host/src/erase.ts", a3)).toEqual([]);
  expect(scan("packages/ext-host/src/other.ts", a3)).toEqual(["1 xeon/as-location"]);
});

test("block disable comments and reasonless disables fail", () => {
  expect(scan("packages/a/src/x.ts", "/* oxlint-disable no-console */")).toEqual([
    "1 xeon/directive-format",
  ]);
  expect(scan("packages/a/src/x.ts", "// oxlint-disable-next-line no-console\nx")).toEqual([
    "1 xeon/directive-format",
  ]);
  expect(
    scan(
      "packages/a/src/x.ts",
      "// oxlint-disable-next-line no-console -- 진입점 출력 (eng.typescript.guide TY-06)\nx",
    ),
  ).toEqual([]);
});

test("ts suppression comments are limited to tests", () => {
  expect(scan("packages/a/src/x.ts", "// @ts-ignore")).toEqual(["1 xeon/directive-format"]);
  expect(scan("packages/a/src/x.ts", "// @ts-expect-error -- 이유가 있다")).toEqual([
    "1 xeon/directive-format",
  ]);
  expect(scan("packages/a/test/x.test.ts", "// @ts-expect-error -- 타입 테스트")).toEqual([]);
});

test("Bug messages that name an expected failure fail in sources, not in tests", () => {
  const text =
    'throw new Bug(`store.io: ${code}`);\nthrow new Bug("store.nested_write: inside a write");';
  expect(scan("packages/a/src/x.ts", text)).toEqual(["1 xeon/bug-for-expected"]);
  expect(scan("packages/a/test/x.test.ts", text)).toEqual([]);
  expect(
    scan("packages/a/src/x.ts", 'throw new Bug("shutdown timeoutMs must be positive");'),
  ).toEqual([]);
});

test("an exemption comment above the line silences a scan rule", () => {
  const text =
    '// xeon-disable-next-line xeon/bug-for-expected -- 질의어가 아니다 (eng.typescript.guide TY-24)\nthrow new Bug("x.io");';
  expect(scan("packages/a/src/x.ts", text)).toEqual([]);
});

test("swallowing catches fail", () => {
  expect(scan("packages/a/src/x.ts", "work.catch(() => undefined);")).toEqual([
    "1 xeon/catch-swallow",
  ]);
  expect(scan("packages/a/src/x.ts", "work.catch(() => {});")).toEqual(["1 xeon/catch-swallow"]);
  expect(scan("packages/a/src/x.ts", "work.catch(noop);")).toEqual(["1 xeon/catch-swallow"]);
  expect(scan("packages/a/src/x.ts", "  void caught;")).toEqual(["1 xeon/catch-swallow"]);
  expect(scan("packages/a/src/x.ts", "work.catch((caught) => log(caught));")).toEqual([]);
  expect(scan("packages/a/src/x.ts", "// work.catch(() => undefined) is banned")).toEqual([]);
});

test("exceptions are summarized per rule", () => {
  const files: SourceFile[] = [
    { path: "packages/platform-os/src/ids.ts", text: `${BRAND_OK}\nx\n${BRAND_OK}\nx` },
    {
      path: "packages/a/src/x.ts",
      text: "// oxlint-disable-next-line no-console -- 출력 (eng.typescript.guide TY-06)\nx",
    },
  ];
  const { violations, exceptions } = scanAll(files);
  expect(violations).toEqual([]);
  expect(summarizeExceptions(exceptions)).toEqual([
    "exceptions oxlint:no-console 1",
    "exceptions oxlint:typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion 2",
  ]);
});
