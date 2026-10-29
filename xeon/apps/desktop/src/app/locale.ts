import {
  activeLocale,
  resolveLocale,
  setActiveLocale,
  UI_LOCALE_KEY,
  type Locale,
} from "@xeon/client/i18n";
import { detach } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";

// 표시 언어(ADR-0016 §3.3). 엔진에 연결하기 전에는 `l4.ui.locale`을 읽을 수 없으므로 WebView의 언어 단서
// (`navigator.languages`)로 첫 렌더 전 로케일을 정하고, 연결된 뒤 설정 값으로 바로잡는다.

/** WebView 언어 단서(`ko-KR` 같은 BCP 47 태그, 우선순위 순) */
export type LanguageHints = readonly string[];

/** 설정 값과 언어 단서에서 로케일을 고른다. 값이 `auto`이거나 없고 단서도 없으면 `en`이다 */
export function localeOf(setting: unknown, hints: LanguageHints): Locale {
  const hint = hints[0];
  return resolveLocale(typeof setting === "string" ? setting : undefined, { LC_ALL: hint }) ?? "en";
}

export interface LocaleSync {
  /** 설정 값(`l4.ui.locale`)을 반영한다. 로케일이 바뀌었으면 `onChange`를 부른다 */
  apply(setting: unknown): void;
  /** 새 연결에서 설정 값을 읽고 `settings.invalidated`를 구독한다. 반환값은 구독 해제. 읽기 실패는 현재 로케일을 둔다 */
  follow(connection: HostConnection, onFailure: (cause: unknown) => void): () => void;
}

/** 첫 렌더 전에 부른다: 언어 단서로 현재 로케일을 먼저 정한다 */
export function startLocale(hints: LanguageHints, onChange: (locale: Locale) => void): LocaleSync {
  setActiveLocale(localeOf(undefined, hints));
  const apply = (setting: unknown): void => {
    const next = localeOf(setting, hints);
    if (next === activeLocale()) return;
    setActiveLocale(next);
    onChange(next);
  };
  const read = async (connection: HostConnection): Promise<void> => {
    const got = await connection.request("settings.get", { keys: [UI_LOCALE_KEY] });
    apply(got.settings.find((s) => s.key === UI_LOCALE_KEY)?.value);
  };
  return {
    apply,
    follow(connection, onFailure) {
      detach(read(connection), onFailure);
      return connection.onNotification("settings.invalidated", (params) => {
        if (params.keys.length === 0 || params.keys.includes(UI_LOCALE_KEY))
          detach(read(connection), onFailure);
      });
    },
  };
}
