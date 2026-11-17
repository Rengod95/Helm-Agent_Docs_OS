import { describe, expect, test } from "bun:test";
import type { InstallPreview } from "@fresnel/contracts/services";
import type { CommandError } from "../../../src/views/commands.ts";
import { errorOf } from "../../../src/app/command-error.ts";
import { wireError } from "@fresnel/contracts/wire";
import { err, ok } from "@fresnel/contracts";
import {
  accessIsEmpty,
  bridgeAccessOf,
  hooksOf,
  INITIAL_INSTALL_FLOW,
  pickOutcomeOf,
  installFailureOf,
  installReasonOf,
  installReasonsOf,
  installFailureHeadOf,
  installReduce,
  warningsOf,
  type InstallFlow,
  type InstallReason,
} from "../../../src/views/workbench/install-model.ts";

const PREVIEW: InstallPreview = {
  name: "docs-bundle",
  version: "1.2.0",
  displayName: null,
  description: null,
  source: "/plugins/docs-bundle",
  sha256: "a".repeat(64),
  trustRequest: "user",
  installedVersion: null,
  hooks: ["boundary.settle.after"],
  tools: [],
  capabilities: [],
  network: [],
  files: [],
  shell: [],
  drives: false,
  screens: [],
  warnings: [],
};

function issue(message: string): CommandError {
  return errorOf(
    wireError("jsonrpc.invalidParams", { details: { issues: [{ path: "/source", message }] } }),
  );
}

describe("설치 흐름", () => {
  test("출처 → 읽기 → 확인 → 설치 → 결과 순서로 가고 값을 그대로 실어 나른다", () => {
    let flow: InstallFlow = installReduce(INITIAL_INSTALL_FLOW, {
      type: "source",
      source: "  /plugins/docs-bundle ",
    });
    flow = installReduce(flow, { type: "previewStart" });
    expect(flow).toEqual({ step: "previewing", source: "/plugins/docs-bundle" });
    flow = installReduce(flow, { type: "previewed", preview: PREVIEW });
    expect(flow).toEqual({ step: "confirm", preview: PREVIEW, failure: null, reasons: [] });
    flow = installReduce(flow, { type: "installStart" });
    expect(flow).toEqual({ step: "installing", preview: PREVIEW });
    // 설치 명령은 M5c-1에서 wire가 빠져 not_available로 끝난다. 확인 화면에 그 실패가 남는다(설치 완료 화면은 없다)
    expect(
      installReduce(flow, { type: "installFailed", failure: "not_available", reasons: [] }),
    ).toEqual({ step: "confirm", preview: PREVIEW, failure: "not_available", reasons: [] });
  });

  test("빈 출처는 읽지 않고, 읽기 실패는 출처 입력으로 돌아가 이유를 남긴다", () => {
    expect(installReduce(INITIAL_INSTALL_FLOW, { type: "previewStart" })).toEqual(
      INITIAL_INSTALL_FLOW,
    );
    const reading: InstallFlow = { step: "previewing", source: "/x" };
    expect(
      installReduce(reading, { type: "previewFailed", failure: "not_found", reasons: [] }),
    ).toEqual({
      step: "source",
      source: "/x",
      failure: "not_found",
      reasons: [],
    });
  });

  test("설치 실패는 확인 화면에 남고, 뒤로 가면 출처 입력이다", () => {
    const installing: InstallFlow = { step: "installing", preview: PREVIEW };
    const failed = installReduce(installing, {
      type: "installFailed",
      failure: "source_changed",
      reasons: [],
    });
    expect(failed).toEqual({
      step: "confirm",
      preview: PREVIEW,
      failure: "source_changed",
      reasons: [],
    });
    expect(installReduce(failed, { type: "back" })).toEqual({
      step: "source",
      source: "/plugins/docs-bundle",
      failure: null,
      reasons: [],
    });
  });

  test("미리 보기와 설치의 거절 사유는 실패 갈래와 함께 출처와 확인 화면에 남는다", () => {
    const reasons: readonly InstallReason[] = [
      { key: "unknown_key", field: "plugins/0/hoks", line: 12 },
    ];
    const reading: InstallFlow = { step: "previewing", source: "/plugins/docs" };
    expect(
      installReduce(reading, { type: "previewFailed", failure: "invalid_input", reasons }),
    ).toEqual({ step: "source", source: "/plugins/docs", failure: "invalid_input", reasons });
    const installing: InstallFlow = { step: "installing", preview: PREVIEW };
    expect(
      installReduce(installing, { type: "installFailed", failure: "invalid_input", reasons }),
    ).toEqual({ step: "confirm", preview: PREVIEW, failure: "invalid_input", reasons });
  });

  test("새 출처나 뒤로 가기는 지난 거절과 그 사유를 지운다", () => {
    const reasons: readonly InstallReason[] = [{ key: "missing_field", field: "plugins/0/hooks" }];
    const failed: InstallFlow = {
      step: "source",
      source: "/plugins/docs",
      failure: "invalid_input",
      reasons,
    };
    expect(installReduce(failed, { type: "source", source: "/plugins/other" })).toEqual({
      step: "source",
      source: "/plugins/other",
      failure: null,
      reasons: [],
    });
    const confirm: InstallFlow = {
      step: "confirm",
      preview: PREVIEW,
      failure: "invalid_input",
      reasons,
    };
    expect(installReduce(confirm, { type: "back" })).toEqual({
      step: "source",
      source: "/plugins/docs-bundle",
      failure: null,
      reasons: [],
    });
  });
});

