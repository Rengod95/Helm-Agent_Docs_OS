import type { LocalSettingsPort, LocalWrite, LocalWriteFailure } from "@fresnel/client/settings";
import {
  toSettingDefWire,
  type EffectiveSetting,
  type SettingDef,
  type SettingDefWire,
  type SettingKey,
} from "@fresnel/contracts/settings";
import type { TSchema } from "typebox";
import { DESKTOP_SETTING_DEFS } from "./defs.ts";
import { LOCAL, type LocalKey, type LocalSettings } from "./local.ts";

// 데스크톱 로컬 저장소를 설정 화면의 로컬 원천 포트로 바꾼다(L4.settings-ui §4.1.3, L4.desktop.spec §3.6).
// 화면에 보이는 키는 `defs.ts`가 선언한 키다. 선언마다 `LOCAL`의 같은 키가 있어야 읽고 쓸 수 있다.
// 창 자리, 검색 안내, 원격 대상 목록은 상태 값이라 여기 없다(정의가 없으므로 화면에 보이지 않는다).

interface Entry {
  readonly def: SettingDef;
  readonly local: LocalKey<TSchema>;
}

const LOCAL_KEYS: ReadonlyMap<string, LocalKey<TSchema>> = new Map(
  Object.values(LOCAL).map((local): [string, LocalKey<TSchema>] => [local.key, local]),
);

const ENTRIES: readonly Entry[] = DESKTOP_SETTING_DEFS.flatMap((def) => {
  const local = LOCAL_KEYS.get(def.key);
  return local === undefined ? [] : [{ def, local }];
});

const WIRE_DEFS: readonly SettingDefWire[] = ENTRIES.map((entry) => toSettingDefWire(entry.def));

const UNKNOWN_KEY: LocalWriteFailure = { ok: false, kind: "settings.unknownKey", details: {} };
const INVALID_VALUE: LocalWriteFailure = { ok: false, kind: "settings.invalidValue", details: {} };
const STORAGE: LocalWriteFailure = { ok: false, kind: "storage", details: {} };

function entryOf(key: SettingKey): Entry | undefined {
  return ENTRIES.find((entry) => entry.def.key === key);
}

/** 유효 값. 저장한 값이 있으면 출처는 사용자 파일이고, 없으면 선언의 기본값이다 */
function effectiveOf(entry: Entry, stored: unknown): EffectiveSetting {
  const saved = stored !== undefined;
  return {
    key: entry.def.key,
    value: saved ? stored : (entry.def.default ?? null),
    source: { scope: saved ? "user" : "default" },
    locked: false,
    shadowed: [],
    runtimeChange: entry.def.runtimeChange,
    pendingUntil: null,
    deprecated: false,
  };
}

/**
 * 로컬 설정 저장소를 포트로 바꾼다. 쓰기 실패는 포트의 종류로 옮긴다: 검사 실패는 `settings.invalidValue`,
 * 파일 쓰기 실패는 `storage`다. 저장에 성공한 변경은 `onChange` 청취자에게 알린다.
 */
export function createLocalSettingsPort(
  local: Pick<LocalSettings, "get" | "set">,
): LocalSettingsPort {
  const listeners = new Set<(setting: EffectiveSetting) => void>();

  async function save(entry: Entry, value: unknown): Promise<LocalWrite> {
    const saved = await local.set(entry.local, value);
    if (!saved.ok) return saved.error.kind === "invalid" ? INVALID_VALUE : STORAGE;
    const setting = effectiveOf(entry, value);
    for (const listener of listeners) listener(setting);
    return { ok: true, setting };
  }

  return {
    defs: () => WIRE_DEFS,
    get(key) {
      const entry = entryOf(key);
      return entry === undefined ? undefined : effectiveOf(entry, local.get(entry.local));
    },
    async set(key, value) {
      const entry = entryOf(key);
      return entry === undefined ? UNKNOWN_KEY : save(entry, value);
    },
    async reset(key) {
      const entry = entryOf(key);
      if (entry === undefined) return UNKNOWN_KEY;
      // 파일에서 키를 지우는 명령이 없어서 기본값을 쓴다. 그래서 출처는 사용자 파일이 된다(L4.desktop.spec §3.6)
      const fallback = entry.def.default;
      return fallback === undefined ? INVALID_VALUE : save(entry, fallback);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
