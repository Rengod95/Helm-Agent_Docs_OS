---
id: L3.group-kit.spec
layer: L3
domain: group-kit
kind: spec
status: draft
depends_on: [F.extensions.spec, F.records.spec, F.capabilities.spec, F.wire-settings.spec, F.conversation.spec, X.primitives.spec, eng.dependency-rules.guide, eng.context-map.design, eng.events.design, adr.0015, review.m3-design-inputs]
binds: [xeon/packages/group-kit/**]
---

# L3 그룹 기반 (group-kit)

패키지: `@xeon/group-kit`(`xeon/packages/group-kit`). 하위 층: L3-a 그룹 기반(`_research/layer-plan-v2.json` L3-a).

이 문서는 L3 의도 그룹 세 문서(L3.helm.spec, L3.learning.spec, L3.slots 템플릿)의 기준 문서다. 그룹이 쓰는 공용 이름(`defineGroup`, `GroupDef`, `GroupApi`, `GroupModule`, `DriveArbiter`, `replayDrive`, `scanDriveSource`, `PromotionReport`, `GroupMetrics`)의 정의 위치는 이 문서다. `GroupService`, `GroupStatus`와 부속 타입은 F `services/groups.ts`(F.capabilities.spec §3.12)에 두고, 필드 정의는 이 문서 §3.8이 적는다.

## 1. 목적과 범위

L3-a 구성요소 7개를 인터페이스로 확정한다.

| # | 구성요소(L3-a) | 단계 | 이 문서의 절 |
|---|---|---|---|
| 1 | defineGroup | 1차 | §3.2, §3.3 |
| 2 | drive 임대 중재 | 1차 | §3.5, §4.3 |
| 3 | 그룹 상태 레코드 | 1차 | §3.6, §4.5~§4.7 |
| 4 | 그룹 간 통신 | 1차 | §3.7, §4.8 |
| 5 | 그룹 전환 명령과 표시 | 1차 | §3.8, §3.9 |
| 6 | drive 재생 규율 검사 | 2차 | §3.10, §3.11 |
| 7 | 그룹 전용 도구와 승격, 계측 | 2차 | §3.12, §4.9 |

정하는 것:

- 그룹 정의 API와 그 정적 검증
- `GroupApi`의 멤버 시그니처. F `ScopeApi`에 더하는 `settings()`, `delegate(spec)`, `metrics`
- drive 임대를 누가 받는지 정하는 정책(`DriveArbiter`)과 그 노출
- 그룹 비공개 상태와 공개 레코드의 구분, 상태 커밋 규칙, 분기·재개 때 복원, 상태 스키마 마이그레이션
- 그룹 사이 통신의 허용·금지 목록과 검사 수단
- `xeon.groups` 서비스(`GroupService`), `/group` 명령 문법, 상태줄 문자열
- 2차: 재생 규율 검사 도구(`replayDrive`, `scanDriveSource`), 승격 보고(`PromotionReport`), 계측(`GroupMetrics`)
- `l3.group-kit.*` 설정 키

다루지 않는 것:

- Helm(`helm`)과 학습 그룹(`learning`)의 내부 설계: L3.helm.spec, L3.learning.spec
- 추가 그룹 템플릿 문서: L3.slots(`eng.context-map.design` C-2, 템플릿은 slots 문서가 받는다)
- 임대 부여·회수·`lease.*` 이벤트 기록, 핸들러 디스패치, 토글 적용 메커니즘: X.primitives.spec
- 매니페스트 탐색, 신뢰 판정, 확장 로딩: X.loading-trust.spec
- 명령 등록 경로와 화면 렌더링: L4.cli.spec, L4.desktop.spec, L4.settings-ui.spec
- 백그라운드 위임 실행(자식 thread 생성, 완료 보고, 취소): L1.agents.spec

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 그룹 | `kind: "group"`, `layer: "L3"`인 확장(F.extensions.spec §2). 이름은 `GroupId`(= `ExtensionName`)다 |
| 그룹 모듈 | `defineGroup`이 돌려주는 `GroupModule`. 매니페스트와 엔트리 함수를 담는다 |
| drive 그룹 | 매니페스트 `usesDrive: true`이고 setup에서 `drive`를 등록한 그룹 |
| holder | 현재 drive 임대를 가진 그룹. 한 번에 하나다 |
| 대기 그룹 | 켜져 있고 drive를 등록했지만 임대를 받지 못한 그룹. drive 함수만 호출되지 않고 `on`, `post`, `delegate`는 계속 동작한다 |
| 요청 순번 | 그룹이 임대 후보가 된 순서. 그 scope의 마지막 `scope.changed{status:"enabled"}` 이벤트의 `seq`다(§4.3) |
| 로드 순서 | X가 확장을 로드한 순서. 같은 커밋에서 켜진 그룹끼리의 동률을 깬다 |
| 단계 경계 | step이 끝나고 다음 step이 시작되기 전 시점(F.conversation.spec §2). 체크포인트 커밋, drive 임대 교체, 그룹 켜기·끄기 적용 시점이다 |
| 비공개 상태 | 그룹 scope의 상태 문서(`StateDecl<S>`). 그 그룹만 읽는다 |
| 그룹 레코드 | 다른 그룹에게 공개하는 내구 레코드(F.extensions.spec §3.6 `GroupRecord`) |
| 위임 | L1-g 백그라운드 위임. 자식 thread에서 서브에이전트를 실행하고 결과를 부모 대화에 보고한다 |
| 승격 | 그룹 전용 도구를 L2 능력으로 옮기는 일 |

이 문서는 켜기·끄기와 임대 교대 시점을 "단계 경계"(step 종료 직후, 도구 결과 커밋 뒤)로 쓴다 [결정: review.decisions-2 U-01](F.conversation.spec §2.1). 지점 이름은 F.extensions.spec §3.4 표의 pi 이벤트명(snake_case)이다.

## 3. 인터페이스

### 3.1 진입점과 import

```text
@xeon/group-kit           defineGroup, validateGroupDef, groupManifest, GroupDef, GroupApi, GroupModule,
                          DelegateSpec, DelegateToolPolicy, DelegateLimits, DelegateFork, DelegateReceipt,
                          DelegateResult, DriveArbiter, leaseArbiterPort, GroupService, GroupServiceName,
                          GroupStatus, 명령·상태줄 함수, GroupMetrics, PromotionReport, 설정 정의
@xeon/group-kit/testing   checkGroup, replayDrive, scanDriveSource, smokeGroup(M1 테스트 그룹),
                          정책 플러그인 정식 예 reviewgate, commitguard, guardrail(2차, L3.slots.spec §3.2)
```

- [제안] 정식 예 3종은 `src/testing/policies/`에 두고 `testing` 진입점에서만 내보낸다. 템플릿 파일은 패키지 루트의 `templates/`에 두고 진입점에 넣지 않는다(L3.slots.spec §3.3.1, L3.slots.plan §2.1 후보 a). 위치의 최종 확정은 §10 템플릿 위치 [미결]과 함께 한다.

- [결정] 그룹끼리 직접 참조하지 않는다. 그룹 사이 통신은 F4에 스키마가 있는 이벤트와 레코드로만 한다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 3, F.extensions.spec §4.8, `eng.context-map.design` CM-06).
- [제안] `group-kit`은 `@xeon/contracts`의 서브패스(`extensions`, `records`, `capabilities`, `services`, `conversation`, `settings`)와 `@xeon/ext-host`의 `hostOf`, 리소스 정의 타입만 import한다(X.primitives.spec §3.8). `LeaseArbiterPort`·`LeaseCandidate`는 F `@xeon/contracts/extensions`(F.extensions.spec §3.2.1 `ports.ts`)에서, `GroupService`와 부속 타입은 F `@xeon/contracts/services`(F.capabilities.spec §3.12 `services/groups.ts`)에서 가져온다. 이 import는 DR-14의 `@xeon/ext-host` 예외(하위 층은 서비스 등록·주입 API만 쓴다)에 든다 [결정: review.decisions-2 U-17]. Cordis는 import하지 않는다(ADR-0002 3번 [결정], 4번 [제안], `eng.dependency-rules.guide` DR-11). 확장 호스트 기능은 서비스 `xeon.ext`(`ExtHost`)로 주입받는다(`eng.context-map.design` 4.1절 `group-kit` 행).
- [결정: review.decisions-2 U-15] 그룹 패키지(`group-helm`, `group-learning`)는 `@xeon/group-kit`의 `.`만 import한다. 이 import는 `eng.dependency-rules.guide` DR-02 방법 (b)의 허용 목록 항목 `DR-02/group-kit-*`(`DR-02/group-kit-helm`, `DR-02/group-kit-learning`)이다. `group-kit`은 어떤 그룹 패키지도 import하지 않는다.
- [결정: 계획 v2 규칙 2, DR-14] L3 패키지는 `cap-*`를 import하지 않는다. 능력은 `g.capability(ServiceKey)`로 쓴다(`architecture.layers.spec` 3.1절 2행, F.capabilities.spec §3.5).

### 3.2 defineGroup

```ts
// xeon/packages/group-kit/src/define-group.ts
import type { Static } from "typebox";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  ExtensionEntry, ExtensionManifest, GroupId, ProviderResourceDef, ScopeApi, StateDecl,
} from "@xeon/contracts/extensions";
import type { Upcaster } from "@xeon/contracts/records";
import type { SettingDefInput, SettingGroup } from "@xeon/contracts/settings";
import type { CommandResourceDef, ToolResourceDef } from "@xeon/ext-host";   // X.primitives.spec §3.8, §3.9
import type {
  CancelDelegatesResult, DelegateCallOptions, DelegateResult, DelegateSpec, DelegateStatusResult,
} from "./delegate.ts";
import type { GroupMetricsHandle } from "./metrics/types.ts";

/** 확장 id 규칙(review.decisions-2 U-18). 소문자, 숫자, 하이픈. 밑줄은 쓰지 않는다 */
export const GROUP_NAME_PATTERN = "^[a-z][a-z0-9-]{1,31}$";
/**
 * 그룹 이름 예약 목록의 정본. 네 묶음을 합친다.
 * RESERVED_EXT_IDS(eng.context-map §5.4), F.extensions.spec §4.7 name_reserved의 grp·x·xeon,
 * L2 도메인 이름(_routing/routes.yaml layout L2), 그룹 명령·설정 값과 겹치는 이름.
 * 설치된 확장 이름과의 충돌은 이 상수에 넣지 않는다. validateManifestSet의 name_conflict로 거부한다.
 */
export const RESERVED_GROUP_NAMES: readonly string[] = [
  "core", "cap", "xh", "sys", "p", "ext", "x", "grp", "xeon",
  "workspace", "mcp", "web", "knowledge", "work", "dialog", "artifacts", "schedule",
  "auto", "all", "none", "group", "groups", "kit",
];

export type GroupManifest = ExtensionManifest & { readonly kind: "group"; readonly layer: "L3" };

/**
 * 매니페스트 값을 검증해 GroupManifest로 좁힌다. .xeon-plugin/plugin.json을 JSON import로 읽은 외부 그룹이 쓴다.
 * F validateManifest 오류, kind·layer 불일치면 Bug를 던진다. 순수 함수
 */
export function groupManifest(value: unknown): GroupManifest;

/** 설정 정의 묶음. 키는 이름 부분(F.wire-settings.spec §3.8.3 SettingDefInput) */
export type GroupSettingDefs = Readonly<Record<string, SettingDefInput>>;
/** 내장 그룹은 "l3.<이름>", 외부 그룹은 "ext.<이름>"(F.wire-settings.spec §3.8.3 규칙 3) */
export type GroupSettingNamespace = `l3.${string}` | `ext.${string}`;
export type GroupSettingValues<D extends GroupSettingDefs> = {
  readonly [K in keyof D & string]: Static<D[K]["type"]>;
};

/** 상태 문서 마이그레이션. 키는 출발 버전. { 1: v1→v2, 2: v2→v3 }. 순수 함수 */
export type StateMigrations = Readonly<Record<number, (previous: unknown) => unknown>>;

export interface GroupDef<S = never, D extends GroupSettingDefs = Record<never, never>> {
  /** 저장소 안 그룹은 defineManifest 상수, 외부 그룹은 groupManifest(plugin.json 값) */
  readonly manifest: GroupManifest;
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

/** F ScopeApi<S>에 settings(), delegate(spec), metrics, 리소스 등록 두 연산을 더한 것 */
export interface GroupApi<S, D extends GroupSettingDefs = Record<never, never>> extends ScopeApi<S> {
  /** 마지막 단계 경계에서 읽은 이 그룹 설정의 유효 값. 동기, 순수 조회 */
  settings(): GroupSettingValues<D>;
  /** L1-g 백그라운드 위임 래퍼(§3.4). 소유는 이 scope, requestId 멱등. `options`는 thread와 취소 신호를 정한다 [제안] */
  delegate(spec: DelegateSpec, options?: DelegateCallOptions): Promise<DelegateResult>;
  /** [제안] 이 scope가 그 대화에서 시작한 위임의 상태. L1 AgentService.status 전달. on 핸들러에서는 `group.effectNotAllowed`다(§3.4) */
  delegateStatus(requestId: string, options?: { readonly threadId?: ThreadId }): DelegateStatusResult;
  /** [제안] 이 scope가 주체인 진행 중 백그라운드 위임을 모두 취소한다. onDispose와 명령 처리기에서 쓴다(§4.10, [결정: D-M3-04]). 재실행되는 코드에서는 `group.effectNotAllowed`다 */
  cancelDelegates(reason?: string): Promise<CancelDelegatesResult>;
  /** 이 그룹의 계측 조회(§3.12). 2차 전까지 snapshot()은 메모리 집계만 돌려준다 */
  readonly metrics: GroupMetricsHandle;
  /** 그룹 전용 모델 도구 등록. X hostOf(g).registerTool을 그대로 부른다. setup 안에서만. scope가 꺼지면 해제된다 */
  registerTool(def: ToolResourceDef): void;
  /** 명령 등록. X hostOf(g).registerCommand를 그대로 부른다. setup 안에서만. 이름은 그룹 이름과 같게 둔다 [제안] */
  registerCommand(name: string, def: CommandResourceDef): void;
  /** 모델 provider 등록. X hostOf(g).registerProvider를 그대로 부른다(config는 JSON 표현). setup 안에서만. scope가 꺼지면 해제된다 */
  registerProvider(name: string, config: ProviderResourceDef): void;
}

export interface GroupModule {
  readonly manifest: GroupManifest;
  /** X 로더가 부르는 엔트리. F ExtensionEntry */
  readonly entry: ExtensionEntry;
  /** 설정 카탈로그에 넣을 묶음. 조립 루트가 buildCatalog 입력({ owner, namespace, defs })으로 옮긴다 */
  readonly settings?: { readonly namespace: GroupSettingNamespace; readonly defs: readonly SettingDef[] };
  /** 상태 이벤트 업캐스터(§4.7). 길이 = state.version - 1. 상태가 없으면 빈 배열 */
  readonly stateUpcasters: readonly Upcaster[];
  /** 상태가 없으면 0 */
  readonly stateVersion: number;
}

/** 정의를 검증하고 GroupModule을 만든다. 오류가 있으면 Bug를 던진다(§3.3) */
export function defineGroup<S = never, const D extends GroupSettingDefs = Record<never, never>>(
  def: GroupDef<S, D>,
): GroupModule;
```

- `entry`가 하는 일 [제안]: `host.scope(manifest.name, { state: def.state, defaultEnabled: manifest.defaultEnabled }, (api) => def.setup(wrap(api)))`를 한 번 부른다. `def.state`가 없으면 `state` 키를 넘기지 않는다. `wrap`은 F `ScopeApi`를 `GroupApi`로 감싼다. 감싼 `on`, `post`, `drive`, `commit`, `record`는 원래 연산을 그대로 부르고 계측 집계(§4.9)만 더한다. 그룹의 주 scope id는 매니페스트 `name`이다(F.extensions.spec §3.2 아래 규칙). 그룹 이름은 매니페스트에서만 온다. `GroupDef`에 별도 `id` 필드는 없다.
- 상태 없는 그룹 [제안]: `state`를 생략할 수 있다. 상태 없이 `on`, `post`, `record`만 쓰는 정책 그룹(L3.slots.spec §3.2, policy 템플릿)을 위해서다. 생략하면 `migrations`를 둘 수 없고(`state_migration_missing`이 아닌 `state_version` 오류), `g.state()`·`g.commit()`은 X가 `state_undeclared`로 거부한다.
- 매니페스트 전달 [제안]: 저장소 안 그룹은 `defineManifest` 상수를 `manifest`에 넘긴다. `.xeon-plugin/plugin.json`만 가진 외부 그룹은 JSON import(`import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" }`)로 읽고 `groupManifest(manifestJson)`을 넘긴다. X 로더도 같은 파일을 읽으므로 두 값은 같다. 같은지는 X 로더가 `validateManifestSet` 전에 비교한다 [가정: X.loading-trust.spec].
- 리소스 등록 [제안]: `registerTool`, `registerCommand`, `registerProvider`는 X `hostOf(g)`(X.primitives.spec §3.8, §4.8)의 같은 이름 연산을 그대로 부른다. 그룹 패키지는 `@xeon/ext-host`를 import하지 않으므로(§3.1, DR-14) group-kit이 이 세 연산을 `GroupApi`로 옮긴다. `registerProvider`의 `config`는 `ProviderResourceDef`(JSON)다. 그 밖의 `hostOf` 연산(`registerShortcut`, `registerFlag`, `registerMessageRenderer` 등)은 그룹 요구가 생기면 같은 방식으로 더한다.
- `settings()` [M2]: 값은 X의 `hostOf(g).settingValue(key)`로 호출 때마다 읽는다. 이 메서드는 포트 `GroupSettingsSourceKey`(서비스 이름 `xeon.settings`, 조립 루트가 설정 서비스에 연결하는 자리)를 거친다. 내장 그룹은 모든 키를, 신뢰 `user`인 외부 그룹은 자기 `ext.<id>.*` 키만 읽는다(X.primitives.spec §3.8). 값이 없거나 스키마를 통과하지 못하면 정의의 `default`다. 포트가 없으면 기본값만 돌려준다. "마지막 단계 경계의 스냅샷"은 설정 서비스가 맡는다(thread별 값은 X.primitives.spec §3.2의 `PrimitivesSettingsSource`처럼 thread를 받는 읽기가 필요하며 [미결]). 기본값도 없고 값도 없는 비밀 설정은 `Bug`다.
- `commit` 래퍼 [M2]: `checkStateCommit`이 스키마·64 KiB·동일 값을 먼저 검사한다. 위반이면 X와 같은 `PrimitiveError`(`state_schema`, `state_too_large`)를 던지고, 같은 값이면 X를 부르지 않고 현재 값을 돌려준다. `record`·`post`는 `checkRecordKind`·`checkPostItem`으로 자기 `grp.<이름>.` 접두를 먼저 검사한다(다른 접두는 `record_invalid`, 선언 없는 자기 접두 kind는 `record_kind_undeclared`).
- 비공개 기록 [결정: review.decisions-2 T-21]: 비공개 기록 연산은 X `ScopeApi.recordPrivate(kind, payload)`다. kind는 자기 `grp.<name>.*`이고, `readsRecordKinds`와 다른 그룹의 `readRecords`로 조회되지 않으며, 큰 값은 blob으로 분리한다(조건은 L3.learning.spec §3.7.1). `GroupApi`는 `ScopeApi`를 상속하므로 이 연산을 그대로 전달한다. 작은 비공개 상태는 상태 문서(`commit`, §4.5 상한 안)를 쓴다.
- `drive` 함수에는 상태를 인자로만 넘긴다. 반환값이나 이전 호출의 값을 다음 호출에 넘기지 않는다(`architecture.runtime-flow.design` §4.3 완화책).
- `GroupDef<S>`의 두 번째 타입 인자 `D`는 기본값이 있으므로 설정이 없는 그룹은 `GroupDef<S>`로 쓴다.
- 예(설명용, 그룹 내부 설계 아님):

```ts
export default defineGroup<DemoState>({
  manifest: demoManifest,                 // kind "group", layer "L3", points ["tool.call.before", "boundary.step.after"], usesPost, usesDrive
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
    g.drive(async (loop, st) => {
      if (st.phase === "done") return;
      const r = await loop.turn({ input: { kind: "user", content: "다음 단계" } });
      await g.commit(r.status === "completed" ? { phase: "done" } : st);
    });
  },
});
```

### 3.3 정적 검증

```ts
// xeon/packages/group-kit/src/define-group.ts
import type { ManifestIssue } from "@xeon/contracts/extensions";

export type GroupDefIssueCode =
  | "group_kind"               // kind가 "group"이 아니거나 layer가 "L3"가 아님
  | "group_name"               // GROUP_NAME_PATTERN 위반 또는 RESERVED_GROUP_NAMES
  | "settings_namespace"       // 설정 namespace가 l3.<이름>(trust.level builtin) 또는 ext.<이름>이 아님
  | "state_version"            // version이 1 이상의 정수가 아니거나, state가 없는데 migrations가 있음
  | "state_initial_invalid"    // initial이 schema를 통과하지 못함
  | "state_migration_missing"  // version ≥ 2인데 migrations에 빠진 출발 버전이 있음
  | "delegate_capability"     // delegate를 쓰는데 매니페스트 requires/optional에 위임 능력이 없음(검사는 checkGroup, M3)
  | "setup_threw";            // checkGroup이 setup을 실행하다 선언과 무관한 예외를 만남(M2에서 더한 코드)

export interface GroupDefIssue {
  readonly severity: "error" | "warning";
  readonly code: GroupDefIssueCode;
  readonly path: string;       // JSON Pointer
  readonly message: string;
}

/**
 * 순수 함수. validateManifest(F) 결과와 그룹 규칙을 함께 돌려준다.
 * GroupDef<S, D>는 setup 인자의 공변이 맞지 않아 GroupDef<unknown, …>에 대입되지 않으므로, 검사가 읽는 필드만 담은
 * GroupDefShape(manifest, state, migrations, settings.namespace)를 받는다. GroupDef는 그대로 대입된다
 */
export function validateGroupDef(def: GroupDefShape): readonly (GroupDefIssue | ManifestIssue)[];

// xeon/packages/group-kit/src/testing/check-group.ts
/**
 * 기록용 호스트로 entry를 실행해 setup의 실제 등록을 모으고 validateUsage(F)로 대조한다.
 * 호스트는 포트가 하나도 없는 ext-host(`createExtHost`)다. 임대와 turn은 일어나지 않고 등록만 본다
 */
export function checkGroup(module: GroupModule): Promise<readonly (GroupDefIssue | ManifestIssue)[]>;
```

검증을 부르는 시점 [제안]:

| 검사 | 함수 | 테스트 시점 | 로드 시점 | 실패 처리 |
|---|---|---|---|---|
| 매니페스트 형식 | F `validateManifest` | `defineGroup` 호출(모듈 평가)과 `checkGroup` | `defineGroup` 호출, X 로더가 한 번 더 | `defineGroup`이 `Bug`를 던진다. X는 로드 실패로 처리 |
| 그룹 규칙 | `validateGroupDef` | 같음 | `defineGroup` 호출 | 같음 |
| 선언과 실제 등록 대조 | F `validateUsage` | `checkGroup`(그룹 패키지 테스트 `group.check`) | X가 setup 직후와 등록 호출마다(F.extensions.spec §3.7 주석) | 테스트 실패 / X가 등록 거부, 로드 실패 |
| 매니페스트 집합 | F `validateManifestSet` | 없음 | X 로더 | `name_conflict` 오류, `drive_conflict` 경고 |

- `defineGroup`은 순수 검사만 한다. setup을 실행하지 않는다. 그래서 `validateUsage`는 로드 시점에 X가, 테스트 시점에 `checkGroup`이 부른다.
- X는 선언하지 않은 `on`·`post`·`drive`·`capability`를 그 자리에서 `PrimitiveError`로 던진다. `checkGroup`은 이 오류의 code가 `validateUsage` 코드(`point_undeclared`, `post_undeclared`, `drive_undeclared`, `capability_undeclared`)와 같으면 같은 이슈로 돌려주고, 그 밖의 setup 예외는 `setup_threw`로 돌려준다. setup은 첫 예외에서 멈추므로 그 뒤의 등록은 보지 못한다.
- `defineGroup`이 던지는 값은 `Bug`(`@xeon/contracts`)다. 정의 오류는 프로그래머 오류이기 때문이다(`eng.typescript.guide` TY-11 `xeon/throw-only-bug`). 메시지에는 모든 이슈의 `code`와 `path`를 싣는다.
- 그룹 패키지는 `checkGroup(module)`이 오류 0개인 테스트를 하나 둔다(L3.group-kit.plan 단위 테스트 `define-group.*`).

### 3.4 delegate (L1-g 백그라운드 위임 래퍼)

```ts
// xeon/packages/group-kit/src/delegate.ts
import type { EventId, ItemId, ThreadId } from "@xeon/contracts/conversation";
import type { RecordKind } from "@xeon/contracts/extensions";

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
  /** 필수. 대화 범위 멱등 키, 1~48자. group-kit이 ":report"를 붙여 보고 post의 키로 쓴다(64자 한도) */
  readonly requestId: string;
  /**
   * 완료 보고 post의 모양. 선택 필드다 [결정: review.m3-design-inputs D-M3-03].
   * 없으면 L1-g는 부모 대화에 agent.settled만 커밋하고 보고 입력을 만들지 않는다
   */
  readonly report?: DelegateReport;
  readonly toolPolicy?: DelegateToolPolicy;
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
  | { readonly kind: "group.delegateInvalid"; readonly field: "requestId" | "report.customType" | "agent" | "fork"; readonly message: string }
  | { readonly kind: "group.delegateUnavailable" }          // 위임 서비스가 없음(M2) 또는 매니페스트 미선언
  | { readonly kind: "group.disabling"; readonly id: string }
  | { readonly kind: "group.delegateFailed"; readonly message: string };

/**
 * 호출이 속한 대화와 취소 신호 [제안]. on 핸들러는 `ctx.threadId`·`ctx.signal`을, 명령 처리기와 도구 `execute`는 자기 호출 문맥의
 * thread를 넘긴다. on 핸들러와 drive 함수에서는 생략하면 X의 호출 문맥(`hostOf(g).callContext()`, §3.13 요청 6)을 쓰고, 문맥이 없는 곳에서 생략하면 `group.delegateUnavailable`이다
 */
export interface DelegateCallOptions {
  readonly threadId?: ThreadId;
  readonly signal?: AbortSignal;
}

/** [제안] L1.agents.spec §3.2 ChildStatus를 그룹에 보이는 모양. settled면 종료 상태만 싣는다. 사용량은 이 값에 싣지 않는다 */
export type DelegateStatus =
  | { readonly state: "queued" | "running"; readonly childThreadId: ThreadId }
  | { readonly state: "settled"; readonly childThreadId: ThreadId; readonly status: "completed" | "aborted" | "error" };

/** 재실행되는 문맥에서 부를 수 없는 호출(ADR-0015 §3.2 표). `delegateStatus`는 on 핸들러, `cancelDelegates`는 on 핸들러와 drive 함수 [제안] */
export interface DelegateContextError {
  readonly kind: "group.effectNotAllowed";
  readonly effect: "g.delegateStatus" | "g.cancelDelegates";
  readonly context: "on" | "drive";
}

/** [제안] ok면 status가 undefined일 수 있다(그 requestId의 위임이 없음) */
export type DelegateStatusResult =
  | { readonly ok: true; readonly status: DelegateStatus | undefined }
  | { readonly ok: false; readonly error: DelegateContextError | { readonly kind: "group.delegateUnavailable" } };

/** [제안] cancelled는 L1 `AgentService.cancel`의 값이다(하나라도 멈췄으면 true) */
export type CancelDelegatesResult =
  | { readonly ok: true; readonly cancelled: boolean }
  | {
      readonly ok: false;
      readonly error:
        | DelegateContextError
        | { readonly kind: "group.delegateUnavailable" }
        | { readonly kind: "group.delegateFailed"; readonly message: string };
    };

/** 복구 가능한 실패는 throw하지 않고 값으로 돌려준다(eng.typescript.guide TY-11) */
export type DelegateResult =
  | { readonly ok: true; readonly receipt: DelegateReceipt }
  | { readonly ok: false; readonly error: DelegateError };
```

- [결정] 학습 그룹은 drive를 쓰지 않는다. 검토 포크는 L1 백그라운드 위임 서비스로 실행한다(F.extensions.spec §4.6, `_research/decisions-log.md` 2026-10-21 계획 v2). `delegate`는 이 경로의 그룹 쪽 래퍼다. drive 임대와 관계없이 모든 켜진 그룹이 쓴다(층 사이 규칙 4 "백그라운드 위임은 여러 그룹이 함께 쓴다").
- 구현 [M3a]: 래퍼는 `hostOf(g).port(AgentServicePortKey)`(`xeon.agents`)로 L1 서비스를 얻는다. 포트는 내장 확장만 읽을 수 있어 외부 그룹이나 서비스가 없는 구성은 `group.delegateUnavailable`이다. `origin`은 `{ parentThreadId, owner: { kind: "scope", scopeId }, caller: "main", depth: 0, ownerRequestId: requestId, signal }`이다. `parentThreadId`는 `options.threadId`, 없으면 X의 재실행 문맥이다. L1 오류 `agents.unavailable`은 `group.delegateUnavailable`, 나머지는 `group.delegateFailed`(메시지 `<kind>: <message>`)이고 L1 호출이 던지면 같은 오류로 바꾼다. 매니페스트 능력 선언 검사(`delegate_capability`)는 능력 ID가 없어 구현하지 않는다([미결](§10)).
- [가정, 옛 안] 래퍼는 `g.capability(AgentsDelegateKey)`로 L1-g 서비스(`xeon.agents`, `eng.context-map.design` 5.3절)를 얻어 부른다. 키 이름, 능력 ID, 서비스 메서드 시그니처는 L1.agents.spec이 정한다. 매니페스트는 그 능력을 `requires`나 `optional`에 선언한다. 선언이 없으면 F `validateUsage`가 `capability_undeclared`를 낸다.
- L1 대응: 래퍼는 `DelegateSpec`을 L1.agents.spec §3.2 `DelegateRequest`로 옮겨 `AgentService.delegate(request, origin)`을 부른다. 필드는 `agent`, `task`, `requestId`, `report`, `model`이 같은 이름이고, `toolPolicy` → `tools`, `limits` → `limits`, `fork` → `fork`다. `origin.owner`는 `{ kind: "scope", scopeId }`다. L1.agents.spec §3.2 끝 문단은 옛 필드(`toolPolicy.deny`만, `forkFrom`)를 적었으므로 이 절에 맞춰 고칠 대상이다.
- 도구 정책 [제안]: 허용 목록과 차단 목록을 둘 다 받는다. 판정은 L1.agents.spec §4.3 권한 상한을 따른다. `allow`는 정의 `tools`와 교집합을 내므로 그룹이 정의보다 넓힐 수 없고, 부모가 거부한 도구도 자식에서 거부된다. 학습 그룹은 허용 목록, 다른 그룹은 차단 목록을 쓸 수 있다. 이것으로 L3.learning.spec §10 미결 10(차단·허용 방식)을 닫는다.
- 완료 보고 [가정]: `report`가 있으면 L1-g가 자식 정착 뒤 부모 대화에 `PostItem{ kind: "context", customType: report.customType, display: report.display }`를 `when: report.when`, `requestId: "<requestId>:report"`로 넣는다. `kind: "user"`는 쓰지 않는다. 사용자 발화와 섞이기 때문이다(`_research/notes/L3-1.md` §3.3). `report`가 없으면 보고 입력을 만들지 않는다 [결정: review.m3-design-inputs D-M3-03]. 학습 그룹은 `report`를 넣지 않는다. 그룹은 부모 대화의 코어 이벤트 `agent.settled` 구독(L3.learning.spec §8.1 REQ-LN-02)이나 `delegateStatus`로 완료를 안다.
- 포크 지점: `fork: { at: "event" }`는 L1-g가 `agents.invalid_request`로 거부한다(L1.agents.spec §4.1 3번, 세션에 이벤트 기준 fork가 없다). 그룹은 `{ at: "item" }`을 쓴다. `DelegateFork`의 `event` 갈래는 L1 지원이 생길 때까지 남겨 두되 `delegate` 입력 검사에서 `group.delegateInvalid`(`field: "fork"`)로 막는 안을 [제안]한다.
- 재실행 문맥 [결정: adr.0015]: `delegate`는 on 핸들러와 drive 함수에서 부를 수 있다. `requestId`는 커밋된 값에서 만든 결정적 키여야 한다(ADR-0015 §3.4). `delegateStatus`는 효과 없는 읽기다. ADR-0015 §3.2 표의 `g.delegateStatus` 행에 따라 drive 함수에서는 부를 수 있고 on 핸들러에서는 부르지 않는다. 결과를 고정하려면 상태에 커밋한다. `cancelDelegates`는 효과가 있는 호출이라 재실행되는 코드에서 부르지 않고 `onDispose`와 명령 처리기에서 부른다. `onDispose`는 scope의 generation이 닫힌 뒤에 실행되어 포트 조회가 거부되므로, `wrap`은 `xeon.agents` 서비스를 setup에서 한 번 잡아 두고 `delegate`, `delegateStatus`, `cancelDelegates`가 같은 값을 쓴다 [제안]. 서비스가 setup 때 없었으면 부를 때마다 다시 조회한다.
- 결과 수신 [M3a]: 위임 결과는 L1이 커밋하는 `agent.settled`가 지점 `lifecycle.agent.settled`로 흘러온다. X가 `owner`가 이 scope인 이벤트만 이 그룹의 핸들러에 보내므로 그룹은 `g.on("lifecycle.agent.settled", …)`로 자기 위임의 결과만 받는다. group-kit은 이 경로에 래퍼를 더하지 않는다.
- 멱등: 같은 thread에서 같은 `requestId`의 두 번째 호출은 자식을 만들지 않고 `status: "duplicate"`와 처음 자식의 `childThreadId`를 돌려준다. 중복 생성 방지 방법(소유 간선 검색 또는 `requests` 테이블)은 L1.agents.spec이 정한다.
- 상한: 위임은 drive 임대 상한(`DriveLimits`)에 들어가지 않는다. 위임 상한의 귀속은 [미결](§10).
- (닫힘) [결정: adr.0015] F.extensions.spec §4.3의 on 핸들러 효과 목록(`post`, `commit`, `record`)에 `requestId` 멱등 `g.delegate`가 더해진다(C안, 2026-10-25). `delegate`의 `requestId`는 커밋된 id(`turnId`, `stepId`)나 상태 값에서 결정적으로 만든다(ADR-0015 §3.4). 옛 우회(`record`로 요청만 남기고 다음 단계 경계 뒤에 `delegate`를 부르는 방식)는 쓰지 않는다. F.extensions.spec 본문 반영은 ADR-0015 §4.3 표에 있다.

### 3.5 DriveArbiter (임대 중재 정책)

역할 분담:

| 일 | 소유 | 근거 |
|---|---|---|
| 임대 부여, 반납, `lease.acquired`·`lease.released` 기록, 상한 집행, drive 함수 재호출, `idle` 반납 | X.primitives.spec §4.4 | F.extensions.spec §4.6, F.records.spec §3.3 |
| 정책을 X에 넣는 포트 `LeaseArbiterPort`(서비스 `xeon.groups`, 선택) | 타입 정본 F.extensions.spec §3.2.1, 호출 규칙 X.primitives.spec §3.6 | X(순위 1)는 group-kit(순위 5)을 import하지 않는다 |
| 누가 임대를 받는지(정책 `DriveArbiter`), 그 정책을 `LeaseArbiterPort`로 옮기는 어댑터, 대기 목록, 정책 결과의 노출(`GroupStatus`, 상태줄) | group-kit | 이 절 |

X 쪽 규칙(X.primitives.spec §4.4.1) 가운데 이 절이 기대는 것:

- X는 임대가 없을 때만 `LeaseArbiterPort.choose(threadId, candidates)`를 부른다. 판단 시점은 경계 훅(`step_end`, `turn_settled`, `idle`)과 `openThread`다(§4.4.1 3번).
- 이미 임대가 있으면 새 판단을 하지 않는다. 선택이 바뀌어도 현재 임대가 반납된 뒤 다음 경계에서 반영한다(§4.4.1 5번). X에는 선택 변경으로 임대를 회수하는 경로가 없다.
- 후보(`LeaseCandidate`)는 그 thread에서 켜져 있고 drive 등록이 있고 오류 상태가 아닌 scope다. `idle`로 반납된 scope는 다음 `turn_settled`나 상태 판이 바뀐 뒤에만 다시 후보가 된다(§4.4.3).
- 포트가 없으면 X는 기본 규칙(후보 하나면 그것, 둘 이상이면 설정 `x.primitives.activeDriveGroup`)을 쓴다.

```ts
// xeon/packages/group-kit/src/arbiter.ts
import type { ThreadId } from "@xeon/contracts/conversation";
import type { GroupId, LeaseArbiterPort, LeaseCandidate, ScopeId } from "@xeon/contracts/extensions";   // F.extensions.spec §3.2.1
import type { DriveHolderSetting } from "@xeon/contracts/services";   // F.capabilities.spec §3.12 services/groups.ts(§3.8)

export interface DriveCandidate {
  readonly scopeId: ScopeId;
  readonly groupId: GroupId;
  /** LeaseCandidate.loadIndex. 0부터 */
  readonly loadOrder: number;
  /** 마지막 scope.changed{status:"enabled"} 이벤트의 seq. X가 주지 않으면 null(§3.13 요청 1) */
  readonly requestSeq: number | null;
}

export interface ArbiterInput {
  /** X가 넘긴 후보. 켜져 있고 drive를 등록했고 오류·idle 반납 대기가 아닌 그룹 */
  readonly candidates: readonly DriveCandidate[];
  /** 설정 x.primitives.activeDriveGroup의 유효 값(thread 범위) */
  readonly holderSetting: DriveHolderSetting;
}

export type ArbiterReason =
  | "first-request"     // 설정 null(auto): 요청 순서로 부여
  | "named"             // activeDriveGroup 지정 그룹
  | "named-unavailable" // 지정 그룹이 후보가 아님. 아무도 받지 않음
  | "no-candidate";

export interface ArbiterDecision {
  /** 임대를 받을 그룹. null이면 아무도 받지 않는다(사용자 입력이 루프를 소유) */
  readonly holder: ScopeId | null;
  /** 받지 못한 후보. 요청 순서대로 */
  readonly waiting: readonly ScopeId[];
  readonly reason: ArbiterReason;
}

/** 순수 함수 객체. 같은 입력이면 같은 결정 */
export interface DriveArbiter {
  decide(input: ArbiterInput): ArbiterDecision;
}

export const defaultDriveArbiter: DriveArbiter;

/** DriveArbiter를 X LeaseArbiterPort로 옮기는 어댑터. 설정 읽기와 requestSeq 조회만 더한다 */
export function leaseArbiterPort(
  arbiter: DriveArbiter,
  deps: {
    readonly holderSetting: (threadId: ThreadId) => DriveHolderSetting;
    readonly requestSeq: (threadId: ThreadId, candidate: LeaseCandidate) => number | null;
  },
): LeaseArbiterPort;
```

입력과 출력:

| 방향 | 이름 | 출처 | 뜻 |
|---|---|---|---|
| 입력 | `candidates` | X `LeaseArbiterPort.choose`의 `candidates` | X가 고른 후보. group-kit은 다시 거르지 않는다 |
| 입력 | `holderSetting` | 설정 `x.primitives.activeDriveGroup`(X.primitives.spec §6) | `null`(auto) 또는 그룹의 주 scope id |
| 입력 | 요청 순번 `requestSeq` | `LeaseCandidate.enabledAtSeq`(이벤트 `scope.changed`의 `seq`, §3.13 요청 1) | 먼저 켜진 그룹이 작다. 재개 뒤에도 같은 값이다 |
| 출력 | `holder` | `choose`의 반환값 | 임대를 받을 scope 또는 null |
| 출력 | `waiting[]` | `GroupStatus` 계산에 쓴다 | 대기 그룹. `GroupStatus.drive = "waiting"` |

규칙 [제안] (§4.3에 순서를 적는다):

1. `holderSetting`이 scope id이면 그 그룹만 임대를 받는다. 그 그룹이 후보가 아니면 아무도 받지 않는다(`named-unavailable`).
2. `null`(auto)이면 `requestSeq`가 가장 작은 후보가 받는다. `requestSeq`가 같으면 `loadOrder`가 작은 쪽이다(`first-request`). `requestSeq`가 null인 후보(활성 가지에 enabled 기록이 없는 기본 켜짐 그룹)는 어떤 enabled 기록보다 앞선 것으로 보고, null끼리는 `loadOrder`로 정한다. 쌍마다 기준이 달라지지 않도록 전체 순서를 이 하나로 둔다.
3. 받지 못한 후보는 모두 `waiting`이다. 대기 그룹은 대기 상한을 넘기 전까지 거부되지 않는다. 상한을 넘으면 요청을 거부하고 내구 이벤트 `lease.rejected`를 커밋한다(plan G-30, REQ-X-08) [결정: review.m3-design-inputs D-M3-05]. drive 함수만 호출되지 않고 `on`, `post`, `delegate`는 계속 동작한다.
4. `auto`는 선점하지 않는다. 임대가 있는 동안 X는 `choose`를 부르지 않으므로 holder는 그 임대가 반납될 때(`idle`, 상한, 끄기, 오류)까지 유지된다. 그룹을 새로 켜거나 설정이 `null`로 바뀌어도 현재 임대는 회수되지 않는다. 이름 지정은 X가 회수한다: `x.primitives.activeDriveGroup`이 다른 후보 그룹을 가리키면 X가 다음 경계에서 현재 임대를 `lease.released{reason:"revoked"}`로 반납하고 이어서 가리킨 그룹에 부여한다(X.primitives.spec §4.4.1 5번, [결정: P-22]). 가리킨 그룹이 후보가 아니면 현재 임대를 유지한다(§4.3).

- [결정] drive 임대는 한 번에 그룹 하나만 가진다. `on`, `post`, 백그라운드 위임은 여러 그룹이 함께 쓴다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 4, F.extensions.spec §4.6).
- `product.vision.spec` §5와 §10 미결 3("두 그룹이 동시에 drive를 요청할 때 기본 동작, 대기 또는 거부")에 위 규칙 3(대기, 상한 뒤 거부)으로 답한다 [결정: review.m3-design-inputs D-M3-05].
- 설정 키 [결정: review.decisions-2 S-15]: drive 보유 그룹 설정은 X 키 `x.primitives.activeDriveGroup` 하나다. group-kit은 별도 키를 두지 않고 이 키의 유효 값을 정책 입력으로 읽는다. 포트가 없을 때(group-kit 없이 X만 올린 테스트 호스트 등) X는 같은 키로 기본 규칙을 쓴다(X.primitives.spec §4.4.1 4번). 값이 `null`이고 후보가 둘 이상일 때 X 기본 규칙은 아무에게도 주지 않고, group-kit 정책은 요청 순서로 정한다(규칙 2). `/group drive`와 설정 화면의 "구동 그룹" 선택은 이 키를 쓴다.
- 회수 경로 [결정: X.primitives.spec §4.4.1 5번, P-22]: 정책(`DriveArbiter`)은 임대를 회수하지 않는다. 회수는 X가 설정 `x.primitives.activeDriveGroup`을 직접 읽고 다음 경계에서 한다. 사용자가 이름을 지정하면(`/group drive <이름>`) 현재 임대는 그 경계까지 유지되고 진행 중인 `loop.turn`은 끊기지 않는다. 현재 holder를 끄는 방법(`/group off <이름>`, `lease.released{reason:"disabled"}`)과 holder의 drive가 `idle`로 반납하기를 기다리는 방법도 그대로 쓸 수 있다.
- `DriveLease.status`에 대기 상태는 넣지 않는다 [제안]. 대기는 정책 결과다. 임대 상태 기계에 넣지 않고 group-kit의 `GroupStatus.drive`로만 나타낸다.

### 3.6 그룹 상태 레코드

비공개 상태와 공개 레코드:

| 구분 | 비공개 상태 문서 | 공개 그룹 레코드 |
|---|---|---|
| 정의 | `StateDecl<S>`(schema, initial, version), F.extensions.spec §3.2 | `GroupRecord`, `RecordKindDecl`, F.extensions.spec §3.6 |
| 쓰기 연산 | `g.commit(next)` | `g.record(kind, subject, payload)` |
| 읽기 연산 | `g.state()`, 핸들러 `ctx.state`, drive 함수 인자 | `g.readRecords(query)`(다른 그룹), 자기 레코드는 선언 없이 |
| 내구 이벤트 kind | `grp.<그룹>.state.committed`(X.primitives.spec §4.6.1. 영역 `state`는 X 예약) [결정: review.decisions-2 T-21] | `grp.<그룹>.<영역>.<이름>`(F.records.spec §3.2) |
| 투영 | `x_<그룹의 하이픈을 밑줄로>_state`(X 소유 투영기, X.primitives.spec §4.6.1. 접두 규칙은 review.decisions-2 U-18) | 투영 없음. 이벤트 로그를 kind로 읽는다 [가정: L1.persistence.spec 조회] |
| 읽는 쪽 | 그 그룹만 | 매니페스트 `readsRecordKinds`를 선언한 그룹 |
| 스키마 버전 | `StateDecl.version`, 업캐스터는 `GroupDef.migrations`에서 만든다(§4.7) | `RecordKindDecl.version`, 읽는 쪽이 해석(F.extensions.spec §5 9번) |
| 크기 | 직렬화 64 KiB 이하 [제안] | payload 16 KiB 이하 [제안]. 본문은 L2 저장소에 두고 id만 싣는다 |
| 분기·재개 | leaf 기준 복원(§4.6) | 이벤트 로그의 가지를 따른다 |
| 소유 kind 카탈로그 | `state.committed`는 X.primitives.spec §4.6.1, 비공개 기록(`recordPrivate`)은 각 그룹 문서 | 각 그룹 문서, 매니페스트 `recordKinds` |

```ts
// xeon/packages/group-kit/src/state.ts
import type { JsonValue } from "@xeon/contracts/conversation";
import type { Upcaster } from "@xeon/contracts/records";

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

/** GroupDef.migrations를 F Upcaster 배열로 바꾼다. 순수 함수 */
export function stateUpcasters(version: number, migrations: StateMigrations | undefined): readonly Upcaster[];

/** commit 전 검사. 순수 함수 */
export type StateCheck =
  | { readonly ok: true; readonly bytes: number; readonly unchanged: boolean }
  | { readonly ok: false; readonly kind: "state.schema"; readonly issues: readonly string[] }
  | { readonly ok: false; readonly kind: "state.tooLarge"; readonly bytes: number; readonly limit: number };
export function checkStateCommit<S>(decl: StateDecl<S>, current: Readonly<S>, next: S): StateCheck;
```

- [가정] `ScopeApi.commit`의 저장은 X.primitives.spec이 구현한다. group-kit의 상태 어댑터(`state.ts`)는 그 저장에 넣을 규칙만 제공한다: 커밋 전 검사(`checkStateCommit`), 이벤트 payload 모양, 투영 행 모양, 업캐스터. X가 이 함수들을 호출하는 방식(F 타입으로 넘길지, group-kit이 `wrap`에서 먼저 검사할지)은 X.primitives.spec과 맞춘다. [제안] 기본은 `wrap`의 `commit`이 `checkStateCommit`을 먼저 부르고 통과한 값만 X `commit`에 넘기는 방식이다.
- 비공개 상태는 다른 그룹이 읽지 않는다(F.extensions.spec §3.6). 다른 그룹의 `x_<그룹>_*` 테이블을 쿼리하면 `eng.context-map.design` CM-02 위반이다.

### 3.7 그룹 간 통신

허용:

| 연산 | 조건 |
|---|---|
| `g.record(kind, subject, payload)` | `kind`가 자기 `grp.<이름>.` 접두이고 매니페스트 `recordKinds`에 선언됨. X가 `validateGroupRecord`로 payload를 검사(F.extensions.spec §4.8) |
| `g.readRecords(query)` | `query.kind`가 매니페스트 `readsRecordKinds`에 선언됨. 대상 그룹이 없으면 빈 목록 |
| L2 능력 서비스 | `g.capability(key)`. 공유 저장(스킬, 메모리)은 L2 knowledge가 소유(`eng.context-map.design` 3절 규칙 5) |

금지와 검사 수단:

| 금지 | 예 | 검사 |
|---|---|---|
| 다른 그룹 패키지 import(값, `import type`, 재수출, 동적 `import()`, `package.json` 의존) | `import { x } from "@xeon/group-learning"` | `check-layers.ts` DR-02, depcruise `DR-02-no-same-layer-import-L3`, DR-14 |
| `group-kit`이 그룹 패키지를 import | `import "@xeon/group-helm"` | 같음. 허용 목록은 그룹 → `group-kit` 한 방향만 |
| 다른 그룹의 서비스 호출 | `ctx.get("learning")` | 그룹은 서비스를 제공하지 않는다(`eng.context-map.design` 5.3절). `inject`에 그룹 서비스 이름이 나오면 로딩 실패(CM-06) |
| Cordis 일반 `emit` 직접 사용 | `ctx.emit("helm/phase", …)` | DR-11(`cordis` import는 `ext-host`만). `GroupApi`에 `emit`이 없다 |
| 다른 그룹의 비공개 테이블·이벤트 읽기 | `SELECT * FROM x_learning_state` | CM-02, 리뷰 |
| 다른 그룹 접두로 레코드 쓰기 | 학습 그룹이 `grp.helm.signal.detected`를 씀 | F `validateManifest` `record_kind_prefix` |

이벤트 격리 정책 [제안]:

- 그룹에 열리는 이벤트 통로는 F의 지점(`on`)과 `readRecords` 둘이다. 그룹 코드는 Cordis 이벤트 버스를 보지 않는다.
- 기본은 kind 접두 필터다. X가 그룹에게 이벤트·레코드를 넘길 때 다음만 통과시킨다: 코어 kind(F.records.spec `CoreEventKind`) 가운데 지점 페이로드로 넘어가는 것, 자기 `grp.<이름>.*`, 매니페스트 `readsRecordKinds`가 가리키는 kind. 나머지 `grp.*`, `x.*`(다른 확장의 상태 이벤트와 `recordPrivate` 기록 포함)는 통과시키지 않는다.
- 근거: ADR-0007 §6 [미결] "그룹 사이 이벤트 격리 정책", `_research/notes/arch-1.md` §3(일반 `emit`은 격리되지 않는다), §8. 확정은 X.primitives.spec과 함께 한다.

### 3.8 GroupService (`xeon.groups`)

[결정: review.decisions-2 D-04] `GroupService`와 부속 타입은 F `@xeon/contracts/services`의 `services/groups.ts`에 둔다(`F.capabilities.spec` §3.12 표와 파일별 이름 표, 규칙 7). `GroupService`가 X `LeaseArbiterPort`(`F.extensions.spec` §3.2.1)를 확장하고 X가 그 포트로 주입받기 때문이다. 아래 블록은 그 파일의 필드 정의이고, `F.capabilities.spec` §3.12는 이 절을 필드 출처로 가리킨다. group-kit은 `service.ts`에서 이 인터페이스를 구현한다.

```ts
// xeon/packages/contracts/src/services/groups.ts  (F.capabilities.spec §3.12)
import type {
  GroupId, LeaseArbiterPort, LeaseId, RecordKind, ScopeId, ScopeStatus, Unsubscribe,
} from "../extensions";

export const GroupServiceName = "xeon.groups";

/** 설정 x.primitives.activeDriveGroup의 유효 값. null은 auto(요청 순서)다 */
export type DriveHolderSetting = ScopeId | null;

/** settings를 import하지 않으므로 F.wire-settings SettingScope와 같은 모양의 리터럴 유니언으로 적는다(F.capabilities.spec §3.12) */
type HolderSettingScope = "managed" | "user" | "project" | "local" | "session";

/** GroupStatus.metrics. group-kit GroupMetrics(§3.12)의 부분 필드와 같은 모양이다 */
export interface GroupMetricsSummary {
  readonly denies: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly costUsd: number;
  readonly leaseMs: number;
}

/** rejected: drive 임대 요청이 대기 상한 뒤 거부됐다(`lease.rejected`, M3-REQ-99). 채우는 일은 X 커밋이 낸 이벤트를 읽는 group-kit 작업이 한다 */
export type DriveRole = "holder" | "waiting" | "none" | "error" | "rejected";

export interface GroupError {
  readonly kind: "group.driveThrew" | "group.setupFailed" | "group.stateInvalid" | "group.migrationFailed";
  readonly message: string;
  /** 오류를 기록한 이벤트 seq. 기록 전이면 null */
  readonly atSeq: number | null;
}

export interface GroupStatus {
  readonly id: GroupId;
  readonly displayName: string;
  readonly scope: ScopeStatus;
  /** scope가 enabling이면 "enable", disabling이면 "disable" */
  readonly pendingToggle: "enable" | "disable" | null;
  readonly usesDrive: boolean;
  /** drive를 쓰지 않거나 꺼져 있으면 "none" */
  readonly drive: DriveRole;
  readonly leaseId: LeaseId | null;
  readonly lastError: GroupError | null;
  /** 매니페스트 recordKinds의 kind 목록 */
  readonly recordKinds: readonly RecordKind[];
  /** l3.group-kit.instrumentation이 false면 null */
  readonly metrics: GroupMetricsSummary | null;
}

export type GroupSettingUnwritableReason =
  | "no_thread" | "ambiguous_thread" | "not_owner" | "project_unavailable" | "invalid_value" | "storage";

export type GroupCommandError =
  | { readonly kind: "group.unknown"; readonly id: string; readonly known: readonly GroupId[] }
  | { readonly kind: "group.noDrive"; readonly id: GroupId }
  | { readonly kind: "group.settingLocked"; readonly key: string }
  /** 잠금은 아니지만 쓸 수 없었다. 쓸 thread를 정하지 못했거나(no_thread, ambiguous_thread), 소유가 없거나(not_owner), 프로젝트 파일을 쓸 수 없거나(project_unavailable), 값이 정의에 맞지 않거나(invalid_value), 저장소가 실패했다(storage) */
  | { readonly kind: "group.settingUnwritable"; readonly key: string; readonly reason: GroupSettingUnwritableReason };

export type GroupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GroupCommandError };

export interface ToggleReceipt {
  readonly id: GroupId;
  readonly status: ScopeStatus;
  /** 실행 중인 turn이 있으면 nextStepBoundary. 유휴 시점 적용은 X.primitives.spec [가정] */
  readonly appliesAt: "nextStepBoundary" | "now";
}

export interface HolderReceipt {
  readonly holder: DriveHolderSetting;
  readonly scope: HolderSettingScope;
  /** 다른 그룹이 임대를 가지고 있으면 afterLeaseRelease. 임대가 없으면 X가 다음 판단 시점에 읽는다 */
  readonly appliesAt: "nextStepBoundary" | "now" | "afterLeaseRelease";
}

/** xeon.groups 서비스. X LeaseArbiterPort(choose)를 확장한다(F.capabilities.spec §3.12 규칙 2) */
export interface GroupService extends LeaseArbiterPort {
  /** 설치된 모든 그룹. 정렬: holder, 켜진 그룹(로드 순서), 꺼진 그룹(이름순) */
  list(): readonly GroupStatus[];
  status(id: string): GroupResult<GroupStatus>;
  /** ScopeHandle.enable() 요청만 기록. 이미 켜져 있으면 그대로 ok */
  enable(id: string): GroupResult<ToggleReceipt>;
  disable(id: string): GroupResult<ToggleReceipt>;
  /** 설정 x.primitives.activeDriveGroup을 쓴다. holder "auto"는 null로 쓴다. scope 기본값 "session". 현재 임대는 회수하지 않는다(§3.5 규칙 4) */
  setDriveHolder(holder: string, options?: { readonly scope?: HolderSettingScope; readonly threadId?: ThreadId }): Promise<GroupResult<HolderReceipt>>;
  /** 상태가 바뀔 때 전체 목록을 넘긴다. 단계 경계마다 최대 한 번 */
  onChange(listener: (groups: readonly GroupStatus[]) => void): Unsubscribe;
}
```

- 구현 [M2]: `createGroupService(deps)`가 `GroupServiceWithSetting`(`GroupService` + `driveHolderSetting()`)을 만든다. 의존은 `host`(`ExtHost`의 `scopes`·`scope`·`leaseOf`·`onChange`·`ports`), `catalog`(`GroupCatalogPort`: 설치된 그룹의 매니페스트와 로드 순서), `holder`(`DriveHolderSettingsPort`: 설정 `x.primitives.activeDriveGroup` 읽기·쓰기), `currentThread`, `report`다. `DriveHolderSettingsPort.write(holder, scope, threadId)`의 `threadId`는 `setDriveHolder`의 `options.threadId`(없으면 null)이고, 쓰기 실패는 `HolderWriteError`(`locked`, 또는 `unwritable`과 `reason`)로 돌려준다. 서비스는 `locked`를 `group.settingLocked`로, `unwritable`을 `group.settingUnwritable`(같은 `reason`)로 옮기고 `appliesAt`는 `options.threadId`가 있으면 그 thread의 임대로 잰다 [결정: 통합 검토 L8]. 쓸 thread를 정하는 일(`no_thread`·`ambiguous_thread`)은 포트 구현(HOST)이 한다. `catalog`와 `holder`는 조립 루트가 로더 보고와 설정 서비스에 연결한다. 상태는 호출 때마다 `ExtHost`에서 새로 읽고 사본을 쌓지 않는다. `onChange`는 같은 동기 구간의 변경을 구독자에게 한 번만 알린다. `GroupStatus.metrics`는 `metrics` 의존이 없으면 null이다(계측 이벤트는 M3).
- `setDriveHolder`의 `appliesAt` [M2]: `auto`는 `"now"`(현재 holder 유지). 지정한 그룹이 이미 holder면 `"now"`. 임대가 없으면 `"nextStepBoundary"`. 다른 그룹이 임대를 갖고 지정한 그룹이 후보(켜짐, drive 등록, 오류 아님)이면 X가 다음 경계에서 회수하므로 `"nextStepBoundary"`, 후보가 아니면 현재 임대를 유지하므로 `"afterLeaseRelease"`다. `contracts/services/groups.ts`의 `setDriveHolder` 주석 "현재 임대는 회수하지 않는다"는 이 규칙과 맞지 않아 F 레인에 고침을 요청한다.
- 서비스 이름 `xeon.groups`와 인터페이스 이름 `GroupService`는 `eng.context-map.design` 5.3절 표와 같다. 소비자는 `helm`, `learning`, `host`, 그리고 `LeaseArbiterPort`로 주입받는 X다. `choose`는 `leaseArbiterPort(defaultDriveArbiter, …)`가 만든 함수다(§3.5).
- [결정: review.decisions-2 D-04] 위 이름(`GroupService`, `GroupServiceName`, `DriveRole`, `GroupError`, `GroupStatus`, `GroupCommandError`, `GroupSettingUnwritableReason`, `GroupResult`, `ToggleReceipt`, `HolderReceipt`, `DriveHolderSetting`, `GroupMetricsSummary`)은 F `services/groups.ts`가 내보낸다. group-kit은 `@xeon/contracts/services`에서 `import type`으로 가져와 다시 내보내고 자기 정의를 두지 않는다. `GroupId`, `ScopeStatus`, `LeaseId`, `RecordKind`, `Unsubscribe`, `LeaseArbiterPort`, `ScopeId`는 F `extensions`에서 온다. `HolderSettingScope`는 파일 안 별칭이고 내보내지 않는다. `F.wire-settings.spec`의 `SettingScope`와 서로 대입 가능해야 한다(§9 수용 기준 20).
- `enable`, `disable`의 지속: 이 메서드는 현재 엔진의 scope 상태만 바꾼다. 다음 실행에도 남기려면 X 예약 키 `ext.<이름>.enabled`를 L4 설정 경로로 쓴다(§6).
- `setDriveHolder` 오류: 설치되지 않은 이름은 `group.unknown`, `usesDrive`가 false인 그룹은 `group.noDrive`, 관리 범위가 값을 잠갔으면 `group.settingLocked`, 잠기지는 않았지만 쓸 수 없었으면 `group.settingUnwritable`(이유는 `reason`). 오류면 설정을 바꾸지 않는다. `options.threadId`는 설정을 쓰고 `appliesAt`를 재는 thread다. 생략하면 `session`·`project`·`local` 범위는 쓰기 소유를 쥔 thread가 하나일 때 그 thread에 쓰고, 정할 수 없으면 대상이 없을 때 `no_thread`, 여럿일 때 `ambiguous_thread`다. "마지막으로 쥔 thread"를 고르지 않는다 [결정: 통합 검토 L8].
- 거부 표시 [M3a, G-30]: `createGroupService`는 커밋 피드 포트(`{ name: "xeon.session", member: "feed" }`)가 있으면 구독해 내구 이벤트로 거부 상태를 센다. `lease.rejected{groupId}`가 오면 그 thread에서 그 그룹을 거부로 기록하고, 그 thread의 `lease.released`, 그 그룹의 `lease.acquired`, 그 그룹의 `scope.changed`가 오면 지운다. X가 거부된 scope를 다음 임대 반납 커밋까지 다시 세지 않는 규칙과 같다. `GroupStatus.drive`는 `ScopeInfo.drive`가 `registered`이고 거부로 기록된 그룹에 `"rejected"`이고, 기록이 바뀌면 `onChange`로 알린다. 상태줄 `[거부]`와 `/group status`의 `drive=거부`는 이 값을 그대로 보인다. 기록은 프로세스 메모리에만 둔다. 피드 포트가 없는 구성(시험 호스트 기본값)은 `"waiting"`으로 남는다. 피드 연결 전에 커밋된 거부는 보이지 않는다 [제안].
- [가정] 서비스 한 인스턴스는 현재 활성 thread 하나의 그룹 상태를 보인다. scope 토글과 임대가 thread마다 따로인지는 X.primitives.spec이 정한다.

### 3.9 전환 명령과 상태줄

명령 문법(L4가 등록하고 group-kit은 해석과 실행만 제공한다):

```text
group-cmd = "/group" [ SP sub ]
sub       = "status" [ SP name ]
          | "on" SP name
          | "off" SP name
          | "drive" SP ( name | "auto" )
name      = %x61-7A 1*31( %x61-7A / DIGIT / "-" )   ; GROUP_NAME_PATTERN
```

```ts
// xeon/packages/group-kit/src/commands.ts
export type GroupCommand =
  | { readonly op: "status"; readonly id?: string }
  | { readonly op: "on" | "off"; readonly id: string }
  | { readonly op: "drive"; readonly target: string };   // "auto" 또는 그룹 이름

export type GroupCommandParse =
  | { readonly ok: true; readonly command: GroupCommand }
  | { readonly ok: false; readonly usage: string };

/** "/group" 뒤의 인자 문자열을 해석한다. 순수 함수 */
export function parseGroupCommand(args: string): GroupCommandParse;

export interface CommandOutput {
  readonly ok: boolean;
  /** 사람이 읽는 여러 줄 문자열 */
  readonly text: string;
  /** 다음 단계 경계에 적용될 변경이 있으면 참 */
  readonly pending: boolean;
}

export function runGroupCommand(service: GroupService, command: GroupCommand): Promise<CommandOutput>;

/** L4 명령 등록부에 넘기는 모양 [가정: L4.cli.spec의 명령 등록 인터페이스] */
export interface GroupCommandRegistration {
  readonly name: "group";
  readonly summary: string;
  readonly usage: string;
  run(args: string): Promise<CommandOutput>;
}
export function groupCommand(service: GroupService): GroupCommandRegistration;
```

출력 문자열 [제안]:

| 경우 | `text` |
|---|---|
| 인자 해석 실패 | `사용법: /group status [이름] \| on <이름> \| off <이름> \| drive <이름\|auto>` |
| 알 수 없는 이름 | `알 수 없는 그룹: xyz. 설치된 그룹: helm, learning` |
| drive 미사용 그룹을 holder로 지정 | `learning 그룹은 drive를 쓰지 않아 구동 그룹으로 지정할 수 없다` |
| 잠긴 설정 | `x.primitives.activeDriveGroup은 상위 범위 설정이 잠가 바꿀 수 없다` |
| 쓸 수 없는 설정 | `x.primitives.activeDriveGroup을 쓸 수 없다: <이유>`. 이유 문구: `no_thread` 쓸 대화가 없다 / `ambiguous_thread` 열린 대화가 여럿이라 어느 대화에 쓸지 정할 수 없다 / `not_owner` 그 대화의 쓰기 소유를 이 프로세스가 쥐고 있지 않다 / `project_unavailable` 프로젝트 설정 파일을 쓸 수 없다(작업 폴더가 없거나 신뢰하지 않는다) / `invalid_value` 값이 설정 정의에 맞지 않는다 / `storage` 저장소나 설정 파일 쓰기에 실패했다 |
| 켜기 요청(실행 중) | `helm 켜기 요청을 기록했다. 다음 단계 경계에 적용한다` |
| 켜기 적용(유휴) | `helm 그룹을 켰다` |
| 끄기 요청(실행 중) | `helm 끄기 요청을 기록했다. 다음 단계 경계에 적용한다` |
| 끄기 적용(유휴) | `helm 그룹을 껐다` |
| drive 지정(임대 없음, 또는 지정한 후보로 X가 옮김) | `구동 그룹을 지정했다: helm. 다음 단계 경계에 적용한다` |
| drive 지정(지정한 그룹이 후보가 아니어서 현재 임대를 유지) | `구동 그룹을 지정했다: helm. review의 임대가 반납된 뒤 적용한다` |
| drive 지정(이미 holder) | `구동 그룹을 지정했다: helm` |
| drive auto | `구동 그룹 선택을 바꿨다: auto. 현재 holder는 유지한다` |

- 한국어 조사(을/를, 으로/로)는 그룹 이름의 발음에 따라 달라져 문자열로 정할 수 없으므로 이름 뒤에 조사를 붙이지 않는 문장으로 쓴다.

`/group status`는 그룹마다 한 줄을 낸다: `<이름>  <켜짐|꺼짐|켜는 중(다음 단계 경계)|끄는 중(다음 단계 경계)>  drive=<구동|대기|없음|오류>  [오류: <message>]`. 첫 줄은 `구동 그룹 설정: <auto|이름>`이고, 설정이 설치되지 않은 그룹을 가리키면 `구동 그룹 설정: review(설치되지 않음)`이다. 첫 줄은 서비스가 `driveHolderSetting()`을 가질 때(`GroupServiceWithSetting`)만 낸다. 출력 구현은 `runGroupCommand`·`groupCommand`(`commands.ts`)다.

상태줄:

```ts
// xeon/packages/group-kit/src/status-line.ts
export interface StatusLineOptions {
  /** 표시 폭(열). 한글·CJK는 두 열로 센다. 기본 60 */
  readonly maxWidth?: number;
  /** l3.group-kit.statusLine 값. false면 null을 돌려준다. 기본 true */
  readonly enabled?: boolean;
}
/** l3.group-kit.statusLine이 false이거나 표시할 그룹이 없으면 null. 순수 함수 */
export function formatGroupStatusLine(groups: readonly GroupStatus[], options?: StatusLineOptions): string | null;
```

규칙 [제안]:

1. 표시 대상은 켜졌거나 켜기·끄기가 대기 중인 그룹이다. 하나도 없으면 null이다.
2. 형식은 `그룹 ` 뒤에 항목을 공백으로 잇는다. 항목은 이름 뒤에 표시를 붙인다: holder `[구동]`, 대기 `[대기]`, 오류 `[오류]`. 켜기 대기는 `+이름`, 끄기 대기는 `-이름`이다.
3. 순서는 holder, 켜진 그룹(로드 순서), 대기 중인 토글 순이다. 오류 표시(`[오류]`)와 대기 표시(`[대기]`)는 순서를 바꾸지 않는다. 그 그룹은 켜진 그룹의 로드 순서 자리에 둔다.
4. 대기 중인 토글이나 holder 변경이 있으면 끝에 ` · 다음 단계 경계에 적용`을 붙인다.
5. 폭을 넘으면 뒤 항목부터 빼고 `+N`(뺀 개수)을 항목 바로 뒤에 붙인다. 적용 대기 문구는 빼지 않고, 항목 하나는 폭을 넘어도 남긴다. 기본 폭은 60열이다. 아래 예 3은 48열을 넘기 때문이다(전각 문자를 두 열로 센 값이 58열).

예:

| 상황 | 상태줄 |
|---|---|
| Helm 구동, 학습 그룹 켜짐 | `그룹 helm[구동] learning` |
| 추가 그룹 review 대기 | `그룹 helm[구동] learning review[대기]` |
| 실행 중 learning 끄기 요청 | `그룹 helm[구동] learning -learning · 다음 단계 경계에 적용` |
| Helm drive 예외 | `그룹 helm[오류] learning` |
| activeDriveGroup=review인데 review가 꺼짐 | `그룹 helm[대기] learning` |

- 상태줄 문자열 생성은 group-kit이 하고, 표시 위치와 갱신 주기는 L4가 정한다. L4는 `GroupService.onChange`나 wire 알림으로 목록을 받는다 [가정: L4.cli.spec, F.wire-settings.spec 알림 표].

### 3.10 replayDrive (재생 규율 검사 하니스)

M2 최소형은 Helm 테스트가 쓴다. 2차에 옵션을 넓힌다. M2 최소형의 옵션은 `group`, `harness`, `maxCommits`뿐이고 절단 지점은 항상 모든 커밋이다.

- 파일 위치: `replayDrive`(§3.10)와 `scanDriveSource`(§3.11)는 `src/testing/` 아래에 둔다. 테스트 전용 도구이기 때문이다.
- 다른 패키지 import [제안]: DR-08·DR-14의 testing 정의는 "테스트 파일만 다른 패키지의 테스트 대역을 import한다"로 통일되었다 [결정: review.decisions-2 U-17]. 그래서 `replayDrive`는 테스트 호스트와 모델 테이프를 import하지 않고 `ReplayHarness`로 받는다. 하니스는 그룹 패키지의 테스트 파일이 `@xeon/ext-host`·`@xeon/core-models`의 테스트 대역으로 만든다.

```ts
// xeon/packages/group-kit/src/testing/replay/replay-drive.ts  (공개 진입점: @xeon/group-kit/testing)
import type { JsonValue } from "@xeon/contracts/conversation";

/** 그룹 테스트 파일이 만든다. 호스트·테이프·정규화는 하니스 안에 있다 */
export interface ReplayHarness {
  /** 새 테스트 호스트에 그룹 하나를 holder로 올린다. restore가 null이면 처음부터, 값이 있으면 그 이벤트열의 앞 commits개 커밋만 복원하고 재개 절차로 시작한다. 같은 테이프로 끝까지 실행한다 */
  run(group: GroupModule, restore: { readonly events: readonly JsonValue[]; readonly commits: number } | null):
    Promise<{ readonly events: readonly JsonValue[]; readonly commitPoints: readonly number[]; /* M3a(G-20): 효과 계수기를 가진 하니스만 채운다. 이 실행이 새로 낸 효과 수 */ readonly effects?: EffectCounts }>;
  /** 정규화한 이벤트열의 digest. 같은 의미면 같은 문자열 */
  digest(events: readonly JsonValue[]): string;
  /** 두 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  firstDiff(a: readonly JsonValue[], b: readonly JsonValue[]): number | null;
}

export interface ReplayDriveOptions {
  readonly group: GroupModule;
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
}

export interface ReplayDriveReport {
  readonly commits: number;
  readonly baselineDigest: string;
  readonly cuts: readonly ReplayCut[];
  readonly ok: boolean;
  /** ok가 false인데 절단 비교 때문이 아니면 채운다: 커밋 수가 maxCommits 초과, 커밋이 하나도 없음, 효과 계수가 기준보다 큼(M3, 아래 4번) */
  readonly failure?: "max-commits-exceeded" | "no-commits" | "effects-doubled" | "effects-mismatch";
  /** [M3a] 기준 실행의 효과 수. 하니스가 계수기를 가진 경우만 */
  readonly effects?: EffectCounts;
}

export function replayDrive(options: ReplayDriveOptions): Promise<ReplayDriveReport>;
```

동작:

0. 하니스를 만드는 쪽의 규약 [M2]: 커밋 지점은 그룹 상태 커밋(`grp.<이름>.state.committed`) 바로 뒤로 잡고, 비교하는 이벤트열은 마지막 커밋까지로 자른다. 마지막 커밋 뒤의 임대 반납·재부여는 경계를 몇 번 돌렸는지에 따라 길이가 달라지는 X의 꼬리라서 그룹이 정하는 부분이 아니다. 복원은 앞 k개 커밋까지의 이벤트를 새 저장소에 넣고 `TestHost.restart()`로 호스트를 다시 만든 뒤 thread를 여는 것이다. 이벤트의 ID는 호스트마다 범위가 달라 처음 나온 순서의 자리표시자로 바꿔 비교한다. 예는 `test/support/replay-harness.ts`다.
1. 기준 실행: `harness.run(group, null)`으로 그룹 하나를 holder로 올려 테이프로 끝까지 실행한다. 내구 이벤트열과 커밋 지점 목록을 얻는다. 커밋 지점은 `g.commit`, `loop.turn` 결과, `loop.spawn` 결과, `post` 수락, `record` 쓰기가 커밋된 위치다.
2. 지점 k마다: `harness.run(group, { events, commits: k })`로 새 호스트에 앞 k개 커밋만 복원하고 프로세스 재시작과 같은 재개 절차로 drive 함수를 마지막 커밋 상태로 다시 부른다. 같은 테이프로 끝까지 실행한다.
3. 두 이벤트열을 `harness.digest`로 비교하고 다르면 `harness.firstDiff`로 위치를 얻는다. 정규화 규칙은 `eng.testing.guide` 1.2절을 따른다. F에는 `./testing` 서브패스를 두지 않으므로 정규화 함수는 하니스를 만드는 테스트 쪽이 가진다 [결정: review.decisions-2 U-03]. 모든 지점에서 같으면 `ok`다. 커밋이 하나도 없는 실행은 확인할 것이 없으므로 `ok: false`, `failure: "no-commits"`다(그룹이 임대를 받지 못한 시험 오류가 조용히 통과하지 않게 한다).
4. 효과 계수 [제안, G-20, ADR-0015 §3.6, M3a 구현]: 기준 실행의 모든 커밋 지점에서 끊고 재개할 때, 끊기 직전의 drive 호출과 on 핸들러를 같은 입력으로 두 번 실행한다. 가짜 포트(`LoopPort`, 입력 큐, 위임 서비스, 능력 공급자)가 효과 계수기를 가지고, 하니스는 `harness.run`의 결과에 `effects`(아래 `EffectCounts`)를 싣는다. 기준 실행의 `effects`는 그 실행이 낸 효과 전부이고, 절단 실행의 `effects`는 복원한 뒤 새로 낸 효과다. 절단 실행은 기준 실행과 같은 가짜 포트의 멱등 기억(요청 키 표)을 이어 써야 하고, 그러면 같은 상태·입력의 재실행은 새 효과가 0이다(옛 안의 "같은 지점까지의 계수 비교"는 이 규칙으로 바꿨다). 계수는 코어가 중복으로 돌려준 호출(`duplicate`, 재생된 `loop.turn`·`loop.spawn`, 처음 결과를 돌려준 멱등 능력 호출)과 읽기 호출을 세지 않는다. 이벤트열이 모두 같아도 절단 실행이 새 효과를 냈으면 `ok: false`, `failure: "effects-doubled"`다. `expectEffects`를 주면 기준 실행의 효과 수가 그 값과 같은지도 보고(`effects-mismatch`), 효과가 한 번 났다는 확인은 이 값으로 한다. `diffEffects`, `effectKindsOf`, `NO_EFFECTS`는 하니스를 만드는 쪽이 계수를 다룰 때 쓴다. 가짜 위임 서비스는 `fakeAgents`(`@xeon/group-kit/testing`)다.

```ts
/** 가짜 포트가 센 외부 효과 수. 중복 응답과 읽기는 세지 않는다 */
export interface EffectCounts {
  readonly turn: number;
  readonly spawn: number;
  readonly delegate: number;
  /** `idempotent: true` 능력 메서드의 새 효과 수 */
  readonly capabilityWrite: number;
  readonly post: number;
}
```

- 근거: `eng.events.design` EV-09 강제 수단("커밋 지점마다 프로세스를 끊고 재호출해 같은 이벤트 열이 나오는지"), 7.1절 4번. 결정성 등급은 D0다(`eng.testing.guide` TS-02).

### 3.11 scanDriveSource (M3a 구현)

```ts
// xeon/packages/group-kit/src/testing/scan/scan-drive.ts  (공개 진입점: @xeon/group-kit/testing)
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
export function scanDriveSource(source: string, options?: { readonly fileName?: string }): readonly DriveScanFinding[];
```

- 대상: `<식>.drive(` 호출의 첫 인자로 넘긴 함수 식, 또는 같은 파일 안에서 그 이름으로 선언한 함수의 본문이다. 본문 안에 정의한 중첩 함수도 포함한다. 같은 파일의 다른 함수를 drive 본문이 직접 부르면 그 함수 본문도 한 단계만 검사한다 [제안]. 다른 모듈은 검사하지 않는다.
- 금지 문자열은 `eng.typescript.guide` TY-21과 `eng.anti-patterns.guide` AP-C-05의 목록과 같다. 메시지는 TY-21 `.oxlintrc.json` 항목의 문자열을 그대로 쓴다.

| 코드 | 대상 | 심각도 | 메시지 | 근거 |
|---|---|---|---|---|
| SD-01 | `Date.now` | error | `Inject Clock (eng.typescript.guide TY-21).` | TY-21, AP-C-05 |
| SD-02 | 인자 없는 `new Date()` | error | `Inject Clock (TY-21).` | TY-21 `xeon/no-ambient-time` |
| SD-03 | `Math.random` | error | `Inject RandomSource (TY-21).` | TY-21, AP-C-05 |
| SD-04 | `crypto.randomUUID` | error | `Use IdFactory (TY-21).` | TY-21 |
| SD-05 | `crypto.getRandomValues` | error | `Inject RandomSource (TY-21).` | TY-21 |
| SD-06 | `performance.now` | error | `Inject Clock (TY-21).` | TY-21 |
| SD-07 | `fetch` 호출 | error | `Direct I/O is not allowed in drive; use the effects of ADR-0015 §3.2.` | F.extensions.spec §4.6, ADR-0015 §3.2 |
| SD-08 | `node:fs`, `fs`, `node:fs/promises` 바인딩 사용, `Bun.file`, `Bun.write` | error | 같음 | F.extensions.spec §4.6 |
| SD-09 | 그 밖의 `Bun.*` 호출(`Bun.spawn`, `Bun.$`, `Bun.sleep` 등) | error | 같음 | F.extensions.spec §4.6 |
| SD-10 | drive 함수 밖에서 선언한 `let`·`var` 변수를 drive 본문이 재할당 | warning | `drive state lives only in scope state (eng.events EV-09).` | EV-09 |

- 구현 [M3a]: 위 표를 그대로 구현했다. 보태거나 좁힌 점은 다음과 같다. (1) 구문 오류가 있으면 `SD-00` 오류 하나(줄 1, 열 1, 메시지는 파서 메시지)를 돌려준다 [제안]. (2) 금지 문자열은 호출이 아니어도 참조하면 찾는다(`const now = Date.now`). `Bun.file`·`Bun.write`는 SD-08, 그 밖의 `Bun.<이름>`은 SD-09다. (3) SD-08은 `fs`, `node:fs`, `fs/promises`, `node:fs/promises` import의 지역 이름을 drive 본문에서 쓰면 낸다. (4) SD-10은 같은 파일에서 `let`·`var`로 선언했고 drive 함수 밖에 있는 변수를 본문이 대입·증감할 때 낸다. 구조 분해로 가려진 이름이나 다른 파일 변수는 보지 않는다. (5) 줄·열은 1부터이고 열은 UTF-16 코드 단위다. 결과는 위치 순서다. 한계는 협조적 코드만 잡는다는 점이다. 별칭(`const f = fetch`)과 동적 접근(`globalThis["fetch"]`)은 못 잡는다.
- 파서 [제안]: `@swc/core` 1.16.18(catalog에 이미 있고 dependency-cruiser가 쓴다, `eng.dependency-rules.guide` 3.1절)의 `parseSync`. TS 7에는 안정 programmatic API가 없다. `@swc/core`를 group-kit이 import하려면 DR-07 `MODULE_OWNERS` 표에 항목이 필요하다 [미결](§10).

### 3.12 PromotionReport와 GroupMetrics (2차)

```ts
// xeon/packages/group-kit/src/metrics/types.ts  (공개 진입점: @xeon/group-kit)
import type { GroupId } from "@xeon/contracts/extensions";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { GroupMetricsSummary } from "@xeon/contracts/services";

export interface GroupMetrics extends GroupMetricsSummary {
  readonly groupId: GroupId;
  /** M2는 프로세스 안 메모리 집계라 모든 thread의 합을 뜻하는 null이다. M3(G-17)부터 thread별 값이다 */
  readonly threadId: ThreadId | null;
  /** first 지점에서 이 그룹 핸들러가 결정(거부)을 돌려준 횟수 */
  readonly denies: number;
  /** chain 지점에서 이 그룹 핸들러가 돌려준 패치 수 */
  readonly chainPatches: number;
  readonly handlerErrors: number;
  /** duplicate 제외 */
  readonly posts: number;
  /** drive 안 loop.spawn */
  readonly spawns: number;
  /** accepted delegate */
  readonly delegates: number;
  readonly commits: number;
  readonly records: number;
  /** 그룹의 loop.turn과 위임·spawn 자식 thread의 사용량 합 */
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly costUsd: number;
  /** lease.acquired ~ lease.released의 recordedAt 차이 합 */
  readonly leaseMs: number;
  readonly leases: number;
}

// M2에서 채우는 필드: posts(duplicate 제외), spawns(drive 안 loop.spawn), delegates, commits, records.
// denies·chainPatches·handlerErrors는 on 래퍼가 필요해 M3까지, tokens·costUsd·leaseMs·leases는 lease.*·turn.completed 이벤트가 필요해 M3까지 0이다.
/** GroupMetricsSummary는 F services/groups.ts(§3.8)의 정의를 다시 내보낸다. GroupMetrics는 그 필드를 모두 가진다 */
export type { GroupMetricsSummary } from "@xeon/contracts/services";

export interface GroupMetricsHandle {
  /** 이 thread의 누적값. 순수 조회 */
  snapshot(): GroupMetrics;
}

/** grp.<그룹>.metrics.recorded payload(recordPrivate). 단계 경계마다 0이 아닌 증가분만 */
export interface MetricsRecordedPayload {
  readonly stepId: string;
  readonly delta: Omit<GroupMetrics, "groupId" | "threadId">;
}
```

```ts
// xeon/packages/group-kit/src/promotion/report.ts
import type { ToolName } from "@xeon/contracts/capabilities";
import type { GroupId, ScopeId } from "@xeon/contracts/extensions";

export interface ToolConsumer {
  /** 호출이 일어난 turn을 시작한 쪽. 임대 holder scope, 또는 위임·spawn 자식을 만든 scope */
  readonly scopeId: ScopeId;
  readonly calls: number;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface PromotionCandidate {
  readonly tool: ToolName;
  readonly owner: GroupId;
  /** 소유 그룹을 뺀 소비자 */
  readonly consumers: readonly ToolConsumer[];
  /** 그룹이 시작하지 않은 turn(사용자 입력 turn)에서의 호출 수. 소비자로 세지 않는다 */
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
  /** 도구 이름 → 등록한 그룹 [가정: X 리소스 등록부] */
  readonly toolOwners: ReadonlyMap<ToolName, GroupId>;
  /** tool.execution.after 이벤트와 그 호출이 속한 turn의 시작 주체 */
  readonly calls: readonly { readonly tool: ToolName; readonly seq: number; readonly threadId: string; readonly origin: ScopeId | "user" }[];
}

/** 순수 함수 */
export function buildPromotionReport(input: PromotionInput): PromotionReport;
```

소비자 집계 [제안]:

- 소비자는 그룹 전용 도구를 호출한 turn을 시작한 scope다. 임대 안 `loop.turn`이 시작한 turn은 holder scope, 위임·spawn 자식 thread의 turn은 그 자식을 만든 scope다. 사용자 입력 turn은 `"user"`로 따로 센다.
- 소유 그룹 밖의 scope가 하나라도 있으면 승격 후보다(L3-a "두 번째 소비자를 얻으면 L2로 승격").

승격 절차 [제안]:

1. `PromotionReport`의 후보를 `/group status`의 부가 줄과 2차 설정 화면에 보인다. 자동으로 옮기지 않는다.
2. 사람이 승격을 결정하면 해당 L2 도메인 spec에 능력 정의를 더하고 F `capabilities/defs/<domain>.ts`에 정의를 둔다(F.capabilities.spec §3.9).
3. 구현을 `cap-<domain>`으로 옮긴다. 원래 그룹은 `g.capability(key)`로 바꾸고 매니페스트 `requires`에 능력을 더한다.
4. 모델 도구 이름은 바꾸지 않는다. 이름이 L2 규칙과 충돌하면 한 부 버전 동안 옛 이름을 별칭으로 둔다.

### 3.13 요구하는 X 인터페이스

group-kit이 쓰는 X.primitives.spec의 이름과, 아직 X에 없어 요청하는 것을 나눈다.

X.primitives.spec에 있는 것:

| 용도 | X 이름 | X 절 |
|---|---|---|
| 확장 호스트 서비스 | `ExtHost`(서비스 `xeon.ext`, `ExtHostPortKey`) | §3.1, §3.6 |
| scope 목록과 상태 | `ExtHost.scopes(): readonly ScopeInfo[]`(`id`, `extension`, `status`, `generation`, `waiting`, `drive: "none" \| "registered" \| "holding" \| "error"`, `lastError`) | §3.9 |
| 토글 | `ExtHost.scope(id): ScopeHandle \| undefined`의 `enable()`, `disable()` | §3.1, §4.5.2 |
| 임대 정책 포트 | `LeaseArbiterPort.choose(threadId, candidates: readonly LeaseCandidate[]): ScopeId \| null`, `LeaseArbiterPortKey`(`xeon.groups`). 타입 정본은 F.extensions.spec §3.2.1 `ports.ts` | §3.6, §4.4.1 |
| 포트 없을 때의 선택 설정 | `x.primitives.activeDriveGroup` | §4.4.1 4번, §6 |
| 리소스 등록 | `hostOf(g).registerTool`, `hostOf(g).registerCommand`, `hostOf(g).registerProvider`, `ExtHost.resources` | §3.8, §3.9, §4.8 |
| 상태 커밋과 크기 상한 | `commit`의 `expectStateRev`, `state_too_large` | §4.6.1 |
| 유휴 토글 적용 | 유휴면 다음 매크로태스크에 적용 | §4.5.5 |

X에 요청한 것 [반영됨: X.1(요청 1~3)과 테스트 호스트 재시작(요청 4 일부)이 xeon/foundation에 병합됐고, 요청 6·7은 M3a X-3이 닫았다]:

1. `LeaseCandidate.enabledAtSeq: number | null`(마지막 `scope.changed{status:"enabled"}`의 seq). [반영] F `LeaseCandidate`에 있다.
2. 현재 임대의 `leaseId` 조회. [반영] `ExtHost.leaseOf(threadId)`가 `LeaseInfo{leaseId, scopeId, leaseEpoch, status}`를 돌려준다. `GroupStatus.leaseId`에 쓴다.
3. scope 상태·임대 상태 변경 구독. [반영] `ExtHost.onChange(listener)`가 `ExtChange{kind: "scope" | "lease", scopeId, threadId}`를 경계 커밋 뒤 알린다. `GroupService.onChange`에 쓴다.
4. 테스트 호스트 재시작. [반영] `TestHost.restart()`.
5. 2차: 계측·승격 집계용 내구 이벤트 조회(kind 접두 필터)와 도구 소유 scope 조회(`ExtHost.resources`의 `ResourceRecord.scopeId`로 대신할 수 있다). [미결]
6. [반영, M3a X-3] 재실행 문맥 조회: `hostOf(g).callContext(): { kind: "on" | "drive"; threadId: ThreadId; signal: AbortSignal; point?: PointName } | undefined`(X.primitives.spec §3.8). setup, 명령 처리기, 도구 `execute`, drive의 `turn`·`spawn` 안에서는 undefined다. `GroupHostAccess.callContext()`가 이 값을 그대로 돌려준다. `delegate`는 on 핸들러와 drive 함수 안에서 문맥의 thread와 신호를 쓰고, `{ threadId, signal }` 옵션은 명령 처리기와 도구 `execute`에서만 필요하다. `delegateStatus`의 on 거부와 `cancelDelegates`의 on·drive 거부(`group.effectNotAllowed`)는 실제 호스트에서 동작한다(`delegate-real-host.int.test.ts`).
7. [반영, M3a X-3] `SessionFeedPortKey`(`{ name: "xeon.session", member: "feed" }`)를 `@xeon/ext-host` 공개 진입점에서 내보낸다. group-kit은 이 키를 쓰고 자체 키(`GroupFeedPortKey`)는 없앴다(§3.8 "거부 표시").

- 설정 읽기와 쓰기는 설정 서비스(F.wire-settings.spec `EffectiveSetting`, `WriteCheck`)로 한다. X에는 이 용도의 API가 없다 [가정: 서비스 이름은 F.wire-settings.spec].
- 임대 교체 [가정]: X는 반납 경계에서 `lease.released`를 기록하고(X.primitives.spec §4.5.3 끄기 2번), 다음 판단(§4.4.1 3번)에서 새 `lease.acquired`를 기록한다. 같은 경계 훅에서 반납과 부여가 함께 일어나면 같은 경계 커밋에 실린다고 본다. X 문서가 다르게 정하면 §5 6번을 고친다.

## 4. 동작 규칙

### 4.1 결정에서 옮긴 규칙

| 규칙 | 표지와 근거 |
|---|---|
| drive 임대는 한 번에 그룹 하나만 가진다. `on`, `post`, 백그라운드 위임은 공유한다 | [결정] `_research/layer-plan-v2-notes.md` 층 사이 규칙 4, F.extensions.spec §4.6 |
| 그룹끼리 직접 참조하지 않는다. 통신은 이벤트와 레코드만 쓴다 | [결정] 층 사이 규칙 3, F.extensions.spec §4.8, `eng.context-map.design` CM-06 |
| 켜기·끄기는 단계 경계에 적용하고 정리는 Cordis dispose로 실행한다 | [결정] 층 사이 규칙 5, F.extensions.spec §4.5. 적용 시점을 단계 경계로 읽는 해석은 [결정: review.decisions-2 U-01] |
| Helm과 학습 그룹은 L3 기본 그룹이고 학습 그룹은 drive를 쓰지 않는다 | [결정] `_research/decisions-log.md` 2026-10-21 계획 v2, `eng.context-map.design` 3절 규칙 4 |
| drive 함수는 마지막 커밋 상태로 다시 호출되고 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다 | [결정] F.extensions.spec §4.6 |
| 예산은 drive 임대 상한에만 건다. drive 임대 상한 기본값은 pi 방식(기본 상한 없음)의 예외로 둔다 | [결정] F.extensions.spec §4.6, `_research/decisions-log.md` 계획 v2. 예외는 [결정: review.decisions-2 U-12] |

### 4.2 로드와 setup 순서

1. 조립 루트(`apps/host`)가 `group-kit`을 Cordis 플러그인으로 등록한다 [가정: X 플러그인 정의 API]. `group-kit`은 확장 매니페스트를 갖지 않는 내장 서비스 플러그인이다 [제안]. `layer: "L3"`인 매니페스트는 `kind: "group"`이어야 하기 때문이다(F `layer_kind_mismatch`).
2. `group-kit` 플러그인은 `xeon.ext`를 주입받고 `xeon.groups`(`GroupService`)를 제공한다. 이 서비스의 `choose`가 X `LeaseArbiterPort` 구현이다(`leaseArbiterPort(defaultDriveArbiter, …)`, §3.5). X는 포트 이름 `xeon.groups`로 주입받는다(X.primitives.spec §3.6).
3. X 로더가 그룹 모듈마다 `validateManifest`, `validateManifestSet`을 부르고, 설정 묶음을 카탈로그에 넣고, `entry`를 부른다. setup 직후 X가 `validateUsage`를 부른다.
4. 그룹 setup 안의 `g.drive(fn)`은 등록만 한다. 임대는 §4.3이 정한다.

### 4.3 임대 중재 순서

X는 임대가 없을 때 경계 훅(`step_end`, `turn_settled`, `idle`)과 `openThread`에서 `LeaseArbiterPort.choose`를 부른다(X.primitives.spec §4.4.1 3번, 5번). group-kit 쪽 규칙:

1. 후보는 X가 넘긴 `LeaseCandidate` 목록이다. 켜져 있고 drive를 등록했고 오류 상태가 아닌 scope다. group-kit은 `loadIndex`를 `loadOrder`로, §3.13 요청 1의 `enabledAtSeq`를 `requestSeq`로 옮긴다.
2. `holderSetting`이 scope id이면 그 그룹이 후보일 때만 holder다. 후보가 아니면 null(`named-unavailable`)이다.
3. `null`(auto)이면 `requestSeq` 오름차순, 같으면 `loadOrder` 오름차순으로 첫 후보가 받는다.
4. 이미 임대가 있으면 X가 `choose`를 부르지 않는다. 그래서 그룹을 새로 켜도 현재 holder는 그 임대가 반납될 때까지 유지된다. 반납 사유는 `idle`, 상한(`releasing`), `disabled`, `error`, `revoked`다(X.primitives.spec §4.4.2, §4.4.3, §4.5.3). `revoked`는 `x.primitives.activeDriveGroup`이 다른 후보 그룹을 가리킬 때 X가 다음 경계에서 쓰는 사유다(§3.5 규칙 4). 진행 중인 step과 `loop.turn`은 끊지 않는다(F.extensions.spec §4.5).
5. 대기 그룹의 drive 함수는 호출되지 않는다. 대기 그룹의 `on` 핸들러, `post`, `delegate`, `commit`, `record`는 계속 동작한다. `GroupStatus.drive`는 `ExtHost.scopes()`의 `drive`가 `"registered"`이고 다른 scope가 `"holding"`이면 `"waiting"`이다.
6. 같은 입력이면 같은 결정이다. `decide`는 시각, 난수, I/O를 쓰지 않는다. 그래서 재개 뒤 같은 이벤트열에서 같은 holder가 나온다.

### 4.4 켜기·끄기와 대기 표시

- `GroupService.enable/disable`은 `ScopeHandle.enable/disable`을 부른다. 요청만 기록하고 X가 단계 경계에서 적용한다(F.extensions.spec §4.5). 적용되면 `scope.changed`가 커밋된다.
- 요청과 적용 사이에 `GroupStatus.pendingToggle`이 채워지고 상태줄에 "다음 단계 경계에 적용"이 붙는다(§3.9).
- 비활성화 적용 순서는 F.extensions.spec §4.5 [제안](on 핸들러 제외 → drive 임대 반납 → `onDispose`)을 따른다. group-kit `wrap`은 `onDispose` 목록 끝에 계측 마감(2차)을 더한다.
- 실행 중인 turn이 없을 때의 적용 시점은 X.primitives.spec이 정한다 [가정]. 그 시점이 "즉시"면 `ToggleReceipt.appliesAt`은 `"now"`다.

### 4.5 상태 커밋 규칙

1. `g.commit(next)`는 상태 문서 전체를 교체한다. 부분 패치는 없다(F `ScopeApi.commit`).
2. 커밋 전 `checkStateCommit`이 `StateDecl.schema` 검사와 크기 검사(직렬화 UTF-8 64 KiB 이하)를 한다. 실패하면 `commit`은 거부되고 상태는 그대로다. 오류는 `GroupError{kind:"group.stateInvalid"}`로 남는다.
3. 직전 커밋 값과 깊이 같으면 이벤트를 쓰지 않고 현재 값을 돌려준다.
4. 빈도 [제안]: drive 함수는 `loop.turn`·`loop.spawn` 결과 하나에 커밋 한 번을 권장한다. `on` 핸들러는 한 디스패치에서 같은 scope에 커밋 한 번까지다. 넘으면 계측에 경고를 남긴다(2차). 토큰 단위 진행이나 카운터 틱은 상태 문서에 커밋하지 않는다(`eng.events.design` EV-02 취지).
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
- 입력 id가 여럿 쌓이는 경우(여러 도구 결과)는 최근 id 몇 개만 둔다. 상한은 2번의 64 KiB 안에서 그룹이 정한다.

### 4.6 분기·재개 때 복원

- 기준은 thread의 leaf다(F.records.spec §4.6).
- [결정: review.decisions-2 §3 T-20] 그룹 상태 = leaf의 조상 경로(활성 가지)에서 가장 가까운 `grp.<그룹>.state.committed` 이벤트의 `doc`(업캐스트 뒤). 없으면 `StateDecl.initial`이다. 활성 가지 규칙은 X.primitives.spec §4.6.1이 정한다.
- 투영 `x_<그룹>_state`의 `prev_event_id` 연결로 조상 경로의 상태를 찾는다. 투영은 X가 소유하고 재생으로 다시 만들 수 있다(X.primitives.spec §4.6.1).
- 임대 복원: 마지막 `checkpoint.step`의 `leaseRefs`(F.records.spec §3.6)가 가리키는 `lease.acquired`가 있으면 X가 그 그룹의 drive 함수를 복원한 상태로 다시 부른다. 분기로 leaf가 임대 전 지점으로 가면 `leaseRefs`가 비고, `decide`가 처음부터 다시 정한다.
- 분기 뒤의 drive 재호출은 재개와 같은 규율을 따른다. `loop.turn`의 기본 `requestId`(`${leaseId}:${순번}`)는 가지가 다르면 `leaseId`가 달라 충돌하지 않는다 [가정: X.primitives.spec].

### 4.7 상태 스키마 버전과 마이그레이션 훅

- `StateDecl.version`을 올리면 `GroupDef.migrations`에 빠짐없는 출발 버전 함수를 둔다. 빠지면 `state_migration_missing`(§3.3)으로 정의가 거부된다. F.extensions.spec §3.2 `StateDecl.version` 주석("올리면 X가 마이그레이션 훅을 요구한다")의 group-kit 쪽 구현이다.
- `defineGroup`은 `migrations`를 F `Upcaster` 배열로 바꿔 `GroupModule.stateUpcasters`에 둔다. 저장된 이벤트는 고치지 않고 읽을 때 올린다(F.records.spec §3.7 규칙 2, 3).
- 마이그레이션 함수는 순수 함수다. 결과가 새 `schema`를 통과하지 못하면 `group.migrationFailed`로 그 그룹 로드를 실패로 처리한다. 다른 그룹은 영향을 받지 않는다.
- 버전을 내리는 것은 허용하지 않는다. 저장된 버전이 현재보다 크면 F `future_version` 오류로 로드 실패다.

### 4.8 그룹 간 통신 규칙

- 레코드 kind는 F 형식 `grp.<그룹>.<영역>.<이름>`이다. 공통 확정 kind(L3.helm.spec, L3.learning.spec가 소유):
  - helm 작성: `grp.helm.signal.detected`, `grp.helm.discovery.recorded`, `grp.helm.inquiry.finished`
  - learning 작성: `grp.learning.skill.proposed`, `grp.learning.skill.approved`, `grp.learning.skill.rejected`, `grp.learning.skill.applied`, `grp.learning.memory.proposed`, `grp.learning.feedback.proposed`, `grp.learning.review.finished`, (2차) `grp.learning.script.proposed`
  - 읽기: helm과 learning은 서로의 레코드를 읽지 않는다 [결정: review.decisions-2 D-10]. 두 그룹의 레코드는 L4 표시와 이력용이다
- 그룹은 레코드를 읽고 해석에 실패해도 예외를 밖으로 던지지 않는다. 버전이 더 크면 F `record_version_unknown` 경고와 원형 payload를 받는다(F.extensions.spec §5 9번).
- 한 그룹이 꺼져도 다른 그룹은 동작한다. 레코드가 오지 않을 뿐이다.

### 4.9 계측 기록 (2차)

- `wrap`이 감싼 연산에서 메모리 카운터를 올린다. `on` 래퍼는 first 지점 반환이 `undefined`가 아니면 `denies`, chain 지점 반환이 `undefined`가 아니면 `chainPatches`, 예외면 `handlerErrors`를 올린다.
- `l3.group-kit.instrumentation`이 참이면 단계 경계마다 증가분이 0이 아닌 그룹에 대해 `grp.<그룹>.metrics.recorded` 비공개 기록을 그 그룹의 `recordPrivate`로 쓴다 [결정: review.decisions-2 T-21]. 커밋 단위는 X.primitives.spec §4.6.5를 따른다. 핸들러 안의 호출은 따로 커밋하고, 단계 커밋에 함께 실으려면 boundary chain 결과의 `entries`를 쓴다. 멱등 키는 `record`와 같아 재실행된 같은 호출은 `replayed`다. kind는 매니페스트 `recordKinds`에 선언하지 않는다(공개 kind와 같은 이름이면 `record_private_invalid`).
- 토큰·비용은 그룹이 시작한 turn의 `turn.completed` 사용량과 자식 thread 사용량에서 계산한다. 임대 시간은 `lease.*` 이벤트의 `recordedAt` 차이로 잰다. 계측 코드는 시계를 직접 읽지 않는다(TY-21).
- kind 소유 [결정: review.decisions-2 T-21]: `grp.<그룹>.metrics.recorded`의 접두 소유자는 각 그룹이고 생산 코드는 group-kit `wrap`이다. `grp.<그룹>.state.committed`는 X가 쓴다(X.primitives.spec §4.6.1).

### 4.10 위임 규칙

- `delegate`는 켜진 그룹이면 임대와 관계없이 부를 수 있다. 꺼지는 중(`disabling`)이면 `group.disabling`을 돌려준다.
- 그룹이 꺼지면 진행 중인 위임을 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04]. 끈 뒤에도 토큰을 쓰고 결과가 들어오면 사용자 기대와 어긋나기 때문이다. 그룹은 `onDispose`에서 `cancelDelegates`를 부르고, group-kit은 L1 `AgentService.cancel({ ownerScopeId })`(L3.learning.spec §8.1 REQ-LN-06)로 옮긴다. 옛 [제안](완료까지 두고 보고 post를 넣음)은 쓰지 않는다.

