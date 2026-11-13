import type { ExtensionUnit } from "@fresnel/ext-host";
import {
  createGuideGroup,
  createGuideReader,
  GUIDE_GROUP_NAME,
  locateGuideSkills,
  type GuideReader,
} from "@fresnel/group-guide";

// 가이드 그룹 `guide`(L3.guide.spec)를 내장 그룹으로 싣는다. 기본은 꺼짐이고 개발 모드(`l3.authoring.devMode`)에서는 항상 켜진다([결정: 2026-11-13 사용자]).
// 그룹이 모델에게 내는 것은 스킬뿐이다: 켜져 있으면 가이드 폴더를 확장 제공 스킬 루트로 `cap-knowledge`에 싣고, 꺼져 있으면 아무것도 싣지 않아 문맥 비용이 0이다.
// 같은 폴더를 플러그인 빌더의 `authoring_guide`도 읽는다(가이드 그룹이 꺼져 있어도). 조립 루트 코드(DR-14 예외 2).

/** 가이드 그룹을 싣는가. 기본 그룹을 끄거나(`defaultGroups: false`) 안전 모드면 싣지 않는다(안전 모드는 확장 기여를 모두 뺀다) */
export function guideLoaded(options: {
  readonly defaultGroups: boolean | undefined;
  readonly safeMode: boolean | undefined;
}): boolean {
  return options.defaultGroups !== false && options.safeMode !== true;
}

export interface GuideWiring {
  /** 가이드 읽기. 가이드 폴더를 못 찾으면 undefined */
  readonly reader: GuideReader | undefined;
  /** 가이드 폴더(스킬 루트). 못 찾으면 undefined */
  readonly dir: string | undefined;
  /** 가이드를 모델에게 내보일 때인가: 개발 모드이거나 `ext.guide.enabled`가 참. 스킬 루트를 읽을 때마다 부른다 */
  readonly active: () => boolean;
}

export function guideWiringOf(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly resourceDir: string;
  readonly devMode: () => boolean;
  readonly enabledSetting: () => boolean;
}): GuideWiring {
  const dir = locateGuideSkills(options.env, options.resourceDir);
  return {
    reader: dir === undefined ? undefined : createGuideReader(dir),
    dir,
    active: () => options.devMode() || options.enabledSetting(),
  };
}

/** `cap-knowledge`에 알리는 확장 제공 스킬 루트. 꺼져 있으면 빈 목록이다 */
export function guideSkillRoots(
  wiring: GuideWiring,
): readonly { readonly dir: string; readonly extension: string }[] {
  return wiring.dir !== undefined && wiring.active()
    ? [{ dir: wiring.dir, extension: GUIDE_GROUP_NAME }]
    : [];
}

export function guideUnit(loadIndex: number): ExtensionUnit {
  const module = createGuideGroup();
  return { manifest: module.manifest, entry: module.entry, loadIndex, builtin: true };
}
