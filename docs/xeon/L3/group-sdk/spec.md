---
id: L3.group-sdk.spec
layer: L3
domain: group-sdk
kind: spec
status: draft
depends_on: [F.extensions.spec, F.records.spec, F.capabilities.spec, F.wire-settings.spec, F.conversation.spec, X.primitives.spec, eng.dependency-rules.guide, eng.context-map.design, eng.events.design, adr.0015, review.m3-design-inputs]
binds: [xeon/packages/orchestration-sdk/**]
---

# L3 플러그인 기반 (orchestration-sdk)

패키지: `@fresnel/orchestration-sdk`(`xeon/packages/orchestration-sdk`). 하위 층: L3-a 플러그인 기반(`_research/layer-plan-v2.json` L3-a).

이 문서는 L3 플러그인 세 문서(L3.helm.spec, L3.learning.spec, L3.slots 템플릿)의 기준 문서다. 플러그인이 쓰는 공용 이름(`defineOrchestration`, `OrchestrationDef`, `OrchestrationApi`, `OrchestrationModule`, `replayDrive`, `scanDriveSource`, `PromotionReport`, `OrchestrationMetrics`)의 정의 위치는 이 문서다. `OrchestrationService`, `OrchestrationStatus`와 부속 타입은 F `services/groups.ts`(F.capabilities.spec §3.12)에 두고, 필드 정의는 이 문서 §3.8이 적는다.

## 1. 목적과 범위

L3-a 구성요소 7개를 인터페이스로 확정한다.

| # | 구성요소(L3-a) | 단계 | 이 문서의 절 |
|---|---|---|---|
| 1 | defineOrchestration | 1차 | §3.2, §3.3 |
| 2 | drive 역할과 주도 시작(중재 없음) | 1차 | §3.5, §4.3 |
| 3 | 플러그인 상태 레코드 | 1차 | §3.6, §4.5~§4.7 |
| 4 | 플러그인 간 통신 | 1차 | §3.7, §4.8 |
| 5 | 플러그인 전환 명령과 표시 | 1차 | §3.8, §3.9 |
| 6 | drive 재생 규율 검사 | 2차 | §3.10, §3.11 |
| 7 | 플러그인 전용 도구와 승격, 계측 | 2차 | §3.12, §4.9 |

정하는 것:

- 오케스트레이션 정의 API와 그 정적 검증
- `OrchestrationApi`의 멤버 시그니처. F `RegistrationApi`에 더하는 `settings()`, `delegate(spec)`, `metrics`
- drive 역할 계산(스택에서 `DriveRole`을 읽는 규칙)과 주도 시작 요청 전달. 후보 중재 정책은 없다(E3, §3.5) [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
- 플러그인 비공개 상태와 공개 레코드의 구분, 상태 커밋 규칙, 분기·재개 때 복원, 상태 스키마 마이그레이션
- 플러그인 사이 통신의 허용·금지 목록과 검사 수단
- `fresnel.orchestration` 서비스(`OrchestrationService`: 목록과 상태)
- 2차: 재생 규율 검사 도구(`replayDrive`, `scanDriveSource`), 승격 보고(`PromotionReport`), 계측(`OrchestrationMetrics`)
- `l3.orchestration.*` 설정 키

다루지 않는 것:

- Helm(`helm`)과 학습 플러그인(`learning`)의 내부 설계: L3.helm.spec, L3.learning.spec
- 추가 플러그인 템플릿 문서: L3.slots(`eng.context-map.design` C-2, 템플릿은 slots 문서가 받는다)
- drive lock 부여·회수·`lease.*` 이벤트 기록, 핸들러 디스패치, 토글 적용 메커니즘: X.primitives.spec
- 매니페스트 탐색, 신뢰 판정, 확장 로딩: X.loading-trust.spec
- 명령 등록 경로와 화면 렌더링: L4.cli.spec, L4.desktop.spec, L4.settings-ui.spec
- 백그라운드 위임 실행(자식 thread 생성, 완료 보고, 취소): L1.agents.spec

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 플러그인 | `orchestration` 선언이 있고 id 없는 L3 루트 플러그인을 가진 확장(F.extensions.spec §2). 이름은 `OrchestrationId`(= `ExtensionName`)다 |
| 오케스트레이션 모듈 | `defineOrchestration`이 돌려주는 `OrchestrationModule`. 매니페스트와 엔트리 함수를 담는다 |
| drive 플러그인 | `plugins[].drives: true`인 L3 플러그인이 setup에서 `drive`를 등록한 플러그인 |
| Driver (holder) | 현재 drive lock을 가진 Registration. 한 번에 하나다 |
| 대기 플러그인 | 주도 스택에 있지만 맨 위가 아니어서 맡긴 쪽이 기다리는 플러그인(`DriveRole` `waiting`). drive 함수만 호출되지 않고 `on`, `post`, `delegate`는 계속 동작한다 |
| 로드 순서 | X가 확장을 로드한 순서. 같은 커밋에서 켜진 플러그인끼리의 동률을 깬다 |
| 단계 경계 | step이 끝나고 다음 step이 시작되기 전 시점(F.conversation.spec §2). 체크포인트 커밋, drive lock 교체, 플러그인 켜기·끄기 적용 시점이다 |
| 비공개 상태 | 플러그인 Registration의 상태 문서(`StateDecl<S>`). 그 플러그인만 읽는다 |
| 플러그인 레코드 | 다른 플러그인에게 공개하는 내구 레코드(F.extensions.spec §3.6 `OrchestrationRecord`) |
| 위임 | L1-g 백그라운드 위임. 자식 thread에서 서브에이전트를 실행하고 결과를 부모 대화에 보고한다 |
| 승격 | 플러그인 전용 도구를 L2 기능으로 옮기는 일 |

이 문서는 켜기·끄기와 drive lock 교대 시점을 "단계 경계"(step 종료 직후, 도구 결과 커밋 뒤)로 쓴다 [결정: review.decisions-2 U-01](F.conversation.spec §2.1). 훅 이름은 F.extensions.spec §3.4 표의 pi 이벤트명(snake_case)이다.

## 3. 인터페이스

### 3.1 진입점과 import

```text
@fresnel/orchestration-sdk           defineOrchestration, defineOrchestrationMember, validateOrchestrationDef, orchestrationManifest, isOrchestrationModule, OrchestrationDef, OrchestrationMember, OrchestrationApi, OrchestrationModule, RunScriptOptions,
                          DelegateSpec, DelegateToolPolicy, DelegateLimits, DelegateFork, DelegateReceipt,
                          DelegateResult, OrchestrationService, OrchestrationServiceName,
                          OrchestrationStatus, 명령·상태줄 함수, OrchestrationMetrics, PromotionReport, 설정 정의
@fresnel/orchestration-sdk/testing   checkOrchestration, replayDrive, scanDriveSource, smokeOrchestration(M1 테스트 플러그인),
                          정책 플러그인 정식 예 reviewgate, commitguard, guardrail(2차, L3.slots.spec §3.2)
```

- [제안] 정식 예 3종은 `src/testing/policies/`에 두고 `testing` 진입점에서만 내보낸다. 템플릿 파일은 패키지 루트의 `templates/`에 두고 진입점에 넣지 않는다(L3.slots.spec §3.3.1, L3.slots.plan §2.1 후보 a). 위치의 최종 확정은 §10 템플릿 위치 [미결]과 함께 한다.

- [결정] 플러그인끼리 직접 참조하지 않는다. 플러그인 사이 통신은 F4에 스키마가 있는 이벤트와 레코드로만 한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 3, F.extensions.spec §4.8, `eng.context-map.design` CM-06).
- [제안] `orchestration-sdk`은 `@fresnel/contracts`의 서브패스(`extensions`, `records`, `capabilities`, `services`, `conversation`, `settings`)와 `@fresnel/ext-host`의 `hostOf`, 리소스 정의 타입만 import한다(X.primitives.spec §3.8). `OrchestrationService`와 부속 타입은 F `@fresnel/contracts/services`(F.capabilities.spec §3.12 `services/groups.ts`)에서 가져온다. 이 import는 DR-14의 `@fresnel/ext-host` 예외(하위 층은 서비스 등록·주입 API만 쓴다)에 든다 [결정: review.decisions-2 U-17]. Cordis는 import하지 않는다(ADR-0002 3번 [결정], 4번 [제안], `eng.dependency-rules.guide` DR-11). 확장 호스트 기능은 서비스 `fresnel.ext`(`ExtHost`)로 주입받는다(`eng.context-map.design` 4.1절 `orchestration-sdk` 행).
- [결정: review.decisions-2 U-15] 플러그인 패키지(`plugin-helm`, `plugin-learning`)는 `@fresnel/orchestration-sdk`의 `.`만 import한다. 이 import는 `eng.dependency-rules.guide` DR-02 방법 (b)의 허용 목록 항목 `DR-02/orchestration-sdk`(`from`은 `packages/plugin-*`, 진입점 `.`와 `./testing`)이다. `orchestration-sdk`은 어떤 플러그인 패키지도 import하지 않는다.
- [결정: 계획 v2 규칙 2, DR-14] L3 패키지는 `cap-*`를 import하지 않는다. 기능은 `g.capability(ServiceKey)`로 쓴다(`architecture.layers.spec` 3.1절 2행, F.capabilities.spec §3.5).

### 3.2 defineOrchestration

```ts
// xeon/packages/orchestration-sdk/src/define-group.ts
import type { Static } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  CompositionDecl, DriveOptions, DriveStep, ExtensionEntry, ExtensionManifest, OrchestrationDecl, OrchestrationId, ProviderResourceDef, RegistrationApi, StateDecl,
} from "@fresnel/contracts/extensions";
import type { Upcaster } from "@fresnel/contracts/records";
import type { SettingDefInput, SettingGroup } from "@fresnel/contracts/settings";
import type { CommandResourceDef, ExtMethodResourceDef, ToolResourceDef } from "@fresnel/ext-host";   // X.primitives.spec §3.8, §3.9
import type {
  CancelDelegatesResult, DelegateCallOptions, DelegateResult, DelegateSpec, DelegateStatusResult,
} from "./delegate.ts";
import type { OrchestrationMetricsHandle } from "./metrics/types.ts";

/** 확장 id 규칙(review.decisions-2 U-18). 소문자, 숫자, 하이픈. 밑줄은 쓰지 않는다 */
export const ORCHESTRATION_NAME_PATTERN = "^[a-z][a-z0-9-]{1,31}$";
/**
 * 플러그인 이름 예약 목록의 정본. 네 묶음을 합친다.
 * RESERVED_EXT_IDS(eng.context-map §5.4), F.extensions.spec §4.7 name_reserved의 grp·x·fresnel,
 * L2 도메인 이름(_routing/routes.yaml layout L2), 플러그인 명령·설정 값과 겹치는 이름.
 * 설치된 확장 이름과의 충돌은 이 상수에 넣지 않는다. validateManifestSet의 name_conflict로 거부한다.
 */
export const RESERVED_ORCHESTRATION_NAMES: readonly string[] = [
  "core", "cap", "xh", "sys", "p", "ext", "x", "grp", "fresnel",
  "workspace", "mcp", "web", "knowledge", "work", "dialog", "artifacts", "schedule",
  "auto", "all", "none", "group", "groups", "kit",
];

/** `orchestration` 선언이 있고, id 없는 L3 루트 플러그인(플러그인)을 가진 매니페스트 */
export type OrchestrationManifest = ExtensionManifest & { readonly group: OrchestrationDecl };

/**
 * 매니페스트 값을 검증해 GroupManifest로 좁힌다. .fresnel-plugin/plugin.json을 JSON import로 읽은 외부 플러그인이 쓴다.
 * F validateManifest 오류, `orchestration` 선언이 없거나 id 없는 L3 루트 플러그인이 없으면 Bug를 던진다. 순수 함수
 */
export function orchestrationManifest(value: unknown): OrchestrationManifest;

/** 설정 정의 묶음. 키는 이름 부분(F.wire-settings.spec §3.8.3 SettingDefInput) */
export type OrchestrationSettingDefs = Readonly<Record<string, SettingDefInput>>;
/** 내장 플러그인은 "l3.<이름>", 외부 플러그인은 "ext.<이름>"(F.wire-settings.spec §3.8.3 규칙 3) */
export type OrchestrationSettingNamespace = `l3.${string}` | `ext.${string}`;
export type OrchestrationSettingValues<D extends OrchestrationSettingDefs> = {
  readonly [K in keyof D & string]: Static<D[K]["type"]>;
};

/** 상태 문서 마이그레이션. 키는 출발 버전. { 1: v1→v2, 2: v2→v3 }. 순수 함수 */
export type StateMigrations = Readonly<Record<number, (previous: unknown) => unknown>>;

export interface OrchestrationDef<S = never, D extends OrchestrationSettingDefs = Record<never, never>> {
  /** 저장소 안 플러그인은 defineManifest 상수, 외부 플러그인은 orchestrationManifest(plugin.json 값) */
  readonly manifest: OrchestrationManifest;
  /**
   * 구성 선언(M4 T-GK, X-16, F.extensions.spec §3.1.2). `defineOrchestration`이 만드는 `OrchestrationModule.manifest`의 `orchestration.composition`에 채운다.
   * 매니페스트 상수는 바꾸지 않고 사본에 채운다. 매니페스트 `orchestration.composition`에도 선언이 있고 두 값이 다르면 `composition_conflict`이고
   * `defineOrchestration`이 Bug를 던진다(같은 값이면 허용). 채운 매니페스트는 `validateManifest`의 `composition_*` 검사를 받는다. 생략하면 구성기는 "구성 정보 없음" 블록 하나로 본다
   */
  readonly composition?: CompositionDecl;
  /**
   * 비공개 상태 문서. F StateDecl(schema, initial, version).
   * 생략하면 상태 없는 플러그인이다(정책 플러그인 등). 이때 g.state()·g.commit()은 X가 state_undeclared로 거부한다(X.primitives.spec §4.6.1 1번)
   */
  readonly state?: StateDecl<S>;
  /** state.version이 2 이상이면 1..version-1 모든 키가 있어야 한다(§4.7). state가 없으면 두지 않는다 */
  readonly migrations?: StateMigrations;
  /** defineSettings("l3.<이름>", …) 또는 defineSettings("ext.<이름>", …)의 결과 */
  readonly settings?: SettingGroup<OrchestrationSettingNamespace, D>;
  readonly setup: (g: OrchestrationApi<S, D>) => void | Promise<void>;
  /**
   * 구성원 정의 [제안]. 키는 매니페스트 `plugins[]`에서 id가 있는 플러그인의 id다(`orchestration.members`가 있으면 그 안의 id만).
   * 선언된 구성원마다 정의가 하나 있어야 한다(`member_missing`). `defineOrchestrationMember`가 만든 값만 받는다.
   */
  readonly members?: Readonly<Record<string, OrchestrationMember>>;
}

/** F RegistrationApi<S>에 settings(), delegate(spec), metrics, 리소스 등록 두 연산을 더한 것 */
export interface OrchestrationApi<S, D extends OrchestrationSettingDefs = Record<never, never>> extends RegistrationApi<S> {
  /** 주도 단계 함수 등록(F ExtensionOps.drive, 계약 `DriveStep`). wrap이 돌려준 명령을 검사하고 계측한 뒤 엔진에 넘긴다(아래 drive 항목). setup 안에서만 */
  drive(step: DriveStep<S>, options?: DriveOptions): void;
  /** 마지막 단계 경계에서 읽은 이 플러그인 설정의 유효 값. 동기, 순수 조회 */
  settings(): OrchestrationSettingValues<D>;
  /** L1-g 백그라운드 위임 래퍼(§3.4). 소유는 이 Registration, requestId 멱등. `options`는 thread와 취소 신호를 정한다 [제안] */
  delegate(spec: DelegateSpec, options?: DelegateCallOptions): Promise<DelegateResult>;
  /** [제안] 이 Registration이 그 대화에서 시작한 위임의 상태. L1 AgentService.status 전달. on 핸들러에서는 `orchestration.effectNotAllowed`다(§3.4) */
  delegateStatus(requestId: string, options?: { readonly threadId?: ThreadId }): DelegateStatusResult;
  /** [제안] 이 Registration이 주체인 진행 중 백그라운드 위임을 모두 취소한다. onDispose와 명령 처리기에서 쓴다(§4.10, [결정: D-M3-04]). 재실행되는 코드에서는 `orchestration.effectNotAllowed`다 */
  cancelDelegates(reason?: string): Promise<CancelDelegatesResult>;
  /** 이 플러그인의 계측 조회(§3.12). snapshot()은 카운터 값이다. thread별 사용량은 OrchestrationStatus.metrics에서 합친다(§4.9) */
  readonly metrics: OrchestrationMetricsHandle;
  /** 플러그인 전용 모델 도구 등록. X hostOf(g).registerTool을 그대로 부른다. setup 안에서만. Registration이 꺼지면 해제된다 */
  registerTool(def: ToolResourceDef): void;
  /** 명령 등록. X hostOf(g).registerCommand를 그대로 부른다. setup 안에서만. 이름은 플러그인 이름과 같게 둔다 [제안] */
  registerCommand(name: string, def: CommandResourceDef): void;
  /**
   * 확장 메서드 처리기 등록(M4 T-GK, X-3). X hostOf(g).registerMethod를 그대로 부른다. setup 안에서만.
   * 동사는 매니페스트 `methods`에 선언되어 있어야 하고 아니면 X가 `resource_name_invalid`로 던진다. scope가 꺼지면 해제된다.
   * thread 안의 호출이면 처리기 안에서 `g.state()`를 명령 처리기처럼 읽는다(X.primitives.spec §4.12)
   */
  registerMethod(verb: string, def: ExtMethodResourceDef): void;
  /** 모델 provider 등록. X hostOf(g).registerProvider를 그대로 부른다(config는 JSON 표현). setup 안에서만. Registration이 꺼지면 해제된다 */
  registerProvider(name: string, config: ProviderResourceDef): void;
  /** 매니페스트 `scripts`의 이 플러그인 폴더 스크립트를 부른다(F.extensions.spec §3.1.4). 거절과 기동 실패는 `error` 값이다. 엔진 안 등록은 `sandbox_unavailable`을 준다 */
  runScript(name: string, options?: RunScriptOptions): Promise<Result<ScriptRunResult, ScriptRunFailure>>;
}

/** `g.runScript`의 옵션. 생략한 `stdin`은 빈 문자열이다(상한 256 KiB) */
export interface RunScriptOptions {
  readonly stdin?: string;
}

/** 구성원 정의의 인자 [제안]. 구성원 setup은 뿌리와 같은 OrchestrationApi를 받는다 */
export interface OrchestrationMemberDef<S = never> {
  readonly state?: StateDecl<S>;
  readonly migrations?: StateMigrations;
  readonly setup: (g: OrchestrationApi<S>) => void | Promise<void>;
}

/** 불투명 구성원 값 [제안]. S는 `mount` 클로저 안에 갇히고, 값에는 검사가 읽는 상태 모양만 보인다 */
export interface OrchestrationMember {
  readonly state?: StateDecl<unknown>;
  readonly migrations?: StateMigrations;
  /** 엔트리 안에서 구성원 Registration 하나를 등록한다. registrationId는 `registrationIdOf(manifest, id)`다 */
  readonly mount: (
    register: RegistrationFn,
    registrationId: RegistrationId,
    manifest: ExtensionManifest,
    plugin: PluginDecl,
  ) => void;
}

/** 구성원 정의를 만든다 [제안]. setup은 실행하지 않는다. 검사는 `defineOrchestration`이 뿌리와 함께 한다 */
export function defineOrchestrationMember<S = never>(def: OrchestrationMemberDef<S>): OrchestrationMember;

export interface OrchestrationModule {
  readonly manifest: OrchestrationManifest;
  /** X 로더가 부르는 엔트리. F ExtensionEntry */
  readonly entry: ExtensionEntry;
  /** 설정 카탈로그에 넣을 묶음. 조립 루트가 buildCatalog 입력({ owner, namespace, defs })으로 옮긴다 */
  readonly settings?: { readonly namespace: OrchestrationSettingNamespace; readonly defs: readonly SettingDef[] };
  /** 상태 이벤트 업캐스터(§4.7). 길이 = state.version - 1. 상태가 없으면 빈 배열 */
  readonly stateUpcasters: readonly Upcaster[];
  /** 상태가 없으면 0 */
  readonly stateVersion: number;
}

/** 정의를 검증하고 GroupModule을 만든다. 오류가 있으면 Bug를 던진다(§3.3) */
export function defineOrchestration<S = never, const D extends OrchestrationSettingDefs = Record<never, never>>(
  def: OrchestrationDef<S, D>,
): OrchestrationModule;
```

- `entry`가 하는 일 [제안]: `pluginsOf(manifest)`에서 id 없는 L3 루트 플러그인(`root`)을 찾아, 그 Registration을 `host.register(manifest.name, { state: def.state, defaultEnabled: pluginDefaultEnabled(manifest, root) }, (api) => def.setup(wrap(api)))`로 한 번 만든다. `def.state`가 없으면 `state` 키를 넘기지 않는다. `wrap`은 F `RegistrationApi`를 `OrchestrationApi`로 감싼다. 감싼 `on`, `post`, `commit`, `record`는 원래 연산을 그대로 부르고 계측 집계(§4.9)만 더한다. `drive`는 단계 함수가 돌려준 명령을 검사·계측한 뒤 엔진에 넘긴다(아래 drive 항목). 루트 플러그인의 Registration id는 매니페스트 `name`이다(F.extensions.spec §3.1 Registration id 규칙). 플러그인 이름은 매니페스트에서만 온다. `OrchestrationDef`에 별도 `id` 필드는 없다.
- 상태 없는 플러그인 [제안]: `state`를 생략할 수 있다. 상태 없이 `on`, `post`, `record`만 쓰는 정책 플러그인(L3.slots.spec §3.2, policy 템플릿)을 위해서다. 생략하면 `migrations`를 둘 수 없고(`state_migration_missing`이 아닌 `state_version` 오류), `g.state()`·`g.commit()`은 X가 `state_undeclared`로 거부한다.
- 매니페스트 전달 [제안]: 저장소 안 플러그인은 `defineManifest` 상수를 `manifest`에 넘긴다. `.fresnel-plugin/plugin.json`만 가진 외부 플러그인은 JSON import(`import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" }`)로 읽고 `orchestrationManifest(manifestJson)`을 넘긴다. X 로더도 같은 파일을 읽으므로 두 값은 같다. 같은지는 X 로더가 `validateManifestSet` 전에 비교한다 [가정: X.loading-trust.spec].
- 리소스 등록 [제안]: `registerTool`, `registerCommand`, `registerMethod`, `registerProvider`는 X `hostOf(g)`(X.primitives.spec §3.8, §4.8, §4.12)의 같은 이름 연산을 그대로 부른다. 플러그인 패키지는 `@fresnel/ext-host`를 import하지 않으므로(§3.1, DR-14) orchestration-sdk이 이 네 연산을 `OrchestrationApi`로 옮긴다. `registerProvider`의 `config`는 `ProviderResourceDef`(JSON)다. 그 밖의 `hostOf` 연산(`registerShortcut`, `registerFlag`, `registerMessageRenderer` 등)은 플러그인 요구가 생기면 같은 방식으로 더한다.
- 스크립트 실행 [제안]: `runScript(name, options?)`는 격리 자식의 대리 `g`(ext-host `ChildScriptApi`)가 가진 같은 이름 연산을 그대로 부른다. 그 연산은 `engine.call` 메서드 `runScript`이고 결과는 `Result<ScriptRunResult, ScriptRunFailure>`(F.extensions.spec §3.1.4)다. 거절과 기동 실패는 던지지 않고 `error` 값이다. 표준 입력 상한 초과와 이름 문법 위반은 엔진 호출 오류(`invalid_params`)라서 값이 아니고 약속이 거부된다(X.loading-trust.spec §3.8). 엔진 안(내장) 등록에는 실행기가 없으므로 `wrap`이 이름과 크기를 보지 않고 `{ ok: false, error: { kind: "sandbox_unavailable", reason: "in_engine_registration" } }`를 준다 [근거: packages/orchestration-sdk/src/wrap.ts `runScriptOf`, 2026-11-18]. 이 시그니처는 orchestration-sdk이 F의 `Result`와 `ScriptRunResult`·`ScriptRunFailure`를 재사용해 적는다. 새 의존은 없다.
- `settings()` [M2]: 값은 X의 `hostOf(g).settingValue(key)`로 호출 때마다 읽는다. 이 메서드는 ExtHost가 내는 `fresnel.settings` 포트(조립 루트가 `createExtHost`의 `settingValue`로 설정 서비스를 연결한다)를 거친다. 내장 플러그인은 모든 키를, 신뢰 `user`인 외부 플러그인은 자기 `ext.<id>.*` 키만 읽는다(X.primitives.spec §3.8). 값이 없거나 스키마를 통과하지 못하면 정의의 `default`다. 포트가 없으면 기본값만 돌려준다. "마지막 단계 경계의 스냅샷"은 설정 서비스가 맡는다(thread별 값은 X.primitives.spec §3.2의 `PrimitivesSettingsSource`처럼 thread를 받는 읽기가 필요하며 [미결]). 기본값도 없고 값도 없는 시크릿 설정은 `Bug`다.
- `commit` 래퍼 [M2]: `checkStateCommit`이 스키마·64 KiB·동일 값을 먼저 검사한다. 위반이면 X와 같은 `PrimitiveError`(`state_schema`, `state_too_large`)를 던지고, 같은 값이면 X를 부르지 않고 현재 값을 돌려준다. `record`·`post`는 `checkRecordKind`·`checkPostItem`으로 자기 `grp.<이름>.` 접두를 먼저 검사한다(다른 접두는 `record_invalid`, 선언 없는 자기 접두 kind는 `record_kind_undeclared`).
- 비공개 기록 [결정: review.decisions-2 T-21]: 비공개 기록 연산은 X `RegistrationApi.recordPrivate(kind, payload)`다. kind는 자기 `grp.<name>.*`이고, `readsRecordKinds`와 다른 플러그인의 `readRecords`로 조회되지 않으며, 큰 값은 blob으로 분리한다(조건은 L3.learning.spec §3.7.1). `OrchestrationApi`는 `RegistrationApi`를 상속하므로 이 연산을 그대로 전달한다. 작은 비공개 상태는 상태 문서(`commit`, §4.5 상한 안)를 쓴다.
- `drive` 단계 함수는 `DriveStepInput`(커밋된 `state`, 직전 명령의 결과 `last`, `budget`, `frame`)만 받는다. 돌려준 명령은 엔진이 실행하고, 그 결과는 같은 호출 안의 다음 단계에서 `last`로만 돌아온다. 호출 사이에 클로저 값을 넘기지 않는다(`architecture.runtime-flow.design` §4.3 완화책).
- `drive`의 명령 검사와 계측 [결정: 계약 커밋 121f2d5b8, drive-isolation.md §1.1]: `spawn` 명령은 `spawns`를 올린다. `commit` 명령(`next` 사슬 안의 것 포함)은 `commit`과 같은 `checkStateCommit`과 같은 `PrimitiveError`(`state_schema`, `state_too_large`)로 검사하고, 직전 커밋 값(사슬의 첫 값은 단계 함수가 받은 `state`)과 값이 다른 것만 `commits`로 센다. 같은 값이면 상태 사건을 쓰지 않고 `next`만 실행한다(§4.5 3번). 검사에 실패하면 단계 함수가 던진 것이 되어 drive lock이 `error`로 반납된다(§5 9번). `turn`, `ask`, `yield`, `done`, `model`, `tool`은 그대로 넘기고 `handoff`는 자리표시자다(E3). 명령과 결과의 정의는 F.extensions.spec §4.6이다.
- `OrchestrationDef<S>`의 두 번째 타입 인자 `D`는 기본값이 있으므로 설정이 없는 플러그인은 `OrchestrationDef<S>`로 쓴다.
- 구성원 [제안]: 한 확장 안에서 뿌리 말고 구성원도 둘 수 있다. 구성원은 `plugins[]`의 id가 있는 L3 플러그인이고, 같은 `defineOrchestration` 정의의 `members`에 `defineOrchestrationMember`로 정의한다. 구성원의 Registration id는 `registrationIdOf(manifest, id)`, 즉 `<이름>/<id>`다. `entry`는 뿌리를 먼저 등록하고 구성원을 `plugins[]` 순서로 등록한다(§4.2).
- 구성원의 setup은 뿌리와 같은 `OrchestrationApi`(wrap)를 받는다. `on`, `post`, `drive`, `commit`, `record` 같은 연산은 구성원 자기 Registration의 선언(`plugins[i]`의 `hooks`, `usesPost`, `drives`, `recordKinds`, `readsRecordKinds`)을 따른다. 구성원은 설정 묶음을 선언하지 않으므로 `settings()`는 빈 값이다.
- 구성원의 계측은 `metrics` 핸들로만 읽는다 [제안]. 계측 등록부(`defaultMetricsRegistry`)에 올리지 않고 `grp.<이름>.metrics.recorded` 경계 기록도 쓰지 않는다. 등록부 키와 기록 kind가 모두 오케스트레이션 이름 하나에 붙어서, 구성원이 쓰면 뿌리의 값과 섞이기 때문이다.
- `g.record`의 자기 접두 검사는 그 Registration의 선언(`checkRecordKind`의 `plugin` 인자)의 `recordKinds`를 본다. 뿌리 선언만 보면 구성원의 kind가 모두 거부되므로 구성원은 자기 선언을 본다 [제안].
- 예(설명용, 플러그인 내부 설계 아님):

```ts
export default defineOrchestration<DemoState>({
  manifest: demoManifest,                 // group 선언, 루트 plugins[0]: layer "L3", hooks ["tool.call.before", "boundary.step.after"], usesPost, drives: true
  state: { schema: DemoStateSchema, initial: { phase: "idle" }, version: 1 },
  setup(g) {
    g.on("tool.call.before", (_call, ctx) => ctx.state.phase === "review" ? { block: true, reason: "검토 단계는 읽기 전용" } : undefined);
    g.on("boundary.step.after", async (end) => {      // chain. 효과는 requestId 멱등 post로만(F §4.3)
      if (end.toolResults.length === 0) {
        await g.post(
          { kind: "context", customType: "grp.demo.nudge.sent", content: "검토를 이어 간다", display: false },
          { when: "next", requestId: `nudge:${end.stepId}` },
        );
      }
      return undefined;
    });
    g.drive(async ({ state, last }) => {
      // 턴의 결과가 돌아오면 그 결과로 커밋하고 다음 경계를 기다린다. 끝난 상태는 주도권을 내려놓는다
      if (last?.kind === "ok" && last.of === "turn") {
        return { do: "commit", state: last.value.status === "completed" ? { phase: "done" } : state, next: { do: "yield" } };
      }
      if (state.phase === "done") return { do: "done" };
      // 턴의 요청 id는 커밋된 상태에서 정한다(엔진의 기본 id는 턴과 뒤의 커밋이 겹칠 수 있다, §10)
      return { do: "turn", input: { kind: "user", content: "다음 단계" }, requestId: `demo:${state.phase}` };
    });
  },
});
```

### 3.3 정적 검증

```ts
// xeon/packages/orchestration-sdk/src/define-group.ts
import type { ManifestIssue } from "@fresnel/contracts/extensions";

export type OrchestrationDefIssueCode =
  | "orchestration_missing"               // `orchestration` 선언이 없거나 id 없는 L3 루트 플러그인이 없음 (이전 이름 group_kind)
  | "orchestration_name"               // ORCHESTRATION_NAME_PATTERN 위반 또는 RESERVED_ORCHESTRATION_NAMES
  | "settings_namespace"       // 설정 namespace가 l3.<이름>(trust.level builtin) 또는 ext.<이름>이 아님
  | "state_version"            // version이 1 이상의 정수가 아니거나, state가 없는데 migrations가 있음
  | "composition_conflict"     // def.composition이 매니페스트 group.composition과 다름(M4, X-16)
  | "state_initial_invalid"    // initial이 schema를 통과하지 못함
  | "state_migration_missing"  // version ≥ 2인데 migrations에 빠진 출발 버전이 있음
  | "member_unknown"           // members의 키가 plugins[]의 구성원 id가 아니거나 orchestration.members에 없음 [제안]
  | "member_missing"           // 매니페스트가 선언한 구성원 id인데 members에 정의가 없음 [제안]
  | "delegate_capability"     // delegate를 쓰는데 매니페스트 requires/optional에 위임 기능이 없음(검사는 checkOrchestration, M3)
  | "setup_threw";            // checkGroup이 setup을 실행하다 선언과 무관한 예외를 만남(M2에서 더한 코드)

export interface OrchestrationDefIssue {
  readonly severity: "error" | "warning";
  readonly code: OrchestrationDefIssueCode;
  readonly path: string;       // JSON Pointer
  readonly message: string;
}

/**
 * 순수 함수. validateManifest(F) 결과와 플러그인 규칙을 함께 돌려준다.
 * OrchestrationDef<S, D>는 setup 인자의 공변이 맞지 않아 OrchestrationDef<unknown, …>에 대입되지 않으므로, 검사가 읽는 필드만 담은
 * OrchestrationDefShape(manifest, state, migrations, settings.namespace)를 받는다. GroupDef는 그대로 대입된다
 */
export function validateOrchestrationDef(def: OrchestrationDefShape): readonly (OrchestrationDefIssue | ManifestIssue)[];

// xeon/packages/orchestration-sdk/src/testing/check-group.ts
/**
 * 기록용 호스트로 entry를 실행해 setup의 실제 등록을 모으고 validateUsage(F)로 대조한다.
 * 호스트는 포트가 하나도 없는 ext-host(`createExtHost`)다. drive lock과 turn은 일어나지 않고 등록만 본다
 */
export function checkOrchestration(module: OrchestrationModule): Promise<readonly (OrchestrationDefIssue | ManifestIssue)[]>;
```

검증을 부르는 시점 [제안]:

| 검사 | 함수 | 테스트 시점 | 로드 시점 | 실패 처리 |
|---|---|---|---|---|
| 매니페스트 형식 | F `validateManifest` | `defineOrchestration` 호출(모듈 평가)과 `checkOrchestration` | `defineOrchestration` 호출, X 로더가 한 번 더 | `defineOrchestration`이 `Bug`를 던진다. X는 로드 실패로 처리 |
| 플러그인 규칙 | `validateOrchestrationDef` | 같음 | `defineOrchestration` 호출 | 같음 |
| 선언과 실제 등록 대조 | F `validateUsage` | `checkOrchestration`(플러그인 패키지 테스트 `group.check`) | X가 setup 직후와 등록 호출마다(F.extensions.spec §3.7 주석) | 테스트 실패 / X가 등록 거부, 로드 실패 |
| 매니페스트 집합 | F `validateManifestSet` | 없음 | X 로더 | `name_conflict` 오류, `drive_conflict` 경고 |
| 주도 정책 | X 설치 시점(`PrimitiveError`) | 없음. 루트 플러그인은 구성원이라 `checkOrchestration`이 거부하지 않는다 | X 설치 | `drive_requires_orchestration`은 정책 `x.primitives.driveRequiresOrchestration`이 참일 때 구성원이 아닌 플러그인이 drive를 등록하면 난다(F.extensions.spec §4.6) |

- 구성원 검사 [제안]: 정의의 키는 구성원 id여야 한다(`member_unknown`, 경로 `/members/<id>`). 매니페스트가 선언한 구성원마다 정의가 있어야 한다(`member_missing`, 경로 `/members/<id>`). 구성원 정의의 상태 검사(version, migrations, initial)는 뿌리와 같은 규칙이고 경로는 `/members/<id>/state/...`, migrations는 `/members/<id>/migrations/<출발 버전>`이다. `checkOrchestration`은 검사 호스트에서 구성원도 켜서 구성원 setup의 선언 오류(`hook_undeclared` 등)를 그 구성원의 `/plugins/<위치>/...` 경로로 돌려준다. 구성원은 기본으로 꺼져 있어 켜지 않으면 setup이 돌지 않기 때문이다.
- `defineOrchestration`은 순수 검사만 한다. setup을 실행하지 않는다. 그래서 `validateUsage`는 로드 시점에 X가, 테스트 시점에 `checkOrchestration`이 부른다.
- `isOrchestrationModule(value: unknown): value is OrchestrationModule` [제안]: 이 모듈 인스턴스의 `defineOrchestration`이 돌려준 객체만 참이다(모듈 안의 `WeakSet`으로 판별). 동적 import로 읽은 default export를 단언 없이 `OrchestrationModule`로 좁힌다. 같은 모양의 손으로 쓴 객체는 거짓이다.
- X는 선언하지 않은 `on`·`post`·`drive`·`capability`를 그 자리에서 `PrimitiveError`로 던진다. `checkOrchestration`은 이 오류의 code가 `validateUsage` 코드(`hook_undeclared`, `post_undeclared`, `drive_undeclared`, `capability_undeclared`)와 같으면 같은 이슈로 돌려주고, 그 밖의 setup 예외는 `setup_threw`로 돌려준다. setup은 첫 예외에서 멈추므로 그 뒤의 등록은 보지 못한다.
- `defineOrchestration`이 던지는 값은 `Bug`(`@fresnel/contracts`)다. 정의 오류는 프로그래머 오류이기 때문이다(`eng.typescript.guide` TY-11 `fresnel/throw-only-bug`). 메시지에는 모든 이슈의 `code`와 `path`를 싣는다.
- 플러그인 패키지는 `checkOrchestration(module)`이 오류 0개인 테스트를 하나 둔다(L3.group-sdk.plan 단위 테스트 `define-group.*`).

### 3.4 delegate (L1-g 백그라운드 위임 래퍼)

```ts
// xeon/packages/orchestration-sdk/src/delegate.ts
import type { EventId, ItemId, ThreadId } from "@fresnel/contracts/conversation";
import type { RecordKind } from "@fresnel/contracts/extensions";

export interface DelegateReport {
  /** 완료 보고를 부모 대화에 넣을 때 쓰는 customType. 자기 grp.<이름>. 접두여야 한다 */
  readonly customType: RecordKind;
  readonly display: boolean;
  readonly when: "followUp" | "next";
}

/** L1.agents.spec §3.2 ChildToolPolicy와 같은 필드. 허용과 차단을 함께 쓴다 */
export interface DelegateToolPolicy {
  /** 실행을 허용하는 도구 이름(glob). 서브에이전트 정의 tools와 교집합을 낸다. 넓히지 못한다 */
  readonly allow?: readonly string[];
  /** 자식에서 막을 도구 이름(glob). allow보다 먼저 적용한다 */
  readonly deny?: readonly string[];
  /** 참이면 광고 도구 배열은 부모와 같게 두고 실행 시점에만 거른다(캐시 접두 공유) */
  readonly keepParentList?: boolean;
  /** 허용 밖 호출의 거부 문장에 붙일 안내 */
  readonly denyHint?: string;
}

/** L1.agents.spec §3.2 ChildLimits와 같은 필드 */
export interface DelegateLimits {
  /** 자식 대화의 최대 step 수 */
  readonly maxSteps?: number;
  /** 자식 대화의 입력 토큰 합계 상한 */
  readonly maxInputTokens?: number;
}

/** 부모 이력의 어디까지를 자식에 복제할지. L1.agents.spec §3.2 ForkPoint와 같은 모양. 생략하면 빈 대화에서 시작 */
export type DelegateFork =
  | { readonly at: "event"; readonly eventId: EventId }
  | { readonly at: "item"; readonly itemId: ItemId };

export interface DelegateSpec {
  /** 서브에이전트 정의 이름(L1.agents.spec §4.9) */
  readonly agent: string;
  readonly task: string;
  /** 필수. 대화 범위 멱등 키, 1~48자. orchestration-sdk이 ":report"를 붙여 보고 post의 키로 쓴다(64자 한도) */
  readonly requestId: string;
  /**
   * 완료 보고 post의 모양. 선택 필드다 [결정: review.m3-design-inputs D-M3-03].
   * 없으면 L1-g는 부모 대화에 agent.settled만 커밋하고 보고 입력을 만들지 않는다
   */
  readonly report?: DelegateReport;
  readonly toolPolicy?: DelegateToolPolicy;
  /** `parent`면 자식이 부모 대화와 같은 기본 프롬프트를 쓴다(접두 캐시 공유, 정의 `prompt`는 쓰지 않는다). 기본 `definition`. L1 `SpawnRequest.promptFrom`으로 간다 */
  readonly promptFrom?: "definition" | "parent";
  readonly limits?: DelegateLimits;
  /** 모델 역할 이름 또는 모델 참조. 없으면 정의의 model(L1.agents.spec §4.9) */
  readonly model?: string;
  /** 스냅샷 범위. 프롬프트 캐시 접두 공유 조건(_research/notes/L3-1.md §3.6) */
  readonly fork?: DelegateFork;
}

export interface DelegateReceipt {
  readonly requestId: string;
  readonly childThreadId: ThreadId;
  /** duplicate: 같은 requestId의 위임이 이미 있어 새로 만들지 않았다 */
  readonly status: "accepted" | "duplicate";
}

export type DelegateError =
  | { readonly kind: "orchestration.delegateInvalid"; readonly field: "requestId" | "report.customType" | "agent" | "fork"; readonly message: string }
  | { readonly kind: "orchestration.delegateUnavailable" }          // 위임 서비스가 없음(M2) 또는 매니페스트 미선언
  | { readonly kind: "orchestration.disabling"; readonly id: string }
  | { readonly kind: "orchestration.delegateFailed"; readonly message: string };

/**
 * 호출이 속한 대화와 취소 신호 [제안]. on 핸들러는 `ctx.threadId`·`ctx.signal`을, 명령 처리기와 도구 `execute`는 자기 호출 문맥의
 * thread를 넘긴다. on 핸들러와 drive 함수에서는 생략하면 X의 호출 문맥(`hostOf(g).callContext()`, §3.13 요청 6)을 쓰고, 문맥이 없는 곳에서 생략하면 `orchestration.delegateUnavailable`이다
 */
export interface DelegateCallOptions {
  readonly threadId?: ThreadId;
  readonly signal?: AbortSignal;
}

/** [제안] L1.agents.spec §3.2 ChildStatus를 플러그인에 보이는 모양. settled면 종료 상태만 싣는다. 사용량은 이 값에 싣지 않는다 */
export type DelegateStatus =
  | { readonly state: "queued" | "running"; readonly childThreadId: ThreadId }
  | { readonly state: "settled"; readonly childThreadId: ThreadId; readonly status: "completed" | "aborted" | "error" };

/** 재실행되는 문맥에서 부를 수 없는 호출(ADR-0015 §3.2 표). `delegateStatus`는 on 핸들러, `cancelDelegates`는 on 핸들러와 drive 함수 [제안] */
export interface DelegateContextError {
  readonly kind: "orchestration.effectNotAllowed";
  readonly effect: "g.delegateStatus" | "g.cancelDelegates";
  readonly context: "on" | "drive";
}

/** [제안] ok면 status가 undefined일 수 있다(그 requestId의 위임이 없음) */
export type DelegateStatusResult =
  | { readonly ok: true; readonly status: DelegateStatus | undefined }
  | { readonly ok: false; readonly error: DelegateContextError | { readonly kind: "orchestration.delegateUnavailable" } };

/** [제안] cancelled는 L1 `AgentService.cancel`의 값이다(하나라도 멈췄으면 true) */
export type CancelDelegatesResult =
  | { readonly ok: true; readonly cancelled: boolean }
  | {
      readonly ok: false;
      readonly error:
        | DelegateContextError
        | { readonly kind: "orchestration.delegateUnavailable" }
        | { readonly kind: "orchestration.delegateFailed"; readonly message: string };
    };

/** 복구 가능한 실패는 throw하지 않고 값으로 돌려준다(eng.typescript.guide TY-11) */
export type DelegateResult =
  | { readonly ok: true; readonly receipt: DelegateReceipt }
  | { readonly ok: false; readonly error: DelegateError };
```

- [결정] 학습 플러그인은 drive를 쓰지 않는다. 검토 포크는 L1 백그라운드 위임 서비스로 실행한다(F.extensions.spec §4.6, `_research/decisions-log.md` 2026-10-21 계획 v2). `delegate`는 이 경로의 플러그인 쪽 래퍼다. drive lock과 관계없이 모든 켜진 플러그인이 쓴다(층 사이 규칙 4 "백그라운드 위임은 여러 그룹이 함께 쓴다").
- 구현 [M3a]: 래퍼는 `hostOf(g).port(AgentServicePortKey)`(`fresnel.agents`)로 L1 서비스를 얻는다. 포트는 내장 확장만 읽을 수 있어 외부 플러그인이나 서비스가 없는 구성은 `orchestration.delegateUnavailable`이다. `origin`은 `{ parentThreadId, owner: { kind: "scope", scopeId }, caller: "main", depth: 0, ownerRequestId: requestId, signal }`이다. `parentThreadId`는 `options.threadId`, 없으면 X의 재실행 문맥이다. L1 오류 `agents.unavailable`은 `orchestration.delegateUnavailable`, 나머지는 `orchestration.delegateFailed`(메시지 `<kind>: <message>`)이고 L1 호출이 던지면 같은 오류로 바꾼다. 매니페스트 기능 선언 검사(`delegate_capability`)는 기능 ID가 없어 구현하지 않는다([미결](§10)).
- [가정, 옛 안] 래퍼는 `g.capability(AgentsDelegateKey)`로 L1-g 서비스(`fresnel.agents`, `eng.context-map.design` 5.3절)를 얻어 부른다. 키 이름, 기능 ID, 서비스 메서드 시그니처는 L1.agents.spec이 정한다. 매니페스트는 그 기능을 `requires`나 `optional`에 선언한다. 선언이 없으면 F `validateUsage`가 `capability_undeclared`를 낸다.
- L1 대응: 래퍼는 `DelegateSpec`을 L1.agents.spec §3.2 `DelegateRequest`로 옮겨 `AgentService.delegate(request, origin)`을 부른다. 필드는 `agent`, `task`, `requestId`, `report`, `model`이 같은 이름이고, `toolPolicy` → `tools`, `limits` → `limits`, `fork` → `fork`다. `origin.owner`는 `{ kind: "scope", scopeId }`다. L1.agents.spec §3.2 끝 문단은 옛 필드(`toolPolicy.deny`만, `forkFrom`)를 적었으므로 이 절에 맞춰 고칠 대상이다.
- 도구 정책 [제안]: 허용 목록과 차단 목록을 둘 다 받는다. 판정은 L1.agents.spec §4.3 권한 상한을 따른다. `allow`는 정의 `tools`와 교집합을 내므로 플러그인이 정의보다 넓힐 수 없고, 부모가 거부한 도구도 자식에서 거부된다. 학습 플러그인은 허용 목록, 다른 플러그인은 차단 목록을 쓸 수 있다. 이것으로 L3.learning.spec §10 미결 10(차단·허용 방식)을 닫는다.
- 완료 보고 [가정]: `report`가 있으면 L1-g가 자식 정착 뒤 부모 대화에 `PostItem{ kind: "context", customType: report.customType, display: report.display }`를 `when: report.when`, `requestId: "<requestId>:report"`로 넣는다. `kind: "user"`는 쓰지 않는다. 사용자 발화와 섞이기 때문이다(`_research/notes/L3-1.md` §3.3). `report`가 없으면 보고 입력을 만들지 않는다 [결정: review.m3-design-inputs D-M3-03]. 학습 플러그인은 `report`를 넣지 않는다. 플러그인은 부모 대화의 코어 이벤트 `agent.settled` 구독(L3.learning.spec §8.1 REQ-LN-02)이나 `delegateStatus`로 완료를 안다.
- 포크 위치: `fork: { at: "event" }`는 L1-g가 `agents.invalid_request`로 거부한다(L1.agents.spec §4.1 3번, 대화에 이벤트 기준 fork가 없다). 플러그인은 `{ at: "item" }`을 쓴다. `DelegateFork`의 `event` 갈래는 L1 지원이 생길 때까지 남겨 두되 `delegate` 입력 검사에서 `orchestration.delegateInvalid`(`field: "fork"`)로 막는 안을 [제안]한다.
- 재실행 문맥 [결정: adr.0015]: `delegate`는 on 핸들러와 drive 함수에서 부를 수 있다. `requestId`는 커밋된 값에서 만든 결정적 키여야 한다(ADR-0015 §3.4). `delegateStatus`는 효과 없는 읽기다. ADR-0015 §3.2 표의 `g.delegateStatus` 행에 따라 drive 함수에서는 부를 수 있고 on 핸들러에서는 부르지 않는다. 결과를 고정하려면 상태에 커밋한다. `cancelDelegates`는 효과가 있는 호출이라 재실행되는 코드에서 부르지 않고 `onDispose`와 명령 처리기에서 부른다. `onDispose`는 scope의 generation이 닫힌 뒤에 실행되어 포트 조회가 거부되므로, `wrap`은 `fresnel.agents` 서비스를 setup에서 한 번 잡아 두고 `delegate`, `delegateStatus`, `cancelDelegates`가 같은 값을 쓴다 [제안]. 서비스가 setup 때 없었으면 부를 때마다 다시 조회한다.
- 결과 수신 [M3a]: 위임 결과는 L1이 커밋하는 `agent.settled`가 훅 `lifecycle.agent.settled`로 흘러온다. X가 `owner`가 이 scope인 이벤트만 이 플러그인의 핸들러에 보내므로 플러그인은 `g.on("lifecycle.agent.settled", …)`로 자기 위임의 결과만 받는다. orchestration-sdk은 이 경로에 래퍼를 더하지 않는다.
- 멱등: 같은 thread에서 같은 `requestId`의 두 번째 호출은 자식을 만들지 않고 `status: "duplicate"`와 처음 자식의 `childThreadId`를 돌려준다. 중복 생성 방지 방법(소유 간선 검색 또는 `requests` 테이블)은 L1.agents.spec이 정한다.
- 상한: 위임은 drive lock 상한(`DriveLimits`)에 들어가지 않는다. 위임 상한의 귀속은 [미결](§10).
- (닫힘) [결정: adr.0015] F.extensions.spec §4.3의 on 핸들러 효과 목록(`post`, `commit`, `record`)에 `requestId` 멱등 `g.delegate`가 더해진다(C안, 2026-10-25). `delegate`의 `requestId`는 커밋된 id(`turnId`, `stepId`)나 상태 값에서 결정적으로 만든다(ADR-0015 §3.4). 옛 우회(`record`로 요청만 남기고 다음 단계 경계 뒤에 `delegate`를 부르는 방식)는 쓰지 않는다. F.extensions.spec 본문 반영은 ADR-0015 §4.3 표에 있다.

### 3.5 drive 역할과 주도 시작 (중재 없음)

[결정: drive-isolation.md 2.2, 2026-11-17 사용자] 구현 E3(2026-11-18). 후보 중재(`DriveArbiter`, `defaultDriveArbiter`, `driveLockArbiterPort`, 요청 순번, 대기 목록, 대기 상한과 `lease.rejected` 발행)는 없다. X는 후보 가운데 고르지 않는다. 주도권은 세 계기로만 받는다: 사용자의 주도 시작 명령(`/helm start`가 부르는 `g.startDrive()`), 프로필의 시작 설정(`ThreadOpenOptions.startDrive`), 맨 위 프레임의 맡기기(`handoff`). 플러그인을 켜는 것만으로는 주도하지 않는다. [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]

규칙:

1. orchestration-sdk은 주도 정책을 갖지 않는다. `OrchestrationApi.startDrive(input?)`는 `hostOf(g).startDrive`를 그대로 부른다. 약속(`Promise<OrchestrationStartDriveResult>`)이다. 결과 값 `OrchestrationStartDriveResult`는 `Result<void, …>`이고, 격리 자식에서도 같은 값을 준다(엔진 왕복, X.primitives.spec §3.8). thread는 호출하는 도구·명령·메서드 문맥의 것이다. 문맥이 없으면(setup, 화면 등) 결과 값으로 `no_context`를 돌려준다.
2. 플러그인의 drive 역할(`DriveRole`)은 thread의 주도권 스택(`ExtHost.driveFrames(thread)`, drive-isolation.md 2.6)에서 계산한다. 플러그인의 프레임은 `DriveFrameView.plugin`이 플러그인의 확장 이름과 같은 프레임이다. 계산 규칙은 다음 표다.

| 스택 상태 | `DriveRole` | 판정 |
|---|---|---|
| 플러그인 프레임이 맨 위(주도 중 `driving` 또는 질문 대기 `asking`) | `holder` | 맨 위 프레임만 단계 함수를 부른다. 질문 대기도 drive 락을 쥔 채이므로 `holder`다 |
| 플러그인 프레임이 스택에 있으나 맨 위가 아님(맡기고 기다리는 `waiting`) | `waiting` | 계약 값 `waiting`을 그대로 쓴다. 뜻은 "맡겨서 위 프레임을 기다림"이다 |
| 스택에 없음(켜졌고 drive 등록) | `none` | 후보 대기가 없어졌으므로 `waiting`으로 내지 않는다 |
| 꺼짐, 또는 drive 미사용 | `none` | §3.8 기존 규칙 |
| drive 함수 오류(`RegistrationInfo.drive = "error"`) | `error` | 스택 위치보다 먼저 본다 |
| `rejected` | 없음 | 대기 상한 거부가 없어졌고, 계약의 `rejected` 값도 계약 정리 단계(E3)에서 걷었다 | [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]

3. `OrchestrationService`가 확장하던 X `DriveLockArbiterPort.choose`와 그 포트 키는 계약 정리 단계에서 걷었다(E3). `OrchestrationService`는 포트를 확장하지 않는다. [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
4. `setDriveHolder`와 `/group drive`는 계약 정리 단계에서 키 `x.primitives.activeDriver`와 함께 걷었다. 지정은 주도를 바꾸지 않았으므로 남은 경로가 없다. [근거: E3 구현, drive-isolation.md 2.2]

### 3.6 플러그인 상태 레코드

비공개 상태와 공개 레코드:

| 구분 | 비공개 상태 문서 | 공개 플러그인 레코드 |
|---|---|---|
| 정의 | `StateDecl<S>`(schema, initial, version), F.extensions.spec §3.2 | `OrchestrationRecord`, `RecordKindDecl`, F.extensions.spec §3.6 |
| 쓰기 연산 | `g.commit(next)` | `g.record(kind, subject, payload)` |
| 읽기 연산 | `g.state()`, 핸들러 `ctx.state`, drive 함수 인자 | `g.readRecords(query)`(다른 플러그인), 자기 레코드는 선언 없이 |
| 내구 이벤트 kind | `grp.<그룹>.state.committed`(X.primitives.spec §4.6.1. 영역 `state`는 X 예약) [결정: review.decisions-2 T-21] | `grp.<그룹>.<영역>.<이름>`(F.records.spec §3.2) |
| 투영 | `x_<그룹의 하이픈을 밑줄로>_state`(X 소유 투영기, X.primitives.spec §4.6.1. 접두 규칙은 review.decisions-2 U-18) | 투영 없음. 이벤트 로그를 kind로 읽는다 [가정: L1.persistence.spec 조회] |
| 읽는 쪽 | 그 플러그인만 | 매니페스트 `readsRecordKinds`를 선언한 플러그인 |
| 스키마 버전 | `StateDecl.version`, 업캐스터는 `OrchestrationDef.migrations`에서 만든다(§4.7) | `RecordKindDecl.version`, 읽는 쪽이 해석(F.extensions.spec §5 9번) |
| 크기 | 직렬화 64 KiB 이하 [제안] | payload 16 KiB 이하 [제안]. 본문은 L2 저장소에 두고 id만 싣는다 |
| 분기·재개 | leaf 기준 복원(§4.6) | 이벤트 로그의 가지를 따른다 |
| 소유 kind 카탈로그 | `state.committed`는 X.primitives.spec §4.6.1, 비공개 기록(`recordPrivate`)은 각 플러그인 문서 | 각 플러그인 문서, 매니페스트 `recordKinds` |

```ts
// xeon/packages/orchestration-sdk/src/state.ts
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { Upcaster } from "@fresnel/contracts/records";

export const STATE_DOC_MAX_BYTES = 65_536;

/** grp.<그룹>.state.committed payload. 모양의 정본은 X.primitives.spec §4.6.1 */
export interface StateCommittedPayload {
  readonly scopeId: string;
  /** 활성 가지 위 판 */
  readonly rev: number;
  /** 같은 가지에서 그 scope의 바로 앞 상태 이벤트 id. 첫 커밋이면 null */
  readonly prevEventId: string | null;
  /** StateDecl.version */
  readonly version: number;
  readonly doc: JsonValue;
}

/** x_<그룹>_state 투영 행. 열 이름과 DDL의 정본은 X.primitives.spec §4.6.1(X 소유 투영기). [결정: review.decisions-2 §3 T-20] X 열 이름을 그대로 쓴다 */
export interface StateProjectionRow {
  readonly thread_id: string;
  readonly scope_id: string;
  /** state.committed 이벤트 id. 기본 키 */
  readonly event_id: string;
  /** 같은 가지에서 바로 앞 state.committed 이벤트 id. 첫 커밋이면 null */
  readonly prev_event_id: string | null;
  readonly rev: number;
  readonly version: number;
  readonly doc: string;
}

/** OrchestrationDef.migrations를 F Upcaster 배열로 바꾼다. 순수 함수 */
export function stateUpcasters(version: number, migrations: StateMigrations | undefined): readonly Upcaster[];

/** commit 전 검사. 순수 함수 */
export type StateCheck =
  | { readonly ok: true; readonly bytes: number; readonly unchanged: boolean }
  | { readonly ok: false; readonly kind: "state.schema"; readonly issues: readonly string[] }
  | { readonly ok: false; readonly kind: "state.tooLarge"; readonly bytes: number; readonly limit: number };
export function checkStateCommit<S>(decl: StateDecl<S>, current: Readonly<S>, next: S): StateCheck;
```

- [가정] `RegistrationApi.commit`의 저장은 X.primitives.spec이 구현한다. orchestration-sdk의 상태 어댑터(`state.ts`)는 그 저장에 넣을 규칙만 제공한다: 커밋 전 검사(`checkStateCommit`), 이벤트 payload 모양, 투영 행 모양, 업캐스터. X가 이 함수들을 호출하는 방식(F 타입으로 넘길지, orchestration-sdk이 `wrap`에서 먼저 검사할지)은 X.primitives.spec과 맞춘다. [제안] 기본은 `wrap`의 `commit`이 `checkStateCommit`을 먼저 부르고 통과한 값만 X `commit`에 넘기는 방식이다.
- 비공개 상태는 다른 플러그인이 읽지 않는다(F.extensions.spec §3.6). 다른 플러그인의 `x_<그룹>_*` 테이블을 쿼리하면 `eng.context-map.design` CM-02 위반이다.

### 3.7 플러그인 간 통신

허용:

| 연산 | 조건 |
|---|---|
| `g.record(kind, subject, payload)` | `kind`가 자기 `grp.<이름>.` 접두이고 매니페스트 `recordKinds`에 선언됨. X가 `validateOrchestrationRecord`로 payload를 검사(F.extensions.spec §4.8) |
| `g.readRecords(query)` | `query.kind`가 매니페스트 `readsRecordKinds`에 선언됨. 대상 플러그인이 없으면 빈 목록 |
| L2 기능 서비스 | `g.capability(key)`. 공유 저장(스킬, 메모리)은 L2 knowledge가 소유(`eng.context-map.design` 3절 규칙 5) |

금지와 검사 수단:

| 금지 | 예 | 검사 |
|---|---|---|
| 다른 플러그인 패키지 import(값, `import type`, 재수출, 동적 `import()`, `package.json` 의존) | `import { x } from "@fresnel/plugin-learning"` | `check-layers.ts` DR-02, depcruise `DR-02-no-same-layer-import-L3`, DR-14 |
| `orchestration-sdk`이 플러그인 패키지를 import | `import "@fresnel/plugin-helm"` | 같음. 허용 목록은 플러그인 → `orchestration-sdk` 한 방향만 |
| 다른 플러그인의 서비스 호출 | `ctx.get("learning")` | 플러그인은 서비스를 제공하지 않는다(`eng.context-map.design` 5.3절). `inject`에 오케스트레이션 서비스 이름이 나오면 로딩 실패(CM-06) |
| Cordis 일반 `emit` 직접 사용 | `ctx.emit("helm/phase", …)` | DR-11(`cordis` import는 `ext-host`만). `OrchestrationApi`에 `emit`이 없다 |
| 다른 플러그인의 비공개 테이블·이벤트 읽기 | `SELECT * FROM x_learning_state` | CM-02, 리뷰 |
| 다른 플러그인 접두로 레코드 쓰기 | 학습 플러그인이 `grp.helm.signal.detected`를 씀 | F `validateManifest` `record_kind_prefix` |

이벤트 격리 정책 [제안]:

- 플러그인에 열리는 이벤트 통로는 F의 훅(`on`)과 `readRecords` 둘이다. 플러그인 코드는 Cordis 이벤트 버스를 보지 않는다.
- 기본은 kind 접두 필터다. X가 플러그인에게 이벤트·레코드를 넘길 때 다음만 통과시킨다: 코어 kind(F.records.spec `CoreEventKind`) 가운데 훅 페이로드로 넘어가는 것, 자기 `grp.<이름>.*`, 매니페스트 `readsRecordKinds`가 가리키는 kind. 나머지 `grp.*`, `x.*`(다른 확장의 상태 이벤트와 `recordPrivate` 기록 포함)는 통과시키지 않는다.
- 근거: ADR-0007 §6 [미결] "그룹 사이 이벤트 격리 정책", `_research/notes/arch-1.md` §3(일반 `emit`은 격리되지 않는다), §8. 확정은 X.primitives.spec과 함께 한다.

### 3.8 OrchestrationService (`fresnel.orchestration`)

[결정: review.decisions-2 D-04] `OrchestrationService`와 부속 타입은 F `@fresnel/contracts/services`의 `services/groups.ts`에 둔다(`F.capabilities.spec` §3.12 표와 파일별 이름 표, 규칙 7). `OrchestrationService`는 X 중재 포트를 확장하지 않는다(E3에서 걷었다). 아래 블록은 그 파일의 필드 정의이고, `F.capabilities.spec` §3.12는 이 절을 필드 출처로 가리킨다. orchestration-sdk은 `service.ts`에서 이 인터페이스를 구현한다.

```ts
// xeon/packages/contracts/src/services/groups.ts  (F.capabilities.spec §3.12)
import type {
  OrchestrationId, DriveLockId, RecordKind, RegistrationStatus, Unsubscribe,
} from "../extensions";

export const OrchestrationServiceName = "fresnel.orchestration";

/** OrchestrationStatus.metrics. orchestration-sdk OrchestrationMetrics(§3.12)의 부분 필드와 같은 모양이다 */
export interface OrchestrationMetricsSummary {
  readonly denies: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly costUsd: number;
  readonly leaseMs: number;
}

/** 스택에서 읽는 플러그인의 drive 역할(§3.5). `rejected`는 중재가 없어져 계약에서 걷었다(E3) */
export type DriveRole = "holder" | "waiting" | "none" | "error";

export interface OrchestrationError {
  readonly kind: "orchestration.driveThrew" | "orchestration.setupFailed" | "orchestration.stateInvalid" | "orchestration.migrationFailed";
  readonly message: string;
  /** 오류를 기록한 이벤트 seq. 기록 전이면 null */
  readonly atSeq: number | null;
}

export interface OrchestrationStatus {
  readonly id: OrchestrationId;
  readonly displayName: string;
  readonly scope: RegistrationStatus;
  /** Registration이 enabling이면 "enable", disabling이면 "disable" */
  readonly pendingToggle: "enable" | "disable" | null;
  readonly drives: boolean;
  /** drive를 쓰지 않거나 꺼져 있으면 "none" */
  readonly drive: DriveRole;
  readonly leaseId: DriveLockId | null;
  readonly lastError: OrchestrationError | null;
  /** 매니페스트 recordKinds의 kind 목록 */
  readonly recordKinds: readonly RecordKind[];
  /** l3.orchestration.instrumentation이 false면 null */
  readonly metrics: OrchestrationMetricsSummary | null;
}

/** fresnel.orchestration 서비스. 중재 포트(choose)와 Drive를 맡는 플러그인 설정 쓰기(setDriveHolder)는 E3에서 걷었고, 전환 명령(`/group`)과 켜기·끄기·상태·변경 알림은 AGE-33에서 걷었다(호출자가 없었다) */
export interface OrchestrationService {
  /** 설치된 모든 플러그인. 정렬: holder, 켜진 플러그인(로드 순서), 꺼진 플러그인(이름순) */
  list(): readonly OrchestrationStatus[];
}
```

- 구현 [M2, E3에서 `driveHolderSetting()`과 `setDriveHolder`를 걷음]: `createOrchestrationService(deps)`가 `OrchestrationServiceWithUsage`(`OrchestrationService` + 계측 메서드)를 만든다. 의존은 `host`(`ExtHost`의 `registrations`·`registration`·`driveFrames`·`onChange`·`ports`·`queryEvents`·`toolOwner`·`resetRegistrationState`), `catalog`, `currentThread`, `report`이고 `instrumentation`·`onEnabled`·`metrics`·`promotion`은 선택이다.
- 서비스 이름 `fresnel.orchestration`와 인터페이스 이름 `OrchestrationService`는 `eng.context-map.design` 5.3절 표와 같다. 소비자는 `helm`, `learning`, `host`다. 서비스는 포트가 아니라 조립 루트가 `onService`로 받는다(E3).
- [결정: review.decisions-2 D-04] 위 이름(`OrchestrationService`, `OrchestrationServiceName`, `DriveRole`, `OrchestrationError`, `OrchestrationStatus`, `GroupSettingUnwritableReason`, `OrchestrationMetricsSummary`)은 F `services/groups.ts`가 내보낸다. orchestration-sdk은 `@fresnel/contracts/services`에서 `import type`으로 가져와 다시 내보내고 자기 정의를 두지 않는다. `OrchestrationId`, `RegistrationStatus`, `DriveLockId`, `RecordKind`, `Unsubscribe`, `DriveLockArbiterPort`, `RegistrationId`는 F `extensions`에서 온다. `HolderSettingScope`는 파일 안 별칭이고 내보내지 않는다. `F.wire-settings.spec`의 `SettingScope`와 서로 대입 가능해야 한다(§9 수용 기준 20).
- 거부 표시 [M3a, G-30, E3에서 걷음]: `lease.rejected` 구독과 거부 집합(`lease-rejections.ts`)은 없다. 엔진은 이 이벤트를 더 발행하지 않는다. `OrchestrationStatus.drive`의 `rejected`도 더 내지 않는다(§3.5). [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
- [가정] 서비스 한 인스턴스는 현재 활성 thread 하나의 플러그인 상태를 보인다. Registration 토글과 drive lock이 thread마다 따로인지는 X.primitives.spec이 정한다.

### 3.9 전환 명령과 상태줄 [AGE-33에서 걷음]

`/group` 명령(`parseGroupCommand`, `runGroupCommand`, `groupCommand`), 상태줄(`formatGroupStatusLine`, 설정 `l3.orchestration.statusLine`), 서비스의 `status`·`enable`·`disable`·`onChange`와 `resetState`는 없다. 등록하는 곳도 읽는 곳도 시험뿐이었다(AGE-33 조사). 플러그인의 켜기·끄기는 X 예약 키 `ext.<이름>.enabled`와 `ext.*` wire가, 상태는 `orchestration.list` wire가 맡는다.

### 3.10 replayDrive (재생 규율 검사 하니스)

M2 최소형은 Helm 테스트가 쓴다. 2차에 옵션을 넓힌다. M2 최소형의 옵션은 `group`, `harness`, `maxCommits`뿐이고 절단 시점은 항상 모든 커밋이다.

- 파일 위치: `replayDrive`(§3.10)와 `scanDriveSource`(§3.11)는 `src/testing/` 아래에 둔다. 테스트 전용 도구이기 때문이다.
- 다른 패키지 import [제안, M4: 기본 런타임 하니스는 아래 5번 뒤의 6번]: DR-08·DR-14의 testing 정의는 "테스트 파일만 다른 패키지의 테스트 대역을 import한다"로 통일되었다 [결정: review.decisions-2 U-17]. 그래서 `replayDrive`는 테스트 호스트와 모델 테이프를 import하지 않고 `ReplayHarness`로 받는다. 하니스는 플러그인 패키지의 테스트 파일이 `@fresnel/ext-host`·`@fresnel/core-models`의 테스트 대역으로 만든다.

```ts
// xeon/packages/orchestration-sdk/src/testing/replay/replay-drive.ts  (공개 진입점: @fresnel/orchestration-sdk/testing)
import type { JsonValue } from "@fresnel/contracts/conversation";

/** 플러그인 테스트 파일이 만든다. 호스트·테이프·정규화는 하니스 안에 있다 */
export interface ReplayHarness {
  /** 새 테스트 호스트에 플러그인 하나를 holder로 올린다. restore가 null이면 처음부터, 값이 있으면 그 이벤트열의 앞 commits개 커밋만 복원하고 재개 절차로 시작한다. 같은 테이프로 끝까지 실행한다 */
  run(group: OrchestrationModule, restore: { readonly events: readonly JsonValue[]; readonly commits: number } | null):
    Promise<{ readonly events: readonly JsonValue[]; readonly commitPoints: readonly number[]; /* M3a(G-20): 효과 계수기를 가진 하니스만 채운다. 이 실행이 새로 낸 효과 수 */ readonly effects?: EffectCounts; /* M4: 이 실행이 쓴 thread id. 기준 실행과 다르면 thread-mismatch */ readonly threadId?: string }>;
  /** 정규화한 이벤트열의 digest. 같은 의미면 같은 문자열 */
  digest(events: readonly JsonValue[]): string;
  /** 두 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  firstDiff(a: readonly JsonValue[], b: readonly JsonValue[]): number | null;
}

export interface ReplayDriveOptions {
  readonly group: OrchestrationModule;
  readonly harness: ReplayHarness;
  /** 기준 실행의 커밋 수 상한. 넘으면 실패한다. 기본 200 */
  readonly maxCommits?: number;
  /** [M3a] 기준 실행의 효과 수가 이 값과 같은지 확인한다(주어진 항목만). 다르면 `effects-mismatch` [제안] */
  readonly expectEffects?: Partial<EffectCounts>;
  // 남은 몫(G-20): initialState, input(첫 사용자 입력), cutAt("every-commit" | 지점 목록)
}

export interface ReplayCut {
  readonly commitIndex: number;
  /** [M3a] 이 절단 실행이 새로 낸 효과 수. 하니스가 계수기를 가진 경우만 */
  readonly effects?: EffectCounts;
  readonly equal: boolean;
  /** 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  readonly firstDiff: number | null;
  readonly digest: string;
  /** [M4] 이 절단 실행이 쓴 thread id. 하니스가 알려 준 경우만 */
  readonly threadId?: string;
}

export interface ReplayDriveReport {
  readonly commits: number;
  readonly baselineDigest: string;
  readonly cuts: readonly ReplayCut[];
  readonly ok: boolean;
  /** ok가 false인데 절단 비교 때문이 아니면 채운다: 커밋 수가 maxCommits 초과, 커밋이 하나도 없음, 효과 계수가 기준보다 큼(M3, 아래 4번) */
  readonly failure?: "max-commits-exceeded" | "no-commits" | "thread-mismatch" | "effects-doubled" | "effects-mismatch";
  /** [M4] failure가 thread-mismatch일 때 기준과 다른 thread를 쓴 절단의 commitIndex 목록 */
  readonly threadMismatchCuts?: readonly number[];
  /** [M3a] 기준 실행의 효과 수. 하니스가 계수기를 가진 경우만 */
  readonly effects?: EffectCounts;
}

export function replayDrive(options: ReplayDriveOptions): Promise<ReplayDriveReport>;
```

동작:

0. 하니스를 만드는 쪽의 규약 [M2]: 커밋 시점은 플러그인 상태 커밋(`grp.<이름>.state.committed`) 바로 뒤로 잡는다. 단계 함수의 `commit` 명령이면 그 결과 사건 `drive.command_settled`(command가 `commit`)가 바로 따르므로 그것까지 커밋 시점에 든다. 복원 뒤 재실행이 그 자리에 같은 사건을 쓰게 하려고다. 비교하는 이벤트열은 마지막 커밋 시점까지로 자른다. 마지막 커밋 뒤의 drive lock 반납·재부여는 경계를 몇 번 돌렸는지에 따라 길이가 달라지는 X의 꼬리라서 플러그인이 정하는 부분이 아니다. 복원은 앞 k개 커밋까지의 이벤트를 새 저장소에 넣고 `TestHost.restart()`로 호스트를 다시 만든 뒤 thread를 여는 것이다. 이벤트의 ID는 호스트마다 범위가 달라 처음 나온 순서의 자리표시자로 바꿔 비교한다. 예는 `test/support/replay-harness.ts`다.
1. 기준 실행: `harness.run(group, null)`으로 플러그인 하나를 holder로 올려 테이프로 끝까지 실행한다. 내구 이벤트열과 커밋 시점 목록을 얻는다. 커밋 시점은 0번의 규약대로 플러그인 상태 커밋 시점이다(`g.commit`과 drive 단계 함수의 `commit` 명령). `turn`·`spawn` 명령의 결과와 `post` 수락, `record` 쓰기는 커밋 시점이 아니다.
2. 시점 k마다: `harness.run(group, { events, commits: k })`로 새 호스트에 앞 k개 커밋만 복원하고 프로세스 재시작과 같은 재개 절차로 drive 함수를 마지막 커밋 상태로 다시 부른다. 같은 테이프로 끝까지 실행한다.
3. 두 이벤트열을 `harness.digest`로 비교하고 다르면 `harness.firstDiff`로 위치를 얻는다. 정규화 규칙은 `eng.testing.guide` 1.2절을 따른다. F에는 `./testing` 서브패스를 두지 않으므로 정규화 함수는 하니스를 만드는 테스트 쪽이 가진다 [결정: review.decisions-2 U-03]. 모든 시점에서 같으면 `ok`다. 커밋이 하나도 없는 실행은 확인할 것이 없으므로 `ok: false`, `failure: "no-commits"`다(플러그인이 drive lock을 받지 못한 시험 오류가 조용히 통과하지 않게 한다).
4. 효과 계수 [제안, G-20, ADR-0015 §3.6, M3a 구현]: 기준 실행의 모든 커밋 시점에서 끊고 재개할 때, 끊기 직전의 drive 호출과 on 핸들러를 같은 입력으로 두 번 실행한다. 가짜 포트(`LoopPort`, 입력 큐, 위임 서비스, 기능 공급자)가 효과 계수기를 가지고, 하니스는 `harness.run`의 결과에 `effects`(아래 `EffectCounts`)를 싣는다. 기준 실행의 `effects`는 그 실행이 낸 효과 전부이고, 절단 실행의 `effects`는 복원한 뒤 새로 낸 효과다. 절단 실행은 기준 실행과 같은 가짜 포트의 멱등 기억(요청 키 표)을 이어 써야 하고, 그러면 같은 상태·입력의 재실행은 새 효과가 0이다(옛 안의 "같은 지점까지의 계수 비교"는 이 규칙으로 바꿨다). 계수는 코어가 중복으로 돌려준 호출(`duplicate`, 재생된 `loop.turn`·`loop.spawn`, 처음 결과를 돌려준 멱등 기능 호출)과 읽기 호출을 세지 않는다. 이벤트열이 모두 같아도 절단 실행이 새 효과를 냈으면 `ok: false`, `failure: "effects-doubled"`다. `expectEffects`를 주면 기준 실행의 효과 수가 그 값과 같은지도 보고(`effects-mismatch`), 효과가 한 번 났다는 확인은 이 값으로 한다. `diffEffects`, `effectKindsOf`, `NO_EFFECTS`는 하니스를 만드는 쪽이 계수를 다룰 때 쓴다. 가짜 위임 서비스는 `fakeAgents`(`@fresnel/orchestration-sdk/testing`)다.

5. thread id 불일치 [M4, 이월 닫음]: 하니스가 `run`의 결과에 `threadId`를 싣고, 기준 실행과 다른 thread를 쓴 절단이 있으면 이벤트열이 같아도 `ok: false`, `failure: "thread-mismatch"`, `threadMismatchCuts`(그 절단의 `commitIndex`)다. 정규화가 ID를 자리표시자로 바꾸므로 이벤트열 비교로는 다른 thread가 보이지 않아서 따로 센다. 순서는 이벤트열 비교, thread 검사, 효과 계수다. `threadMismatches(threads)`는 같은 검사를 실행 기록 배열에 하는 순수 함수다.
6. 런타임 하니스 [M4 T-GK, X-10]: `createRuntimeReplayHarness()`(`@fresnel/orchestration-sdk/testing`, `src/testing/replay/runtime-harness.ts`)가 시험 파일에서 쓰던 하니스(§3.10 0번의 규약 전부)를 `testing` 서브패스로 옮긴 것이다. 설치된 `OrchestrationModule` 하나를 실제 `ExtHost`(X)에 올리고 위임 서비스는 `fakeAgents` 테이프, 루프·입력 큐는 메모리 포트로 두며 효과 계수, thread id, ID 정규화, 커밋 위치 계산을 모두 가진다. 다른 패키지의 `testing` 서브패스를 import하므로 `src/testing/` 아래에 있다(DR-08). 개발 모드 Test run의 replay(W-29, `ext.test.run`)가 같은 하니스를 쓴다. `ReplayHarness` 인터페이스는 그대로라 플러그인 패키지의 시험 하니스(Helm, learning)도 계속 쓸 수 있다. 하니스가 모델 테이프로 turn을 흉내 내는 확장은 하지 않았다: drive의 `loop.turn`은 메모리 `LoopPort`가 받는다. 사람 확인(`loop.ask`)을 지나가는 플러그인은 `createRuntimeReplayHarness({ approvals })`에 승인 서비스 대역을 넣어 재생한다. `autoAnswerApprovals(answer)`(`src/testing/fake-approvals.ts`)가 연 요청을 바로 그 답으로 해결하는 대역이고, `requestKey`로 멱등이라 절단 실행의 같은 요청 id 재호출이 기록된 답을 돌려받는다(Y7).

```ts
/** 가짜 포트가 센 외부 효과 수. 중복 응답과 읽기는 세지 않는다 */
export interface EffectCounts {
  readonly turn: number;
  readonly spawn: number;
  readonly delegate: number;
  readonly post: number;
}
```

[결정: 오케스트레이터 기본값] `capabilityWrite`는 뺐습니다. 기능 쓰기 계수는 X 테스트(`xeon/packages/ext-host/test/primitives/replay-effects.test.ts`)가 다룹니다.

- 근거: `eng.events.design` EV-09 강제 수단("커밋 지점마다 프로세스를 끊고 재호출해 같은 이벤트 열이 나오는지"), 7.1절 4번. 결정성 등급은 D0다(`eng.testing.guide` TS-02).

### 3.11 scanDriveSource (M3a 구현)

```ts
// xeon/packages/orchestration-sdk/src/testing/scan/scan-drive.ts  (공개 진입점: @fresnel/orchestration-sdk/testing)
export type DriveScanCode =
  | "SD-00" | "SD-01" | "SD-02" | "SD-03" | "SD-04" | "SD-05" | "SD-06"
  | "SD-07" | "SD-08" | "SD-09" | "SD-10";

export interface DriveScanFinding {
  readonly code: DriveScanCode;
  readonly severity: "error" | "warning";
  readonly line: number;
  readonly column: number;
  /** 금지 문자열 그대로. 예: "Date.now" */
  readonly target: string;
  readonly message: string;
}

/** 소스 문자열에서 drive 함수 본문을 찾아 검사한다. 순수 함수 */
export function scanDriveSource(source: string, options?: DriveScanOptions): readonly DriveScanFinding[];
```

- 대상: `<식>.drive(` 호출의 첫 인자로 넘긴 함수 식, 또는 같은 파일 안에서 그 이름으로 선언한 함수의 본문이다. 첫 인자가 같은 파일 함수의 호출(`g.drive(helmDrive(g, settings))`)이면 그 팩토리 함수의 본문을 본다. `.drive(` 호출은 `defineOrchestration({ setup(g) { ... } })`처럼 호출 인자·객체·배열 안 어디에 있어도 찾고, drive 본문 안의 호출 인자·배열 원소에 있는 금지 호출도 찾는다. 본문 안에 정의한 중첩 함수도 포함한다. 같은 파일의 다른 함수를 drive 본문이 직접 부르면 그 함수 본문도 한 단계만 검사한다 [제안]. 다른 모듈은 검사하지 않는다.
- 금지 문자열은 `eng.typescript.guide` TY-21과 `eng.anti-patterns.guide` AP-C-05의 목록과 같다. 메시지는 TY-21 `.oxlintrc.json` 항목의 문자열을 그대로 쓴다.

| 코드 | 대상 | 심각도 | 메시지 | 근거 |
|---|---|---|---|---|
| SD-01 | `Date.now` | error | `Inject Clock (eng.typescript.guide TY-21).` | TY-21, AP-C-05 |
| SD-02 | 인자 없는 `new Date()` | error | `Inject Clock (TY-21).` | TY-21 `fresnel/no-ambient-time` |
| SD-03 | `Math.random` | error | `Inject RandomSource (TY-21).` | TY-21, AP-C-05 |
| SD-04 | `crypto.randomUUID` | error | `Use IdFactory (TY-21).` | TY-21 |
| SD-05 | `crypto.getRandomValues` | error | `Inject RandomSource (TY-21).` | TY-21 |
| SD-06 | `performance.now` | error | `Inject Clock (TY-21).` | TY-21 |
| SD-07 | `fetch` 호출 | error | `Direct I/O is not allowed in drive; use the effects of ADR-0015 §3.2.` | F.extensions.spec §4.6, ADR-0015 §3.2 |
| SD-08 | `node:fs`, `fs`, `node:fs/promises` 바인딩 사용, `Bun.file`, `Bun.write` | error | 같음 | F.extensions.spec §4.6 |
| SD-09 | 그 밖의 `Bun.*` 호출(`Bun.spawn`, `Bun.$`, `Bun.sleep` 등) | error | 같음 | F.extensions.spec §4.6 |
| SD-10 | drive 함수 밖에서 선언한 `let`·`var` 변수를 drive 본문이 재할당 | warning | `drive state lives only in scope state (eng.events EV-09).` | EV-09 |

- 구현 [M3a]: 위 표를 그대로 구현했다. 보태거나 좁힌 점은 다음과 같다. (1) 구문 오류가 있으면 `SD-00` 오류 하나(줄 1, 열 1, 메시지는 파서 메시지)를 돌려준다 [제안]. (2) 금지 문자열은 호출이 아니어도 참조하면 찾는다(`const now = Date.now`). `Bun.file`·`Bun.write`는 SD-08, 그 밖의 `Bun.<이름>`은 SD-09다. (3) SD-08은 `fs`, `node:fs`, `fs/promises`, `node:fs/promises` import의 지역 이름을 drive 본문에서 쓰면 낸다. (4) SD-10은 같은 파일에서 `let`·`var`로 선언했고 drive 함수 밖에 있는 변수를 본문이 대입·증감할 때 낸다. 구조 분해로 가려진 이름이나 다른 파일 변수는 보지 않는다. (5) 줄·열은 1부터이고 열은 UTF-16 코드 단위다. 결과는 위치 순서다. 한계는 협조적 코드만 잡는다는 점이다. 별칭(`const f = fetch`)과 동적 접근(`globalThis["fetch"]`)은 못 잡는다.
- 파서 [제안]: `@swc/core` 1.16.18(catalog에 이미 있고 dependency-cruiser가 쓴다, `eng.dependency-rules.guide` 3.1절)의 `parseSync`. TS 7에는 안정 programmatic API가 없다. `@swc/core`를 orchestration-sdk이 import하려면 DR-07 `MODULE_OWNERS` 표에 항목이 필요하다 [미결](§10).

### 3.12 PromotionReport와 OrchestrationMetrics (2차)

```ts
// xeon/packages/orchestration-sdk/src/metrics/types.ts  (공개 진입점: @fresnel/orchestration-sdk)
import type { OrchestrationId } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { OrchestrationMetricsSummary } from "@fresnel/contracts/services";

export interface OrchestrationMetrics extends OrchestrationMetricsSummary {
  readonly groupId: OrchestrationId;
  /** 모든 thread의 합을 뜻하는 null이다. thread별 drive lock 시간과 비용은 OrchestrationStatus.metrics가 이벤트에서 따로 낸다(§4.9) */
  readonly threadId: ThreadId | null;
  /** first 훅에서 이 플러그인 핸들러가 결정(거부)을 돌려준 횟수 */
  readonly denies: number;
  /** chain 훅에서 이 플러그인 핸들러가 돌려준 패치 수 */
  readonly chainPatches: number;
  readonly handlerErrors: number;
  /** duplicate 제외 */
  readonly posts: number;
  /** drive 단계 함수가 낸 spawn 명령 */
  readonly spawns: number;
  /** accepted delegate */
  readonly delegates: number;
  readonly commits: number;
  readonly records: number;
  /** 플러그인의 turn 명령과 위임·spawn 자식 thread의 사용량 합 */
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly costUsd: number;
  /** lease.acquired ~ lease.released의 recordedAt 차이 합 */
  readonly leaseMs: number;
  readonly leases: number;
}

// 카운터 필드: posts(duplicate 제외), spawns(drive의 spawn 명령), delegates, commits, records는 wrap이 올린다.
// denies·chainPatches·handlerErrors는 on 래퍼가 올리고(§4.9), tokens·costUsd는 addUsage가 더한다 (M3b, G-17).
// leases·leaseMs와 turn.completed 사용량은 snapshot에서 0이다. 서비스가 lease.*·turn.* 이벤트로 따로 셈해 OrchestrationStatus.metrics에 합친다.
/** GroupMetricsSummary는 F services/groups.ts(§3.8)의 정의를 다시 내보낸다. GroupMetrics는 그 필드를 모두 가진다 */
export type { OrchestrationMetricsSummary } from "@fresnel/contracts/services";

export interface OrchestrationMetricsHandle {
  /** 누적값. 순수 조회 */
  snapshot(): OrchestrationMetrics;
  /**
   * 플러그인이 쓴 토큰과 비용을 더한다(LR-17). 인자가 음수이거나 유한하지 않으면 호출 계약 위반이라 `Bug`를 던진다.
   * 플러그인 코드가 만든 값이라 오류 값 대신 버그로 다룬다(TY-24). 검사가 끝나기 전에는 아무 값도 더하지 않는다.
   */
  addUsage(delta: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly costUsd: number;
  }): void;
}

/**
 * grp.<그룹>.metrics.recorded payload(recordPrivate). 단계 경계마다 마지막 기록 뒤의 0이 아닌 증가분만 쓴다.
 * stepId는 경계 signal의 turnId다 [결정: 오케스트레이터 기본값, M3b].
 */
export interface MetricsRecordedPayload {
  readonly stepId: string;
  readonly delta: Omit<OrchestrationMetrics, "groupId" | "threadId">;
}
```

```ts
// xeon/packages/orchestration-sdk/src/promotion/report.ts
import type { ToolName } from "@fresnel/contracts/capabilities";
import type { OrchestrationId, RegistrationId } from "@fresnel/contracts/extensions";

export interface ToolConsumer {
  /** 호출이 일어난 turn을 시작한 쪽. drive lock holder Registration, 또는 위임·spawn 자식을 만든 Registration */
  readonly scopeId: RegistrationId;
  readonly calls: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface PromotionCandidate {
  readonly tool: ToolName;
  readonly owner: OrchestrationId;
  /** 소유 플러그인을 뺀 소비자 */
  readonly consumers: readonly ToolConsumer[];
  /** 플러그인이 시작하지 않은 turn(사용자 입력 turn)에서의 호출 수. 소비자로 세지 않는다 */
  readonly userCalls: number;
  /** consumers가 1개 이상이면 참 */
  readonly candidate: boolean;
}

export interface PromotionReport {
  /** 집계에 쓴 마지막 이벤트 seq */
  readonly throughSeq: number;
  readonly threads: number;
  readonly candidates: readonly PromotionCandidate[];
}

export interface PromotionInput {
  /** 도구 이름 → 등록한 플러그인 [가정: X 리소스 등록부] */
  readonly toolOwners: ReadonlyMap<ToolName, OrchestrationId>;
  /** 도구 호출 하나마다 한 항목. `effect.intent` 이벤트와 그 호출이 속한 turn의 시작 주체다. `origin`이 `"user"`면 사용자 입력 turn이다 [결정: B4-GRP] */
  readonly calls: readonly { readonly tool: ToolName; readonly seq: number; readonly threadId: string; readonly origin: RegistrationId }[];
}

/** 순수 함수 */
export function buildPromotionReport(input: PromotionInput): PromotionReport;
```

소비자 집계 [결정: 오케스트레이터 기본값, B4-GRP]:

- 소비자는 플러그인 전용 도구를 호출한 turn을 시작한 scope다. drive lock 안 turn 명령이 시작한 turn은 holder scope다. 위임·spawn 자식 thread의 turn은 그 자식을 만든 scope여야 하지만, 자식 turn의 `turn.started`에는 그 scope가 없어 집계에서 뺀다(§10). 사용자 입력 turn은 `"user"`로 따로 센다.
- 소유 플러그인 밖의 scope가 하나라도 있으면 승격 후보다(L3-a "두 번째 소비자를 얻으면 L2로 승격").
- 소유 플러그인 자신의 호출(`origin`이 소유 플러그인)은 소비자가 아니다. `throughSeq`와 `threads`에는 든다.
- 소유 플러그인이 없는 도구의 호출은 `throughSeq`, `threads`, 후보 어디에도 세지 않는다.
- `candidates`는 `toolOwners`의 도구마다 한 항목이고 도구 이름순이다. 호출이 없는 도구는 소비자와 `userCalls`가 0인 항목이다. 소비자는 Registration id순이다.
- `throughSeq`는 소유 플러그인이 있는 도구의 호출 가운데 최대 seq다. 호출이 없으면 0이다. `threads`는 그 호출이 든 thread 수다.

집계 입력 [결정: 오케스트레이터 기본값, B4-GRP]. `gatherPromotionInput(host, threadIds)`(`src/promotion/gather.ts`)가 X 이벤트로 만든다.

- 호출 한 건은 `effect.intent` 이벤트 하나다. 도구 실행 전에 한 번 커밋되고 요청 키가 `tool:<키>:intent`라 재실행되어도 한 건이다. `turnId`로 turn 출처와 잇는다.
- turn 출처는 `turn.started`에서 읽는다. `scopeId`가 null이 아니면 그 Registration(drive turn). `scopeId`가 null이고 `origin`이 `user`(또는 없음)이면 `"user"`다. `delegation`, `scheduled`, `remote`, `other` turn은 호출을 만든 scope를 이벤트에서 알 수 없어 입력에서 뺀다 [미결](§10).
- 도구 소유는 호출을 기록한 대화가 보는 이름으로 찾는다(`PromotionHostView.toolOwnerIn(name, threadId)`, `OrchestrationServiceDeps.toolOwnerIn`. 도구 이름은 대화마다 정해지므로 같은 이름이 여러 주인에게 있을 수 있다. L1.tools.spec §3.3.1 7). 조립이 `toolOwnerIn`을 주지 않으면 `ExtHost.toolOwner(name)`을 쓴다. 기록의 `scopeId`가 `registrations()`에 있는 설치된 Registration일 때만 그 `extension`(플러그인 이름)을 소유 플러그인으로 본다. 소유 플러그인이 없는 도구의 호출은 입력에 넣지 않는다.
- 조회는 `queryEvents(threadId, { kindPrefix: "turn.started" })`와 `{ kindPrefix: "effect.intent" }`다. 한 thread의 조회가 하나라도 실패하면(Result err) 그 thread를 건너뛰고 나머지를 모은다.
- 현재 thread 기본 입력은 `OrchestrationServiceDeps.promotion`이 없을 때 `createOrchestrationService`가 만든다. 현재 thread가 없으면 빈 보고다.

승격 절차 [제안]:

1. `PromotionReport`의 후보를 `orchestration.promotion` wire와 2차 설정 화면에 보인다. 자동으로 옮기지 않는다.
2. 사람이 승격을 결정하면 해당 L2 도메인 spec에 기능 정의를 더하고 F `capabilities/defs/<domain>.ts`에 정의를 둔다(F.capabilities.spec §3.9).
3. 구현을 `cap-<domain>`으로 옮긴다. 원래 플러그인은 `g.capability(key)`로 바꾸고 매니페스트 `requires`에 기능을 더한다.
4. 모델 도구 이름은 바꾸지 않는다. 이름이 L2 규칙과 충돌하면 한 부 버전 동안 옛 이름을 별칭으로 둔다.

### 3.13 요구하는 X 인터페이스

orchestration-sdk이 쓰는 X.primitives.spec의 이름과, 아직 X에 없어 요청하는 것을 나눈다.

X.primitives.spec에 있는 것:

| 용도 | X 이름 | X 절 |
|---|---|---|
| 확장 호스트 서비스 | `ExtHost`(서비스 `fresnel.ext`, `ExtHostPortKey`) | §3.1, §3.6 |
| Registration 목록과 상태 | `ExtHost.registrations(): readonly RegistrationInfo[]`(`id`, `extension`, `status`, `generation`, `waiting`, `drive: "none" \| "registered" \| "holding" \| "error"`, `lastError`) | §3.9 |
| 토글 | `ExtHost.registration(id): RegistrationHandle \| undefined`의 `enable()`, `disable()` | §3.1, §4.5.2 |
| 주도 스택 읽기 | `ExtHost.driveFrames(threadId): readonly DriveFrameView[]`(E3, drive-isolation.md 2.6). 맨 아래가 코어 루프 깊이 0이다. 계약 `DriveFrameView`는 F.extensions.spec | §3.5, §4.3 |
| 주도 시작 요청 | `ExtHost.startDrive(threadId, scopeId, options?)`, `RegistrationHostApi.startDrive(input?)` | §3.2, §3.5 |
| 중재 포트(제거) | `DriveLockArbiterPort.choose`와 `DriveLockArbiterPortKey`는 E3에서 엔진이 쓰지 않는다. 계약 정리 단계(E3)에서 걷었다 | §3.5 | [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
| Drive를 맡는 플러그인 설정 | `x.primitives.activeDriver`는 E3에서 설정과 계약에서 걷었다. 주도 시작은 명령과 프로필이 한다 | §3.5, §6 |
| 리소스 등록 | `hostOf(g).registerTool`, `hostOf(g).registerCommand`, `hostOf(g).registerProvider`, `ExtHost.resources` | §3.8, §3.9, §4.8 |
| 상태 커밋과 크기 상한 | `commit`의 `expectStateRev`, `state_too_large` | §4.6.1 |
| 유휴 토글 적용 | 유휴면 다음 매크로태스크에 적용 | §4.5.5 |

X에 요청한 것 [반영됨: X.1(요청 1~3)과 테스트 호스트 재시작(요청 4 일부)이 `xeon/foundation`에 병합됐고, 요청 6·7은 M3a X-3이 닫았다]:

1. `DriveLockCandidate.enabledAtSeq: number | null`(마지막 `scope.changed{status:"enabled"}`의 seq). [반영] F `DriveLockCandidate`에 있다.
2. 현재 drive lock의 `leaseId` 조회. [반영] `ExtHost.leaseOf(threadId)`가 `LeaseInfo{leaseId, scopeId, leaseEpoch, status}`를 돌려준다. `OrchestrationStatus.leaseId`에 쓴다.
3. Registration 상태·drive lock 상태 변경 구독. [반영] `ExtHost.onChange(listener)`가 `ExtChange{kind: "scope" | "lease", scopeId, threadId}`를 경계 커밋 뒤 알린다. `OrchestrationService.onChange`에 쓴다. `kind: "data"`(확장 상태·기록 커밋, AGE-78)는 화면 알림용이라 이 구독에 쓰지 않는다.
4. 테스트 호스트 재시작. [반영] `TestHost.restart()`.
5. 2차: 계측·승격 집계용 내구 이벤트 조회(kind 접두 필터)와 도구 소유 Registration 조회. [반영, B4-GRP] `ExtHost.queryEvents(threadId, { kindPrefix })`(M3-REQ-39, 계측은 M3b부터 쓴다)와 `ExtHost.toolOwner(name)`(`ResourceRecord`의 `scopeId`·`extension`)이 X에 있다. `OrchestrationHostView`가 두 메서드를 쓴다.
6. [반영, M3a X-3] 재실행 문맥 조회: `hostOf(g).callContext(): { kind: "on" | "drive"; threadId: ThreadId; signal: AbortSignal; point?: HookName } | undefined`(X.primitives.spec §3.8). setup, 명령 처리기, 도구 `execute`, drive의 `turn`·`spawn` 안에서는 undefined다. `OrchestrationHostAccess.callContext()`가 이 값을 그대로 돌려준다. `delegate`는 on 핸들러와 drive 함수 안에서 문맥의 thread와 신호를 쓰고, `{ threadId, signal }` 옵션은 명령 처리기와 도구 `execute`에서만 필요하다. `delegateStatus`의 on 거부와 `cancelDelegates`의 on·drive 거부(`orchestration.effectNotAllowed`)는 실제 호스트에서 동작한다(`delegate-real-host.int.test.ts`).
7. [반영, M3a X-3] `SessionFeedPortKey`(`{ name: "fresnel.session", member: "feed" }`)를 `@fresnel/ext-host` 공개 진입점에서 내보낸다. orchestration-sdk은 이 키를 쓰고 자체 키(`GroupFeedPortKey`)는 없앴다(§3.8 "거부 표시").

- 설정 읽기와 쓰기는 설정 서비스(F.wire-settings.spec `EffectiveSetting`, `WriteCheck`)로 한다. X에는 이 용도의 API가 없다 [가정: 서비스 이름은 F.wire-settings.spec].
- drive lock 교체 [가정]: X는 반납 경계에서 `lease.released`를 기록하고(X.primitives.spec §4.5.3 끄기 2번), 다음 판단(§4.4.1 3번)에서 새 `lease.acquired`를 기록한다. 같은 경계 훅에서 반납과 부여가 함께 일어나면 같은 경계 커밋에 실린다고 본다. X 문서가 다르게 정하면 §5 6번을 고친다.

## 4. 동작 규칙

### 4.1 결정에서 옮긴 규칙

| 규칙 | 표지와 근거 |
|---|---|
| drive lock은 한 번에 플러그인 하나만 가진다. `on`, `post`, 백그라운드 위임은 공유한다 | [결정] `_research/layer-plan-v2-notes.md` 층 사이 규칙 4, F.extensions.spec §4.6 |
| 플러그인끼리 직접 참조하지 않는다. 통신은 이벤트와 레코드만 쓴다 | [결정] 층 사이 규칙 3, F.extensions.spec §4.8, `eng.context-map.design` CM-06 |
| 켜기·끄기는 단계 경계에 적용하고 정리는 Cordis dispose로 실행한다 | [결정] 층 사이 규칙 5, F.extensions.spec §4.5. 적용 시점을 단계 경계로 읽는 해석은 [결정: review.decisions-2 U-01] |
| Helm과 학습 플러그인은 L3 기본 플러그인이고 학습 플러그인은 drive를 쓰지 않는다 | [결정] `_research/decisions-log.md` 2026-10-21 계획 v2, `eng.context-map.design` 3절 규칙 4 |
| drive 단계 함수는 마지막 커밋 상태로 다시 호출되고 효과는 `turn`·`spawn` 명령과 `post`, `delegate`로만 낸다 | [결정] F.extensions.spec §4.6 |
| 예산은 drive lock 상한에만 건다. drive lock 상한 기본값은 pi 방식(기본 상한 없음)의 예외로 둔다 | [결정] F.extensions.spec §4.6, `_research/decisions-log.md` 계획 v2. 예외는 [결정: review.decisions-2 U-12] |

### 4.2 로드와 setup 순서

1. 조립 루트(`apps/host`)가 `orchestration-sdk`을 Cordis 플러그인으로 등록한다 [가정: X 플러그인 정의 API]. `orchestration-sdk`은 확장 매니페스트를 갖지 않는 내장 서비스 플러그인이다 [제안]. `orchestration` 선언이 있고 L3 루트 플러그인을 가진 매니페스트만 플러그인으로 읽히기 때문이다(매니페스트 검증에서 이 검사를 둘지는 [미결]이고, 지금은 `defineOrchestration`이 `orchestration_missing`으로 검사한다).
2. `orchestration-sdk` 플러그인은 `fresnel.ext`를 주입받고 `fresnel.orchestration`(`OrchestrationService`)를 제공한다. 중재 포트는 없다(E3). `choose`는 계약에서 걷었다(§3.5). [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
3. X 로더가 오케스트레이션 모듈마다 `validateManifest`, `validateManifestSet`을 부르고, 설정 묶음을 카탈로그에 넣고, `entry`를 부른다. setup 직후 X가 `validateUsage`를 부른다.
4. 플러그인 setup 안의 `g.drive(fn)`은 등록만 한다. drive lock은 §4.3이 정한다.
5. 구성원이 있으면 뿌리 Registration 뒤에 구성원 Registration을 `plugins[]` 순서로 등록한다 [제안]. 구성원의 켜짐 기본값은 `pluginDefaultEnabled`가 정한다. 구성원은 `defaultEnabled`를 적지 않으면 꺼져 있다. `defaultEnabled`는 프로필이 없을 때의 켜짐만 정하므로, 프로필이 그 구성원을 목록에 넣으면 `defaultEnabled: false`여도 함께 켜지고 setup이 돈다 [제안값: 2026-11-22 오케스트레이터, AGE-33. 구현이 이미 이렇게 동작한다]. 꺼진 동안만 setup이 돌지 않는다 [근거: packages/contracts/src/extensions/manifest.ts `pluginDefaultEnabled`].

### 4.3 drive 역할 계산과 주도 시작

1. 역할은 `driveFrames`로 읽는다(§3.5 표). 같은 스택 상태에서는 같은 역할이다(순수 계산).
2. 주도 시작 요청은 사용자 명령, 프로필 시작, 맡기기만 낸다. 플러그인을 켜거나 설정을 바꿔도 요청하지 않으므로 스택에 오르지 않는다.
3. 같은 scope의 사용자 시작 요청은 전환이 아니므로 엔진이 버린다(drive-isolation.md 2.2). 그래서 도구가 이미 맨 위인 플러그인을 다시 깨우는 것은 무해하다.
4. `OrchestrationStatus.leaseId`는 그 플러그인 프레임의 `leaseId`다. 맨 위가 아닌 프레임도 같은 값을 쥔다.
5. 맡기고 기다리는 플러그인(`waiting`)의 drive 함수는 호출되지 않는다. 그 플러그인의 `on` 핸들러, `post`, `delegate`, `commit`, `record`는 계속 동작한다.
6. 질문 대기(`asking`)는 반납이 아니다. 프레임 상태만 `asking`이고 `DriveRole`은 `holder`다.

### 4.4 켜기·끄기와 대기 표시

- `OrchestrationService.enable/disable`은 `RegistrationHandle.enable/disable`을 부른다. 요청만 기록하고 X가 단계 경계에서 적용한다(F.extensions.spec §4.5). 적용되면 `scope.changed`가 커밋된다.
- 요청과 적용 사이에 `OrchestrationStatus.pendingToggle`이 채워지고 상태줄에 "다음 단계 경계에 적용"이 붙는다(§3.9).
- 비활성화 적용 순서는 F.extensions.spec §4.5 [제안](on 핸들러 제외 → drive lock 반납 → `onDispose`)을 따른다. orchestration-sdk `wrap`은 `onDispose` 목록 끝에 계측 마감(2차)을 더한다.
- 실행 중인 turn이 없을 때의 적용 시점은 X.primitives.spec §4.5.5가 정한다(유휴 thread는 즉시 적용, [결정: 2026-11-04 사용자, 결정 목록 R19]). 그 시점이 "즉시"이므로 `ToggleReceipt.appliesAt`은 `"now"`다.
- 구성원은 뿌리와 따로 켜고 끈다. 설치 때 구성원 가운데 하나의 setup이 실패하면 이미 켜진 구성원을 함께 끈다(X `install`의 구성원 묶음 규칙, [제안: F.extensions.spec §4.5]).

### 4.5 상태 커밋 규칙

- 구성원의 상태 문서는 그 구성원 Registration에만 속한다 [제안]. `g.state()`, `g.commit()`, drive 단계 함수의 `state`는 자기 구성원의 문서만 읽고 쓰며 뿌리 문서와 섞이지 않는다.

1. `g.commit(next)`는 상태 문서 전체를 교체한다. 부분 패치는 없다(F `RegistrationApi.commit`).
2. 커밋 전 `checkStateCommit`이 `StateDecl.schema` 검사와 크기 검사(직렬화 UTF-8 64 KiB 이하)를 한다. 실패하면 `commit`은 거부되고 상태는 그대로다. 오류는 `OrchestrationError{kind:"orchestration.stateInvalid"}`로 남는다.
3. 직전 커밋 값과 깊이 같으면 이벤트를 쓰지 않고 현재 값을 돌려준다.
4. 빈도 [제안]: drive 단계 함수는 `turn`·`spawn` 명령 결과 하나에 `commit` 명령 한 번을 권장한다. `on` 핸들러는 한 디스패치에서 같은 scope에 커밋 한 번까지다. 넘으면 계측에 경고를 남긴다(2차). 토큰 단위 진행이나 카운터 틱은 상태 문서에 커밋하지 않는다(`eng.events.design` EV-02 취지).
5. 큰 본문(탐구 결과, 스킬 본문)은 상태 문서에 넣지 않는다. L2 저장소에 쓰고 id만 둔다.
6. 멱등 reducer [결정: review.decisions-2 §3 T-20]: 확장 상태 투영은 X.primitives.spec 정의를 따르므로 재실행 규칙도 X 규칙을 따른다. `on` 핸들러는 소비 커밋 전 크래시 뒤 다시 실행될 수 있다. 다시 실행된 핸들러의 `ctx.state`는 이미 커밋된 판(k+1)이다(X.primitives.spec §4.6.1 재실행 규칙). 그래서 상태 갱신은 이미 반영된 입력을 다시 적용해도 결과가 같은 함수로 쓴다. 처리한 입력의 id를 doc에 두고, 같은 id이면 현재 값을 그대로 돌려준다. 그러면 재실행의 `commit`은 3번 규칙에 따라 이벤트를 쓰지 않는다.

```ts
// 설명용. 처리한 stepId를 doc에 두는 멱등 reducer
interface CountState { readonly turns: number; readonly lastStepId: string | null }

function countTurn(st: Readonly<CountState>, stepId: string): CountState {
  if (st.lastStepId === stepId) return st;            // 이미 반영된 입력. 다시 세지 않는다
  return { turns: st.turns + 1, lastStepId: stepId };
}

g.on("boundary.step.after", async (end, _current, ctx) => {
  await g.commit(countTurn(ctx.state, end.stepId));   // 재실행되어도 turns는 한 번만 오른다
  return undefined;
});
```

- 판 번호나 입력 id 없이 `st.turns + 1`처럼 현재 값에 더하기만 하는 갱신은 쓰지 않는다. 재실행에서 이미 오른 값에 다시 더해 핸들러가 받는 값과 부수 결과(post 본문, record payload)가 처음 실행과 달라진다.
- 입력 id가 여럿 쌓이는 경우(여러 도구 결과)는 최근 id 몇 개만 둔다. 상한은 2번의 64 KiB 안에서 플러그인이 정한다.

### 4.6 분기·재개 때 복원

- 기준은 thread의 leaf다(F.records.spec §4.6).
- [결정: review.decisions-2 §3 T-20] 플러그인 상태 = leaf의 조상 경로(활성 가지)에서 가장 가까운 `grp.<그룹>.state.committed` 이벤트의 `doc`(업캐스트 뒤). 없으면 `StateDecl.initial`이다. 활성 가지 규칙은 X.primitives.spec §4.6.1이 정한다.
- 투영 `x_<그룹>_state`의 `prev_event_id` 연결로 조상 경로의 상태를 찾는다. 투영은 X가 소유하고 재생으로 다시 만들 수 있다(X.primitives.spec §4.6.1).
- drive lock 복원: 마지막 `checkpoint.step`의 `leaseRefs`(F.records.spec §3.6)가 가리키는 `lease.acquired`가 있으면 X가 그 플러그인의 drive 함수를 복원한 상태로 다시 부른다. 분기로 leaf가 drive lock 전 시점으로 가면 `leaseRefs`가 비고, `decide`가 처음부터 다시 정한다.
- 분기 뒤의 drive 재호출은 재개와 같은 규율을 따른다. `turn` 명령의 기본 `requestId`(`${lineageId}:${상태 판}.${단계 번호}`)는 가지가 다르면 계통 id가 달라 충돌하지 않는다. 계통은 `waiting` 반납 바로 뒤 같은 thread의 재부여만 잇기 때문이다 [가정: X.primitives.spec §4.4.1 11번]. 같은 가지 안에서는 단계 번호가 단계마다 0부터 다시 세므로, 턴 명령의 기본 id와 뒤 단계 `commit` 명령의 id가 겹칠 수 있다. 플러그인은 턴 명령에 `requestId`를 명시해 피하고, 엔진 쪽 결함은 §10에 적었다.

### 4.7 상태 스키마 버전과 마이그레이션 훅

- `StateDecl.version`을 올리면 `OrchestrationDef.migrations`에 빠짐없는 출발 버전 함수를 둔다. 빠지면 `state_migration_missing`(§3.3)으로 정의가 거부된다. F.extensions.spec §3.2 `StateDecl.version` 주석("올리면 X가 마이그레이션 훅을 요구한다")의 orchestration-sdk 쪽 구현이다.
- `defineOrchestration`은 `migrations`를 F `Upcaster` 배열로 바꿔 `OrchestrationModule.stateUpcasters`에 둔다. 저장된 이벤트는 고치지 않고 읽을 때 올린다(F.records.spec §3.7 규칙 2, 3).
- 마이그레이션 함수는 순수 함수다. 결과가 새 `schema`를 통과하지 못하면 `orchestration.migrationFailed`로 그 플러그인 로드를 실패로 처리한다. 다른 플러그인은 영향을 받지 않는다.
- 버전을 내리는 것은 허용하지 않는다. 저장된 버전이 현재보다 크면 F `future_version` 오류로 로드 실패다.

### 4.8 플러그인 간 통신 규칙

- 레코드 kind는 F 형식 `grp.<그룹>.<영역>.<이름>`이다. 공통 확정 kind(L3.helm.spec, L3.learning.spec가 소유):
  - helm 작성: `grp.helm.signal.detected`, `grp.helm.discovery.recorded`, `grp.helm.inquiry.finished`
  - learning 작성: `grp.learning.skill.proposed`, `grp.learning.skill.approved`, `grp.learning.skill.rejected`, `grp.learning.skill.applied`, `grp.learning.memory.proposed`, `grp.learning.feedback.proposed`, `grp.learning.review.finished`, (2차) `grp.learning.script.proposed`
  - 읽기: helm과 learning은 서로의 레코드를 읽지 않는다 [결정: review.decisions-2 D-10]. 두 플러그인의 레코드는 L4 표시와 이력용이다
- 플러그인은 레코드를 읽고 해석에 실패해도 예외를 밖으로 던지지 않는다. 버전이 더 크면 F `record_version_unknown` 경고와 원형 payload를 받는다(F.extensions.spec §5 9번).
- 한 플러그인이 꺼져도 다른 플러그인은 동작한다. 레코드가 오지 않을 뿐이다.

### 4.9 계측 기록 (2차)

- **훅 카운터(M3b).** `on` 래퍼는 핸들러를 감싸 반환과 예외를 센다. first 훅에서 정의된(`undefined`가 아닌) 반환은 `denies`, chain 훅의 정의된 반환은 `chainPatches`, 던진 오류(동기 던지기와 거부된 Promise 모두)는 `handlerErrors`를 올리고 같은 값으로 다시 던진다. tap과 collect 훅은 `handlerErrors`만 센다. 반환값은 바꾸지 않는다.
- **사용량 쓰기(M3b, LR-17).** `metrics.addUsage(delta)`가 `tokens`와 `costUsd`를 더한다. 이 값은 프로세스 메모리 스냅샷(`snapshot()`)에만 남고 `orchestration.metrics`와 `OrchestrationStatus.metrics`는 읽지 않는다. 같은 사용량이 자식의 `agent.settled`로 이벤트에도 남아 두 번 세지 않기 위해서다 [결정: T-MEAS-FIX]. 인자 검사는 §3.12 대로다.
- **이벤트 집계(M3b, G-17).** `summarizeUsage(events)`는 순수 함수다. 한 thread의 이벤트열을 scope별로 접는다. `lease.acquired`는 drive lock 수를 올리고, 같은 `leaseId`의 `lease.released`는 `recordedAt` 차이를 drive lock 시간에 더한다. 풀리지 않은 drive lock은 수에만 든다. `turn.started`의 scopeId가 null이 아니면 그 turnId의 `turn.completed` 사용량을 그 scope에 더한다. `agent.settled.usage`(자식 사용량, 부모 `turn.completed`에 없다)는 `owner`가 `scope`나 `drive`이면 그 `scopeId`에 더한다. `owner`가 없는 옛 기록은 같은 `childThreadId`의 `agent.spawned.owner`를 읽고, `tool` 소유는 플러그인에 귀속하지 않는다. 같은 `childThreadId`와 `requestId`는 한 번만 센다 [결정: T-MEAS-FIX, 기획서 §9]. 플러그인 토큰과 비용의 원천은 이 접기 하나다(계약: 부분의 합이 전체와 맞고, 같은 사용량을 두 출처에서 세지 않는다). 검사에 실패한 payload는 건너뛴다. 시계는 읽지 않는다(TY-21).
- **서비스 캐시와 상태(M3b).** `refreshUsage(threadId)`는 `queryEvents(threadId, { kindPrefix: "lease." })`, `{ kindPrefix: "turn." }`, `{ kindPrefix: "agent." }`를 읽어 `seq` 순으로 합치고 `summarizeUsage`로 접는다. 결과는 그 thread의 캐시가 된다. 조회가 하나라도 실패하면 캐시를 그대로 두고 던지지 않는다. `/group status`는 상태를 보이기 전에 현재 thread를 한 번 갱신한다. `OrchestrationStatus.metrics`는 등록부의 카운터(denies, posts, spawns, delegates)와 캐시를 합친다. `costUsd`는 이벤트 집계(`turn.completed`와 `agent.settled`)의 비용이며 카운터 `addUsage`는 더하지 않고, `leaseMs`는 `lease.*` 구간의 합이다. 캐시는 마지막으로 갱신한 thread의 값만 보인다. 다른 thread를 보면 이벤트 값은 0이다.
- **등록부(M3b).** `wrap`은 플러그인 이름으로 계측 핸들을 프로세스 전역 등록부(`defaultMetricsRegistry`)에 등록한다. 같은 이름으로 다시 등록하면 새 핸들이 옛 핸들을 대신한다. 조립 루트의 배선은 없다 [결정: 오케스트레이터 기본값, M3b].
- **단계 경계 기록(M3b).** 기록은 플러그인 자신의 `boundary.settle.after` 핸들러가 끝난 뒤, 그 핸들러 호출 안에서 쓴다. 별도 핸들러로 쓰지 않는다. X는 핸들러 호출마다 멱등 키의 번호를 0에서 세므로, 같은 scope가 같은 호출 키로 쓰는 별도 핸들러의 `recordPrivate`는 플러그인 핸들러의 기록과 같은 키(`rec:<scope>:<키>:0`)를 받는다. 그러면 플러그인 쪽 기록이 거부된다. 그래서 기록은 플러그인 핸들러 안에서, 그 핸들러가 부른 기록과 커밋 뒤의 번호를 이어받아 쓴다 [결정: 오케스트레이터 기본값, M3b].
  - 핸들러가 정상으로 끝난 뒤 설정 읽기 포트(`settingsSource`)로 `l3.orchestration.instrumentation`을 읽는다. 값이 `false`가 아니면(읽지 못하거나 값이 없으면 참) 마지막 기록 뒤의 증가분을 구한다. 0이 아닌 값이 하나라도 있을 때만 `grp.<그룹>.metrics.recorded`를 그 플러그인의 `recordPrivate`로 쓴다. payload는 `{ stepId: 경계 turnId, delta }`다 [결정: 오케스트레이터 기본값, M3b].
  - 같은 호출(dispatch)에서는 한 번만 쓴다. 이 프로세스에서 기록을 시도한 turn(최근 64개)은 다시 발화해도 쓰지 않는다. 시도가 실패한 turn도 같다. 이 검사가 재발화 때 같은 키의 기록이 거부되는 것을 막는다.
  - 쓰기가 성공했을 때만 기준을 옮긴다. 쓰기가 실패하면(X 거부, 저장 오류, 같은 키 재기록의 거부 모두) 기준을 옮기지 않고, 그 오류는 플러그인 핸들러에 전하지 않는다. 플러그인 핸들러는 성공으로 끝나고 `handler_failed`를 내지 않는다. 증가분은 다음 기록에 그대로 든다. 끄는 동안에는 기준을 옮기지 않으므로, 다시 켠 첫 경계의 기록에는 끈 동안의 증가분도 든다.
  - 플러그인이 핸들러 호출 안에서 올린 값(게시, 커밋, 위임 등)은 같은 경계의 기록에 든다.
- **기록의 한계(M3b).**
  - 매니페스트가 `boundary.settle.after`를 선언하고도 경계 핸들러를 달지 않은 플러그인에는 기록을 쓰지 않는다. 기록은 플러그인 핸들러에 붙어 있으므로 핸들러가 없으면 쓸 곳이 없다. 그 플러그인의 값은 `snapshot`과 `/group status`에서만 본다. 기록을 쓰려면 경계 핸들러를 달아야 한다.
  - 기준은 프로세스가 뜬 뒤 0에서 시작한다. 재시작 뒤 첫 기록은 재시작 뒤의 증가분만 담고, 옛 프로세스의 값은 기록에 없다.
  - 재시작 뒤에 이미 기록한 경계가 다시 발화하면, 새 프로세스의 증가분과 옛 기록의 payload가 달라 같은 키의 기록이 거부될 수 있다. 이 거부는 수용한다(§10): 그 기록은 건너뛰고 증가분은 다음 기록에 든다. 플러그인 핸들러와 상태 커밋에는 영향이 없고 `handler_failed`도 나지 않는다.
  - 마지막 경계 뒤에 플러그인 밖에서 올린 값은 다음 경계가 있어야 기록된다.
- 계측 코드는 시계를 직접 읽지 않는다(TY-21).
- kind 소유 [결정: review.decisions-2 T-21]: `grp.<그룹>.metrics.recorded`의 접두 소유자는 각 플러그인이고 생산 코드는 orchestration-sdk `wrap`이다. `grp.<그룹>.state.committed`는 X가 쓴다(X.primitives.spec §4.6.1). 커밋 단위는 X.primitives.spec §4.6.5를 따른다. 멱등 키는 `record`와 같아 재실행된 같은 호출은 `replayed`다. kind는 매니페스트 `recordKinds`에 선언하지 않는다(공개 kind와 같은 이름이면 `record_private_invalid`).

### 4.10 위임 규칙

- `delegate`는 켜진 플러그인이면 drive lock과 관계없이 부를 수 있다. 꺼지는 중(`disabling`)이면 `orchestration.disabling`을 돌려준다.
- 플러그인이 꺼지면 진행 중인 위임을 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04]. 끈 뒤에도 토큰을 쓰고 결과가 들어오면 사용자 기대와 어긋나기 때문이다. 플러그인은 `onDispose`에서 `cancelDelegates`를 부르고, orchestration-sdk은 L1 `AgentService.cancel({ ownerRegistrationId })`(L3.learning.spec §8.1 REQ-LN-06)로 옮긴다. 옛 [제안](완료까지 두고 보고 post를 넣음)은 쓰지 않는다.

## 5. 실패와 경계 사례

| # | 사례 | 처리 |
|---|---|---|
| 1 | 이름 충돌: 같은 `name`의 플러그인이 둘 설치됨 | X `validateManifestSet`이 `name_conflict` 오류를 낸다. 뒤에 로드한 쪽을 거부한다 [가정: X.loading-trust.spec]. 이름이 `RESERVED_ORCHESTRATION_NAMES`(예: `auto`)면 `defineOrchestration`이 `orchestration_name`으로 거부한다 |
| 2 | 존재하지 않는 플러그인 이름 | Drive를 맡는 플러그인 설정은 없다(E3). 이름 해석은 명령 경로의 규칙을 따른다 | [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
| 3 | drive 함수 예외 | X가 그 프레임을 내린다(`lease.released{reason:"error"}`, F.extensions.spec §5 6번). `OrchestrationStatus.drive = "error"`, `lastError = orchestration.driveThrew`. `on` 핸들러와 `post`, `delegate`는 계속 동작한다. 오류 표시는 플러그인을 끄고 다시 켜면 지워진다(X.primitives.spec §4.4.3 예외 규칙). 그동안 시작 요청은 `drive_error`로 거부된다 |
| 4 | 맡기고 기다리는 플러그인이 비활성화됨 | 끄기가 적용되는 단계 경계에서 그 프레임과 위 프레임이 `disabled`로 내려간다(X.primitives.spec §4.5.3) [가정]. `scope.changed{disabled}`가 커밋된다 |
| 5 | 주도 중인 플러그인이 비활성화됨 | 끄기가 적용되는 단계 경계에서 `lease.released{reason:"disabled"}`가 기록되고 진행 중 turn 명령은 정착까지 돈다(X.primitives.spec §4.5.3). 아래 프레임은 `aborted`로 이어 받는다. 새 후보를 고르지 않는다. 다음 주도는 사용자의 시작 요청으로 한다 |
| 6 | drive lock 교체 중 프로세스 종료 | 반납 커밋 전 종료면 이전 holder가 그대로이고 재개 뒤 `openThread`가 열린 drive 락 목록(`openLeases`, 오래된 것부터)으로 스택을 세우고 맨 위 프레임의 drive 함수를 다시 부른다. 반납 커밋 뒤 부여 전 종료면 사용자 명령과 맡기기의 시작 요청은 `lease.requested` 기록에서 큐에 되살아난다(프로필 시작은 열 때 다시 만든다, AGE-26). 부여 커밋 뒤 종료면 새 holder의 drive 함수가 마지막 커밋 상태로 다시 불린다 |
| 7 | Drive를 맡는 플러그인 지정이 진행 중 turn이나 다른 플러그인의 주도와 겹침 | 엔진은 지정 값을 읽지 않는다(E3). 지정은 기록만 되고 스택은 바뀌지 않는다. 주도를 옮기려면 사용자가 그 플러그인의 주도 시작 명령을 낸다. 같은 scope 명령은 전환이 아니다. 진행 중 `loop.turn`은 끝까지 돈다 |
| 8 | 같은 단계에서 켜기와 끄기 요청이 겹침 | 마지막 요청만 적용한다(X `RegistrationHandle` 규칙 [가정]). 상태줄은 마지막 요청을 보인다 |
| 9 | 상태 커밋이 스키마나 크기 한도 위반 | `commit` 거부, 상태 유지, `orchestration.stateInvalid`. drive 함수 안이면 예외로 이어져 3번 처리 |
| 10 | 상태 마이그레이션 실패 | 그 플러그인만 로드 실패(`orchestration.migrationFailed`). 다른 플러그인과 대화는 계속 |
| 11 | 매니페스트에 없는 레코드 kind 쓰기 | F `validateUsage` `record_kind_undeclared`. 이벤트를 쓰지 않는다 |
| 12 | `delegate`의 `requestId`가 48자 초과이거나 `report.customType`이 자기 접두가 아님 | 호출 전 `{ ok: false, error: { kind: "orchestration.delegateInvalid" } }`. 위임은 만들지 않는다 |
| 13 | (E3에서 걷음) `x.primitives.activeDriver` 키가 없어 이 경우가 생기지 않는다 | 해당 없음 | [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
| 14 | drive 플러그인이 하나도 없음 | 스택이 비어 있으면 상태줄에 `[구동]` 항목이 없다 | [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
| 15 | 저장 상태가 스키마를 어겨 켜지지 못함(X `state_schema`) | `OrchestrationStatus.lastError = orchestration.stateInvalid`. 상태는 그대로 두고 플러그인을 켜지 않는다. `/group reset <이름>`(B4-GRP, §3.9)이 선언 초기값을 새 판으로 쓰고 오류를 지운다. 켜기 상태(`scope`)는 바꾸지 않으며 적용은 다음 단계 경계에 일어난다(시험 `reset.command-restores-the-declared-initial-and-the-group-runs-at-the-next-boundary`) |
| 16 | 매니페스트가 선언한 구성원 id에 정의가 없거나, 정의 키가 구성원이 아님 | `defineOrchestration`이 `Bug`를 던진다(`member_missing`, `member_unknown`). 정의가 없으면 구성원 Registration도 없다 [제안] |
| 17 | `orchestration.members` 밖에 있는 id 있는 플러그인 | 구성원이 아니므로 SDK는 등록하지 않는다. 로더가 `plugin_not_registered` 경고를 낸다 [미결, §10] |

## 6. 설정 노출

`defineSettings("l3.orchestration", …)`로 선언한다(F.wire-settings.spec §3.8.3). 탭은 모두 `plugins`("플러그인", `_research/layer-plan-v2-notes.md` L4 설정 화면 구성안)다.

| 키 | 타입 | 기본값 | 범위(`allowedScopes`) | 대화 중 변경 | `runtimeChange` | 위젯 | 뜻 |
|---|---|---|---|---|---|---|---|
| `l3.orchestration.instrumentation` | boolean | `true` | managed, user, project, local, launch | 가능 | `live` | `toggle` | 오케스트레이션 계측 기록(§4.9, 2차) |

- Drive를 맡는 플러그인 선택 [결정: review.decisions-2 S-15, E3에서 걷음]: orchestration-sdk은 Drive를 맡는 플러그인 키를 두지 않는다. 키 `x.primitives.activeDriver`는 설정과 계약에서 걷었다(E3, drive-isolation.md 2.2). orchestration-sdk은 이 값을 읽거나 쓰지 않고 `/group status`도 설정 줄을 내지 않는다. `setDriveHolder`와 `/group drive`도 계약 정리 단계에서 함께 걷었다. [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
- 플러그인 켜기 키: 내장 플러그인과 외부 플러그인 모두 X 로더 예약 키 `ext.<이름>.enabled`다(예: `ext.helm.enabled`, `ext.learning.enabled`. F.extensions.spec §6, X.loading-trust.spec §4.5, F.wire-settings.spec §3.8.3 규칙 1). X 로더만 이 키를 읽고, 플러그인과 orchestration-sdk은 이 키를 선언하지 않는다. 기본값은 매니페스트 `defaultEnabled`다. 값 속성은 X.loading-trust.spec §6 정의를 따른다: `runtimeChange` `live`(요청을 기록하고 적용은 다음 단계 경계), `allowedScopes` managed~session [결정: review.decisions-2 K-04].
- drive lock 상한의 일반 기본값은 X 키 `x.primitives.driveDefaultLimits`, 천장은 `x.primitives.driveLimits`다(F.extensions.spec §6). 플러그인별 요청 상한은 각 플러그인 키(예: `l3.helm.driveLimits`)가 기본값을 덮어쓰고, 천장보다 클 수 없다(review.decisions-2 U-12).
- 명령은 없다(§3.9). 설정 파일과 `fresnel config` 명령은 F.wire-settings.spec §4.9 생성 규칙을 따른다.

## 7. 훅

- orchestration-sdk 자체는 훅을 선언하지 않고 `on` 핸들러도 걸지 않는다. 훅 선언은 F.extensions.spec §3.4다.
- `OrchestrationApi.on`은 F `RegistrationApi.on`을 감싼다. 핸들러 시그니처와 fold는 그대로다. 래퍼는 계측 집계만 더한다(§4.9).
- `post`, `commit`, `record`, `readRecords`, `capability`, `onDispose`는 그대로 전달한다. `registerTool`, `registerCommand`, `registerMethod`, `registerProvider`는 X `hostOf(g)`로 전달한다(§3.2).
- `drive` 등록은 그대로 전달한다. 주도권은 시작 요청(사용자 명령, 프로필, 맡기기)으로만 받는다(§3.5).
- `delegate`는 L1-g 서비스 래퍼다. 훅 목록에 들어가지 않는다. 위임 자식 thread의 훅 발화와 플러그인 핸들러 적용 범위는 [미결]이다(`_research/notes/L3-1.md` §6 마지막 항목).

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `defineOrchestration`, `OrchestrationDef`, `OrchestrationApi`(`registerTool`, `registerCommand`, `registerMethod`, `registerProvider`, `runScript` 포함), `RunScriptOptions`, `OrchestrationModule`, `validateOrchestrationDef`, `orchestrationManifest`, `ORCHESTRATION_NAME_PATTERN`, `RESERVED_ORCHESTRATION_NAMES`(예약 이름 정본) | L3.helm.spec, L3.learning.spec, L3.slots.spec 템플릿, L3.readme §4 |
| `checkOrchestrationName`, `OrchestrationNameError`(R2 이름 검사, 순수 함수) | L3.slots.spec §3.3.4, `L4.cli.spec`(DR-14로 같은 규칙을 따로 구현) |
| `TemplateKindSchema`, `TemplateIndexSchema`, `TEMPLATE_PLACEHOLDERS`, `TemplateKind`, `TemplateIndex` | L3.slots.spec §3.3.3(`templates/index.json`), `L4.cli.spec` |
| `DelegateSpec`, `DelegateReceipt`, `DelegateResult`, `DelegateError`, `DelegateReport`, `DelegateToolPolicy`, `DelegateLimits`, `DelegateFork` | L3.learning.spec, L3.helm.spec, L1.agents.spec(`DelegateRequest` 대응) |
| `OrchestrationService`와 부속 타입(§3.8)의 필드 정의. 정의 위치는 F `services/groups.ts`(F.capabilities.spec §3.12)이고 orchestration-sdk은 다시 내보내며 `service.ts`에서 구현한다 | F.capabilities.spec §3.12, L4.cli.spec, L4.desktop.spec, L4.host-service.spec, L3.helm.spec, L3.learning.spec |
| `parseGroupCommand`, `runGroupCommand`, `groupCommand`, `formatGroupStatusLine` | L4.cli.spec, L4.desktop.spec |
| `checkOrchestration`, `replayDrive`, `scanDriveSource`(M3 이후), `smokeOrchestration` | L3.helm.plan, L3.learning.plan, X.primitives.plan(M1 스모크) |
| 정책 정식 예 `reviewgate`, `commitguard`, `guardrail`(`testing` 진입점), 템플릿 `templates/`(2차) | L3.slots.spec, L3.slots.plan |
| `OrchestrationMetrics`, `OrchestrationMetricsSummary`, `PromotionReport`, `buildPromotionReport` | L4.settings-ui.spec(2차), L3 플러그인 문서 |
| 설정 키 `l3.orchestration.instrumentation`, `l3.orchestration.statusLine` | L4.settings-ui.spec |

요구:

| 이름 | 출처 |
|---|---|
| `ExtensionManifest`, `RegistrationApi`, `StateDecl`, `DriveStep`, `DriveCommand`, `StepResult`, `DriveOptions`, `DriveLock`, `DriveLockId`, `RegistrationId`, `RegistrationStatus`, `RegistrationHandle`, `ExtensionEntry`, `OrchestrationRecord`, `RecordKind`, `OrchestrationId`, `validateManifest`, `validateUsage`, `validateManifestSet` | F.extensions.spec |
| `Upcaster`, `DurableEventEnvelope`, `scope.changed`, `lease.acquired`, `lease.released`, `checkpoint.step`의 `leaseRefs`, 분기 규칙 | F.records.spec |
| `ServiceKey`, `ToolName`. `@fresnel/contracts/services`의 `OrchestrationService`, `OrchestrationServiceName`, `DriveRole`, `OrchestrationError`, `OrchestrationStatus`, `OrchestrationMetricsSummary`(§3.12 `services/groups.ts`) | F.capabilities.spec |
| `SettingDefInput`, `SettingGroup`, `defineSettings`, `SettingScope`, `EffectiveSetting`, `WriteCheck` | F.wire-settings.spec |
| `ThreadId`, `ItemId`, `EventId`, `JsonValue`, 단계 경계 용어 | F.conversation.spec |
| drive lock 메커니즘(§4.4), 중재 포트 호출 규칙은 E3에서 없앴다(§3.5), `ExtHost`(`fresnel.ext`)의 `registrations()`·`registration()`(§3.1, §3.9), `hostOf(g).registerTool`·`registerCommand`·`registerProvider`와 `ToolResourceDef`·`CommandResourceDef`·`ProviderResourceDef`(§3.8, §4.8), 유휴 토글 적용(§4.5.5). 요청 사항 4개(§3.13)와 테스트 호스트(`@fresnel/ext-host/testing`)는 [가정] | X.primitives.spec |
| `AgentService.delegate`, `DelegateRequest`, `ChildToolPolicy`, `ChildLimits`, `ForkPoint`, `DelegateReceipt`(§3.2, §3.3). 서비스 키 경로는 [가정] | L1.agents.spec |
| 모델 테이프(`@fresnel/core-models/testing`) [가정] | L1.models.spec |
| 명령 등록부, 상태줄 표시 위치 [가정] | L4.cli.spec, L4.desktop.spec |
| DR-02 허용 목록, DR-11, DR-14 | eng.dependency-rules.guide |
| 서비스 이름, 테이블·type 접두 소유 | eng.context-map.design |
| EV-08, EV-09, type 이름 규칙 | eng.events.design |

## 9. 수용 기준

1. drive 플러그인 A와 B가 켜져 있어도 시작 요청이 없으면 어느 drive 함수도 호출되지 않고 `OrchestrationStatus.drive`는 둘 다 `"none"`이다. A의 `startDrive`가 받아들여지면 A가 `holder`가 되고 B의 drive 함수 호출 수는 0이다.
2. 1번 상태에서 B의 `tool.call.before` 핸들러와 `post`는 계속 호출·수락되고, B가 `delegate`를 부르면 `accepted` 영수증을 받는다.
3. holder A가 있을 때 C를 새로 켜도 단계 경계 뒤 C는 스택에 오르지 않는다(켜기는 주도 요청이 아니다). `OrchestrationStatus.drive`는 C가 `"none"`이다.
4. A가 맨 위에서 주도하는 동안 B가 `startDrive`를 내면 A의 진행 중 turn 명령은 `completed`로 끝나고, 전환 정책(`USER_SWITCH_AT`)에 따라 스택 전체가 `revoked`로 내려간 뒤 B가 주도한다. 같은 scope의 시작 요청은 버린다. A를 끄면 끄기가 적용된 경계에 `lease.released{reason:"disabled"}`(A)가 기록된다.
5. 시작 요청의 대상이 drive를 쓰지 않는 플러그인이면 `startDrive`는 `not_drive`를 돌려주고 drive 함수는 하나도 호출되지 않는다.
6. (E3에서 걷음) `setDriveHolder`와 `/group drive`는 없다. 이 항목은 시험하지 않는다. [근거: drive-isolation.md 2.2]
7. 실행 중 `/group off helm`은 `pending: true`를 돌려주고, 다음 단계 경계 전까지 상태줄 끝에 `다음 단계 경계에 적용`이 있으며, 경계 뒤 `scope.changed{status:"disabled"}`가 정확히 한 번 커밋된다.
8. `orchestration-sdk` 소스에서 `@fresnel/plugin-helm`, `@fresnel/plugin-learning` import가 0이다(check-layers). `plugin-helm`에 `@fresnel/plugin-learning` import 샘플을 넣으면 check-layers가 DR-02로 실패한다.
9. M1 테스트 플러그인(`smokeOrchestration`)이 한 턴에서 `on`(`tool.call.before`, `boundary.step.after`), `post`, `drive`를 모두 쓰고, `checkOrchestration(smokeOrchestration)`의 오류가 0이다.
10. setup에서 매니페스트 `plugins[].hooks`에 없는 훅에 `on`을 건 플러그인은 `checkOrchestration`이 `hook_undeclared`를 돌려준다. `name: "auto"`, `name: "web"`(L2 도메인 이름)인 정의는 `defineOrchestration`이 `orchestration_name`으로 `Bug`를 던진다. `state` 없이 `on`만 쓰는 정의는 오류 없이 `OrchestrationModule`(`stateVersion: 0`)을 만든다.
10a. `registerTool`, `registerCommand`로 등록한 도구와 명령은 플러그인을 끄면 해제된다(가짜 `ExtHost.resources` 등록 수로 확인).
10b. `orchestrationManifest`는 `orchestration` 선언이 없는 매니페스트 값에 `Bug`(`orchestration_missing`)를 던지고, 템플릿 `plugin.json`과 같은 값에는 `OrchestrationManifest`를 돌려준다.
10c. `registerProvider`로 등록한 provider는 플러그인을 끄면 해제된다(가짜 `ExtHost.resources`와 가짜 `fresnel.models` 포트의 등록 수로 확인).
11. 상태를 v1, v2 순서로 커밋한 뒤 v1 커밋 직후 이벤트로 분기하면 `g.state()`는 v1 문서다. 같은 thread를 재개하면 drive 함수 인자도 v1 문서다.
12. `StateDecl.version: 2`이고 `migrations[1]`이 없으면 `validateOrchestrationDef`가 `state_migration_missing`을 낸다. 있으면 v1으로 저장된 상태가 v2 스키마를 통과하는 값으로 읽힌다.
13. 64 KiB를 넘는 상태 커밋은 거부되고 `state.committed` 이벤트 수가 늘지 않는다. 직전과 같은 값의 커밋도 이벤트를 쓰지 않는다.
14. 같은 thread에서 같은 `requestId`로 `delegate`를 두 번 부르면 두 번째 영수증은 `duplicate`이고 자식 thread는 하나다.
15. `replayDrive`는 `eng.events.design` EV-09의 좋은 예 플러그인에 `ok: true`, 나쁜 예(클로저 카운터) 플러그인에 `ok: false`와 `firstDiff`를 돌려준다.
16. `scanDriveSource`는 drive 함수 안의 `Date.now()`에 `SD-01`을 내고, 같은 파일의 drive 밖 `Date.now()`에는 아무것도 내지 않는다.
17. 플러그인 A가 등록한 도구를 플러그인 B의 drive lock turn이 호출하면 `buildPromotionReport`의 A 도구 항목이 `candidate: true`이고 소비자는 B다. 사용자 입력 turn의 호출은 `userCalls`에만 더해진다.
18. `l3.orchestration.instrumentation = false`면 `grp.<그룹>.metrics.recorded` 기록이 0개이고 `OrchestrationStatus.metrics`는 null이다.
19. `formatGroupStatusLine`은 §3.9 예 표의 다섯 입력에 표의 문자열을 그대로 돌려준다.
20. `orchestration-sdk` 운영 소스에서 `OrchestrationService`, `OrchestrationStatus`, `OrchestrationMetricsSummary`를 정의하는 선언이 0개이고, 이 이름은 `@fresnel/contracts/services`에서 온다. 중재 이름(`DriveLockArbiterPort`, `DriveLockCandidate`, `DriveHolderSetting`, `HolderReceipt`)은 E3에서 계약에서 걷었다.
21. 상태 갱신이 멱등 reducer(§4.5 6번)인 플러그인에서 같은 `boundary.step.after` 핸들러를 소비 커밋 전에 두 번 실행하면 `grp.<그룹>.state.committed`는 한 번만 늘고 두 번째 `commit`은 이벤트를 쓰지 않는다.
22. (M3, ADR-0015) `replayDrive`는 효과 계수기를 가진 하니스에서 모든 절단 시점의 drive·on 핸들러 이중 실행 뒤에도 `EffectCounts`가 기준 실행과 같으면 `ok: true`다. 같은 `requestId` 없이 효과를 두 번 내는 플러그인에는 `failure: "effects-doubled"`를 돌려준다.
23. (M3, ADR-0015) `delegateStatus`는 drive 문맥에서 상태를 돌려주고 on 문맥에서는 거부된다. `cancelDelegates`는 재실행되는 코드에서 거부되고 `onDispose`와 명령 처리기에서는 동작한다.
22a. (M4, T-GK) `replayDrive`는 기준과 다른 thread에서 돈 절단을 `failure: "thread-mismatch"`와 `threadMismatchCuts`로 보고한다(이벤트열이 같아도). `createRuntimeReplayHarness`가 만든 하니스는 모든 실행에서 같은 thread를 쓴다.
22b. (M4, T-GK) `defineOrchestration({ composition })`은 `module.manifest.group.composition`을 채우고 매니페스트 상수를 바꾸지 않는다. 다른 값이 매니페스트에 이미 있으면 `composition_conflict`다. 알 수 없는 `plugin`을 가진 블록은 `composition_plugin_unknown`이다.
22c. (M4, T-GK, X-3) `g.registerMethod`로 등록한 메서드는 `ExtHost.methods.call`로 불리고 모양이 틀린 params는 `params_invalid`이며, 플러그인을 끄면 `methods.list()`에서 사라진다.
24. (E3) 대기 상한과 `lease.rejected` 발행이 없다. 맡기고 기다리는 플러그인의 `OrchestrationStatus.drive`는 `"waiting"`이고, 스택에 없는 켜진 플러그인은 `"none"`이다. [근거: E3 구현(packages/orchestration-sdk/src/service.ts), drive-isolation.md 2.2]
25. (M3b, G-17) `on` 래퍼는 first 훅의 정의된 반환을 `denies`, chain 훅의 정의된 반환을 `chainPatches`, 던진 오류를 `handlerErrors`로 올리고 오류를 같은 값으로 다시 던진다. `undefined` 반환은 세지 않는다.
26. (M3b, LR-17) `metrics.addUsage`는 `tokens`와 `costUsd`를 더한다. 음수나 유한하지 않은 값이면 `Bug`를 던지고 그 호출은 아무 값도 바꾸지 않는다.
27. (M3b, G-17) `/group status`는 현재 thread의 `lease.*`·`turn.*` 이벤트로 drive lock 시간과 비용을 채운다. 조회가 실패하면 이전 캐시를 두고 명령은 성공한다. 계측 기록은 경계마다 증가분만 쓴다. 두 번째 기록에 첫 기록의 값이 다시 들지 않는다.
28. (M4, 구성원) 뿌리와 구성원 `alpha`, `beta`를 `plugins[]`에 선언하고 두 구성원을 `members`로 정의하면 `install`의 `unregistered`가 빈 배열이고, Registration은 `[이름, 이름/alpha, 이름/beta]` 순서다. `members`가 없는 뿌리 전용 정의는 Registration 하나와 이전과 같은 계측 등록부 항목을 낸다. 구성원의 setup은 자기 Registration에서 돌고, 그 `on` 훅은 `extReadViewOf(host).handlers()`에서 `<이름>/<id>`에 붙는다. 정의가 빠지거나 정의 키가 구성원이 아니면 각각 `member_missing`, `member_unknown`이다. 시험: `packages/orchestration-sdk/test/members.test.ts`, `define-group.test.ts`.

## 10. 미결 사항

- [결정: review.decisions-2 T-21] 공통 모순 1(닫힘): 확장 kind는 F 형식 `grp.<그룹>.<영역>.<이름>` 하나다. 상태 이벤트는 `grp.<그룹>.state.committed`(X 소유), 계측은 `grp.<그룹>.metrics.recorded`(`recordPrivate`)다. eng 문서의 옛 밑줄 접두 표기는 쓰지 않는다.
- (닫힘) [결정: adr.0015] 공통 모순 2: F.extensions.spec §4.3(on 핸들러 외부 효과 금지)과 학습 검토 포크 시작·Helm spawn의 관계. C안(2026-10-25)으로 `requestId` 멱등 `g.delegate`와 drive 안 `spawn` 명령, 선언된 기능 호출이 허용된다(§3.4, §3.10). F.extensions.spec 본문 반영은 ADR-0015 §4.3 표에 있다.
- 맞춤(M3-35, 2026-10-29) 공통 모순 3: `xeon/packages/orchestration-sdk/package.json`의 `fresnel.domain`은 `kit`이었고 routes layout 도메인은 `orchestration-sdk`이었다. 이제 `orchestration-sdk`이다. DR-03은 `orchestration-sdk`을 접두 규칙의 예외로 적는다(`eng.dependency-rules.guide` DR-03, `scripts/check-layers.ts`의 `expectedDomain`). 작업 항목은 L3.group-sdk.plan G-02다.
- (닫힘) [결정: review.m3-design-inputs D-M3-05] 대기 vs 거부: 대기가 기본이고 대기 상한을 넘으면 거부한다(§3.5 규칙 3). `product.vision.spec` §5와 §10 미결 3의 답이다.
- (닫힘) 선점 허용: X가 이름 지정에 한해 다음 경계에서 `revoked`로 회수한다(X.primitives.spec §4.4.1 5번, [결정: P-22]). `auto`는 선점하지 않는다(§3.5 규칙 4, §4.3 4번). `auto` 우선순위 선점은 두지 않는다.
- (닫힘) [결정: review.decisions-2 D-04] `OrchestrationService`와 부속 타입은 F `@fresnel/contracts/services`의 `services/groups.ts`에 둔다(F.capabilities.spec §3.12, 이 문서 §3.8). `eng.context-map.design` §5.3의 F 위치 열은 그 문서 쪽에서 services로 고친다.
- [결정: 오케스트레이터 기본값] 템플릿 위치: `xeon/packages/orchestration-sdk/templates/`(L3.slots.spec §3.3.1, B4-GRP 구현). `eng.context-map.design` C-2의 문서 쪽 반영은 그 문서의 몫이다. 이 문서와 L3.group-sdk.plan §2는 L3.slots.plan §2.1 후보 a(`xeon/packages/orchestration-sdk/templates/`, 정식 예는 `src/testing/policies/`)를 [제안]으로 따른다. 스캐폴드 명령의 실행은 L4.cli.spec이 맡는다(L3.slots.spec §3.3.6).
- [결정: review.decisions-2 U-15] DR-02 방법 (b)(허용 목록 `DR-02/orchestration-sdk`). `eng.context-map.design` C-5와 같은 항목이다.
- (닫힘) 정책 포트 타입 `DriveLockArbiterPort`·`DriveLockCandidate`의 정본은 F.extensions.spec §3.2.1 `ports.ts`다. orchestration-sdk은 `@fresnel/contracts/extensions`에서 가져온다. 역할 분담은 §3.5 표로 정했다.
- (닫힘) X에 요청한 4개 항목(§3.13)은 X.1과 테스트 호스트 재시작으로 반영됐다. 2차 계측·승격 집계용 조회(§3.13 5번)만 남았다.
- [미결] M2 구현이 남긴 연결: `OrchestrationCatalogPort`는 조립 루트(HOST)가 로더 보고에 연결한다(`fresnel.settings` 포트는 ExtHost가 낸다). 그 전까지 시험은 `orchestrationCatalogOf`를 쓴다.
- (닫힘) [결정: review.m3-design-inputs D-M3-06] 유휴 중 drive lock 부여로 자율 turn을 시작하는 것을 drive lock 상한 안에서 허용한다. X.primitives.spec §4.5.5의 [제안]과 같다.
- [미결] `OrchestrationService`가 thread별 상태를 보이는 방식(§3.8 [가정]).
- [미결] 위임 상한의 귀속(§3.4, `_research/notes/L3-1.md` §6). 완료 보고와 끄기 때 처리는 아래 결정으로 닫았다. 위임 도구 정책(허용·차단)은 §3.4에서 둘 다 받는 것으로 정했다 [제안].
  - M3 설계(2026-10-26): `next` 보고는 turn을 시작하지 않는다(ADR-0013). `report`는 선택 필드다 [결정: review.m3-design-inputs D-M3-03]. 끄기 때는 `cancelDelegates`로 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04]. 상한 귀속은 L1.agents 요구 REQ-L1-03(`review.m3-design-inputs` §4.4)이다.
- [결정: review.decisions-2 T-21] 상태 상한(64 KiB)을 넘는 비공개 기록은 X `RegistrationApi.recordPrivate(kind, payload)`로 쓰고 `OrchestrationApi`가 그대로 전달한다(§3.2).
- [미결] drive lock 이벤트 이름: F.records.spec `lease.acquired`·`lease.released`와 `eng.context-map.design` 5.1절 `drive.leased`·`drive.released`. 이 문서는 F 이름을 쓴다.
- [결정: review.decisions-2 T-21] `grp.<그룹>.metrics.recorded`와 `grp.<그룹>.state.committed`의 소유는 §4.9와 §3.6 표에 적었다.
- [결정: review.decisions-2 U-18] 플러그인 이름 규칙은 확장 id 규칙 `^[a-z][a-z0-9-]{1,31}$`(밑줄 없음)이다. 테이블 접두는 이름의 하이픈을 밑줄로 바꿔 만든다.
- [미결] `scanDriveSource`의 파서 `@swc/core`를 orchestration-sdk이 import하려면 DR-07 `MODULE_OWNERS` 항목이 필요하다. M3a는 `orchestration-sdk/package.json`에 `@swc/core`(`catalog:`)를 더했고 `check-layers`는 통과한다. `eng.dependency-rules.guide` 표와 `MODULE_OWNERS`에 행을 더하는 승인은 아직 없다.
- [미결] [M3a] `delegate_capability` 검사(§3.3): 위임 기능 ID가 F에 없고 L1 서비스는 포트(`fresnel.agents`)라 매니페스트로 선언할 수 없다. 포트는 내장 확장만 읽으므로 외부 플러그인의 위임 허용 여부는 신뢰 등급 정책이 정한다.
- [미결] [M3a] 옛 스펙의 `cancelDelegates(reason): Promise<{ cancelled: number }>`와 `delegateStatus(requestId): DelegateStatus | undefined`를 값 반환(`CancelDelegatesResult`, `DelegateStatusResult`)으로 바꿨다. L1 `cancel`은 `{ cancelled: boolean }`을 돌려주어 개수를 알 수 없고, 서비스 없음과 문맥 거부는 값으로 알려야 하기 때문이다(TY-11). 학습 스펙 §3·§4.3의 호출 예(`g.cancelDelegates("orchestration_disabled")`)는 그대로 쓸 수 있고 반환값을 쓰는 곳만 맞춘다.
- [닫힘, E3] [M3a] G-30의 "실패 값": 대기 상한 거부가 없어져 이 미결은 닫힌다. 기존 기록: `OrchestrationStatus.drive`의 `"rejected"`만 채웠다. 거부 사유(`reason`, `requestSeq`)를 `OrchestrationStatus`나 `OrchestrationError`에 싣는 안은 F `services/groups.ts` 변경이 필요해 하지 않았다.
- [미결] [M3a] `replayDrive`의 시점 목록 지정(`cutAt`)과 사용자 입력 시작(`input`), 실패 보고의 첫 차이 이벤트 표시는 G-20 남은 몫이다.
- (닫힘) `RuntimeChange`의 단계 경계 값: 이 값을 쓰던 orchestration-sdk의 구동 그룹 키를 지웠다(§6, review.decisions-2 S-15).
- [결정: 오케스트레이터 기본값, M3b] 계측 등록부는 프로세스 전역 `defaultMetricsRegistry`다(§4.9). 조립 루트의 배선은 두지 않는다.
- [미결] [B4-GRP] 위임·spawn 자식 thread의 turn 출처(§3.12). `turn.started`의 `origin`이 `delegation`이면 자식을 만든 scope를 이벤트에서 알 수 없다. 자식과 부모를 잇는 이벤트(예: `agent.spawned`, 위임 수명주기)를 함께 읽어야 한다. 그 전까지 이 호출은 집계에서 빠진다.
- (닫힘) [결정: 사용자 지시, B4-GRP] `/group reset` 성공 문구를 바꿨다. 저장 상태 오류 플러그인은 켜기 상태가 `enabled`로 남고 X가 재설정 뒤 적용을 예약하므로, 켜진 플러그인에는 `다음 단계 경계에서 다시 실행됩니다`만 말하고 `/group on`을 붙이지 않는다. 꺼진 플러그인(`scope`가 `disabled`)에는 ` /group on <id>로 켜세요.`를 덧붙인다. 재설정은 켜기 상태를 바꾸지 않는다(시험 `reset.command-restores-the-declared-initial-and-the-group-runs-at-the-next-boundary`, `reset.disabled-group-also-says-how-to-turn-it-on`).
- [결정: 오케스트레이터 기본값, B4-GRP] `PromotionInput.calls[].origin`은 `RegistrationId`로 적는다. spec §3.12의 `RegistrationId | "user"`는 `RegistrationId`가 string이라 같은 타입이고, lint가 중복 유니온을 막는다. 사용자 입력 표지 `"user"`는 값으로만 쓴다.
- [결정: 오케스트레이터 기본값, M3b] `addUsage`의 잘못된 인자는 `Bug`다. 플러그인 코드가 만든 값의 불변 조건 위반이라 TY-24에 따른다. 호출자가 외부 확장이 되면 오류 값으로 바꾸고 시그니처를 `Result`로 고친다.
- [결정: 오케스트레이터 기본값, M3b] `grp.<그룹>.metrics.recorded`의 stepId는 경계 turnId다.
- [수용, B4-GRP] 재시작 뒤 같은 경계의 재발화에서 같은 키의 기록이 거부되면 그 기록은 건너뛴다. 증가분은 다음 기록에 든다(§4.9 기록의 한계). 플러그인 핸들러는 실패로 보고되지 않는다. X는 이 거부를 `commit.invalid` Bug로 낸다. 계측 쓰기 실패는 모두 플러그인에 전하지 않으므로 이 Bug도 같은 자리에서 삼켜진다.
- [결정: 오케스트레이터 기본값, B4-GRP] 계측 쓰기 실패는 플러그인 핸들러의 실패가 아니다(§4.9). 실패 원인은 저장하지 않는다. 실패를 세는 카운터는 spec에 없어 넣지 않았다. 실패한 증가분은 다음 기록에 든다.
- [결정: 오케스트레이터 기본값, M3b] 별도 `boundary.settle.after` 핸들러로 쓰는 안은 같은 scope의 호출 키 충돌로 학습 플러그인의 기록을 거부시켰다(시험 6건). 그래서 기록은 플러그인 핸들러 안에서 쓴다(§4.9).
- [미결] M3b의 이벤트 집계는 마지막으로 갱신한 thread만 보인다. 여러 thread의 drive lock 시간과 비용을 한 줄로 보일지는 정하지 않았다.
- (닫힘) [B4-GRP] 학습 플러그인의 `addUsage` 연결(LR-17)은 학습 스펙 §10 17에 따라 검토 종료 때 연결했다.
- [미결] 구성원이 아닌 id 있는 플러그인(`orchestration.members` 밖에 있고 `plugins[]`에는 있음)은 SDK가 등록하지 않아 로더가 `plugin_not_registered` 경고를 낸다. 이런 플러그인을 어떻게 등록하거나 검사에서 막을지 정하지 않았다.
- [미결] 구성원의 `settings()`(뿌리 설정 묶음 읽기)와 구성원 계측의 `OrchestrationStatus` 합산은 이번에 넣지 않았다.
- [제안] `defineOrchestrationMember`와 `OrchestrationMember`는 F에 없는 새 이름이다. F 이름 정리 때 확정한다.
- [결정: review.decisions-2 U-17] `orchestration-sdk`의 `@fresnel/ext-host` import(`hostOf`, 리소스 정의 타입, 플러그인 등록)는 DR-14의 ext-host 예외(서비스 등록·주입 API만)에 든다. 플러그인 패키지는 `@fresnel/ext-host`를 import하지 않는다(L3.readme §3).
- [미결] [근거: packages/ext-host/src/primitives/lease.ts] [엔진, X.primitives.spec §4.4.1 소관] 단계 함수의 기본 `requestId`는 `${lineageId}:${상태 판}.${단계 번호}`인데, 단계 번호(`DriveInvocation.i`)가 단계마다 0부터 다시 센다(`packages/ext-host/src/primitives/lease.ts`의 `runSteps`와 `executeCommand`의 `nextId`). 같은 상태 판에서 기본 id를 받은 턴 명령과 뒤 단계의 `commit` 명령이 같은 id를 받으면, 두 번째 결과 사건이 같은 키에 다른 내용으로 쓰여 `invalid`로 거부되고 단계가 `storage_unavailable`로 끝나 drive lock이 `error`로 반납된다. 플러그인 쪽은 턴 명령에 `requestId`를 명시해 피한다(§3.2 예, §4.6). 계약의 `DriveCommandBase.requestId` 주석(`단계 번호`의 뜻)과 맞추려면 엔진이 단계 번호를 drive lock 안에서 이어 세야 한다.