## 5. 실패와 경계 사례

| # | 사례 | 처리 |
|---|---|---|
| 1 | 이름 충돌: 같은 `name`의 그룹이 둘 설치됨 | X `validateManifestSet`이 `name_conflict` 오류를 낸다. 뒤에 로드한 쪽을 거부한다 [가정: X.loading-trust.spec]. 이름이 `RESERVED_GROUP_NAMES`(예: `auto`)면 `defineGroup`이 `group_name`으로 거부한다 |
| 2 | 존재하지 않는 holder 지정 | 명령·서비스 경로는 `group.unknown`으로 거부하고 설정을 바꾸지 않는다. 설정 파일에 이미 없는 이름이 있으면 `named-unavailable`로 아무도 임대를 받지 않고, 상태줄은 drive 그룹을 `[대기]`로 보이며 `/group status` 첫 줄에 `구동 그룹 설정: review(설치되지 않음)`을 낸다 |
| 3 | drive 함수 예외 | X가 임대를 반납한다(`lease.released{reason:"error"}`, F.extensions.spec §5 6번). `GroupStatus.drive = "error"`, `lastError = group.driveThrew`. `on` 핸들러와 `post`, `delegate`는 계속 동작한다. 오류 표시는 그룹을 끄고 다시 켜면 지워진다(X.primitives.spec §4.4.3 예외 규칙). 그동안 X는 그 그룹을 후보(`LeaseCandidate`)에 넣지 않는다 |
| 4 | 대기 중인 그룹이 비활성화됨 | 단계 경계에서 `waiting`에서 빠진다. 임대 이벤트는 없다. `scope.changed{disabled}`만 커밋된다 |
| 5 | holder가 비활성화됨 | 끄기가 적용되는 단계 경계에서 `lease.released{reason:"disabled"}`가 기록되고 진행 중 `loop.turn`은 정착까지 돈다(X.primitives.spec §4.5.3). 그 뒤 판단 시점에 `choose`가 다음 후보를 고르고 `lease.acquired`가 기록된다 [가정: 같은 경계 커밋 여부는 §3.13] |
| 6 | 임대 교체 중 프로세스 종료 | 반납 커밋 전 종료면 이전 holder가 그대로이고 재개 뒤 X가 열린 임대(`openLease`)로 drive를 다시 부른다. 반납 커밋 뒤 부여 전 종료면 재개 뒤 `openThread`에서 `choose`가 다시 정한다. 부여 커밋 뒤 종료면 새 holder의 drive 함수가 마지막 커밋 상태로 다시 불린다 |
| 7 | 홀더 설정 변경이 진행 중 turn이나 다른 그룹의 임대와 겹침 | 설정은 즉시 저장된다. 임대가 없으면 다음 판단 시점(단계 경계)에 `decide`의 입력이 된다. 다른 그룹이 임대를 가지고 있고 지정한 그룹이 후보이면 X가 다음 경계에서 그 임대를 `revoked`로 반납하고 지정한 그룹에 부여한다. 지정한 그룹이 후보가 아니면 현재 임대를 유지하고, 지정한 그룹이 후보가 되는 경계나 임대가 반납되는 경계에 적용된다(§3.5 규칙 4). 진행 중 `loop.turn`은 끝까지 돈다. 그 사이 `GroupStatus`와 상태줄은 적용 대기 문구를 보인다 |
| 8 | 같은 단계에서 켜기와 끄기 요청이 겹침 | 마지막 요청만 적용한다(X `ScopeHandle` 규칙 [가정]). 상태줄은 마지막 요청을 보인다 |
| 9 | 상태 커밋이 스키마나 크기 한도 위반 | `commit` 거부, 상태 유지, `group.stateInvalid`. drive 함수 안이면 예외로 이어져 3번 처리 |
| 10 | 상태 마이그레이션 실패 | 그 그룹만 로드 실패(`group.migrationFailed`). 다른 그룹과 대화는 계속 |
| 11 | 매니페스트에 없는 레코드 kind 쓰기 | F `validateUsage` `record_kind_undeclared`. 이벤트를 쓰지 않는다 |
| 12 | `delegate`의 `requestId`가 48자 초과이거나 `report.customType`이 자기 접두가 아님 | 호출 전 `{ ok: false, error: { kind: "group.delegateInvalid" } }`. 위임은 만들지 않는다 |
| 13 | `x.primitives.activeDriveGroup`이 drive를 쓰지 않는 그룹으로 설정 파일에 적힘 | `named-unavailable`과 같게 처리하고 설정 경고를 남긴다 |
| 14 | drive 그룹이 하나도 없음 | `decide`는 `no-candidate`. 상태줄에는 `[구동]` 항목이 없다 |