describe("설치 실패 갈래", () => {
  test("안전 모드, 관리자 잠금, 내용 바뀜, 폴더 문제를 가른다", () => {
    expect(installFailureOf(errorOf(wireError("extension.safeModeActive")))).toBe("safe_mode");
    expect(installFailureOf(issue("managed_locked: demo is locked"))).toBe("managed_locked");
    expect(installFailureOf(issue("source_changed: changed"))).toBe("source_changed");
    expect(installFailureOf(issue("invalid_input: source must be an absolute path"))).toBe(
      "invalid_input",
    );
    expect(installFailureOf(issue("not_absolute: source must be an absolute path"))).toBe(
      "not_absolute",
    );
    expect(installFailureOf(issue("no_manifest: .fresnel-plugin/plugin.json is missing"))).toBe(
      "no_manifest",
    );
    expect(installFailureOf(issue("not_found: manifest"))).toBe("not_found");
    expect(installFailureOf(issue("denied: builtin"))).toBe("denied");
    expect(installFailureOf({ kind: "offline" })).toBe("offline");
    expect(installFailureOf({ kind: "unsupported" })).toBe("unsupported");
    expect(installFailureOf({ kind: "not_available", command: "ext.install" })).toBe(
      "not_available",
    );
    expect(installFailureOf({ kind: "failed" })).toBe("other");
  });
});

describe("미리 보기 경고", () => {
  test("요청하지 않은 것은 경고가 없다", () => {
    expect(warningsOf(PREVIEW)).toEqual([]);
  });

  test("명령 실행, 인터넷, 파일, 도구 바꾸기, 신뢰 안 됨, 검사 경고를 이 순서로 낸다", () => {
    expect(
      warningsOf({
        ...PREVIEW,
        shell: ["workspace.shell"],
        network: ["web.fetch"],
        files: ["workspace.files"],
        tools: ["read_file"],
        trustRequest: "untrusted",
        warnings: [
          { severity: "warning", code: "AU-006", path: "/ui", message: "m" },
          { severity: "info", code: "AU-008", path: "/ui", message: "m" },
        ],
      }),
    ).toEqual([
      { kind: "shell" },
      { kind: "network" },
      { kind: "files" },
      { kind: "tools", tools: ["read_file"] },
      { kind: "untrusted" },
      { kind: "checks", count: 1 },
    ]);
  });
});

describe("설치 확인의 훅 목록", () => {
  const HOOKED: InstallPreview = {
    ...PREVIEW,
    hooks: ["boundary.settle.after", "tool.result", "tool.call.before", "weird.hook"],
  };

  test("훅마다 할 수 있는 일을 막기, 고치기, 보기, 알 수 없음으로 가르고 막을 수 있는 것을 앞에 둔다", () => {
    expect(hooksOf(HOOKED)).toEqual([
      { id: "tool.call.before", power: "block", blocksTools: true },
      { id: "tool.result", power: "modify", blocksTools: false },
      { id: "boundary.settle.after", power: "observe", blocksTools: false },
      { id: "weird.hook", power: "unknown", blocksTools: false },
    ]);
  });

  test("도구 호출을 막는 훅은 경고가 되어 권한 없음 문구를 대신한다", () => {
    expect(warningsOf(HOOKED)).toEqual([{ kind: "toolHooks", hooks: ["tool.call.before"] }]);
    expect(accessIsEmpty(HOOKED)).toBe(false);
  });

  test("도구를 막지 않는 훅만 있으면 경고가 없다", () => {
    const quiet = { ...PREVIEW, hooks: ["thread.switch.before", "tool.result"] };
    expect(hooksOf(quiet).map((h) => h.blocksTools)).toEqual([false, false]);
    expect(warningsOf(quiet)).toEqual([]);
    expect(accessIsEmpty(quiet)).toBe(true);
  });

  test("guard.tool.before도 도구를 막는다", () => {
    expect(warningsOf({ ...PREVIEW, hooks: ["guard.tool.before"] })).toEqual([
      { kind: "toolHooks", hooks: ["guard.tool.before"] },
    ]);
  });
});

