// L4.cli.spec §3.6. 제품 CLI의 종료 코드다. 개발 레시피의 종료코드(1 고침, 2 환경, 3 사람 확인)와 섞지 않는다.

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 129 | 130 | 143;

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