## 6. 설정 노출

`defineSettings("l3.group-kit", …)`로 선언한다(F.wire-settings.spec §3.8.3). 탭은 모두 `plugins`("플러그인과 그룹", `_research/layer-plan-v2-notes.md` L4 설정 화면 구성안)다.

| 키 | 타입 | 기본값 | 범위(`allowedScopes`) | 세션 중 변경 | `runtimeChange` | 위젯 | 뜻 |
|---|---|---|---|---|---|---|---|
| `l3.group-kit.instrumentation` | boolean | `true` | managed, user, project, local, session | 가능 | `live` | `toggle` | 그룹 계측 기록(§4.9, 2차) |
| `l3.group-kit.statusLine` | boolean | `true` | user, project, local, session | 가능 | `live` | `toggle` | 상태줄 그룹 표시(§3.9) |

- 구동 그룹 선택 [결정: review.decisions-2 S-15]: group-kit은 구동 그룹 키를 두지 않는다. 선택은 X 키 `x.primitives.activeDriveGroup`(`ScopeId | null`, 기본 `null`, 범위 user·project·session, `nextTurn`, 위젯 `select`)이고 정의는 X.primitives.spec §6이 소유한다. group-kit은 이 값을 정책 입력으로 읽고(§3.5), `null`을 "auto"로 표시한다. 다른 그룹이 임대를 가지고 있으면 바뀐 값은 그 임대가 반납된 뒤 적용된다(§4.3 4번).
- 그룹 켜기 키: 내장 그룹과 외부 그룹 모두 X 로더 예약 키 `ext.<이름>.enabled`다(예: `ext.helm.enabled`, `ext.learning.enabled`. F.extensions.spec §6, X.loading-trust.spec §4.5, F.wire-settings.spec §3.8.3 규칙 1). X 로더만 이 키를 읽고, 그룹과 group-kit은 이 키를 선언하지 않는다. 기본값은 매니페스트 `defaultEnabled`다. 값 속성은 X.loading-trust.spec §6 정의를 따른다: `runtimeChange` `live`(요청을 기록하고 적용은 다음 단계 경계), `allowedScopes` managed~session [결정: review.decisions-2 K-04].
- drive 임대 상한의 일반 기본값은 X 키 `x.primitives.driveDefaultLimits`, 천장은 `x.primitives.driveLimits`다(F.extensions.spec §6). 그룹별 요청 상한은 각 그룹 키(예: `l3.helm.driveLimits`)가 기본값을 덮어쓰고, 천장보다 클 수 없다(review.decisions-2 U-12).
- 명령: `/group status|on <이름>|off <이름>|drive <이름|auto>`(§3.9). 설정 파일과 `xeon config` 명령은 F.wire-settings.spec §4.9 생성 규칙을 따른다.

