import { resolveSetting, type SettingCatalog } from "@fresnel/contracts/settings";
import type { LoaderSettingsSource } from "@fresnel/ext-host";
import type { SettingsEngine } from "./settings-engine.ts";

// 로더의 설정 읽기(X.loading-trust §4.5, §4.9.0)를 엔진 설정으로 채운다. 로더는 확장을 싣는 동안 예약 키(`ext.<이름>.enabled`,
// `ext.<이름>.isolation`)와 사용자 정의 키를 카탈로그에 아직 넣지 않았을 수 있다(`registerExtensionKeys`는 적재 뒤에 부른다).
// 그래서 키가 카탈로그에 없으면 사용자 파일에 적힌 값을 읽는다. 조립 루트 코드(DR-14 예외 2).

export type ExtSettingsSource = Omit<LoaderSettingsSource, "defaultProjectTrust">;

export function extSettingsOf(
  catalog: SettingCatalog,
  settings: SettingsEngine,
): ExtSettingsSource {
  // 카탈로그에 있으면 유효 값(정의 기본 포함), 없으면 사용자 파일의 값
  const effective = (key: string): unknown =>
    catalog.has(key) ? settings.value(key) : settings.userValues().get(key);
  return {
    // 잠금 값만 준다: 관리 범위가 거짓으로 잠근 경우만 `false`다. 매니페스트 기본(`defaultEnabled: false`)과 사용자 값은
    // 잠금이 아니다. 켜짐은 대화별 E(T)가 정한다(M5c §4.1.10). 키가 카탈로그에 아직 없으면 사용자 파일 값을 본다(예전 동작)
    enabled: (name) => {
      const key = `ext.${name}.enabled`;
      const def = catalog.get(key);
      if (def === undefined) {
        const value = settings.userValues().get(key);
        return typeof value === "boolean" ? value : undefined;
      }
      const { setting } = resolveSetting(def, settings.layers(undefined));
      return setting.source.scope === "managed" && setting.value === false ? false : undefined;
    },
    // 필수 사용자 설정이 채워졌는가: 값이 있고 빈 문자열이 아니다
    hasValue: (key) => {
      const value = effective(key);
      return value !== undefined && value !== "";
    },
    // 명시 값만 본다. 정의 기본(매니페스트 또는 process)은 세지 않는다. 명시 여부가 포트가 없을 때의 동작(명시면 거부, 기본이면 엔진 안)을 가른다
    isolation: (name) => {
      const value = settings.userValues().get(`ext.${name}.isolation`);
      return value === "none" || value === "process" ? value : undefined;
    },
    settingValue: (key) => effective(key),
  };
}
