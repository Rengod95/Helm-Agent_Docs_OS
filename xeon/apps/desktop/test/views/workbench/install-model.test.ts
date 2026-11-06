import { describe, expect, test } from "bun:test";
import type { InstallPreview } from "@fresnel/contracts/services";
import type { CommandError } from "../../../src/views/commands.ts";
import { errorOf } from "../../../src/app/command-error.ts";
import { wireError } from "@fresnel/contracts/wire";
import { err, ok } from "@fresnel/contracts";
import type { ExtInstallResult } from "@fresnel/contracts/wire";
import {
  accessIsEmpty,
  applyInstalled,
  bridgeAccessOf,
  INITIAL_INSTALL_FLOW,
  pickOutcomeOf,
  installDoneOf,
  installFailureOf,
  installReduce,
  warningsOf,
  type InstallFlow,
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
    expect(flow).toEqual({ step: "confirm", preview: PREVIEW, failure: null });
    flow = installReduce(flow, { type: "installStart" });
    expect(flow).toEqual({ step: "installing", preview: PREVIEW });
    const result = {
      name: "docs-bundle",
      version: "1.2.0",
      location: "/ext/docs-bundle",
      appliesAt: "restart",
    } as const;
    expect(installReduce(flow, { type: "installed", result, reloadFailure: null })).toEqual({
      step: "done",
      result,
      reloadFailure: null,
    });
  });

  test("빈 출처는 읽지 않고, 읽기 실패는 출처 입력으로 돌아가 이유를 남긴다", () => {
    expect(installReduce(INITIAL_INSTALL_FLOW, { type: "previewStart" })).toEqual(
      INITIAL_INSTALL_FLOW,
    );
    const reading: InstallFlow = { step: "previewing", source: "/x" };
    expect(installReduce(reading, { type: "previewFailed", failure: "not_found" })).toEqual({
      step: "source",
      source: "/x",
      failure: "not_found",
    });
  });

  test("설치 실패는 확인 화면에 남고, 뒤로 가면 출처 입력이다", () => {
    const installing: InstallFlow = { step: "installing", preview: PREVIEW };
    const failed = installReduce(installing, { type: "installFailed", failure: "source_changed" });
    expect(failed).toEqual({ step: "confirm", preview: PREVIEW, failure: "source_changed" });
    expect(installReduce(failed, { type: "back" })).toEqual({
      step: "source",
      source: "/plugins/docs-bundle",
      failure: null,
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
    expect(installFailureOf(issue("not_found: manifest"))).toBe("not_found");
    expect(installFailureOf(issue("denied: builtin"))).toBe("denied");
    expect(installFailureOf({ kind: "offline" })).toBe("offline");
    expect(installFailureOf({ kind: "unsupported" })).toBe("unsupported");
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

const INSTALLED: ExtInstallResult = {
  name: "docs-bundle",
  version: "1.2.0",
  location: "/ext/docs-bundle",
  appliesAt: "nextStepBoundary",
  needsReload: true,
};

describe("설치 뒤 교체 적용", () => {
  test("nextStepBoundary이면 그 이름으로 ext.reload를 한 번 부르고 성공이면 실패 없음이다", async () => {
    const calls: string[] = [];
    const failure = await applyInstalled((name) => {
      calls.push(name);
      return Promise.resolve(ok(null));
    }, INSTALLED);
    expect(calls).toEqual(["docs-bundle"]);
    expect(failure).toBeNull();
  });

  test("새 이름의 경계 대기(needsReload 없음)와 restart와 now이면 reload를 부르지 않는다", async () => {
    const calls: string[] = [];
    const reload = (name: string): Promise<ReturnType<typeof ok<null>>> => {
      calls.push(name);
      return Promise.resolve(ok(null));
    };
    const { needsReload: _drop, ...waiting } = INSTALLED;
    expect(await applyInstalled(reload, { ...waiting, appliesAt: "restart" })).toBeNull();
    expect(await applyInstalled(reload, { ...waiting, appliesAt: "now" })).toBeNull();
    expect(await applyInstalled(reload, waiting)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("reload가 거절되면 오류 갈래를 돌려주고 흐름 끝에 남는다", async () => {
    const failure = await applyInstalled(
      () => Promise.resolve(err<CommandError>({ kind: "offline" })),
      INSTALLED,
    );
    expect(failure).toBe("offline");
    const flow = installReduce(
      { step: "installing", preview: PREVIEW },
      { type: "installed", result: INSTALLED, reloadFailure: failure },
    );
    expect(flow).toEqual({ step: "done", result: INSTALLED, reloadFailure: "offline" });
  });
});

describe("설치 결과의 갈래", () => {
  const base: ExtInstallResult = { ...INSTALLED };
  test("now는 목록에 바로 올랐고 경계 대기는 다음 단계부터다", () => {
    expect(installDoneOf({ ...base, appliesAt: "now" })).toEqual({ kind: "listed" });
    expect(installDoneOf(base)).toEqual({ kind: "boundary" });
    expect(installDoneOf({ ...base, appliesAt: "restart" })).toEqual({ kind: "restart" });
  });

  test("싣기에 실패하면 이유와 첫 오류 진단 문장을 보인다", () => {
    const failed = (reason: "safe_mode" | "disabled" | "rejected" | "loader_unavailable") => ({
      ...base,
      appliesAt: "restart" as const,
      loadFailure: {
        reason,
        diagnostics: [
          { severity: "warning" as const, code: "w", message: "warned" },
          { severity: "error" as const, code: "entry_import_failed", message: "cannot import" },
        ],
      },
    });
    expect(installDoneOf(failed("rejected"))).toEqual({
      kind: "notLoaded",
      reason: "error",
      detail: "cannot import",
    });
    expect(installDoneOf(failed("safe_mode"))).toEqual({
      kind: "notLoaded",
      reason: "safe_mode",
      detail: "cannot import",
    });
    expect(installDoneOf(failed("disabled"))).toMatchObject({ reason: "disabled" });
    expect(installDoneOf(failed("loader_unavailable"))).toEqual({ kind: "restart" });
    expect(
      installDoneOf({
        ...base,
        appliesAt: "restart",
        loadFailure: { reason: "error", diagnostics: [] },
      }),
    ).toEqual({ kind: "notLoaded", reason: "error", detail: null });
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