## 7. 확장 지점

- group-kit 자체는 지점을 선언하지 않고 `on` 핸들러도 걸지 않는다. 지점 선언은 F.extensions.spec §3.4다.
- `GroupApi.on`은 F `ScopeApi.on`을 감싼다. 핸들러 시그니처와 fold는 그대로다. 래퍼는 계측 집계만 더한다(§4.9).
- `post`, `commit`, `record`, `readRecords`, `capability`, `onDispose`는 그대로 전달한다. `registerTool`, `registerCommand`, `registerProvider`는 X `hostOf(g)`로 전달한다(§3.2).
- `drive` 등록은 그대로 전달하고, 임대 결정은 `DriveArbiter`가 X `LeaseArbiterPort`를 통해 정한다(§3.5).
- `delegate`는 L1-g 서비스 래퍼다. 확장 지점 목록에 들어가지 않는다. 위임 자식 thread의 지점 발화와 그룹 핸들러 적용 범위는 [미결]이다(`_research/notes/L3-1.md` §6 마지막 항목).

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `defineGroup`, `GroupDef`, `GroupApi`(`registerTool`, `registerCommand`, `registerProvider` 포함), `GroupModule`, `validateGroupDef`, `groupManifest`, `GROUP_NAME_PATTERN`, `RESERVED_GROUP_NAMES`(예약 이름 정본) | L3.helm.spec, L3.learning.spec, L3.slots.spec 템플릿, L3.readme §4 |
| `DelegateSpec`, `DelegateReceipt`, `DelegateResult`, `DelegateError`, `DelegateReport`, `DelegateToolPolicy`, `DelegateLimits`, `DelegateFork` | L3.learning.spec, L3.helm.spec, L1.agents.spec(`DelegateRequest` 대응) |
| `DriveArbiter`, `defaultDriveArbiter`, `leaseArbiterPort`, `ArbiterInput`, `ArbiterDecision` | X.primitives.spec(`LeaseArbiterPort` 구현), L4.settings-ui.spec |
| `GroupService`와 부속 타입(§3.8)의 필드 정의. 정의 위치는 F `services/groups.ts`(F.capabilities.spec §3.12)이고 group-kit은 다시 내보내며 `service.ts`에서 구현한다 | F.capabilities.spec §3.12, L4.cli.spec, L4.desktop.spec, L4.host-service.spec, L3.helm.spec, L3.learning.spec |
| `parseGroupCommand`, `runGroupCommand`, `groupCommand`, `formatGroupStatusLine` | L4.cli.spec, L4.desktop.spec |
| `checkGroup`, `replayDrive`, `scanDriveSource`(M3 이후), `smokeGroup` | L3.helm.plan, L3.learning.plan, X.primitives.plan(M1 스모크) |
| 정책 정식 예 `reviewgate`, `commitguard`, `guardrail`(`testing` 진입점), 템플릿 `templates/`(2차) | L3.slots.spec, L3.slots.plan |
| `GroupMetrics`, `GroupMetricsSummary`, `PromotionReport`, `buildPromotionReport` | L4.settings-ui.spec(2차), L3 그룹 문서 |
| 설정 키 `l3.group-kit.instrumentation`, `l3.group-kit.statusLine` | L4.settings-ui.spec |

