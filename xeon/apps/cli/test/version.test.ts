import { expect, test } from "bun:test";
import { CLI_VERSION } from "../src/commands/version.ts";

// L4.release.spec §8.1: 소스 실행에는 빌드 정의(XEON_BUILD_VERSION)가 없으므로 CLI 버전은 "0.0.0"이다.
// 릴리즈 주입은 scripts/build-sidecar.test.ts가 실제 컴파일로 본다.
test("from source the CLI version is 0.0.0, since no release build defines XEON_BUILD_VERSION", () => {
  expect(CLI_VERSION).toBe("0.0.0");
});
