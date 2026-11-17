import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "@fresnel/contracts";
import type { CommonSet, Profile, ProfilesFile } from "@fresnel/contracts/wire";
import {
  DEFAULT_PROFILE_ID,
  FACTORY_PERMISSION_MODE,
  PERMISSION_MODE_KEY,
} from "./profile-defaults.ts";

// `profiles.json` v1 → v2 옮김(M5c §7.2·§7.3). 순수 함수다. 파일 쓰기와 잠금은 `profile-store.ts`가 한다.
// §7.1(사용자 설정 파일의 `ext.<name>.enabled` 지우기)은 설정 저장소 쪽이라 이 옮김에 없다.

/** v1 프로필 한 개(옛 `profile-store.ts`가 쓴 모양). `enable`·`disable`이 있었다 */
export interface V1Profile {
  readonly id: string;
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable: readonly string[];
  readonly settings: readonly { readonly key: string; readonly value: unknown }[];
  readonly driver: string | null;
  readonly updatedAt: string;
  readonly rev: number;
}

/** v1 파일 전체. 검증은 `parse`가 한다 */
export interface V1ProfilesFile {
  readonly schemaVersion: 1;
  readonly profiles: readonly V1Profile[];
}

const V1ProfileShape = Type.Object({
  id: Type.String(),
  title: Type.String(),
  enable: Type.Array(Type.String()),
  disable: Type.Array(Type.String()),
  settings: Type.Array(Type.Object({ key: Type.String(), value: Type.Unknown() })),
  driver: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
  rev: Type.Integer({ minimum: 0 }),
});
const V1ProfilesFileShape = Type.Object({
  schemaVersion: Type.Literal(1),
  profiles: Type.Array(V1ProfileShape),
});
export const V1ProfilesFileSchema: TUnsafe<V1ProfilesFile> = Type.Unsafe<V1ProfilesFile>(
  V1ProfilesFileShape satisfies SchemaProof<V1ProfilesFile, typeof V1ProfilesFileShape>,
);

/** 사용자 설정과 카탈로그에서 옮김이 읽는 입력. 옮김 함수는 이것만 본다 */
export interface LegacyInputs {
  /** 사용자 범위의 `ext.<name>.enabled` 값(참·거짓). 값이 없는 플러그인은 여기 없다 */
  readonly userEnabled: ReadonlyMap<string, boolean>;
  /** 매니페스트 기본이 켜짐인 비코어 기본 설치 플러그인(값이 없을 때 켜짐으로 본다) */
  readonly defaultEnabled: readonly string[];
  /** 사용자 파일의 `l1.tools.permissionMode`. 없으면 `bypass` */
  readonly permissionMode: string | undefined;
  /** 프로필 범위가 허용하는 설정 키인가(`allowedScopes`에 `profile`) */
  readonly profileAllows: (key: string) => boolean;
}

/** 옮김 기록 한 줄(`migration.log`). 거절한 키와 버린 키를 남긴다 */
export interface MigrationEntry {
  readonly profileId: string;
  readonly plugins: number;
  readonly rejected: readonly string[];
  readonly droppedEnabledKeys: number;
  /** 이 항목을 옮기지 않은 사유. 옮겼으면 없다 */
  readonly skipped?: "collides_with_builtin";
}

export interface MigrationResult {
  readonly file: ProfilesFile;
  readonly log: readonly MigrationEntry[];
}

const ENABLED_KEY = /^ext\..+\.enabled$/u;

function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** 사용자 값이 켜짐인 플러그인과, 값이 없고 기본 켜짐인 플러그인을 모은다(§7.2) */
function legacyDefaultPlugins(legacy: LegacyInputs): readonly string[] {
  const candidates = unique([...legacy.defaultEnabled, ...legacy.userEnabled.keys()]);
  return candidates.filter((name) => {
    const value = legacy.userEnabled.get(name);
    return value === undefined ? legacy.defaultEnabled.includes(name) : value;
  });
}

function migrateProfile(
  profile: V1ProfilesFile["profiles"][number],
  defaults: readonly string[],
  legacy: LegacyInputs,
  now: string,
): { readonly profile: Profile; readonly entry: MigrationEntry } {
  // plugins = 옮긴 default.plugins ∪ enable − disable (§7.3)
  const base = unique([...defaults, ...profile.enable]).filter(
    (name) => !profile.disable.includes(name),
  );
  if (profile.driver !== null && !base.includes(profile.driver)) base.push(profile.driver);
  const rejected: string[] = [];
  let droppedEnabledKeys = 0;
  const settings: { key: string; value: unknown }[] = [];
  for (const setting of profile.settings) {
    if (ENABLED_KEY.test(setting.key)) {
      droppedEnabledKeys += 1;
      continue;
    }
    if (!legacy.profileAllows(setting.key)) {
      rejected.push(setting.key);
      continue;
    }
    settings.push({ key: setting.key, value: setting.value });
  }
  return {
    profile: {
      id: profile.id,
      title: profile.title,
      builtin: false,
      plugins: base.map((name) => ({ name })),
      settings,
      startDrive: profile.driver,
      updatedAt: now,
      rev: profile.rev,
    },
    entry: {
      profileId: profile.id,
      plugins: base.length,
      rejected,
      droppedEnabledKeys,
    },
  };
}

/**
 * v1 파일을 v2로 옮긴다. 내장 `default`는 항상 이 옮김으로 채운다(§7.2): 플러그인은 사용자 값 기준, 권한 모드는 사용자 파일 값 또는 `bypass`.
 * v1에 `default`라는 id가 있으면 내장과 겹치므로 그 항목은 옮기지 않고 기록에 남긴다.
 * 공통 묶음은 빈 값이다(rev 0 = 아직 쓴 적 없음).
 */
export function migrateV1(v1: V1ProfilesFile, legacy: LegacyInputs, now: string): MigrationResult {
  const defaults = legacyDefaultPlugins(legacy);
  const defaultProfile: Profile = {
    id: DEFAULT_PROFILE_ID,
    title: "default",
    builtin: true,
    plugins: defaults.map((name) => ({ name })),
    settings: [
      { key: PERMISSION_MODE_KEY, value: legacy.permissionMode ?? FACTORY_PERMISSION_MODE },
    ],
    startDrive: null,
    updatedAt: now,
    rev: 1,
  };
  const profiles: Profile[] = [defaultProfile];
  const log: MigrationEntry[] = [
    {
      profileId: DEFAULT_PROFILE_ID,
      plugins: defaults.length,
      rejected: [],
      droppedEnabledKeys: 0,
    },
  ];
  for (const profile of v1.profiles) {
    if (profile.id === DEFAULT_PROFILE_ID) {
      log.push({
        profileId: profile.id,
        plugins: 0,
        rejected: [],
        droppedEnabledKeys: 0,
        skipped: "collides_with_builtin",
      });
      continue;
    }
    const moved = migrateProfile(profile, defaults, legacy, now);
    profiles.push(moved.profile);
    log.push(moved.entry);
  }
  const common: CommonSet = { plugins: [], settings: [], updatedAt: now, rev: 0 };
  return { file: { schemaVersion: 2, common, profiles }, log };
}
