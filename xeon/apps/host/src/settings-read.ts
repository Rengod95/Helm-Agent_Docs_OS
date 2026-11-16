import { normalizeStoredMode, TOOLS_SETTING_KEYS } from "@fresnel/core-tools";
import {
  resolveSetting,
  type ScopeLayer,
  type ScopeStack,
  type SettingDef,
  type SettingKey,
} from "@fresnel/contracts/settings";

// 유효 값을 읽는 host 경로(settings.get·set·reset의 응답과 표시, 설정 읽기 포트, 확장의 설정 설명)가 엔진과 같은 값을 내게 하는 한 곳
// (dzPl §12-2). 저장된 권한 모드 `plan`은 은퇴했다. 엔진은 `normalizeStoredMode`로 `default`로 읽고 그 층에서 멈춘다. 이 규칙을 거치지
// 않으면 `resolveSetting`은 `plan`을 틀린 값으로 보고 그 층을 건너뛰어 다음 층 값을 보여 준다.
// 바꾼 층은 복사본이다. 저장소(층의 Map)는 바꾸지 않는다: 옛 `plan` 문자열은 파일에 그대로 남는다.

/** 키의 층 목록을 엔진이 읽는 값으로 바꾼다. 권한 모드 키의 옛 `plan`만 `default`가 되고 나머지 층과 키는 그대로다 */
function layersAsEngineReads(key: SettingKey, layers: ScopeStack): ScopeStack {
  if (key !== TOOLS_SETTING_KEYS.permissionMode) return layers;
  return layers.map((layer): ScopeLayer => {
    if (!layer.values.has(key)) return layer;
    const stored = layer.values.get(key);
    const mode = normalizeStoredMode(stored);
    if (mode === undefined || mode === stored) return layer;
    const values = new Map(layer.values);
    values.set(key, mode);
    return { ...layer, values };
  });
}

/** 설정 하나의 유효 값과 출처. `resolveSetting`을 엔진과 같은 층 읽기로 부른다 */
export function resolveEngineSetting(
  def: SettingDef,
  layers: ScopeStack,
): ReturnType<typeof resolveSetting> {
  return resolveSetting(def, layersAsEngineReads(def.key, layers));
}
