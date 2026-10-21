import type { ExtensionName } from "@xeon/contracts/extensions";
import type { InstallSource } from "./trust/levels.ts";

/** 내장 층 순서. L0 플랫폼 플러그인은 이 파이프라인 밖에서 먼저 등록된다(X.loading-trust.spec §4.2.3) */
export const BUILTIN_LAYER_ORDER: readonly ["L1", "L2", "L3", "plugin"] = [
  "L1",
  "L2",
  "L3",
  "plugin",
];

const SOURCE_ORDER: readonly ["builtin", "managed", "user", "project"] = [
  "builtin",
  "managed",
  "user",
  "project",
];

export interface OrderKey {
  readonly source: InstallSource;
  /** 내장만 쓴다. 외부는 0 */
  readonly layerIndex: number;
  readonly name: ExtensionName;
}

/** 코드 포인트 순 비교. 로케일에 기대지 않는다 */
function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 순수 함수. 입력 순서와 무관하게 같은 결과를 낸다. 음수면 a가 먼저 */
export function compareLoadOrder(a: OrderKey, b: OrderKey): number {
  const bySource = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
  if (bySource !== 0) return bySource;
  const byLayer = a.layerIndex - b.layerIndex;
  if (byLayer !== 0) return byLayer;
  return compareCodePoints(a.name, b.name);
}

export function orderManifests<T extends { readonly key: OrderKey }>(
  items: readonly T[],
): readonly T[] {
  return items.toSorted((a, b) => compareLoadOrder(a.key, b.key));
}
