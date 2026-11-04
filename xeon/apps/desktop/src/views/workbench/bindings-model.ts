// 기능 연결(B-05, `ext.bindings`)의 행 모델. 받을 곳이 없는 기능(미충족)을 맨 앞에 두고, 나머지는 기능 id 순서다.
import type { CapabilityBinding } from "@fresnel/contracts/wire";

export interface BindingRowVM {
  readonly capability: string;
  /** 지금 바인딩한 공급자 `<등록 id> <버전>`. 없으면 null */
  readonly provider: string | null;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly unmet: boolean;
}

export function bindingRowsOf(capabilities: readonly CapabilityBinding[]): readonly BindingRowVM[] {
  const rows = capabilities.map((binding): BindingRowVM => ({
    capability: binding.capability,
    provider:
      binding.provider === null
        ? null
        : `${binding.provider.registrationId} ${binding.provider.version}`,
    requires: binding.consumers
      .filter((c) => c.relation === "requires")
      .map((c) => c.registrationId),
    optional: binding.consumers
      .filter((c) => c.relation === "optional")
      .map((c) => c.registrationId),
    unmet: binding.unmet,
  }));
  return rows.toSorted(
    (a, b) => Number(b.unmet) - Number(a.unmet) || a.capability.localeCompare(b.capability),
  );
}

export function unmetCountOf(rows: readonly BindingRowVM[]): number {
  return rows.filter((row) => row.unmet).length;
}
