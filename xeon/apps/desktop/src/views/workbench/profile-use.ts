// 플러그인 목록과 상세 머리의 "쓰는 곳"과 "프로필에 넣기" 메뉴의 순수 모델(AGE-74, AGE-76 plugMin).
// 플러그인을 켜고 끄는 것은 프로필에 넣고 빼는 것뿐이다. 프로필은 대화마다 하나 붙는다. 넣고 빼기는 리뷰를 거치지 않는다(설치가 이미 리뷰를 지났다).
// 데이터는 `profile.list`(숨은 프로필은 오지 않는다)다. 저장은 캔버스와 같은 `profile.put`, 빼기는 `profile.removePlugin`이다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { Profile, ProfileInput, ProfileListResult } from "@fresnel/contracts/wire";

/** 프로필 목록과 공통 묶음(모든 대화에 얹힌다)의 플러그인 이름 */
export interface ProfileSet {
  readonly profiles: readonly Profile[];
  readonly common: readonly string[];
}

export function profileSetOf(result: ProfileListResult): ProfileSet {
  return {
    profiles: result.profiles.filter((profile) => profile.hidden !== true),
    common: result.common.plugins.map((ref) => ref.name),
  };
}

/** 쓰는 곳: 모든 대화(앱 핵심이나 공통 묶음), 프로필 N개, 어느 프로필에도 없음 */
export type ProfileUse =
  | { readonly kind: "all" }
  | { readonly kind: "profiles"; readonly count: number }
  | { readonly kind: "none" };

export function profileUseOf(name: string, appCore: boolean, set: ProfileSet): ProfileUse {
  if (appCore || set.common.includes(name)) return { kind: "all" };
  const count = set.profiles.filter((profile) => inProfile(profile, name)).length;
  return count === 0 ? { kind: "none" } : { kind: "profiles", count };
}

export function profileUseText(use: ProfileUse): string {
  switch (use.kind) {
    case "all":
      return t("desktop.workbench.use.all");
    case "profiles":
      return t("desktop.workbench.use.profiles", { count: use.count });
    case "none":
      return t("desktop.workbench.use.none");
    default:
      return assertNever(use, "ProfileUse");
  }
}

export function inProfile(profile: Pick<Profile, "plugins">, name: string): boolean {
  return profile.plugins.some((ref) => ref.name === name);
}

/** 프로필에 플러그인 하나를 끝에 넣은 저장 값. 이름, 설정, 시작 Drive는 저장된 그대로다. 이미 있으면 그대로 둔다 */
export function withPlugin(profile: Profile, name: string): ProfileInput {
  return {
    id: profile.id,
    title: profile.title,
    plugins: inProfile(profile, name) ? profile.plugins : [...profile.plugins, { name }],
    settings: profile.settings,
    startDrive: profile.startDrive,
  };
}
