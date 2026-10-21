import { isCapabilityId, type CapabilityId } from "@xeon/contracts/capabilities";
import type { ExtensionName } from "@xeon/contracts/extensions";

/** 능력의 현재 바인딩 이름. 소비자가 inject하는 이름이다. 예: "cap:web.search" */
export function capabilityServiceName(id: CapabilityId): `cap:${string}` {
  return `cap:${id}`;
}

/** 공급자별 이름. 예: "cap:web.search@web-exa" */
export function providerServiceName(
  id: CapabilityId,
  provider: ExtensionName,
): `cap:${string}@${string}` {
  return `cap:${id}@${provider}`;
}

/** "xeon." 접두, "_" 접두, "cap:" 접두는 예약. 확장 코드가 직접 provide할 수 없다 */
export function isReservedServiceName(name: string): boolean {
  return name.startsWith("xeon.") || name.startsWith("_") || name.startsWith("cap:");
}

/** 매니페스트의 능력 id 문자열을 CapabilityId로 좁힌다. 형식이 틀린 항목은 뺀다(매니페스트 검증이 이미 막는다) */
export function toCapabilityIds(ids: readonly string[]): CapabilityId[] {
  return ids.filter((id): id is CapabilityId => isCapabilityId(id));
}
