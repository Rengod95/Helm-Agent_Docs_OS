/**
 * 설정의 유효 값 읽기. ExtHost가 `fresnel.settings` 포트(`SETTINGS_READ_PORT`, `@fresnel/ext-host`)로 내고
 * 조립 루트가 설정 엔진을 연결한다(L3.group-sdk.spec §3.13 마지막 문단).
 */
export interface OrchestrationSettingsSource {
  /** 설정 키(`l3.helm.driveLimits` 같은 전체 키)의 유효 값. 모르는 키는 undefined */
  value(key: string): unknown;
}
