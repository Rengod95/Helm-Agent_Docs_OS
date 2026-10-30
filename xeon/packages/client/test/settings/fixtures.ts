import type { EffectiveSetting, SettingDefWire } from "@xeon/contracts/settings";

// 설정 view-model 시험의 입력 도우미. 정의는 와이어 형태(SettingDefWire)로 직접 쓴다.

const SCOPES_ALL: SettingDefWire["allowedScopes"] = [
  "managed",
  "user",
  "project",
  "local",
  "session",
];

/** 기본값이 채워진 와이어 정의. 시험마다 필요한 필드만 바꾼다 */
export function wireDef(
  input: Pick<SettingDefWire, "key" | "type"> & Partial<SettingDefWire>,
): SettingDefWire {
  return {
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: SCOPES_ALL,
    since: "0.1.0",
    ...input,
  };
}

/** 유효 값 하나. 기본 출처는 사용자 파일이다 */
export function effectiveOf(
  key: string,
  value: unknown,
  extra: Partial<EffectiveSetting> = {},
): EffectiveSetting {
  return {
    key,
    value,
    source: { scope: "user", path: "/home/user/.xeon/settings.json" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
    ...extra,
  };
}
