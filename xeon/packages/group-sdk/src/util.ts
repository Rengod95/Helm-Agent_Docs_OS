import type { ExtensionManifest, PluginDecl } from "@fresnel/contracts/extensions";

/** 키로 읽을 수 있는 객체인가(배열과 null 제외) */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 그룹의 L3 오케스트레이션 플러그인: id가 없는 루트 플러그인 가운데 `layer: "L3"`인 것.
 * defineGroup이 이 플러그인의 Registration(id = 확장 이름) 하나를 만든다. 그룹 id와 Registration id가 같게 하려고
 * 루트만 인정한다(L3.group-sdk.spec §3.3)
 */
export function orchestrationOf(
  manifest: Pick<ExtensionManifest, "plugins">,
): PluginDecl | undefined {
  return manifest.plugins.find((plugin) => plugin.id === undefined && plugin.layer === "L3");
}