요구:

| 이름 | 출처 |
|---|---|
| `ExtensionManifest`, `ScopeApi`, `StateDecl`, `DriveFn`, `DriveLease`, `LeaseId`, `ScopeId`, `ScopeStatus`, `ScopeHandle`, `ExtensionEntry`, `GroupRecord`, `RecordKind`, `GroupId`, `validateManifest`, `validateUsage`, `validateManifestSet` | F.extensions.spec |
| `Upcaster`, `DurableEventEnvelope`, `scope.changed`, `lease.acquired`, `lease.released`, `checkpoint.step`의 `leaseRefs`, 분기 규칙 | F.records.spec |
| `ServiceKey`, `ToolName`. `@xeon/contracts/services`의 `GroupService`, `GroupServiceName`, `DriveRole`, `GroupError`, `GroupStatus`, `GroupCommandError`, `GroupResult`, `ToggleReceipt`, `HolderReceipt`, `DriveHolderSetting`, `GroupMetricsSummary`(§3.12 `services/groups.ts`) | F.capabilities.spec |
| `SettingDefInput`, `SettingGroup`, `defineSettings`, `SettingScope`, `EffectiveSetting`, `WriteCheck` | F.wire-settings.spec |
| `ThreadId`, `ItemId`, `EventId`, `JsonValue`, 단계 경계 용어 | F.conversation.spec |
| 임대 메커니즘(§4.4), `LeaseArbiterPort`·`LeaseCandidate` 호출 규칙(§3.6. 타입 정본은 F.extensions.spec §3.2.1), `ExtHost`(`xeon.ext`)의 `scopes()`·`scope()`(§3.1, §3.9), `hostOf(g).registerTool`·`registerCommand`·`registerProvider`와 `ToolResourceDef`·`CommandResourceDef`·`ProviderResourceDef`(§3.8, §4.8), 유휴 토글 적용(§4.5.5). 요청 사항 4개(§3.13)와 테스트 호스트(`@xeon/ext-host/testing`)는 [가정] | X.primitives.spec |
| `AgentService.delegate`, `DelegateRequest`, `ChildToolPolicy`, `ChildLimits`, `ForkPoint`, `DelegateReceipt`(§3.2, §3.3). 서비스 키 경로는 [가정] | L1.agents.spec |
| 모델 테이프(`@xeon/core-models/testing`) [가정] | L1.models.spec |
| 명령 등록부, 상태줄 표시 위치 [가정] | L4.cli.spec, L4.desktop.spec |
| DR-02 허용 목록, DR-11, DR-14 | eng.dependency-rules.guide |
| 서비스 이름, 테이블·type 접두 소유 | eng.context-map.design |
| EV-08, EV-09, type 이름 규칙 | eng.events.design |

