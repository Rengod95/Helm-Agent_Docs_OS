import type { ExtensionManifest, PluginDecl } from "@fresnel/contracts/extensions";
import type { GroupManifest } from "../../src/index.ts";

export interface GroupManifestInput {
  readonly name: string;
  /** 루트 플러그인(L3)의 on 지점 목록 */
  readonly hooks?: PluginDecl["hooks"];
  readonly usesPost?: boolean;
  /** 루트 플러그인이 drive를 등록하는가. 생략하면 선언하지 않는다 */
  readonly drives?: boolean;
  readonly defaultEnabled?: boolean;
  readonly recordKinds?: PluginDecl["recordKinds"];
  readonly readsRecordKinds?: PluginDecl["readsRecordKinds"];
  readonly requires?: PluginDecl["requires"];
  readonly builtin?: boolean;
}

/** validateManifest를 통과하는 그룹 매니페스트. 루트 L3 플러그인 하나와 빈 group 선언을 쓴다 */
export function groupManifestOf(input: GroupManifestInput): GroupManifest {
  return {
    schemaVersion: 2,
    name: input.name,
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L3",
        hooks: input.hooks ?? [],
        ...(input.drives === true ? { drives: true } : {}),
        ...(input.usesPost === undefined ? {} : { usesPost: input.usesPost }),
        ...(input.recordKinds === undefined ? {} : { recordKinds: input.recordKinds }),
        ...(input.readsRecordKinds === undefined
          ? {}
          : { readsRecordKinds: input.readsRecordKinds }),
        ...(input.requires === undefined ? {} : { requires: input.requires }),
      },
    ],
    group: {},
    ...(input.defaultEnabled === undefined ? {} : { defaultEnabled: input.defaultEnabled }),
    ...(input.builtin === false ? {} : { trust: { level: "builtin" } }),
  };
}

/** 그룹이 아닌 외부 플러그인 매니페스트. group 선언도 L3 루트도 없다. validateManifest는 통과한다 */
export function pluginManifestOf(name: string): ExtensionManifest {
  return {
    schemaVersion: 2,
    name,
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: [] }],
  };
}
