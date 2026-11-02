import type {
  CompositionDecl,
  ExtensionEntry,
  ExtensionManifest,
  ProviderResourceDef,
  GroupDecl,
  RegistrationApi,
  StateDecl,
  ToolResourceDef,
} from "@fresnel/contracts/extensions";
import type { Upcaster } from "@fresnel/contracts/records";
import type { SettingDef, SettingDefInput, SettingGroup } from "@fresnel/contracts/settings";
import type { CommandResourceDef, ExtMethodResourceDef } from "@fresnel/ext-host";
import type { Static } from "typebox";
import type {
  CancelDelegatesResult,
  DelegateCallOptions,
  DelegateResult,
  DelegateSpec,
  DelegateStatusResult,
} from "./delegate.ts";
import type { GroupMetricsHandle } from "./metrics/types.ts";
import type { StateMigrations } from "./state.ts";

// 그룹 정의 API의 타입 선언 모음. define-group.ts(검증·defineGroup)와 wrap.ts가 함께 import한다.
// 함수가 없는 파일이라 두 파일 사이에 import 순환이 생기지 않는다.

/** `group` 선언이 있고 L3 오케스트레이션 플러그인이 하나 이상 있는 매니페스트(검사는 isGroupManifest) */
export type GroupManifest = ExtensionManifest & {
  readonly group: GroupDecl;
};

/** 설정 정의 묶음. 키는 이름 부분(F.wire-settings.spec §3.8.3 SettingDefInput) */
export type GroupSettingDefs = Readonly<Record<string, SettingDefInput>>;
/** 내장 그룹은 "l3.<이름>", 외부 그룹은 "ext.<이름>"(F.wire-settings.spec §3.8.3 규칙 3) */
export type GroupSettingNamespace = `l3.${string}` | `ext.${string}`;
/**
 * 설정이 없는 그룹의 D. 키가 하나도 없는 형태를 뜻하는 `{}`다. 스펙 시그니처의 기본값(Record<never, never>)과 같다.
 */
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- 설정이 없는 그룹의 D 기본값은 키가 없는 객체 형태 자체다 (L3.group-sdk.spec §3.2)
export type NoSettings = Record<never, never>;
export type GroupSettingValues<D extends GroupSettingDefs> = {
  readonly [K in keyof D & string]: Static<D[K]["type"]>;
};

export interface GroupDef<S = never, D extends GroupSettingDefs = NoSettings> {
  /** 저장소 안 그룹은 defineManifest 상수, 외부 그룹은 groupManifest(plugin.json 값) */
  readonly manifest: GroupManifest;
  /**
   * 구성 선언(X-16, F.extensions.spec §3.1.2). `defineGroup`이 만든 모듈의 매니페스트 `group.composition`을 채운다.
   * 매니페스트에도 `group.composition`이 있고 둘이 다르면 `composition_conflict`다. 없으면 구성기는 "구성 정보 없음" 블록 하나로 본다
   */
  readonly composition?: CompositionDecl;
  /**
   * 비공개 상태 문서. F StateDecl(schema, initial, version).
   * 생략하면 상태 없는 그룹이다(정책 그룹 등). 이때 g.state()·g.commit()은 X가 state_undeclared로 거부한다(X.primitives.spec §4.6.1 1번)
   */
  readonly state?: StateDecl<S>;
  /** state.version이 2 이상이면 1..version-1 모든 키가 있어야 한다(§4.7). state가 없으면 두지 않는다 */
  readonly migrations?: StateMigrations;
  /** defineSettings("l3.<이름>", …) 또는 defineSettings("ext.<이름>", …)의 결과 */
  readonly settings?: SettingGroup<GroupSettingNamespace, D>;
  readonly setup: (g: GroupApi<S, D>) => void | Promise<void>;
}