## 9. 수용 기준

1. `x.primitives.activeDriveGroup`이 `null`(auto)일 때 drive 그룹 A(요청 순번 10)와 B(요청 순번 12)가 켜지면 A의 drive 함수만 호출되고 B의 drive 함수 호출 수는 0이다. B의 `GroupStatus.drive`는 `"waiting"`이다.
2. 1번 상태에서 B의 `tool.call.before` 핸들러와 `post`는 계속 호출·수락되고, B가 `delegate`를 부르면 `accepted` 영수증을 받는다.
3. `x.primitives.activeDriveGroup`이 `null`(auto)이고 holder A가 있을 때 C를 새로 켜도 단계 경계 뒤 holder는 A다(선점 없음).
4. A가 임대를 가진 동안 `x.primitives.activeDriveGroup`을 B로 바꾸면 A의 진행 중 `loop.turn`은 `completed`로 끝나고, 다음 경계에 `lease.released{reason:"revoked"}`(A)와 `lease.acquired`(B)가 차례로 기록된다. 중단된 step은 0개다. B가 후보가 아니면(예: 꺼짐) A의 임대는 유지된다. A를 끄면 끄기가 적용된 경계에 `lease.released{reason:"disabled"}`(A)가 기록되고, 그 뒤 판단 시점에 `choose`가 B를 고른다.
5. `x.primitives.activeDriveGroup`이 켜지지 않은 그룹 이름이면 `decide`는 `holder: null`, `reason: "named-unavailable"`을 돌려주고 drive 함수는 하나도 호출되지 않는다.
6. `setDriveHolder("learning")`(drive 미사용)은 `group.noDrive`를 돌려주고 설정 값은 바뀌지 않는다. `/group drive xyz`는 `알 수 없는 그룹: xyz. 설치된 그룹: …`을 출력한다.
7. 실행 중 `/group off helm`은 `pending: true`를 돌려주고, 다음 단계 경계 전까지 상태줄 끝에 `다음 단계 경계에 적용`이 있으며, 경계 뒤 `scope.changed{status:"disabled"}`가 정확히 한 번 커밋된다.
8. `group-kit` 소스에서 `@xeon/group-helm`, `@xeon/group-learning` import가 0이다(check-layers). `group-helm`에 `@xeon/group-learning` import 샘플을 넣으면 check-layers가 DR-02로 실패한다.
9. M1 테스트 그룹(`smokeGroup`)이 한 턴에서 `on`(`tool.call.before`, `boundary.step.after`), `post`, `drive`를 모두 쓰고, `checkGroup(smokeGroup)`의 오류가 0이다.
10. setup에서 매니페스트 `points`에 없는 지점에 `on`을 건 그룹은 `checkGroup`이 `point_undeclared`를 돌려준다. `name: "auto"`, `name: "web"`(L2 도메인 이름)인 정의는 `defineGroup`이 `group_name`으로 `Bug`를 던진다. `state` 없이 `on`만 쓰는 정의는 오류 없이 `GroupModule`(`stateVersion: 0`)을 만든다.
10a. `registerTool`, `registerCommand`로 등록한 도구와 명령은 그룹을 끄면 해제된다(가짜 `ExtHost.resources` 등록 수로 확인).
10b. `groupManifest`는 `kind: "plugin"`인 매니페스트 값에 `Bug`를 던지고, 템플릿 `plugin.json`과 같은 값에는 `GroupManifest`를 돌려준다.
10c. `registerProvider`로 등록한 provider는 그룹을 끄면 해제된다(가짜 `ExtHost.resources`와 가짜 `xeon.models` 포트의 등록 수로 확인).
11. 상태를 v1, v2 순서로 커밋한 뒤 v1 커밋 직후 이벤트로 분기하면 `g.state()`는 v1 문서다. 같은 thread를 재개하면 drive 함수 인자도 v1 문서다.
12. `StateDecl.version: 2`이고 `migrations[1]`이 없으면 `validateGroupDef`가 `state_migration_missing`을 낸다. 있으면 v1으로 저장된 상태가 v2 스키마를 통과하는 값으로 읽힌다.
13. 64 KiB를 넘는 상태 커밋은 거부되고 `state.committed` 이벤트 수가 늘지 않는다. 직전과 같은 값의 커밋도 이벤트를 쓰지 않는다.
14. 같은 thread에서 같은 `requestId`로 `delegate`를 두 번 부르면 두 번째 영수증은 `duplicate`이고 자식 thread는 하나다.
15. `replayDrive`는 `eng.events.design` EV-09의 좋은 예 그룹에 `ok: true`, 나쁜 예(클로저 카운터) 그룹에 `ok: false`와 `firstDiff`를 돌려준다.
16. `scanDriveSource`는 drive 함수 안의 `Date.now()`에 `SD-01`을 내고, 같은 파일의 drive 밖 `Date.now()`에는 아무것도 내지 않는다.
17. 그룹 A가 등록한 도구를 그룹 B의 임대 turn이 호출하면 `buildPromotionReport`의 A 도구 항목이 `candidate: true`이고 소비자는 B다. 사용자 입력 turn의 호출은 `userCalls`에만 더해진다.
18. `l3.group-kit.instrumentation = false`면 `grp.<그룹>.metrics.recorded` 기록이 0개이고 `GroupStatus.metrics`는 null이다.
19. `formatGroupStatusLine`은 §3.9 예 표의 다섯 입력에 표의 문자열을 그대로 돌려준다.
20. `group-kit` 운영 소스에서 `LeaseArbiterPort`, `LeaseCandidate`, `GroupService`, `GroupStatus`, `DriveHolderSetting`, `GroupMetricsSummary`를 정의하는 선언이 0개이고, 이 이름은 `@xeon/contracts/extensions` 또는 `@xeon/contracts/services`에서 온다. `services/groups.ts`의 `HolderReceipt["scope"]`는 F.wire-settings `SettingScope`에 대입 가능하고 그 반대도 된다(타입 테스트).
21. 상태 갱신이 멱등 reducer(§4.5 6번)인 그룹에서 같은 `boundary.step.after` 핸들러를 소비 커밋 전에 두 번 실행하면 `grp.<그룹>.state.committed`는 한 번만 늘고 두 번째 `commit`은 이벤트를 쓰지 않는다.
22. (M3, ADR-0015) `replayDrive`는 효과 계수기를 가진 하니스에서 모든 절단 지점의 drive·on 핸들러 이중 실행 뒤에도 `EffectCounts`가 기준 실행과 같으면 `ok: true`다. 같은 `requestId` 없이 효과를 두 번 내는 그룹에는 `failure: "effects-doubled"`를 돌려준다.
23. (M3, ADR-0015) `delegateStatus`는 drive 문맥에서 상태를 돌려주고 on 문맥에서는 거부된다. `cancelDelegates`는 재실행되는 코드에서 거부되고 `onDispose`와 명령 처리기에서는 동작한다.
24. (M3) 임대 대기 상한을 넘어 거부된 그룹의 `GroupStatus.drive`는 `"rejected"`다.

