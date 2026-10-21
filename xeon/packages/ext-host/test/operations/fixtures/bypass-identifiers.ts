/** 접두 우회를 노린 식별자 모음. 지역 이름이나 열 이름으로 주면 모두 거부되어야 한다(X.operations.spec §9 16번) */
export const BYPASS_IDENTIFIERS: readonly string[] = [
  "notes; DROP TABLE events",
  'notes"--',
  "main.events",
  "sqlite_master",
  "../x",
  "Notes",
  "NOTES",
  "nоtes",
  "ｎｏｔｅｓ",
  "",
  " ",
  "notes ",
  "1notes",
  "notes\u0000",
  "notes\n",
];

/** 열 이름 규칙(밑줄 허용, 63자)에는 맞지만 지역 이름 규칙에는 어긋나는 식별자 */
export const LOCAL_ONLY_INVALID: readonly string[] = ["not_es", "x_other_pins", "a".repeat(33)];
