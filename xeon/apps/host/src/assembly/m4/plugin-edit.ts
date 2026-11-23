import { err, ok, type Result } from "@fresnel/contracts";
import type {
  CommonSet,
  PluginRef,
  Profile,
  ProfileIssue,
  ProfileIssueCode,
  ProfilePlan,
} from "@fresnel/contracts/wire";
import type { PluginFact } from "./plugin-fact.ts";
import { previousOf, type ProfileBody, type ProfilePrevious } from "./profile-validate.ts";

// 승인의 프로필 반영 계산(M5c §4.7.3). 순수 함수다: 저장 상태를 받아 바뀔 프로필과 오류만 돌려준다. 쓰기는 호출자가 한다.
// `add`는 대상 프로필 맨 뒤에 넣는다(이미 있으면 그대로). `plan`(합치기·떼기, AGE-72)이 있으면 대상 프로필마다 `planned`의 자리에 넣고 원래 플러그인을 뺀다.
// `profileIds`에 `COMMON_ID`가 있으면 공통 묶음 맨 뒤에 넣는다(이미 있으면 그대로). 공통 묶음에는 `plan`을 적용하지 않는다.
// `remove`는 이름이 든 모든 프로필과 공통 묶음에서 그 이름과 그 플러그인의
// 설정, 시작 Drive를 뺀다(`profile.removePlugin`과 같은 규칙). `keep`(수정 승인)은 목록을 고치지 않고, 이름이 든 프로필을 새 사실로 검사만 한다.
// 검사는 바뀌거나 이름이 든 모든 대상 프로필과 공통 묶음에 `validateProfile`을 거친다. 오류가 하나라도 있으면 호출자는 아무것도 쓰지 않는다.
// 대상 프로필이 저장 전에도 가리키던, 지금은 없는 플러그인은 오류가 아니라 경고다(`missingPlugins`로 돌려준다, AGE-34).

/** 승인 한 번의 프로필 변경 요청 */
export type PluginEditRequest =
  | {
      readonly kind: "add";
      /** 승인하는 플러그인의 사실(검토본이 있는 것으로 본다) */
      readonly plugin: PluginFact;
      /** 넣을 프로필 id. 비었으면 넣지 않는다(보관만). `COMMON_ID`면 공통 묶음에 넣는다 */
      readonly profileIds: readonly string[];
      /** 합치기·떼기 계획. 없으면 대상 프로필 맨 뒤에 넣는다 */
      readonly plan?: ProfilePlan;
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
  /** 대상 프로필이 이미 가리키던, 지금은 이 기기에 없는 플러그인(경고만 한다, AGE-34). 없으면 빈 목록이다 */
  readonly missingPlugins: readonly string[];
}

/** 공통 묶음의 이슈에 붙이는 프로필 자리 값 */
export const COMMON_ID = "common";

