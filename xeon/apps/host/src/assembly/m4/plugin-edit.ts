import { err, ok, type Result } from "@fresnel/contracts";
import type { CommonSet, Profile, ProfileIssue, ProfileIssueCode } from "@fresnel/contracts/wire";
import type { PluginFact } from "./plugin-fact.ts";
import type { ProfileBody } from "./profile-validate.ts";

// 승인의 프로필 반영 계산(M5c §4.7.3). 순수 함수다: 저장 상태를 받아 바뀔 프로필과 오류만 돌려준다. 쓰기는 호출자가 한다.
// `add`는 대상 프로필 맨 뒤에 넣는다(이미 있으면 그대로). `remove`는 이름이 든 모든 프로필과 공통 묶음에서 그 이름과 그 플러그인의
// 설정, 시작 Drive를 뺀다(`profile.removePlugin`과 같은 규칙). `keep`(수정 승인)은 목록을 고치지 않고, 이름이 든 프로필을 새 사실로 검사만 한다.
// 검사는 바뀌거나 이름이 든 모든 대상 프로필과 공통 묶음에 `validateProfile`을 거친다. 오류가 하나라도 있으면 호출자는 아무것도 쓰지 않는다.

/** 승인 한 번의 프로필 변경 요청 */
export type PluginEditRequest =
  | {
      readonly kind: "add";
      /** 승인하는 플러그인의 사실(검토본이 있는 것으로 본다) */
      readonly plugin: PluginFact;
      /** 넣을 프로필 id. 비었으면 넣지 않는다(보관만) */
      readonly profileIds: readonly string[];
    }
  | { readonly kind: "keep"; readonly plugin: PluginFact }
  | { readonly kind: "remove"; readonly plugin: string };

/**
 * 검증 이슈 하나. 어느 프로필(또는 `common`)의 것인지 싣는다. `profile_not_found`는 승인 대상 프로필이 그 사이 지워졌다는 뜻이다(M5c §5)
 */
export type PluginEditIssue = {
  readonly profile: string;
  readonly code: ProfileIssueCode | "profile_not_found";
  readonly severity: "error";
  readonly plugin?: string;
  readonly key?: string;
  readonly other?: string;
  readonly tool?: string;
};

export interface PluginEditOutcome {
  /** 내용이 바뀐 프로필(새 개정 포함). 바뀌지 않으면 빈 목록이다 */
  readonly changed: readonly Profile[];
  /** 공통 묶음이 바뀌었으면 새 값, 아니면 null */
  readonly common: CommonSet | null;
}

/** 공통 묶음의 이슈에 붙이는 프로필 자리 값 */
export const COMMON_ID = "common";

const EMPTY_BODY: ProfileBody = { plugins: [], settings: [], driver: null };

function ownsKey(plugin: string, key: string): boolean {
  return key.startsWith(`ext.${plugin}.`);
}

/** 검증 이슈 하나를 승인 이슈로 옮긴다. 선택 칸은 있을 때만 싣는다(정확한 선택 속성 규칙) */
function editIssueOf(profile: string, issue: ProfileIssue): PluginEditIssue {
  return {
    profile,
    code: issue.code,
    severity: "error",
    ...(issue.plugin === undefined ? {} : { plugin: issue.plugin }),
    ...(issue.key === undefined ? {} : { key: issue.key }),
    ...(issue.other === undefined ? {} : { other: issue.other }),
    ...(issue.tool === undefined ? {} : { tool: issue.tool }),
  };
}

/** 검증 결과 가운데 저장을 막는 오류만 골라 어느 프로필의 것인지 붙인다 */
function errorsOf(profile: string, issues: readonly ProfileIssue[]): PluginEditIssue[] {
  return issues.flatMap((issue) =>
    issue.severity === "error" ? [editIssueOf(profile, issue)] : [],
  );
}

