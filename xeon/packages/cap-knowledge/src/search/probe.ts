// L2.knowledge.spec §4.8.5 FTS5 시작 프로브. trigram 토크나이저는 FTS5가 있고 SQLite가 3.34.0 이상일 때만 쓸 수 있다.
//
// 구현(KN.4)은 spec처럼 자기 범위 핸들에서 `CREATE VIRTUAL TABLE temp...`를 돌리지 않는다: 범위 핸들(`scoped`)은 DDL을 허용하지
// 않는다. 대신 `platform-store`가 시작 때 한 FTS5 프로브(`StoreService.capabilities.fts5`)와 SQLite 버전으로 판정하고, 실제
// `trigram` 표 생성은 투영기 등록의 DDL이 한다. 등록이 실패하면 표 접근 검사(`tablesReady`)가 걸러 기능을 끈다.

const MIN_TRIGRAM = { major: 3, minor: 34 } as const;

export type FtsProbe =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

function versionAtLeast(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > MIN_TRIGRAM.major || (major === MIN_TRIGRAM.major && minor >= MIN_TRIGRAM.minor);
}

export function probeFts(capabilities: {
  readonly fts5: boolean;
  readonly sqliteVersion: string;
}): FtsProbe {
  if (!capabilities.fts5) {
    return {
      available: false,
      reason:
        "this SQLite build has no FTS5 (on macOS point setCustomSQLite at a build that has it)",
    };
  }
  if (!versionAtLeast(capabilities.sqliteVersion)) {
    return {
      available: false,
      reason: `SQLite ${capabilities.sqliteVersion} is older than 3.34.0, which the trigram tokenizer needs`,
    };
  }
  return { available: true };
}
