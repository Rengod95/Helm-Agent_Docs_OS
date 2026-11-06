import { reservedExtensionSettings, settingsFromManifest } from "@fresnel/ext-host";
import type { SettingDef, SettingKey } from "@fresnel/contracts/settings";
import type { ExtensionRecord } from "./m4/ext-read-port.ts";

// 확장마다 예약 키(`ext.<이름>.enabled`)를 카탈로그에 올린다(X.loading-trust §4.5.2). 카탈로그는 시작할 때 코어 그룹으로만 만들어지므로
// 내장 단위와 설치한 외부 확장의 키는 여기서 늦게 더한다. 키가 없으면 `settings.set`이 `settings.unknownKey`로 거절해
// 확장 화면의 켜기·끄기 스위치가 모두 실패했다. 이미 있는 키(helm 등 코어가 올린 것)는 건드리지 않는다. 조립 루트 코드(DR-14 예외 2).

/** 기록에 있는 확장의 예약 키 중 카탈로그에 없는 것을 더한다. 더한 키 수를 돌려준다 */
export function registerExtensionKeys(
  catalog: Map<SettingKey, SettingDef>,
  records: readonly ExtensionRecord[],
): number {
  let added = 0;
  for (const record of records) {
    // 매니페스트가 선언한 userConfig 키(`settingsFromManifest`): 사용자 플러그인의 설정 읽기·쓰기가 쓰는 정의다
    for (const def of settingsFromManifest(record.manifest).defs) {
      if (catalog.has(def.key)) continue;
      catalog.set(def.key, def);
      added += 1;
    }
    if (catalog.has(`ext.${record.manifest.name}.enabled`)) continue;
    for (const def of reservedExtensionSettings(record.manifest, record.origin).defs) {
      if (catalog.has(def.key)) continue;
      catalog.set(def.key, def);
      added += 1;
    }
  }
  return added;
}