## 10. 미결 사항

- [결정: review.decisions-2 T-21] 공통 모순 1(닫힘): 확장 kind는 F 형식 `grp.<그룹>.<영역>.<이름>` 하나다. 상태 이벤트는 `grp.<그룹>.state.committed`(X 소유), 계측은 `grp.<그룹>.metrics.recorded`(`recordPrivate`)다. eng 문서의 옛 밑줄 접두 표기는 쓰지 않는다.
- (닫힘) [결정: adr.0015] 공통 모순 2: F.extensions.spec §4.3(on 핸들러 외부 효과 금지)과 학습 검토 포크 시작·Helm spawn의 관계. C안(2026-10-25)으로 `requestId` 멱등 `g.delegate`와 drive 안 `loop.spawn`, 선언된 능력 호출이 허용된다(§3.4, §3.10). F.extensions.spec 본문 반영은 ADR-0015 §4.3 표에 있다.
- [미결] 공통 모순 3: `xeon/packages/group-kit/package.json`의 `xeon.domain`이 `kit`이고 routes layout 도메인은 `group-kit`이다. DR-03은 "디렉터리 이름의 접두사를 뺀 값"과 layout 도메인 이름이 같다고 적었는데 `group-kit`에서 두 값이 다르다. [제안] `group-kit`으로 맞추고 DR-03에 `group-kit`을 접두 규칙 예외로 적는다(L3.group-kit.plan G-02).
- (닫힘) [결정: review.m3-design-inputs D-M3-05] 대기 vs 거부: 대기가 기본이고 대기 상한을 넘으면 거부한다(§3.5 규칙 3). `product.vision.spec` §5와 §10 미결 3의 답이다.
- (닫힘) 선점 허용: X가 이름 지정에 한해 다음 경계에서 `revoked`로 회수한다(X.primitives.spec §4.4.1 5번, [결정: P-22]). `auto`는 선점하지 않는다(§3.5 규칙 4, §4.3 4번). `auto` 우선순위 선점은 두지 않는다.
- (닫힘) [결정: review.decisions-2 D-04] `GroupService`와 부속 타입은 F `@xeon/contracts/services`의 `services/groups.ts`에 둔다(F.capabilities.spec §3.12, 이 문서 §3.8). `eng.context-map.design` §5.3의 F 위치 열은 그 문서 쪽에서 services로 고친다.
- [미결] 템플릿 위치: `eng.context-map.design` C-2. 이 문서와 L3.group-kit.plan §2는 L3.slots.plan §2.1 후보 a(`xeon/packages/group-kit/templates/`, 정식 예는 `src/testing/policies/`)를 [제안]으로 따른다. 스캐폴드 명령의 실행은 L4.cli.spec이 맡는다(L3.slots.spec §3.3.6).
- [결정: review.decisions-2 U-15] DR-02 방법 (b)(허용 목록 `DR-02/group-kit-*`). `eng.context-map.design` C-5와 같은 항목이다.
- (닫힘) 정책 포트 타입 `LeaseArbiterPort`·`LeaseCandidate`의 정본은 F.extensions.spec §3.2.1 `ports.ts`다. group-kit은 `@xeon/contracts/extensions`에서 가져온다. 역할 분담은 §3.5 표로 정했다.
- (닫힘) X에 요청한 4개 항목(§3.13)은 X.1과 테스트 호스트 재시작으로 반영됐다. 2차 계측·승격 집계용 조회(§3.13 5번)만 남았다.
- [미결] M2 구현이 남긴 연결: 설정 읽기 포트 `GroupSettingsSourceKey`(`xeon.settings`), `DriveHolderSettingsPort`, `GroupCatalogPort`는 조립 루트(HOST)가 설정 서비스와 로더 보고에 연결한다. 그 전까지 시험은 `memoryDriveHolderSettings`, `groupCatalogOf`를 쓴다.
- (닫힘) [결정: review.m3-design-inputs D-M3-06] 유휴 중 임대 부여로 자율 turn을 시작하는 것을 임대 상한 안에서 허용한다. X.primitives.spec §4.5.5의 [제안]과 같다.
- [미결] `GroupService`가 thread별 상태를 보이는 방식(§3.8 [가정]).
- [미결] 위임 상한의 귀속(§3.4, `_research/notes/L3-1.md` §6). 완료 보고와 끄기 때 처리는 아래 결정으로 닫았다. 위임 도구 정책(허용·차단)은 §3.4에서 둘 다 받는 것으로 정했다 [제안].
  - M3 설계(2026-10-26): `next` 보고는 turn을 시작하지 않는다(ADR-0013). `report`는 선택 필드다 [결정: review.m3-design-inputs D-M3-03]. 끄기 때는 `cancelDelegates`로 즉시 취소한다 [결정: review.m3-design-inputs D-M3-04]. 상한 귀속은 L1.agents 요구 REQ-L1-03(`review.m3-design-inputs` §4.4)이다.
