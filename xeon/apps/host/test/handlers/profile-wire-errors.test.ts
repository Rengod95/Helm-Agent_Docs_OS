import { expect, test } from "bun:test";
import {
  wireError,
  type ProfileIssue,
  type WireError,
  type WireErrorKind,
} from "@fresnel/contracts/wire";
import {
  wireErrorOfProfile,
  type ProfilePortFailure,
} from "../../src/handlers/m4/profile-test-run.ts";

// 포트 실패를 와이어 오류로 옮기는 표. 각 실패는 계약의 kind와 코드로 나와야 한다(F.wire-settings.spec §3.5.2).

function kindOf(error: WireError): string {
  return error.data.kind;
}

test("every ProfilePortFailure maps to the contract kind and code", () => {
  const cases: readonly [ProfilePortFailure, WireErrorKind][] = [
    [{ kind: "not_found", id: "x" }, "profile.notFound"],
    [{ kind: "conflict", id: "x", rev: 2, baseRev: 1 }, "profile.conflict"],
    [{ kind: "corrupt", path: "/p", reason: "schema" }, "profile.fileCorrupt"],
    [{ kind: "limit", max: 200 }, "profile.limit"],
    [{ kind: "builtin_protected", id: "default" }, "profile.builtinProtected"],
    [
      { kind: "invalid", issues: [{ code: "plugin_unknown", severity: "error", plugin: "x" }] },
      "profile.invalid",
    ],
    [{ kind: "plugin_not_in_profile", plugin: "x" }, "profile.pluginNotInProfile"],
    [{ kind: "common_plugin", plugin: "x" }, "profile.commonPlugin"],
  ];
  for (const [failure, kind] of cases) {
    const mapped = wireErrorOfProfile(failure);
    expect(kindOf(mapped)).toBe(kind);
    expect(mapped.code).toBe(wireError(kind).code);
  }
});

test("an io failure of the file is store.io and carries only the code", () => {
  const mapped = wireErrorOfProfile({
    kind: "io",
    path: "/secret/path/profiles.json",
    code: "EACCES",
  });
  expect(kindOf(mapped)).toBe("store.io");
  expect(JSON.stringify(mapped.data)).not.toContain("/secret/path");
});

test("the invalid details carry at most 64 issues", () => {
  const many: ProfileIssue[] = Array.from({ length: 80 }, () => ({
    code: "plugin_unknown",
    severity: "error",
    plugin: "x",
  }));
  const mapped = wireErrorOfProfile({ kind: "invalid", issues: many });
  expect(kindOf(mapped)).toBe("profile.invalid");
  const issues = mapped.data.details?.["issues"];
  expect(Array.isArray(issues) ? issues.length : -1).toBe(64);
});
