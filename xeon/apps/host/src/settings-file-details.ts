/**
 * `settings_file_invalid`(store.io)의 details. 파일 경로와 위치를 싣는다. 위치는 JSON 문법 오류일 때만 있어서 없으면 그 칸을 생략한다
 * (F wire §3.5.2 5006). 파일 내용은 싣지 않는다
 */
export function settingsFileInvalidDetails(failure: {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}): Readonly<Record<string, unknown>> {
  return {
    code: "settings_file_invalid",
    path: failure.path.slice(0, 512),
    ...(failure.line === null ? {} : { line: failure.line }),
    ...(failure.column === null ? {} : { column: failure.column }),
  };
}
