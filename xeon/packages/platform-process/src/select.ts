import { spawn } from "node:child_process";
import { attempt, err, ok, type Logger, type Result } from "@xeon/contracts";

// L0.process.plan §2 `select.ts`. OS 이름을 읽는 곳은 이 파일 하나다(eng.dependency-rules.guide DR-13).
// M2 범위: 외부 훅과 격리 자식의 프로세스 트리 종료, 자식 분리 옵션. OS 서비스 등록(registrar)과 소켓 경로 한도는 서비스 모드 때 더한다.

export type TreeSignal = "graceful" | "force";

export interface ProcessPlatformProvider {
  readonly kind: "posix" | "win32";
  /** spawn의 detached 값. POSIX true(새 프로세스 그룹이라 트리 전체에 신호를 보낼 수 있다), win32 false */
  readonly detachedSpawn: boolean;
  /**
   * 프로세스 트리 전체에 종료를 요청한다. graceful은 SIGTERM(win32는 `taskkill /T`), force는 SIGKILL(win32는 `taskkill /T /F`).
   * 이미 끝난 트리는 보낼 곳이 없을 뿐이라 오류가 아니다.
   */
  signalTree(pid: number, signal: TreeSignal): void;
}

export type ProcessSelectError = {
  readonly kind: "unsupported_platform";
  readonly platform: string;
};

function posixProvider(): ProcessPlatformProvider {
  return {
    kind: "posix",
    detachedSpawn: true,
    signalTree(pid, signal) {
      const name = signal === "graceful" ? "SIGTERM" : "SIGKILL";
      const group = attempt(() => process.kill(-pid, name));
      if (group.ok) return;
      // 프로세스 그룹이 없으면 그 프로세스에만 보낸다. 이것도 실패하면 이미 끝난 프로세스다
      attempt(() => process.kill(pid, name));
    },
  };
}

function win32Provider(logger: Logger | undefined): ProcessPlatformProvider {
  return {
    kind: "win32",
    detachedSpawn: false,
    signalTree(pid, signal) {
      const args = ["/PID", String(pid), "/T", ...(signal === "force" ? ["/F"] : [])];
      const child = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
      child.once("error", (cause) => {
        logger?.warn("process.taskkill_failed", { pid, error: cause.message });
      });
    },
  };
}

/** OS 이름으로 provider를 고른다. 지원 목록 밖의 값은 오류 값이다. 입력을 받는 순수 함수라 시험에서 OS를 바꿔 부를 수 있다 */
export function selectProcessPlatform(input: {
  readonly platform: string;
  readonly logger?: Logger;
}): Result<ProcessPlatformProvider, ProcessSelectError> {
  switch (input.platform) {
    case "darwin":
    case "linux":
      return ok(posixProvider());
    case "win32":
      return ok(win32Provider(input.logger));
    // xeon-disable-next-line xeon/switch-default-never -- process.platform은 지원 목록보다 넓은 외부 값이다. 지원 밖 OS는 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err({ kind: "unsupported_platform", platform: input.platform });
  }
}

/** 실행 중인 OS의 provider. 프로세스의 OS 이름을 읽는 유일한 곳이다 */
export function detectProcessPlatform(
  logger?: Logger,
): Result<ProcessPlatformProvider, ProcessSelectError> {
  return selectProcessPlatform({
    platform: process.platform,
    ...(logger === undefined ? {} : { logger }),
  });
}
