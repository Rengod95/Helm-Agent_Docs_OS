// L4.cli.spec §3.6. 제품 CLI의 종료 코드다. 개발 레시피의 종료코드(1 고침, 2 환경, 3 사람 확인)와 섞지 않는다.

import { assertNever } from "@fresnel/contracts";

/** 70~73은 `fresnel host --stdio`(데스크톱 사이드카 진입)만 돌려준다. 앱 셸이 시작 실패의 분류를 종료 코드로 읽는다 */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 70 | 71 | 72 | 73 | 129 | 130 | 143;

export const EXIT: {
  readonly ok: 0;
  readonly error: 1;
  readonly usage: 2;
  readonly environment: 3;
  readonly lockDenied: 4;
  readonly hangup: 129;
  readonly interrupted: 130;
  readonly terminated: 143;
} = {
  ok: 0,
  error: 1,
  usage: 2,
  environment: 3,
  lockDenied: 4,
  hangup: 129,
  interrupted: 130,
  terminated: 143,
};

/**
 * `@fresnel/host`의 `runHostCommand`가 돌려주는 종료 코드를 CLI 종료 코드로 옮긴다.
 * 70~72는 저장소를 열지 못한 종료(`storeFailureOfExitCode`), 73은 데이터 폴더 권한 문제라 환경 문제(3)다. 그 밖의 알 수 없는 값은 1이다(L4.cli.spec §3.6)
 */
export function exitCodeOfHost(code: 0 | 1 | 2 | 70 | 71 | 72 | 73): ExitCode {
  switch (code) {
    case 0:
      return EXIT.ok;
    case 2:
      return EXIT.usage;
    case 70:
    case 71:
    case 72:
    // 73은 데이터 폴더 권한이 넓은 시작 실패(`startupFailureOfExitCode`)라 이것도 환경 문제다
    case 73:
      return EXIT.environment;
    case 1:
      return EXIT.error;
    default:
      return assertNever(code, "HostExitCode");
  }
}
