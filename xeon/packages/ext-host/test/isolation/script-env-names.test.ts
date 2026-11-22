// 선언한 환경 변수 이름 가운데 실제로 자식에게 넘어가는 것과 받지 못하는 것을 이름만으로 가른다 [결정: 2026-11-22, 사용자, AGE-63]
import { expect, test } from "bun:test";
import { scriptEnvNamesOf } from "../../src/index.ts";

test("only allow-listed, non-secret names pass; the rest are ignored in declared order", () => {
  expect(
    scriptEnvNamesOf(["HOME", "FETCH_API_KEY", "PATH", "MY_TOKEN", "TZ", "CUSTOM", "FRESNEL_X"]),
  ).toEqual({
    passed: ["HOME", "PATH", "TZ"],
    ignored: ["FETCH_API_KEY", "MY_TOKEN", "CUSTOM", "FRESNEL_X"],
  });
  expect(scriptEnvNamesOf([])).toEqual({ passed: [], ignored: [] });
});
