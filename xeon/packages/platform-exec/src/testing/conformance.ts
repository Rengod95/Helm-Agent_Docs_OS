import { describe, expect, it } from "bun:test";
import type { EnvConformanceOptions, EnvConformanceProvider } from "../upstream/testing/types.ts";
import { registerEnvConformance } from "../upstream/testing/runner.ts";

export type ExecConformanceProvider = EnvConformanceProvider;
export type ExecConformanceOptions = Pick<EnvConformanceOptions, "shell" | "symlinks">;

/**
 * 어떤 `ExecutionEnv` 구현이든 원본 적합성 사례(24개)를 bun:test로 등록한다(L0.exec.plan EX-09).
 * `withEnv`는 cwd가 새 빈 쓰기 가능 디렉터리인 env를 한 번 `use`에 넘기고 뒤처리한다.
 */
export function registerExecConformance(
  name: string,
  withEnv: ExecConformanceProvider,
  options: ExecConformanceOptions = {},
): void {
  registerEnvConformance({ describe, expect, it }, name, withEnv, options);
}
