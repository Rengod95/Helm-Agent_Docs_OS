import type { ProfileIssue } from "@fresnel/contracts/wire";
import { PROFILE_LIMITS } from "@fresnel/contracts/wire";
import type { SettingScope } from "@fresnel/contracts/settings";

// 프로필 검증(M5c §4.2.7). 순수 함수다: 저장 상태와 카탈로그·라이브러리 조회만 받고 아무것도 쓰지 않는다.
// 저장(`profile.put`·`profile.common.put`·`profile.removePlugin`)과 미리 보기(`profile.preview`)가 같은 함수를 쓴다.
// 오류(`error`)가 하나라도 있으면 저장을 막는다. 경고는 저장하고 알린다. 시크릿 값은 이슈에도 싣지 않는다.

/** 라이브러리가 가진 플러그인 한 줄. 설치 여부와 검토 상태, 매니페스트에서 읽은 사실이다 */
export interface ProfileLibraryEntry {
  readonly name: string;
  /** 현재 검토본이 있는가. 없으면 `plugin_not_reviewed` */
  readonly reviewed: boolean;
  /** `PluginDecl.replaces`: 이 플러그인이 대체하는 내장 도구 이름 */
  readonly replaces: readonly string[];
  /** 시작 Drive 항목(`does.drive.start`)이 있는가 */
  readonly drives: boolean;
  /** 필요한 기능이 목록 안에 없어 켜지지 못하는가(Registration `waiting`) */
  readonly unmet: boolean;
  /** 값이 없으면 대화에서 `config_required`로 멈추는 필수 설정 키 */
  readonly requiredKeys: readonly string[];
}

/** 설치된 플러그인 조회. 없는 이름은 `undefined`다 */
export interface ProfileLibrary {
  lookup(name: string): ProfileLibraryEntry | undefined;
}

/** 설정 키 하나의 카탈로그 정보. 쓰기 검사(`checkSettingWrite`)와 같은 기준이다 */
export interface ProfileSettingInfo {
  readonly key: string;
  readonly allowedScopes: readonly SettingScope[];
  /** 시크릿 키(`SecretRef`만 받는다) */
  readonly secret: boolean;
  /** `ext.<name>.<key>`의 소유 플러그인 이름. 코어 키는 null */
  readonly owner: string | null;
  /** 값 검사. `secret_literal`은 시크릿 키에 `secret://` 참조가 아닌 값을 준 경우다 */
  checkValue(
    value: unknown,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: "invalid" | "secret_literal" };
}

export interface ProfileCatalog {
  lookup(key: string): ProfileSettingInfo | undefined;
  /** 시크릿 이름(`secret://` 뒤)이 저장소에 있는가 */
  secretExists(name: string): boolean;
  /** 관리 범위가 이 플러그인의 켜짐(`ext.<name>.enabled`)을 거짓으로 잠갔는가 */
  managedDisabled(plugin: string): boolean;
}

/** 검증 입력의 모양. 저장된 프로필과 입력 프로필이 모두 맞는다 */
export interface ProfileBody {
  readonly plugins: readonly { readonly name: string }[];
  readonly settings: readonly { readonly key: string; readonly value: unknown }[];
  readonly startDrive: string | null;
}

/** 공통 묶음의 모양. 시작 Drive가 없다 */
export interface CommonBody {
  readonly plugins: readonly { readonly name: string }[];
  readonly settings: readonly { readonly key: string; readonly value: unknown }[];
}

const SECRET_PREFIX = "secret://";

/** 공통 묶음과 프로필을 합친 플러그인 순서(§4.1.3): 공통이 먼저, 중복은 처음 것을 남긴다 */
function resolvedPluginNames(profile: CommonBody, common: CommonBody): readonly string[] {
  const seen = new Set<string>();
  for (const ref of [...common.plugins, ...profile.plugins]) seen.add(ref.name);
  return [...seen];
}

/** 같은 키가 여러 번 나오면 마지막 값이 이기고, 처음 자리를 쓴다(§4.2.9) */
function collapsedSettings(
  settings: readonly { readonly key: string; readonly value: unknown }[],
): { readonly key: string; readonly value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const setting of settings) {
    const at = out.findIndex((item) => item.key === setting.key);
    if (at === -1) out.push({ key: setting.key, value: setting.value });
    else out[at] = { key: setting.key, value: setting.value };
  }
  return out;
}

