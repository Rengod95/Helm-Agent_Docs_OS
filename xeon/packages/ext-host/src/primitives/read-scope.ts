import type { ExtensionManifest } from "@xeon/contracts/extensions";

/** 확장이 쓰는 kind 접두: 그룹은 `grp.<이름>.`, 플러그인은 `x.<이름>.` */
export function ownKindPrefix(manifest: Pick<ExtensionManifest, "kind" | "name">): string {
  return manifest.kind === "group" ? `grp.${manifest.name}.` : `x.${manifest.name}.`;
}

/**
 * 자기 접두 kind이거나 매니페스트 `readsRecordKinds`가 덮으면 읽을 수 있다(X.primitives.spec §4.6.4).
 * 끝의 `*`는 접두 일치다. 그룹 사이 이벤트 격리(§4.9)는 이 규칙 하나다
 */
export function isKindReadable(
  manifest: Pick<ExtensionManifest, "kind" | "name" | "readsRecordKinds">,
  kind: string,
): boolean {
  if (kind.startsWith(ownKindPrefix(manifest))) return true;
  return (manifest.readsRecordKinds ?? []).some((declared) =>
    declared.endsWith("*") ? kind.startsWith(declared.slice(0, -1)) : declared === kind,
  );
}