/** F RegistrationApi<S>에 settings(), delegate(spec), metrics, 리소스 등록 두 연산을 더한 것 */
export interface GroupApi<S, D extends GroupSettingDefs = NoSettings> extends RegistrationApi<S> {
  /** 마지막으로 읽은 이 그룹 설정의 유효 값. 동기, 순수 조회 */
  settings(): GroupSettingValues<D>;
  /** L1-g 백그라운드 위임 래퍼(§3.4). 소유는 이 scope, requestId 멱등. on 핸들러와 drive 함수에서 부를 수 있다 */
  delegate(spec: DelegateSpec, options?: DelegateCallOptions): Promise<DelegateResult>;
  /** 위임 상태 조회(효과 없음). drive 함수에서 부를 수 있고 on 핸들러에서는 `group.effectNotAllowed`다(ADR-0015 §3.2) */
  delegateStatus(
    requestId: string,
    options?: Pick<DelegateCallOptions, "threadId">,
  ): DelegateStatusResult;
  /**
   * 이 scope가 소유한 진행 중 위임을 모두 취소한다(§4.10). `onDispose`와 명령 처리기에서만 부른다.
   * on 핸들러와 drive 함수에서는 `group.effectNotAllowed`다
   */
  cancelDelegates(reason?: string): Promise<CancelDelegatesResult>;
  /** 이 그룹의 계측 조회(§3.12). 2차 전까지 snapshot()은 메모리 집계만 돌려준다 */
  readonly metrics: GroupMetricsHandle;
  /** 그룹 전용 모델 도구 등록. X hostOf(g).registerTool을 그대로 부른다. setup 안에서만. scope가 꺼지면 해제된다 */
  registerTool(def: ToolResourceDef): void;
  /** 명령 등록. X hostOf(g).registerCommand를 그대로 부른다. setup 안에서만. 이름은 그룹 이름과 같게 둔다 [제안] */
  registerCommand(name: string, def: CommandResourceDef): void;
  /**
   * 확장 메서드 처리기 등록(X-3). X `hostOf(g).registerMethod`를 그대로 부른다. setup 안에서만. 동사는 매니페스트 `methods`에 선언되어 있어야 한다.
   * scope가 꺼지면 해제된다. thread 안의 호출이면 `g.state()`를 명령 처리기처럼 읽을 수 있다
   */
  registerMethod(verb: string, def: ExtMethodResourceDef): void;
  /** 모델 provider 등록. X hostOf(g).registerProvider를 그대로 부른다(config는 JSON 표현). setup 안에서만. scope가 꺼지면 해제된다 */
  registerProvider(name: string, config: ProviderResourceDef): void;
}

export interface GroupModule {
  readonly manifest: GroupManifest;
  /** X 로더가 부르는 엔트리. F ExtensionEntry */
  readonly entry: ExtensionEntry;
  /** 설정 카탈로그에 넣을 묶음. 조립 루트가 buildCatalog 입력({ owner, namespace, defs })으로 옮긴다 */
  readonly settings?: GroupModuleSettings;
  /** 상태 이벤트 업캐스터(§4.7). 길이 = state.version - 1. 상태가 없으면 빈 배열 */
  readonly stateUpcasters: readonly Upcaster[];
  /** 상태가 없으면 0 */
  readonly stateVersion: number;
}

/** GroupModule.settings. SettingGroup의 키별 타입을 지운 모양이라 어떤 D의 그룹이든 담는다 */
export interface GroupModuleSettings {
  readonly namespace: GroupSettingNamespace;
  readonly defs: readonly SettingDef[];
}

export type GroupDefIssueCode =
  | "group_missing_orchestration" // `group` 선언이 없거나 layer가 "L3"인 플러그인이 없음
  | "group_name" // GROUP_NAME_PATTERN 위반 또는 RESERVED_GROUP_NAMES
  | "settings_namespace" // 설정 namespace가 l3.<이름>(trust.level builtin) 또는 ext.<이름>이 아님
  | "state_version" // version이 1 이상의 정수가 아니거나, state가 없는데 migrations가 있음
  | "composition_conflict" // def.composition이 매니페스트 group.composition과 다름
  | "state_initial_invalid" // initial이 schema를 통과하지 못함
  | "state_migration_missing" // version ≥ 2인데 migrations에 빠진 출발 버전이 있음
  | "delegate_capability" // delegate를 쓰는데 매니페스트 requires/optional에 위임 기능이 없음(M3, checkGroup)
  | "setup_threw"; // checkGroup이 setup을 실행하다 예외를 만남(스펙 코드 목록에 더한 값)

export interface GroupDefIssue {
  readonly severity: "error" | "warning";
  readonly code: GroupDefIssueCode;
  /** JSON Pointer */
  readonly path: string;
  readonly message: string;
}

/**
 * validateGroupDef가 읽는 정의의 좁은 모양. GroupDef<S, D>는 setup 인자의 공변이 맞지 않아
 * GroupDef<unknown, …>에 대입할 수 없으므로 검사에 필요한 필드만 받는다(스펙 시그니처에서 넓힌 값).
 */
export interface GroupDefShape {
  readonly manifest: ExtensionManifest;
  readonly composition?: CompositionDecl;
  readonly state?: StateDecl<unknown>;
  readonly migrations?: StateMigrations;
  readonly settings?: { readonly namespace: string };
}
