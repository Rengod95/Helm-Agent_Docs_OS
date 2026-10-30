// 손으로 쓴 통합 diff와 파일 내용. 문맥 줄 없이 줄마다 hunk 하나라서 hunk ID와 글을 눈으로 따라갈 수 있다.

function diff(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

/** src/a.ts 한 파일에 hunk 셋(f0h0, f0h1, f0h2). 되돌린 뒤의 줄은 `const x = 1;` 같은 옛 값이다 */
export const ONE_FILE_THREE_HUNKS: string = diff(
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-const x = 1;",
  "+const x = 10;",
  "@@ -2 +2 @@",
  "-const y = 2;",
  "+const y = 20;",
  "@@ -3 +3 @@",
  "-const z = 3;",
  "+const z = 30;",
);

/** `ONE_FILE_THREE_HUNKS` 적용 뒤의 src/a.ts */
export const A_AFTER_EDIT = "const x = 10;\nconst y = 20;\nconst z = 30;\n";

/** 두 파일, hunk 셋: src/a.ts에 f0h0 f0h1, src/b.ts에 f1h0 */
export const TWO_FILES_THREE_HUNKS: string = diff(
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-const x = 1;",
  "+const x = 10;",
  "@@ -2 +2 @@",
  "-const y = 2;",
  "+const y = 20;",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -3 +3 @@",
  "-const z = 3;",
  "+const z = 30;",
);

/** 같은 턴에 src/a.ts의 같은 줄을 두 번 고친 첫 번째 편집(a → b) */
export const REPEAT_EDIT_FIRST: string = diff(
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-const v = 'a';",
  "+const v = 'b';",
);

/** 두 번째 편집(b → c). 합치면 같은 파일에 hunk 둘이다: f0h0(a→b), f0h1(b→c) */
export const REPEAT_EDIT_SECOND: string = diff(
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-const v = 'b';",
  "+const v = 'c';",
);

/** 새 파일을 만든 diff */
export const NEW_FILE: string = diff(
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1 @@",
  "+export const n = 1;",
);
