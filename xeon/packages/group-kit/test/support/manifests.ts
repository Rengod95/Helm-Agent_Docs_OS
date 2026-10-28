import type { ExtensionManifest } from "@xeon/contracts/extensions";
import type { GroupManifest } from "../../src/index.ts";

export interface GroupManifestInput {
  readonly name: string;
  readonly points?: ExtensionManifest["points"];
  readonly usesPost?: boolean;
  readonly usesDrive?: boolean;
  readonly defaultEnabled?: boolean;
  readonly recordKinds?: ExtensionManifest["recordKinds"];
  readonly readsRecordKinds?: ExtensionManifest["readsRecordKinds"];
  readonly requires?: ExtensionManifest["requires"];
  readonly builtin?: boolean;
}

/** validateManifest를 통과하는 그룹 매니페스트 */
export function groupManifestOf(input: GroupManifestInput): GroupManifest {
  return {
    schemaVersion: 1,
    name: input.name,
    version: "0.1.0",
    layer: "L3",
    kind: "group",
    entry: "./src/index.ts",
    points: input.points ?? [],
    usesDrive: input.usesDrive ?? false,
    ...(input.usesPost === undefined ? {} : { usesPost: input.usesPost }),
    ...(input.defaultEnabled === undefined ? {} : { defaultEnabled: input.defaultEnabled }),
    ...(input.recordKinds === undefined ? {} : { recordKinds: input.recordKinds }),
    ...(input.readsRecordKinds === undefined ? {} : { readsRecordKinds: input.readsRecordKinds }),
    ...(input.requires === undefined ? {} : { requires: input.requires }),
    ...(input.builtin === false ? {} : { trust: { level: "builtin" } }),
  };
}
