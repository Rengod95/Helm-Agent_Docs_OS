// 훑기 자식 프로세스(`migration-scan --stdio`)의 인자 해석. 가볍게 유지한다: 진입 파일(main.ts)이 엔진을 싣기 전에 부른다.
// 인자는 정확히 `--stdio` 하나다. 그 밖의 인자는 사용 오류다(migration.md §7.4 [제안], `plugin-host/argv.ts`와 같은 모양).

type MigrationScanArgv = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function parseMigrationScanArgv(rest: readonly string[]): MigrationScanArgv {
  const [first, ...extra] = rest;
  if (first !== "--stdio") {
    return { ok: false, message: "usage: migration-scan --stdio" };
  }
  const [unknown] = extra;
  if (unknown !== undefined) {
    return { ok: false, message: `unknown argument: ${unknown}` };
  }
  return { ok: true };
}
