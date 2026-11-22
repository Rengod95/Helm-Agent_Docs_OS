import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import type { DeclaredInventory } from "./profile-cost.ts";

// 플러그인 하나의 매니페스트 사실(M5c §4.2.7). 프로필 검증 라이브러리가 쓴다. 설치된 확장과 승인 중인 후보가 같은 모양이다.

/** 플러그인 하나의 매니페스트 사실. 라이브러리가 검증에 쓴다 */
export interface PluginFact {
  readonly name: string;
  /** 매니페스트의 `version`. 다른 플러그인의 `range`를 이 값으로 검사한다 */
  readonly version: string;
  /** 매니페스트 전체. 의존(`dependsOn`)과 구성원을 여기서 읽는다 */
  readonly manifest: ExtensionManifest;
  /** 대체하는 내장 도구(`PluginDecl.replaces`를 모두 모은 것) */
  readonly replaces: readonly string[];
  /** 시작 Drive를 등록할 수 있는가(`PluginDecl.drives`) */
  readonly drives: boolean;
  /** 필수 설정 키(`userConfig`의 `required` 항목) */
  readonly requiredKeys: readonly string[];
  /** 선언된 재료(도구, 지침, 스킬). 비용과 도구 변화의 근거다(M5c §4.2.8) */
  readonly declared: DeclaredInventory;
}

/** 매니페스트에서 사실을 뽑는다. 설치된 확장과 검토 후보가 같은 함수를 쓴다. `root`는 재료 파일이 놓인 폴더다 */
export function pluginFactOf(manifest: ExtensionManifest, root: string): PluginFact {
  const plugins = manifest.plugins ?? [];
  return {
    name: manifest.name,
    version: manifest.version,
    manifest,
    replaces: plugins.flatMap((plugin) => plugin.replaces ?? []),
    drives: plugins.some((plugin) => plugin.drives === true),
    requiredKeys: Object.values(manifest.userConfig ?? {})
      .filter((entry) => entry.required === true)
      .map((entry) => entry.setting),
    declared: {
      code: manifest.entry !== undefined,
      root,
      tools: manifest.tools ?? [],
      instructions: manifest.components?.instructions ?? [],
      skills: manifest.components?.skills ?? [],
    },
  };
}
