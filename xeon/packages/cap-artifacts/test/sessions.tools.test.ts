import { describe, expect, test } from "bun:test";
import type { ScopeLayer } from "@xeon/contracts/settings";
import { sessionRenamePolicy } from "../src/plugin.ts";
import { readArtifactsSettings } from "../src/settings.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

// session_rename은 설정 `l2.artifacts.tools.sessionRename`이 켜진 때만 도구로 올라간다(기본 꺼짐).
describe("session_rename registration", () => {
  test("the tool is not advertised by default", () => {
    expect(sessionRenamePolicy(readArtifactsSettings([]))).toBeUndefined();
  });

  test("a user setting of true advertises it with the read risk", () => {
    const settings = readArtifactsSettings([
      layer("user", { "l2.artifacts.tools.sessionRename": true }),
    ]);
    expect(sessionRenamePolicy(settings)).toEqual({ session_rename: { risk: "read" } });
  });

  test("an explicit false keeps it hidden", () => {
    const settings = readArtifactsSettings([
      layer("user", { "l2.artifacts.tools.sessionRename": false }),
    ]);
    expect(sessionRenamePolicy(settings)).toBeUndefined();
  });
});