describe("폴더 고르기", () => {
  test("고른 경로는 출처가 되고 취소는 그대로 두며 창 실패는 알린다", () => {
    expect(pickOutcomeOf(ok("/plugins/docs"))).toEqual({ kind: "source", source: "/plugins/docs" });
    expect(pickOutcomeOf(ok(undefined))).toEqual({ kind: "keep" });
    expect(pickOutcomeOf(err({ kind: "threw", cause: new Error("x") }))).toEqual({
      kind: "failed",
    });
  });
});

describe("화면과 다리 권한", () => {
  const withScreens: InstallPreview = {
    ...PREVIEW,
    screens: [
      {
        id: "all",
        title: "Perm all",
        placement: "page",
        mode: "app",
        capabilities: ["files", "notify", "settingsWrite", "secrets"],
      },
      {
        id: "tool",
        title: "Tool",
        placement: "page",
        mode: "app",
        capabilities: ["notify"],
      },
      { id: "plain", title: "Plain", placement: "page", mode: "native", capabilities: [] },
    ],
  };

  test("권한마다 한 줄로 모으고 시크릿, 설정 쓰기, 파일만 강조한다", () => {
    expect(bridgeAccessOf(withScreens)).toEqual([
      { capability: "secrets", strong: true, screens: ["Perm all"] },
      { capability: "settingsWrite", strong: true, screens: ["Perm all"] },
      { capability: "files", strong: true, screens: ["Perm all"] },
      { capability: "notify", strong: false, screens: ["Perm all", "Tool"] },
    ]);
  });

  test("선언이 없으면 비어 있고 확인 화면은 '요청 없음'을 보인다", () => {
    expect(bridgeAccessOf(PREVIEW)).toEqual([]);
    expect(accessIsEmpty(PREVIEW)).toBe(true);
    expect(accessIsEmpty(withScreens)).toBe(false);
  });
});

describe("설치 거절 사유", () => {
  test("엔진 사유는 코드와 자리만 남기고 검사기 원문 문장은 버린다", () => {
    expect(
      installReasonOf({
        code: "unknown_key",
        field: "plugins/0/hoks",
        line: 12,
        message: "must NOT have additional properties",
      }),
    ).toEqual({ key: "unknown_key", field: "plugins/0/hoks", line: 12 });
    expect(installReasonOf({ code: "folder_missing" })).toEqual({ key: "folder_missing" });
  });

  test("화면이 문장을 가진 코드는 그 코드를 쓰고, 모르는 코드는 other다", () => {
    expect(installReasonOf({ code: "name_reserved" })).toEqual({ key: "name_reserved" });
    expect(installReasonOf({ code: "hook_unknown", field: "plugins/0/hooks/2" })).toEqual({
      key: "other",
      field: "plugins/0/hooks/2",
    });
    expect(installReasonOf({ code: "AU-002" })).toEqual({ key: "other" });
  });

  test("사유는 거절된 명령 오류에서만 얻고, 그 밖에는 빈 목록이다", () => {
    const rejected = errorOf(
      wireError("jsonrpc.invalidParams", {
        details: {
          issues: [
            { path: "/source", message: "no_manifest: .fresnel-plugin/plugin.json is missing" },
          ],
          reasons: [{ code: "no_manifest" }],
        },
      }),
    );
    expect(installReasonsOf(rejected)).toEqual([{ key: "no_manifest" }]);
    expect(installReasonsOf(issue("not_found: manifest"))).toEqual([]);
    expect(installReasonsOf({ kind: "offline" })).toEqual([]);
  });
});

test("reasons that look the same on screen are listed once", () => {
  const error = {
    kind: "rejected",
    code: -32602,
    reasons: [
      { code: "unknown_key", field: "plugins/0/hoks", line: 4, message: "a" },
      { code: "unknown_key", field: "plugins/0/hoks", line: 4, message: "b" },
      { code: "version_invalid", message: "c" },
      { code: "hook_unknown", message: "d" },
    ],
  } as const;
  expect(installReasonsOf(error)).toEqual([
    { key: "unknown_key", field: "plugins/0/hoks", line: 4 },
    { key: "other" },
  ]);
});

test("a general rejection with reasons says the folder failed the check, not that the path is wrong", () => {
  const reasons = [{ key: "unknown_key", field: "entrie", line: 5 }] as const;
  expect(installFailureHeadOf("invalid_input", reasons)).toBe("checked");
  expect(installFailureHeadOf("other", reasons)).toBe("checked");
  expect(installFailureHeadOf("invalid_input", [])).toBe("invalid_input");
  expect(installFailureHeadOf("not_absolute", [{ key: "not_absolute" }])).toBe("not_absolute");
  expect(installFailureHeadOf("safe_mode", reasons)).toBe("safe_mode");
});