- [결정: review.decisions-2 T-21] 상태 상한(64 KiB)을 넘는 비공개 기록은 X `ScopeApi.recordPrivate(kind, payload)`로 쓰고 `GroupApi`가 그대로 전달한다(§3.2).
- [미결] 임대 이벤트 이름: F.records.spec `lease.acquired`·`lease.released`와 `eng.context-map.design` 5.1절 `drive.leased`·`drive.released`. 이 문서는 F 이름을 쓴다.
- [결정: review.decisions-2 T-21] `grp.<그룹>.metrics.recorded`와 `grp.<그룹>.state.committed`의 소유는 §4.9와 §3.6 표에 적었다.
- [결정: review.decisions-2 U-18] 그룹 이름 규칙은 확장 id 규칙 `^[a-z][a-z0-9-]{1,31}$`(밑줄 없음)이다. 테이블 접두는 이름의 하이픈을 밑줄로 바꿔 만든다.
- [미결] `scanDriveSource`의 파서 `@swc/core`를 group-kit이 import하려면 DR-07 `MODULE_OWNERS` 항목이 필요하다. M3a는 `group-kit/package.json`에 `@swc/core`(`catalog:`)를 더했고 `check-layers`는 통과한다. `eng.dependency-rules.guide` 표와 `MODULE_OWNERS`에 행을 더하는 승인은 아직 없다.
- [미결] [M3a] `delegate_capability` 검사(§3.3): 위임 능력 ID가 F에 없고 L1 서비스는 포트(`xeon.agents`)라 매니페스트로 선언할 수 없다. 포트는 내장 확장만 읽으므로 외부 그룹의 위임 허용 여부는 신뢰 등급 정책이 정한다.
- [미결] [M3a] 옛 스펙의 `cancelDelegates(reason): Promise<{ cancelled: number }>`와 `delegateStatus(requestId): DelegateStatus | undefined`를 값 반환(`CancelDelegatesResult`, `DelegateStatusResult`)으로 바꿨다. L1 `cancel`은 `{ cancelled: boolean }`을 돌려주어 개수를 알 수 없고, 서비스 없음과 문맥 거부는 값으로 알려야 하기 때문이다(TY-11). 학습 스펙 §3·§4.3의 호출 예(`g.cancelDelegates("group_disabled")`)는 그대로 쓸 수 있고 반환값을 쓰는 곳만 맞춘다.
- [미결] [M3a] G-30의 "실패 값": `GroupStatus.drive`의 `"rejected"`만 채웠다. 거부 사유(`reason`, `requestSeq`)를 `GroupStatus`나 `GroupError`에 싣는 안은 F `services/groups.ts` 변경이 필요해 하지 않았다.
- [미결] [M3a] `replayDrive`의 지점 목록 지정(`cutAt`)과 사용자 입력 시작(`input`), 실패 보고의 첫 차이 이벤트 표시는 G-20 남은 몫이다.
- (닫힘) `RuntimeChange`의 단계 경계 값: 이 값을 쓰던 group-kit의 구동 그룹 키를 지웠다(§6, review.decisions-2 S-15).
- [결정: review.decisions-2 U-17] `group-kit`의 `@xeon/ext-host` import(`hostOf`, 리소스 정의 타입, 플러그인 등록)는 DR-14의 ext-host 예외(서비스 등록·주입 API만)에 든다. 그룹 패키지는 `@xeon/ext-host`를 import하지 않는다(L3.readme §3).
