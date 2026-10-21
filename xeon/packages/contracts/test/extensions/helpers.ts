import { validateManifest, type ExtensionManifest } from "../../src/extensions/index.ts";
import { Bug } from "../../src/index.ts";

/** 올바른 플러그인 매니페스트 JSON. 테스트가 필드를 덮어써 쓴다 */
export function pluginJson(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "acme-notes",
    version: "1.0.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    ...overrides,
  };
}

/** 올바른 그룹 매니페스트 JSON */
export function groupJson(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return pluginJson({ name: "learning", layer: "L3", kind: "group", ...overrides });
}

/** 검증을 통과한 매니페스트를 돌려준다. 실패하면 Bug */
export function validManifest(input: Readonly<Record<string, unknown>>): ExtensionManifest {
  const result = validateManifest(input);
  if (result.manifest === undefined) {
    throw new Bug(`fixture manifest is invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.manifest;
}

/** 이슈 코드만 모은다 */
export function codesOf(issues: readonly { readonly code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}