/**
 * 승인 한 번의 변경을 계산한다. 바뀌는 프로필과 공통 묶음을 새 값으로 만들고, 이름이 든 대상 프로필을 모두 검사한다.
 * `validate`는 프로필 검증 함수(`validateProfile`을 라이브러리·카탈로그에 묶은 것)다. 후보 플러그인은 호출자가 라이브러리에 넣는다.
 */
export function planPluginEdit(input: {
  /** 유효 프로필 목록(저장된 것 + 저장하지 않은 기본 공장 값) */
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
  readonly request: PluginEditRequest;
  readonly validate: (body: ProfileBody, common: CommonSet) => readonly ProfileIssue[];
  readonly updatedAt: string;
}): Result<
  PluginEditOutcome,
  { readonly kind: "plugin_invalid"; readonly issues: readonly PluginEditIssue[] }
> {
  const { request } = input;
  const name = request.kind === "remove" ? request.plugin : request.plugin.name;
  const bump = (profile: Profile, patch: Partial<Profile>): Profile => ({
    ...profile,
    ...patch,
    updatedAt: input.updatedAt,
    rev: profile.rev + 1,
  });
  const inCommon = input.common.plugins.some((ref) => ref.name === name);

  // 1. 바뀔 프로필과 검사할 프로필을 정한다. 목록 밖의 id는 승인 대상이 지워진 것이다(§5)
  const issues: PluginEditIssue[] = [];
  const edited = new Map<string, Profile>();
  let common = input.common;
  let commonChanged = false;

  if (request.kind === "add") {
    for (const id of new Set(request.profileIds)) {
      const profile = input.profiles.find((item) => item.id === id);
      if (profile === undefined) {
        issues.push({ profile: id, code: "profile_not_found", severity: "error" });
        continue;
      }
      const has = profile.plugins.some((ref) => ref.name === name);
      edited.set(id, has ? profile : bump(profile, { plugins: [...profile.plugins, { name }] }));
    }
  } else if (request.kind === "keep") {
    for (const profile of input.profiles) {
      if (profile.plugins.some((ref) => ref.name === name)) edited.set(profile.id, profile);
    }
  } else {
    for (const profile of input.profiles) {
      if (!profile.plugins.some((ref) => ref.name === name)) continue;
      edited.set(
        profile.id,
        bump(profile, {
          plugins: profile.plugins.filter((ref) => ref.name !== name),
          settings: profile.settings.filter((setting) => !ownsKey(name, setting.key)),
          driver: profile.driver === name ? null : profile.driver,
        }),
      );
    }
    if (inCommon) {
      common = {
        ...input.common,
        plugins: input.common.plugins.filter((ref) => ref.name !== name),
        settings: input.common.settings.filter((setting) => !ownsKey(name, setting.key)),
        updatedAt: input.updatedAt,
        rev: input.common.rev + 1,
      };
      commonChanged = true;
    }
  }

  // 2. 대상 프로필을 모두 검사한다. 공통 묶음이 바뀌었거나 이름이 든 공통 묶음이면 공통 묶음 자체도 본다
  if (issues.length === 0) {
    for (const profile of edited.values()) {
      const body: ProfileBody = {
        plugins: profile.plugins,
        settings: profile.settings,
        driver: profile.driver,
      };
      issues.push(...errorsOf(profile.id, input.validate(body, common)));
    }
    if (commonChanged || (request.kind === "keep" && inCommon)) {
      issues.push(...errorsOf(COMMON_ID, input.validate(EMPTY_BODY, common)));
    }
  }
  if (issues.length > 0) return err({ kind: "plugin_invalid", issues });

  // 3. 내용이 실제로 바뀐 프로필만 돌려준다. `add`의 이미 든 프로필과 `keep`은 바뀌지 않는다
  const changed = [...edited.values()].filter((profile) => {
    const stored = input.profiles.find((item) => item.id === profile.id);
    return stored !== profile;
  });
  return ok({ changed, common: commonChanged ? common : null });
}
