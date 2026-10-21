import { createExpectAssertions, type ExpectLike } from "./assertions.ts";
import { createEnvConformance } from "./env-conformance.ts";
import type { EnvConformanceOptions, EnvConformanceProvider } from "./types.ts";

export interface StorageConformanceRunner {
  readonly describe: (name: string, suite: () => void) => unknown;
  readonly expect: ExpectLike;
  readonly it: (name: string, test: () => Promise<void>, timeoutMs?: number) => unknown;
}

/** Registers the runner-independent `ExecutionEnv` cases with a Vitest/Jest-compatible test runner. */
export function registerEnvConformance(
  runner: StorageConformanceRunner,
  name: string,
  withEnv: EnvConformanceProvider,
  options: Pick<EnvConformanceOptions, "shell" | "symlinks"> = {},
): void {
  const cases = createEnvConformance({
    ...options,
    assertions: createExpectAssertions(runner.expect),
    withEnv,
  });
  runner.describe(name, () => {
    // oxlint-disable-next-line typescript/unbound-method -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
    for (const testCase of cases) runner.it(testCase.name, testCase.run, testCase.timeoutMs);
  });
}
