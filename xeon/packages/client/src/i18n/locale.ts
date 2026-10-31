import { isLocale, type Locale } from "./catalog.ts";

// ADR-0016 §3.3. `ui.locale` 값과 OS 로케일에서 쓸 로케일을 고른다.

export type LocaleEnv = Readonly<Record<string, string | undefined>>;

function localeOfTag(tag: string): Locale | undefined {
  const language = tag.toLowerCase().split(/[._@-]/, 1)[0] ?? "";
  return isLocale(language) ? language : undefined;
}

/**
 * OS 로케일 단서. `LC_ALL`, `LC_MESSAGES`, `LANG` 중 처음 값이 있는 것을 본다(`C`와 `POSIX`는 단서가 아니다).
 * 단서가 없으면 undefined이고, 지원하지 않는 언어면 `en`이다
 */
export function osLocaleHint(env: LocaleEnv): Locale | undefined {
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name];
    if (value === undefined || value === "" || value === "C" || value === "POSIX") continue;
    return localeOfTag(value) ?? "en";
  }
  return undefined;
}

/**
 * `ui.locale` 값(`auto`, `ko`, `en`, 또는 없음)을 로케일로 바꾼다. `auto`는 OS 단서를 따르고 단서가 없으면 undefined다
 * (부른 쪽이 지금 로케일을 그대로 둔다). 지원하지 않는 값은 `en`이다
 */
export function resolveLocale(setting: string | undefined, env: LocaleEnv): Locale | undefined {
  if (setting === undefined || setting === "auto") return osLocaleHint(env);
  return isLocale(setting) ? setting : "en";
}
