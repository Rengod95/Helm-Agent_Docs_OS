import type { ExtensionUnit } from "@fresnel/ext-host";
import {
  createGuideOrchestration,
  createGuideReader,
  GUIDE_ORCHESTRATION_NAME,
  locateGuideSkills,
  type GuideReader,
} from "@fresnel/plugin-guide";

// 가이드 그룹 `guide`(L3.guide.spec)를 내장 그룹으로 싣는다. 기본은 꺼짐이다. 대화가 쓰는 프로필이 넣었거나(M5c §4.1, E(T)),
// 개발 모드(`l3.authoring.devMode`)이면 모든 대화에서 켜진 채 잠긴다([결정: 2026-11-13 사용자]).
// 그룹이 모델에게 내는 것은 스킬뿐이다: 대화의 켜짐 집합에 있으면 가이드 폴더를 확장 제공 스킬 루트로 `cap-knowledge`에 싣고, 없으면 아무것도 싣지 않아 문맥 비용이 0이다.
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
  /** 개발 모드인가: 설정 `l3.authoring.devMode`가 참이거나 Fresnel을 개발 실행으로 띄웠다(`devRunOf`). 켜진 채 잠긴다 */
  readonly forced: () => boolean;
  /**
   * 가이드를 모델에게 내보일 때인가: 개발 모드이거나 이 대화의 켜짐 집합(E(T))에 가이드가 있다. 대화가 없으면 개발 모드만 본다.
   * 스킬 루트를 읽을 때마다 부른다
   */
  readonly active: (threadId: string | undefined) => boolean;
}

/**
 * Fresnel 자체를 개발 실행으로 띄웠는가. 환경 변수 `FRESNEL_DEV=1`이다(CLI의 개발 빌드 판별과 같은 이름, `apps/cli/src/dev-mode.ts`).
 * 데스크톱 셸은 묶지 않은 개발 사이드카(`just desktop-run`)를 띄울 때 이 값을 넘긴다. 소스 실행(`bun`)을 따로 알아채지 않는다:
 * 시험도 소스에서 돌아 구분되지 않기 때문이다
 */
function devRunOf(env: Readonly<Record<string, string | undefined>>): boolean {
  return env["FRESNEL_DEV"] === "1";
}

export function guideWiringOf(options: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly resourceDir: string;
  readonly devMode: () => boolean;
  /** 이 대화의 켜짐 집합에 가이드 그룹이 있는가(조립이 E(T)를 읽어 준다) */
  readonly inSet: (threadId: string | undefined) => boolean;
}): GuideWiring {
  const forced = (): boolean => options.devMode() || devRunOf(options.env);
  const dir = locateGuideSkills(options.env, options.resourceDir);
  return {
    reader: dir === undefined ? undefined : createGuideReader(dir),
    dir,
    forced,
    active: (threadId) => forced() || options.inSet(threadId),
  };
}

/** `cap-knowledge`에 알리는 확장 제공 스킬 루트. 이 대화에서 꺼져 있으면 빈 목록이다 */
export function guideSkillRoots(
  wiring: GuideWiring,
  threadId: string | undefined,
): readonly { readonly dir: string; readonly extension: string }[] {
  return wiring.dir !== undefined && wiring.active(threadId)
    ? [{ dir: wiring.dir, extension: GUIDE_ORCHESTRATION_NAME }]
    : [];
}

/** `ext.list`의 `forcedOn`: 가이드 그룹은 개발 모드에서 켜진 채 잠긴다 */
export function guideForcedOn(wiring: GuideWiring, name: string): "devMode" | null {
  return name === GUIDE_ORCHESTRATION_NAME && wiring.forced() ? "devMode" : null;
}

export function guideUnit(loadIndex: number): ExtensionUnit {
  const module = createGuideOrchestration();
  return { manifest: module.manifest, entry: module.entry, loadIndex, builtin: true };
}
