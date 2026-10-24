import { expect, test } from "bun:test";
import type { ExecutionEnv as FExecutionEnv } from "@xeon/contracts/services";
import type { ExecutionEnv as ForkExecutionEnv } from "../src/upstream/env/index.ts";

// L0.exec.spec §9 11번. 포크 선언(src/upstream/env/index.ts)과 F 선언(@xeon/contracts/services)이 서로 대입 가능한지
// 타입 수준에서 확인한다. 어긋나면 이 파일이 tsc -b에서 실패한다.

const forkToF = (env: ForkExecutionEnv): FExecutionEnv => env;
const fToFork = (env: FExecutionEnv): ForkExecutionEnv => env;

test("fork and F declarations are mutually assignable", () => {
  expect(typeof forkToF).toBe("function");
  expect(typeof fToFork).toBe("function");
});
