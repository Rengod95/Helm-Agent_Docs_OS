import {
  pluginsOf,
  validateManifest,
  type ExtensionManifest,
  type PluginEntry,
} from "../../src/extensions/index.ts";
import { Bug } from "../../src/index.ts";

/**
 * 올바른 외부 플러그인 매니페스트 JSON(플러그인 하나, `group` 없음). 첫째 인자는 확장 수준 필드,
 * 둘째 인자는 루트 플러그인(`plugins[0]`)의 필드를 덮어쓴다
 */
export function pluginJson(
  overrides: Readonly<Record<string, unknown>> = {},
  pluginOverrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name: "acme-notes",
    version: "1.0.0",
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: [], ...pluginOverrides }],
    ...overrides,
  };
}

/** 올바른 플러그인 그룹 매니페스트 JSON(L3 루트 플러그인 하나, `group: {}`). 인자 뜻은 pluginJson과 같다 */
export function groupJson(
  overrides: Readonly<Record<string, unknown>> = {},
  pluginOverrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return pluginJson(
    { name: "learning", group: {}, ...overrides },
    { layer: "L3", ...pluginOverrides },
  );
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

/** 매니페스트의 `index`번째 플러그인 항목(validateUsage 입력). 없으면 Bug */
export function pluginAt(manifest: ExtensionManifest, index: number): PluginEntry {
  const entry = pluginsOf(manifest)[index];
  if (entry === undefined) throw new Bug(`fixture manifest has no plugin at index ${index}`);
  return entry;
}
