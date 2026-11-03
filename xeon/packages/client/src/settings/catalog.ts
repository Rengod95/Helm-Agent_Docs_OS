import type { SettingDefWire, SettingKey } from "@fresnel/contracts/settings";
import type { SettingOrigin } from "./types.ts";

// 두 원천의 정의 목록을 합친다(L4.settings-ui §4.1.3 규칙 1·2). 순수 함수다.

/** 데스크톱 로컬 설정 키의 접두사. 이 접두사의 키는 desktop 원천이다 */
const DESKTOP_KEY_PREFIX = "l4.desktop.";

export interface CatalogSources {
  /** `settings.list` 결과 */
  readonly engine: readonly SettingDefWire[];
  /** `localStore.defs()` 결과 */
  readonly desktop: readonly SettingDefWire[];
}

export interface MergedCatalog {
  readonly defs: ReadonlyMap<SettingKey, SettingDefWire>;
  readonly origins: ReadonlyMap<SettingKey, SettingOrigin>;
  /** 두 원천이 같은 키를 낸 키. 정의는 desktop 쪽을 쓴다 */
  readonly duplicateKeys: readonly SettingKey[];
}

/** 키 이름으로 원천을 정한다. 접두사가 `l4.desktop.`이면 desktop이다 */
function originOfKey(key: SettingKey): SettingOrigin {
  return key.startsWith(DESKTOP_KEY_PREFIX) ? "desktop" : "engine";
}

/**
 * 합집합. 같은 원천 안에서 같은 키가 두 번 오면 처음 것을 쓴다. 두 원천에 걸친 같은 키는 desktop 정의를 쓰고 `duplicateKeys`에 남긴다.
 */
export function mergeCatalogs(sources: CatalogSources): MergedCatalog {
  const defs = new Map<SettingKey, SettingDefWire>();
  const origins = new Map<SettingKey, SettingOrigin>();
  const desktopKeys = new Set<SettingKey>();
  const duplicates = new Set<SettingKey>();
  for (const def of sources.desktop) {
    if (defs.has(def.key)) continue;
    defs.set(def.key, def);
    origins.set(def.key, originOfKey(def.key));
    desktopKeys.add(def.key);
  }
  for (const def of sources.engine) {
    if (defs.has(def.key)) {
      if (desktopKeys.has(def.key)) duplicates.add(def.key);
      continue;
    }
    defs.set(def.key, def);
    origins.set(def.key, originOfKey(def.key));
  }
  return { defs, origins, duplicateKeys: [...duplicates].toSorted() };
}
