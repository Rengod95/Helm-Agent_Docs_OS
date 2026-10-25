import { describe, expect, test } from "bun:test";
import { createFlockPrimitive, type Ffi, type FlockSelection } from "../src/file-lock/flock.ts";
import { selectProviders } from "../src/select.ts";

const DARWIN: FlockSelection = {
  kind: "flock",
  libName: "libSystem.B.dylib",
  errnoSymbol: "__error",
  wouldBlockErrno: 35,
};

describe("createFlockPrimitive", () => {
  test("로더가 라이브러리를 돌려주면 파일 존재와 무관하게 수단을 만든다(macOS libSystem은 디스크에 없다)", () => {
    const seen: FlockSelection[] = [];
    const ffi: Ffi = { flock: () => 0, errno: () => 0 };
    const primitive = createFlockPrimitive(DARWIN, (selection) => {
      seen.push(selection);
      return ffi;
    });
    expect(primitive === undefined).toBe(false);
    expect(seen).toEqual([DARWIN]);
  });

  test("로더가 실패(undefined)하면 undefined다", () => {
    expect(createFlockPrimitive(DARWIN, () => undefined)).toBeUndefined();
  });

  test("macOS 선택은 libSystem.B.dylib 이름 그대로 dlopen한다", () => {
    const providers = selectProviders({
      platform: "darwin",
      arch: "arm64",
      isWsl: false,
      release: "25.0.0",
    });
    expect(providers.fileLock).toEqual(DARWIN);
  });

  test.skipIf(process.platform !== "darwin")(
    "실제 macOS에서는 libSystem이 로드되어 잠금을 쥔다",
    () => {
      expect(createFlockPrimitive(DARWIN) === undefined).toBe(false);
    },
  );
});
