import type { PortKey } from "@xeon/contracts/extensions";

/**
 * 그룹 설정의 유효 값 읽기. 조립 루트(L4 host)가 설정 서비스에 연결해 넘긴다
 * (L3.group-kit.spec §3.13 마지막 문단 [가정], X.primitives.spec §3.2의 PrimitivesSettingsSource와 같은 방식).
 * 서비스 이름은 F.wire-settings가 정하기 전까지 이 파일의 키가 자리를 맡는다. 실제 연결은 HOST 조립에서 한다.
 */
export interface GroupSettingsSource {
  /** 설정 키(`l3.helm.driveLimits` 같은 전체 키)의 유효 값. 모르는 키는 undefined */
  value(key: string): unknown;
}

export const GroupSettingsSourceKey: PortKey<GroupSettingsSource> = { name: "xeon.settings" };
