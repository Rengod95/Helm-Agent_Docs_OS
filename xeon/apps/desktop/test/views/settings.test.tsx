import { describe, expect, test } from "bun:test";
import { binaryViewOf, type SetupSnapshot } from "@fresnel/client/settings";
import { keepTools } from "../../src/app/setup.ts";
import { errorText } from "../../src/views/settings.tsx";

// 최소 설정 화면의 본문은 P-09 설정 화면과 P-01 첫 실행 화면으로 옮겼다(각 시험이 그 그림을 본다).
// 이 파일에는 두 화면이 아직 쓰는 함수만 남긴다: 설정을 다시 읽을 때 도구 점검을 잇는 `keepTools`와 저장 오류 문장 `errorText`.

const EMPTY: SetupSnapshot = {
  providers: [],
  defaultModel: null,
  secrets: [],
  toolsReady: null,
  binaries: null,
};

describe("keepTools", () => {
  test("a settings re-read keeps the earlier tool check and takes everything else from the new read", () => {
    const binaries = binaryViewOf({
      platform: "linux",
      ready: true,
      blocking: [],
      degraded: [],
      items: [],
    });
    const previous: SetupSnapshot = { ...EMPTY, toolsReady: true, binaries };
    const fresh: SetupSnapshot = {
      ...EMPTY,
      defaultModel: "anthropic/claude-sonnet-5-5",
      secrets: [{ name: "anthropic-api-key", registered: true }],
    };
    expect(keepTools(fresh, previous)).toEqual({
      providers: [],
      defaultModel: "anthropic/claude-sonnet-5-5",
      secrets: [{ name: "anthropic-api-key", registered: true }],
      toolsReady: true,
      binaries,
    });
  });
});

describe("save errors", () => {
  test("a rejected value shows the host sentence, so a wrong model id says what is wrong", () => {
    expect(
      errorText({
        kind: "rejected",
        code: 3102,
        detail: "알 수 없는 모델 anthropic/claude-sonnet-5.5 (anthropic의 모델: claude-sonnet-5-5)",
      }),
    ).toBe(
      "저장하지 못했어요: 알 수 없는 모델 anthropic/claude-sonnet-5.5 (anthropic의 모델: claude-sonnet-5-5)",
    );
    expect(errorText({ kind: "rejected", code: 3103 })).toBe("엔진이 거절했어요 (3103).");
  });
});