const EMPTY_BODY: ProfileBody = { plugins: [], settings: [], startDrive: null };

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
  readonly validate: (
    body: ProfileBody,
    common: CommonSet,
    previous: ProfilePrevious,
  ) => readonly ProfileIssue[];
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
  /** 계획을 대상 프로필 하나에 적용한다. 바뀌지 않으면 같은 프로필을 돌려준다(새 판이 아니다) */
  const planned = (profile: Profile, fact: PluginFact, plan: ProfilePlan): Profile => {
    // 새 플러그인 자신은 뺄 대상이 아니다(계획에 같은 이름이 들어 있어도)
    const outs = new Set(plan.swapOut.filter((item) => item !== fact.name));
    const kept = profile.plugins.filter((ref) => !outs.has(ref.name));
    // 자리: 뺄 것 가운데 가장 앞선 자리, 없으면 `placeAfter` 바로 뒤, 그것도 없으면 맨 뒤
    const first = profile.plugins.findIndex((ref) => outs.has(ref.name));
    const after =
      plan.placeAfter === null ? -1 : kept.findIndex((ref) => ref.name === plan.placeAfter);
    const at = first !== -1 ? first : after !== -1 ? after + 1 : kept.length;
    // 이미 든 이름은 자리를 옮기지 않고 한 번만 둔다
    const plugins: readonly PluginRef[] = kept.some((ref) => ref.name === fact.name)
      ? kept
      : [...kept.slice(0, at), { name: fact.name }, ...kept.slice(at)];
    const settings = profile.settings.filter(
      (setting) => ![...outs].some((out) => ownsKey(out, setting.key)),
    );
    const moves =
      profile.startDrive !== null &&
      (outs.has(profile.startDrive) || profile.startDrive === plan.driveFrom);
    const startDrive = moves ? (fact.drives ? fact.name : null) : profile.startDrive;
    const unchanged =
      plugins.length === profile.plugins.length &&
      plugins.every((ref, index) => ref.name === profile.plugins[index]?.name) &&
      settings.length === profile.settings.length &&
      startDrive === profile.startDrive;
    return unchanged ? profile : bump(profile, { plugins, settings, startDrive });
  };

  // 1. 바뀔 프로필과 검사할 프로필을 정한다. 목록 밖의 id는 승인 대상이 지워진 것이다(§5)
  const issues: PluginEditIssue[] = [];
  const edited = new Map<string, Profile>();
  let common = input.common;
  let commonChanged = false;

  if (request.kind === "add") {
    const plan = request.plan;
    for (const id of new Set(request.profileIds)) {
      // 공통 묶음에 넣기: 모든 대화에 얹힌다. 이미 든 이름이면 아무것도 바꾸지 않는다
      if (id === COMMON_ID) {
        if (!inCommon) {
          common = {
            ...input.common,
            plugins: [...input.common.plugins, { name }],
            updatedAt: input.updatedAt,
            rev: input.common.rev + 1,
          };
          commonChanged = true;
        }
        continue;
      }
      const profile = input.profiles.find((item) => item.id === id);
      if (profile === undefined) {
        issues.push({ profile: id, code: "profile_not_found", severity: "error" });
        continue;
      }
      const has = profile.plugins.some((ref) => ref.name === name);
      if (plan !== undefined) {
        edited.set(id, planned(profile, request.plugin, plan));
      } else {
        edited.set(id, has ? profile : bump(profile, { plugins: [...profile.plugins, { name }] }));
      }
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
          startDrive: profile.startDrive === name ? null : profile.startDrive,
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
  const missing = new Set<string>();
  const collect = (found: readonly ProfileIssue[]): void => {
    for (const issue of found) {
      if (
        issue.code === "plugin_unknown" &&
        issue.severity === "warning" &&
        issue.plugin !== undefined
      )
        missing.add(issue.plugin);
    }
  };
  if (issues.length === 0) {
    for (const profile of edited.values()) {
      const body: ProfileBody = {
        plugins: profile.plugins,
        settings: profile.settings,
        startDrive: profile.startDrive,
      };
      // "이미 있던 것"은 저장 전의 같은 프로필과 공통 묶음으로 가린다(없으면 전부 새 항목)
      const stored = input.profiles.find((item) => item.id === profile.id);
      const found = input.validate(body, common, previousOf(stored, input.common));
      issues.push(...errorsOf(profile.id, found));
      collect(found);
    }
    if (commonChanged || (request.kind === "keep" && inCommon)) {
      const found = input.validate(EMPTY_BODY, common, previousOf(undefined, input.common));
      issues.push(...errorsOf(COMMON_ID, found));
      collect(found);
    }
  }
  if (issues.length > 0) return err({ kind: "plugin_invalid", issues });

  // 3. 내용이 실제로 바뀐 프로필만 돌려준다. `add`의 이미 든 프로필과 `keep`은 바뀌지 않는다
  const changed = [...edited.values()].filter((profile) => {
    const stored = input.profiles.find((item) => item.id === profile.id);
    return stored !== profile;
  });
  return ok({ changed, common: commonChanged ? common : null, missingPlugins: [...missing] });
}
