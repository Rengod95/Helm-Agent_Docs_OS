import { readFileSync } from "node:fs";
import { attempt, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { ExecPlatformProvider } from "./provider.ts";
import { darwinProvider } from "./providers/darwin.ts";
import { createLinuxProvider } from "./providers/linux.ts";
import { createWin32Provider } from "./providers/win32.ts";

export type ExecSelectError = { readonly kind: "unsupported_platform"; readonly platform: string };

/** WSL 판정 기준은 L0.os.spec §3.1과 같다: `WSL_DISTRO_NAME`이 비어 있지 않거나 `/proc/version`에 microsoft 또는 WSL이 있다 */
function isWsl(
  env: Readonly<Record<string, string | undefined>>,
  procVersion: string | undefined,
): boolean {
  const distro = env["WSL_DISTRO_NAME"];
  if (distro !== undefined && distro !== "") return true;
  return procVersion !== undefined && /microsoft|wsl/i.test(procVersion);
}

/**
 * OS 이름으로 provider를 고른다. 지원 목록 밖의 값(freebsd, android 등)은 오류 값이다(DR-13, TY-14의 열린 외부 값).
 * 입력을 받는 순수 함수라 시험에서 OS를 바꿔 부를 수 있다.
 */
export function selectExecPlatform(input: {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** linux만 /proc/version 내용 */
  readonly procVersion: string | undefined;
  /** win32 provider의 종료 호출 실패 기록용 */
  readonly logger?: Logger;
}): Result<ExecPlatformProvider, ExecSelectError> {
  switch (input.platform) {
    case "darwin":
      return ok(darwinProvider);
    case "linux":
      return ok(createLinuxProvider({ wsl: isWsl(input.env, input.procVersion) }));
    case "win32":
      return ok(
        createWin32Provider({
          env: input.env,
          ...(input.logger === undefined ? {} : { logger: input.logger }),
        }),
      );
    default:
      return err({ kind: "unsupported_platform", platform: input.platform });
  }
}

function readProcVersion(): string | undefined {
  const read = attempt(() => readFileSync("/proc/version", "utf8"));
  // /proc이 없는 OS는 WSL이 아닌 것으로 본다
  return read.ok ? read.value : undefined;
}

/** 실행 중인 OS의 provider. 프로세스의 OS 이름을 읽는 유일한 곳이다(L0.exec.spec §3.4) */
export function detectExecPlatform(logger?: Logger): Result<ExecPlatformProvider, ExecSelectError> {
  const platform = process.platform;
  return selectExecPlatform({
    platform,
    env: process.env,
    procVersion: platform === "linux" ? readProcVersion() : undefined,
    ...(logger === undefined ? {} : { logger }),
  });
}
