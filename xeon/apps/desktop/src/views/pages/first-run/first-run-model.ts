import {
  checkProviderId,
  firstRunView,
  providerSecretName,
  type FirstRunSearch,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { assertNever } from "@fresnel/contracts";
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

/** 모델 키 칸의 상태. 값은 없다: 입력란 자체가 값을 들고 있다 */
export type FirstRunKeyEntry =
  | { readonly state: "idle" }
  | { readonly state: "form"; readonly name: SecretName; readonly action: "add" | "set" }
  | { readonly state: "failed"; readonly text: string };

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
  const next = steps.find((step) => !step.done && !step.unknown)?.id ?? null;

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
