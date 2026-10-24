// L4.cli.spec §4.3. 개발 빌드 판별. 엔진을 끌어오지 않는 가벼운 모듈이다(runtime.ts가 시작할 때 읽는다).

/** 컴파일 바이너리의 Bun.main은 `/$bunfs/` 아래다 [가정: 값 형식은 L4.host-service.spec §3.2 H15 spike에서 확인] */
const COMPILED_MAIN_PREFIX = "/$bunfs/";

/**
 * 개발 빌드(`XEON_DEV=1` 또는 소스 실행)면 참이다(§4.3). in-process에서 비직렬화 값이 섞이지 않게 하는 JSON 왕복 검사를 켠다.
 * 컴파일 바이너리는 끈다. 순수 함수
 */
export function devWireRoundTripOf(
  env: Readonly<Record<string, string | undefined>>,
  mainPath: string,
): boolean {
  if (env["XEON_DEV"] === "1") return true;
  return !mainPath.startsWith(COMPILED_MAIN_PREFIX);
}
