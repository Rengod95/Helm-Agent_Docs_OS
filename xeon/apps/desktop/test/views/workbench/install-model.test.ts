import { describe, expect, test } from "bun:test";
import type { InstallPreview } from "@fresnel/contracts/services";
import type { CommandError } from "../../../src/views/commands.ts";
import { errorOf } from "../../../src/app/command-error.ts";
import { wireError } from "@fresnel/contracts/wire";
import {
  INITIAL_INSTALL_FLOW,
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
    expect(installReduce(flow, { type: "installed", result })).toEqual({ step: "done", result });
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
