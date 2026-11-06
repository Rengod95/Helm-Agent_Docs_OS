import {
  checkProviderId,
  firstRunView,
  providerSecretName,
  type FirstRunSearch,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import type { WebRecommendation } from "@fresnel/client";
import { assertNever, parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { ModelEntry } from "@fresnel/contracts/wire";
import type { DefaultGroupId, GroupsSnapshot, SearchSnapshot } from "../../commands.ts";

// 첫 실행 화면(P-01)의 순수 모델. 단계 목록, 완료 여부, 다음 단계, 대화 시작 가능 여부, 기본 그룹 행을 값으로 만든다.
// 입력은 명령이 읽은 결과다. 키 값은 이 모델에 들어오지 않는다(시크릿 이름과 참조만 다룬다).

export type StepId = "tools" | "key" | "model" | "search" | "groups";

/** 화면에 보이는 순서. 검색 권장 다음에 기본 그룹이 온다(L4.desktop-ux §6.5) */
export const STEP_ORDER: readonly StepId[] = ["tools", "key", "model", "search", "groups"];

/** 건너뛸 수 있는 단계. 대화를 시작하는 조건(`readyToChat`)에 들지 않는다 */
const OPTIONAL_STEPS: ReadonlySet<StepId> = new Set<StepId>(["search", "groups"]);

/**
 * 기본 그룹 켜짐의 기본값. Helm과 학습 그룹의 매니페스트 `defaultEnabled`가 참이다(L3.helm.spec §3.1, L3.learning.spec §3.1).
 * 설정 값을 쓴 적이 없으면 이 값이다.
 */
const GROUP_DEFAULT_ON = true;

/** 기본 그룹 단계가 켜고 끄는 그룹(화면에서 Switch로 보인다) */
const DEFAULT_GROUP_IDS: readonly DefaultGroupId[] = ["helm", "learning"];

/**
 * 기본 그룹 행. Helm과 학습은 Switch로 켜고 끈다. `review`는 기본으로 꺼져 있고 이 화면에서 바꾸지 않는다
 * (켜기 키가 정해지지 않았다). 판별 필드 `switchable`로 그린다.
 */
export type GroupRow =
  | { readonly id: DefaultGroupId; readonly on: boolean; readonly switchable: true }
  | { readonly id: "review"; readonly on: false; readonly switchable: false };

/** 그룹 행의 id. Helm, 학습, review 가운데 하나다 */
export type GroupRowId = GroupRow["id"];

/** 화면이 그리는 첫 실행 상태. 설정을 읽는 중, 못 읽음, 오프라인, 읽음 */
export type FirstRunStatus = "loading" | "error" | "offline" | "ready";

/**
 * 키 값 칸의 상태. 값은 없다: 입력란 자체가 값을 들고 있다.
 * `providerId`는 저장 뒤 이을 제공자다. null이면 검색 권장 플러그인의 키라서 저장만 하고 잇지 않는다.
 */
export type FirstRunKeyEntry =
  | { readonly state: "idle" }
  | {
      readonly state: "form";
      readonly name: SecretName;
      readonly action: "add" | "set";
      readonly providerId: string | null;
    }
  | {
      readonly state: "failed";
      readonly text: string;
      /** 기술 문구(종료 코드 등). 화면은 "자세히" 뒤에 둔다 */
      readonly detail?: string;
      /** 키체인 실패면 있다. 화면이 "다시 시도"(키 값 칸을 다시 연다)와 "도움말 열기"를 보인다 */
      readonly keystore?: {
        readonly name: SecretName;
        readonly action: "add" | "set";
        readonly providerId: string | null;
      };
    };

/** 검색 권장 단계의 상태. `unknown`은 `web.providers`를 읽지 못했다는 뜻이다 */
type SearchState = "ready" | "dismissed" | "pending" | "unknown";

export interface StepState {
  readonly id: StepId;
  /** 끝났는가. 점검 결과가 없으면 거짓이다 */
  readonly done: boolean;
  /** 점검 결과를 받지 못해 끝났는지 모른다. 막힌 것이 아니라 모르는 것이다 */
  readonly unknown: boolean;
  readonly optional: boolean;
  /** 앞 단계가 끝나야 열린다. 기본 모델은 키 등록 뒤에 열린다 */
  readonly locked: boolean;
}

export interface FirstRunModel {
  readonly steps: readonly StepState[];
  /** 아직 끝나지 않은 첫 단계(점검 결과를 못 받은 단계는 건너뛴다). 모두 끝났으면 null */
  readonly next: StepId | null;
  /** 모델 키와 기본 모델이 끝났는가(외부 도구는 시작 가능 여부에 넣지 않는다) */
  readonly readyToChat: boolean;
  readonly defaultModel: string | null;
  readonly search: FirstRunSearch | null;
  readonly searchState: SearchState;
  readonly groups: GroupsSnapshot | null;
}

export interface FirstRunInput {
  readonly setup: SetupSnapshot;
  /** null이면 검색 권장을 읽지 못했다(확인할 수 없음) */
  readonly search: SearchSnapshot | null;
  /** null이면 기본 그룹을 읽지 못했다(확인할 수 없음) */
  readonly groups: GroupsSnapshot | null;
}

/** 값을 쓴 적이 없으면 기본값을 쓴다 */
export function groupOnOf(stored: boolean | null): boolean {
  return stored ?? GROUP_DEFAULT_ON;
}

/** 기본 그룹 행 두 개와 review 행 한 개. review는 꺼짐으로 보이고 바꿀 수 없다 */
export function groupRowsOf(groups: GroupsSnapshot): readonly GroupRow[] {
  return [
    { id: "helm", on: groupOnOf(groups.enabled.helm), switchable: true },
    { id: "learning", on: groupOnOf(groups.enabled.learning), switchable: true },
    { id: "review", on: false, switchable: false },
  ];
}

/** 단계 목록의 순서 번호로 단계 id를 찾는다. 범위를 벗어나면 null이다 */
export function stepIdAt(index: number): StepId | null {
  return STEP_ORDER[index] ?? null;
}

/** 설정을 아직 읽지 못했을 때의 단계 목록. 모든 단계가 "확인할 수 없음"이다 */
export function unknownStepsOf(): readonly StepState[] {
  return STEP_ORDER.map((id) => ({
    id,
    done: false,
    unknown: true,
    optional: OPTIONAL_STEPS.has(id),
    locked: false,
  }));
}

function groupsDone(groups: GroupsSnapshot | null): boolean {
  return groups !== null && DEFAULT_GROUP_IDS.every((id) => groupOnOf(groups.enabled[id]));
}

/** 첫 실행 화면의 단계와 상태를 만든다. 모델 키와 기본 모델 판단은 `firstRunView`(client)가 한다 */
export function firstRunModelOf(input: FirstRunInput): FirstRunModel {
  const view = firstRunView({
    setup: input.setup,
    web: input.search?.web ?? null,
    searchHintDismissed: input.search?.dismissed ?? false,
  });
  const search = view.search;
  const searchState: SearchState =
    search === null
      ? "unknown"
      : search.recommendations.every((entry) => entry.state === "ready")
        ? "ready"
        : input.search?.dismissed === true
          ? "dismissed"
          : "pending";

  const coreStep = (id: "tools" | "key" | "model"): { done: boolean; unknown: boolean } => {
    const found = view.steps.find((step) => step.id === id);
    return { done: found?.done === true, unknown: found?.unknown === true };
  };
  const keyDone = coreStep("key").done;

  const statusOf = (id: StepId): { done: boolean; unknown: boolean } => {
    switch (id) {
      case "tools":
      case "key":
      case "model":
        return coreStep(id);
      case "search":
        return {
          done: searchState === "ready" || searchState === "dismissed",
          unknown: searchState === "unknown",
        };
      case "groups":
        return { done: groupsDone(input.groups), unknown: input.groups === null };
      default:
        return assertNever(id, "StepId");
    }
  };

  const steps: readonly StepState[] = STEP_ORDER.map((id) => {
    const status = statusOf(id);
    return {
      id,
      done: status.done,
      unknown: status.unknown,
      optional: OPTIONAL_STEPS.has(id),
      locked: id === "model" && !keyDone,
    };
  });
  // 끝나지 않은 첫 필수 단계를 연다. 모델 키 목록을 못 읽은 경우도 건너뛰지 않는다(선택 단계가 먼저 열리면 안 된다).
  // 외부 도구 점검과 선택 단계는 모르면 건너뛴다
  const next =
    steps.find((step) => !step.done && (!step.unknown || (!step.optional && step.id !== "tools")))
      ?.id ?? null;

  return {
    steps,
    next,
    readyToChat: view.readyToChat,
    defaultModel: input.setup.defaultModel,
    search,
    searchState,
    groups: input.groups,
  };
}

// ── 모델 키 칸 ───────────────────────────────────────────────────────────

/** 입력한 제공자 하나의 키 상태. 값은 없고 시크릿 이름과 등록 여부, 참조가 켜졌는지만 있다 */
export interface KeyView {
  /** 제공자 이름이 규칙에 맞으면 그 제공자의 시크릿 이름 */
  readonly secretName: SecretName | null;
  readonly registered: boolean;
  /** 제공자 설정이 이 시크릿 참조를 켜 두었는가 */
  readonly linked: boolean;
}

export function keyViewOf(setup: SetupSnapshot, providerInput: string): KeyView {
  const provider = checkProviderId(providerInput);
  const secret = provider.ok ? providerSecretName(provider.value) : null;
  const secretName = secret?.ok === true ? secret.value : null;
  const registered =
    secretName !== null && (setup.secrets ?? []).some((s) => s.name === secretName && s.registered);
  const linked =
    provider.ok &&
    secretName !== null &&
    setup.providers.some(
      (entry) =>
        entry.id === provider.value &&
        entry.enabled &&
        entry.apiKeyRef === `secret://${secretName}`,
    );
  return { secretName, registered, linked };
}

/** 권장 플러그인의 시크릿 이름. 계약의 이름 규칙에 맞지 않으면 null이라 키 등록 단추를 보이지 않는다 */
export function recommendSecretOf(entry: WebRecommendation): SecretName | null {
  const parsed = parse(SecretNameSchema, entry.secretName);
  return parsed.ok ? parsed.value : null;
}

/** 권장 플러그인이 설치되지 않았거나 키가 없으면 "설치 방법 보기" 링크를 둔다([제안] "설치" 단추 대신, §6.5) */
export function showsInstallHelp(state: WebRecommendation["state"]): boolean {
  return state === "not-installed" || state === "needs-key";
}

/**
 * 첫 실행 화면을 이번 앱 실행에서 무대에 자동으로 열 차례인가. 설정이 끝나지 않았고(`useSetupNeeded`)
 * 아직 자동으로 연 적이 없을 때만 참이다. 한 번 연 뒤에는 사용자가 다른 화면에 갔다가 와도 다시 열지 않는다.
 */
export function firstRunAutoOpenDue(input: {
  readonly needed: boolean;
  readonly openedThisRun: boolean;
}): boolean {
  return input.needed && !input.openedThisRun;
}

// ── ⌘Enter ───────────────────────────────────────────────────────────────

/** ⌘Enter가 하는 일. 단계마다 주 동작이 하나다(L4.desktop-ux §6.5 바로 가기 키) */
export type PrimaryAction = "recheck" | "register" | "submitKey" | "saveModel" | "dismissSearch";

export interface PrimaryInput {
  readonly step: StepId;
  /** 쓰기가 잠겼는가(오프라인이거나 보내는 중). 잠기면 주 동작이 없다 */
  readonly locked: boolean;
  /** 설정을 읽었는가. 못 읽었으면 단계의 단추가 없으니 주 동작도 없다 */
  readonly ready: boolean;
  /** 키 값 칸이 열려 있는가. 키 단계와 검색 단계에 보인다 */
  readonly keyFormOpen: boolean;
  /** 입력한 제공자에서 시크릿 이름이 정해졌는가 */
  readonly secretKnown: boolean;
  /** 기본 모델 입력이 맞고 그 단계가 잠기지 않았는가 */
  readonly modelReady: boolean;
  /** "나중에"가 남아 있는가 */
  readonly searchPending: boolean;
}

/** 현재 단계에서 ⌘Enter가 할 일. 지금 누를 수 없으면(잠김, 입력 불충분, 할 일 없음) null이다 */
export function primaryActionOf(input: PrimaryInput): PrimaryAction | null {
  if (input.locked || !input.ready) return null;
  switch (input.step) {
    case "tools":
      return "recheck";
    case "key":
      if (input.keyFormOpen) return "submitKey";
      return input.secretKnown ? "register" : null;
    case "model":
      return input.modelReady ? "saveModel" : null;
    case "search":
      if (input.keyFormOpen) return "submitKey";
      return input.searchPending ? "dismissSearch" : null;
    case "groups":
      return null;
    default:
      return assertNever(input.step, "StepId");
  }
}

// ── 기본 모델 목록 ───────────────────────────────────────────────────────

/** 모델 Combobox의 한 묶음: 제공자 하나와 그 모델들. 값은 `provider/id`, 이름은 카탈로그의 이름(없으면 id)이다 */
export interface ModelGroup {
  readonly provider: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** 모델 목록(`models.list`)을 제공자별 묶음으로 만든다. 순서는 목록 순서를 따른다 */
export function modelGroupsOf(choices: readonly ModelEntry[]): readonly ModelGroup[] {
  const groups: { provider: string; options: { value: string; label: string }[] }[] = [];
  for (const entry of choices) {
    const slash = entry.ref.indexOf("/");
    const provider = slash < 0 ? entry.ref : entry.ref.slice(0, slash);
    const id = slash < 0 ? entry.ref : entry.ref.slice(slash + 1);
    const label = entry.name === "" ? id : entry.name;
    const group = groups.find((found) => found.provider === provider);
    if (group === undefined) groups.push({ provider, options: [{ value: entry.ref, label }] });
    else group.options.push({ value: entry.ref, label });
  }
  return groups;
}

/** 입력한 모델이 목록에 있는 모델인가. 없는 모델은 저장할 수 없다 */
export function modelInChoices(choices: readonly ModelEntry[], ref: string): boolean {
  return choices.some((entry) => entry.ref === ref);
}
