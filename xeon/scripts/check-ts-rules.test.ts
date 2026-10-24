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

test("keeping the upstream shape is not a reason for an exception", () => {
  const fork = "packages/platform-exec/src/upstream/env/node.ts";
  expect(
    scan(
      fork,
      "// oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)\nx",
    ),
  ).toEqual(["1 xeon/directive-format"]);
  expect(
    scan(
      fork,
      "// oxlint-disable-next-line no-await-in-loop -- keep upstream shape (eng.typescript.guide TY-22)\nx",
    ),
  ).toEqual(["1 xeon/directive-format"]);
  expect(
    scan(
      fork,
      "// xeon-disable-next-line xeon/bug-for-expected -- 업스트림 병합을 쉽게 하려고 (eng.typescript.guide TY-24)\nx",
    ),
  ).toEqual(["1 xeon/directive-format"]);
  expect(
    scan(
      "packages/a/src/x.ts",
      "// oxlint-disable-next-line no-await-in-loop -- 순차 await가 이 함수의 목적이다 (eng.typescript.guide TY-22)\nx",
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

test("Bug messages with the stored-row and commit failure words fail", () => {
  for (const word of [
    "row_invalid",
    "row_corrupt",
    "read_failed",
    "commit_failed",
    "name_conflict",
  ]) {
    expect(scan("packages/a/src/x.ts", `throw new Bug("store.${word}: x");`)).toEqual([
      "1 xeon/bug-for-expected",
    ]);
  }
  // 낱말이 아닌 이름은 통과한다
  expect(scan("packages/a/src/x.ts", 'throw new Bug("tools.commit_failed_twice");')).toEqual([]);
});

test("a Bug message that interpolates a Result error fails outside test support", () => {
  const text = "throw new Bug(`store failed: ${result.error.kind}`);";
  expect(scan("packages/a/src/x.ts", text)).toEqual(["1 xeon/bug-for-expected"]);
  expect(scan("packages/a/src/testing/x.ts", text)).toEqual([]);
  expect(scan("packages/a/test/x.test.ts", text)).toEqual([]);
});

test("a Result failure converted to a Bug fails outside test support", () => {
  const inline = 'if (!opened.ok) throw new Bug("store.x: invariant");';
  expect(scan("packages/a/src/x.ts", inline)).toEqual(["1 xeon/bug-for-expected"]);
  const braced = 'if (!opened.value.ok) {\n  throw new Bug("store.x: invariant");\n}';
  expect(scan("packages/a/src/x.ts", braced)).toEqual(["2 xeon/bug-for-expected"]);
  expect(scan("packages/a/src/testing/x.ts", inline)).toEqual([]);
  expect(scan("packages/a/test/x.test.ts", inline)).toEqual([]);
  // 다른 조건 뒤의 Bug는 이 모양이 아니다
  expect(scan("packages/a/src/x.ts", 'if (!ready) throw new Bug("loop.not_ready");')).toEqual([]);
  // 줄 위의 면제 주석이 있으면 통과한다
  expect(
    scan(
      "packages/a/src/x.ts",
      `// xeon-disable-next-line xeon/bug-for-expected -- 자기 값 검증 (eng.typescript.guide TY-24)\n${inline}`,
    ),
  ).toEqual([]);
});

test("a switch default must call assertNever", () => {
  const good =
    "switch (kind) {\n  case 'a':\n    return 1;\n  default:\n    return assertNever(kind, 'K');\n}";
  expect(scan("packages/a/src/x.ts", good)).toEqual([]);
  const bad = "switch (kind) {\n  case 'a':\n    return 1;\n  default:\n    return 0;\n}";
  expect(scan("packages/a/src/x.ts", bad)).toEqual(["4 xeon/switch-default-never"]);
  // 시험 파일에도 같다
  expect(scan("packages/a/test/x.test.ts", bad)).toEqual(["4 xeon/switch-default-never"]);
  // default가 없는 switch는 oxlint default-case의 일이다
  expect(scan("packages/a/src/x.ts", "switch (kind) {\n  case 'a':\n    return 1;\n}")).toEqual([]);
});

test("the default block ends at the next case and only the switch's own default counts", () => {
  const text = [
    "switch (a) {",
    "  default:",
    "    return assertNever(a, 'A');",
    "  case 'x':",
    "    return switchInner(b);",
    "}",
    "switch (outer) {",
    "  case 1:",
    "    switch (inner) {",
    "      default:",
    "        return 2;",
    "    }",
    "    return 1;",
    "  default:",
    "    return assertNever(outer, 'O');",
    "}",
  ].join("\n");
  // 바깥 default는 assertNever가 있고, 안쪽 switch의 default만 실패한다
  expect(scan("packages/a/src/x.ts", text)).toEqual(["10 xeon/switch-default-never"]);
});

test("strings, comments and regex literals do not confuse the switch scan", () => {
  const text = [
    'const a = "switch (x) { default: return 1; }";',
    "// switch (y) { default: return 2; }",
    "const b = /[{}]\\/default:/;",
    "switch (k) {",
    "  case 'a':",
    "    return `}${k}{`;",
    "  default:",
    "    return assertNever(k, 'K');",
    "}",
  ].join("\n");
  expect(scan("packages/a/src/x.ts", text)).toEqual([]);
});

test("an exemption above the default line or inside its block silences the switch rule", () => {
  const above =
    "switch (s) {\n  case 'a':\n    return 1;\n  // xeon-disable-next-line xeon/switch-default-never -- 열린 외부 값 (eng.typescript.guide TY-14)\n  default:\n    return 0;\n}";
  expect(scan("packages/a/src/x.ts", above)).toEqual([]);
  const inside =
    "switch (s) {\n  case 'a':\n    return 1;\n  default:\n    // xeon-disable-next-line xeon/switch-default-never -- 열린 외부 값 (eng.typescript.guide TY-14)\n    return 0;\n}";
  expect(scan("packages/a/src/x.ts", inside)).toEqual([]);
});

test("Type.Unsafe is limited to brands, JSON passthrough, proofs and the TY-26 allowlist", () => {
  const path = "packages/contracts/src/services/x.ts";
  // 브랜드: 문자열 스키마를 감싼다
  expect(scan(path, 'const A = Type.Unsafe<Id>(Type.String({ pattern: "^a$" }));')).toEqual([]);
  // JSON 통과
  expect(scan(path, "const B = Type.Unsafe<JsonValue>(Type.Unknown());")).toEqual([]);
  expect(
    scan(path, "const C = Type.Unsafe<JsonObject>(Type.Record(Type.String(), Type.Unknown()));"),
  ).toEqual([]);
  // 컴파일 시점 증명
  expect(
    scan(path, "const D = Type.Unsafe<Foo>(shape satisfies SchemaProof<Foo, typeof shape>);"),
  ).toEqual([]);
  expect(
    scan(path, "const E = Type.Unsafe<Foo>(shape satisfies SchemaSound<Foo, typeof shape>);"),
  ).toEqual([]);
  // 증명 없는 객체 스키마는 정적 타입만 얹는다
  expect(scan(path, "const F = Type.Unsafe<Foo>(Type.Object({ a: Type.String() }));")).toEqual([
    "1 xeon/type-unsafe",
  ]);
  expect(scan(path, "const G = Type.Unsafe<Foo>(shape);")).toEqual(["1 xeon/type-unsafe"]);
  // 제네릭 안의 꺾쇠를 건너뛴다
  expect(scan(path, "const H = Type.Unsafe<Omit<Foo, 'a'>>(Type.Object({}));")).toEqual([
    "1 xeon/type-unsafe",
  ]);
  // 허용 파일(U2 pi 거울, U3 JSON 스키마 통과, U4 시험)
  expect(
    scan(
      "packages/contracts/src/conversation/message-schema.ts",
      "const I = Type.Unsafe<M>(shape);",
    ),
  ).toEqual([]);
  expect(scan("packages/contracts/test/x.test.ts", "const J = Type.Unsafe(json);")).toEqual([]);
  expect(
    scan("packages/core-models/src/testing/tape.ts", "const K = Type.Unsafe<T>(shape);"),
  ).toEqual([]);
  // 주석과 문자열 안은 세지 않는다
  expect(scan(path, "// Type.Unsafe<Foo>(shape)\nconst L = 'Type.Unsafe<Foo>(shape)';")).toEqual(
    [],
  );
  // 예외 주석
  expect(
    scan(
      path,
      "// xeon-disable-next-line xeon/type-unsafe -- 외부 타입 거울 (eng.typescript.guide TY-26)\nconst M = Type.Unsafe<Foo>(shape);",
    ),
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

test("void <call> in production code fails and tests, types and void 0 pass", () => {
  expect(scan("packages/a/src/x.ts", "  void tasks.abort(scope, reason);")).toEqual([
    "1 xeon/no-void-promise",
  ]);
  expect(scan("packages/a/src/x.ts", "setTimeout(() => {\n  void this.#flush();\n}, 1);")).toEqual([
    "2 xeon/no-void-promise",
  ]);
  expect(scan("packages/a/src/x.ts", "void (async () => { await go(); })();")).toEqual([
    "1 xeon/no-void-promise",
  ]);
  expect(scan("packages/a/test/x.test.ts", "void callTool(h, run);")).toEqual([]);
  expect(scan("packages/a/src/testing/x.ts", "void callTool(h, run);")).toEqual([]);
  expect(
    scan(
      "packages/a/src/x.ts",
      "type Cb = () => void;\nconst a: Promise<void> = go();\nconst b = void 0;\n// void tasks.abort(x)\nconst s = 'void run()';",
    ),
  ).toEqual([]);
  const exempt =
    "// xeon-disable-next-line xeon/no-void-promise -- 시작 신호만 보낸다 (eng.typescript.guide TY-22)\nvoid ping();";
  expect(scan("packages/a/src/x.ts", exempt)).toEqual([]);
});