/**
 * 프로필 하나와 공통 묶음을 검증한다(§4.2.7). 해소된 목록(E의 플러그인 부분)과 그 안의 설정을 본다.
 * 공통 묶음만 검증할 때는 빈 프로필을 넘긴다.
 */
export function validateProfile(
  profile: ProfileBody,
  common: CommonBody,
  library: ProfileLibrary,
  catalog: ProfileCatalog,
): readonly ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const names = resolvedPluginNames(profile, common);
  const resolved = new Set(names);
  const settings = collapsedSettings([...common.settings, ...profile.settings]);

  if (
    profile.plugins.length > PROFILE_LIMITS.plugins ||
    profile.settings.length > PROFILE_LIMITS.settings
  ) {
    issues.push({ code: "limit", severity: "error" });
  }

  const entries = new Map<string, ProfileLibraryEntry>();
  for (const name of names) {
    const entry = library.lookup(name);
    if (entry === undefined) {
      issues.push({ code: "plugin_unknown", severity: "error", plugin: name });
      continue;
    }
    entries.set(name, entry);
    if (!entry.reviewed)
      issues.push({ code: "plugin_not_reviewed", severity: "error", plugin: name });
    if (catalog.managedDisabled(name)) {
      issues.push({ code: "managed_forbidden", severity: "warning", plugin: name });
    }
    if (entry.unmet) issues.push({ code: "requirement_unmet", severity: "warning", plugin: name });
  }

  // 내장 도구 대체는 해소된 목록 안에서 같은 도구를 두 플러그인이 대체하면 충돌이다(§4.2.7)
  const replacedBy = new Map<string, string>();
  for (const name of names) {
    const entry = entries.get(name);
    if (entry === undefined) continue;
    for (const tool of entry.replaces) {
      const first = replacedBy.get(tool);
      if (first === undefined) replacedBy.set(tool, name);
      else
        issues.push({
          code: "replace_conflict",
          severity: "error",
          plugin: name,
          other: first,
          tool,
        });
    }
  }

  if (profile.startDrive !== null) {
    if (!resolved.has(profile.startDrive)) {
      issues.push({ code: "driver_not_in_list", severity: "error", plugin: profile.startDrive });
    } else {
      const entry = entries.get(profile.startDrive);
      if (entry !== undefined && !entry.drives) {
        issues.push({ code: "driver_cannot_drive", severity: "error", plugin: profile.startDrive });
      }
    }
  }

  for (const setting of settings) {
    const info = catalog.lookup(setting.key);
    if (info === undefined) {
      issues.push({ code: "setting_unknown_key", severity: "error", key: setting.key });
      continue;
    }
    if (info.owner !== null && !resolved.has(info.owner)) {
      // 소유 플러그인이 목록에 없는 키는 저장할 수 없다(§4.2.2)
      issues.push({ code: "setting_unknown_key", severity: "error", key: setting.key });
      continue;
    }
    if (!info.allowedScopes.includes("profile")) {
      issues.push({ code: "setting_scope_not_allowed", severity: "error", key: setting.key });
      continue;
    }
    const checked = info.checkValue(setting.value);
    if (!checked.ok) {
      issues.push({
        code: checked.reason === "secret_literal" ? "secret_literal" : "setting_invalid_value",
        severity: "error",
        key: setting.key,
      });
      continue;
    }
    if (info.secret && typeof setting.value === "string") {
      const secretName = setting.value.slice(SECRET_PREFIX.length);
      if (!catalog.secretExists(secretName)) {
        issues.push({ code: "secret_missing", severity: "warning", key: setting.key });
      }
    }
  }

  for (const name of names) {
    const entry = entries.get(name);
    if (entry === undefined) continue;
    for (const key of entry.requiredKeys) {
      if (!settings.some((setting) => setting.key === key)) {
        issues.push({ code: "required_unset", severity: "warning", plugin: name, key });
      }
    }
  }

  return issues;
}

/** 이슈 가운데 저장을 막는 오류가 있는가 */
export function hasBlockingIssue(issues: readonly ProfileIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
