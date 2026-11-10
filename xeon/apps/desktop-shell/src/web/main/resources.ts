// 게이트웨이가 사이드카를 찾는 폴더(`ctx.paths.resources`와 같은 뜻). 개발 트리에서는 데스크톱 셸 패키지 폴더이고,
// 빌드된 게이트웨이(`bun build --compile`의 `fresnel-web`)에서는 실행 파일 옆, 곧 패키지 앱의 Resources다.
import path from "node:path";

/** `bun build --compile` 실행 파일이 코드를 두는 가상 폴더 이름. 유닉스는 `/$bunfs/root`, 윈도는 `B:\~BUN\root`다 */
const COMPILED_ROOT = /(?:^|[\\/])(?:\$bunfs|~BUN)(?:[\\/]|$)/u;

/**
 * 사이드카 폴더를 고른다. `here`는 게이트웨이 소스 폴더(`import.meta.url`의 폴더), `execPath`는 실행 파일 경로다.
 * 빌드된 게이트웨이에서는 `here`가 가상 폴더라 `../..`를 따라가면 `/`가 되어 사이드카를 찾지 못한다. 그러면
 * 웹에서 키 값을 보낼 때 `secret_register`가 `unavailable`로 끝나고 화면은 "이 연결에서는 키를 입력할 수 없어요"를 보인다.
 * 패키지 앱은 `fresnel-web`과 사이드카를 같은 Resources 폴더에 둔다(scripts/package.ts)
 */
export function resourcesDirOf(here: string, execPath: string): string {
  return COMPILED_ROOT.test(here) ? path.dirname(execPath) : path.resolve(here, "../..");
}
