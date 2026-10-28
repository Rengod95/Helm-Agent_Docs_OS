---
id: L3.helm.spec
layer: L3
domain: helm
kind: spec
status: draft
depends_on: [F.extensions.spec, F.records.spec, F.capabilities.spec, F.conversation.spec, X.primitives.spec, L3.group-kit.spec, L3.slots.spec, L2.web.spec, L2.knowledge.spec, L2.work.spec, L1.agents.spec, L1.tools.spec, adr.0013, adr.0015, adr.0017, X.loading-trust.spec, eng.typescript.guide, product.usecases.spec, review.m3-design-inputs]
binds: [xeon/packages/group-helm/**]
---

# L3 Helm 그룹 (helm)

패키지: `@xeon/group-helm`(`xeon/packages/group-helm`). 그룹 이름(`ExtensionName`, 주 scope id): `helm`.

M3 세부 설계판(2026-10-26). 첫 동작 마일스톤은 M3다(`review.m2-plan` §9 D-a, `review.m3-plan` M3-01). 이 판은 M3 설계 단계 입력(`review.m3-design-inputs` §4.1 H-IN-01~17)에 답하고, ADR-0015(효과 목록 C안)와 도구 메타(G1-05, `review.m3-plan` M3-02)를 반영한다. 2026-10-26 사용자 결정(`review.m3-design-inputs` §3 D-M3-01·05·06·07·11·17)을 반영했다. Helm은 L3 그룹 코드를 담은 기본 플러그인이다 [결정: review.m3-design-inputs D-M3-01].

## 1. 목적과 범위

[결정] Helm의 목적은 탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용하는 발견 지원이다. Helm을 스킬이나 일반 플러그인으로 두면 모델에 강제력이 없으므로, 코드 수준에서 루프를 제어한다(`_research/decisions-log.md` 2026-10-21 사용자 의중, product.vision.spec §7.1).

이 문서는 층 구성 계획 v2의 L3-b 구성요소 5개(`_research/layer-plan-v2.json` L3-b)의 인터페이스를 확정한다.

| # | 구성요소 | 쓰는 연산 | 이 문서의 절 |
|---|---|---|---|
| 1 | 탐구 신호 감지 | `on` tap(`tool.execution.after`, `boundary.settle.after`) | §3.5, §4.3 |
| 2 | 관점·방법 주입 | `on` collect(`input.agent.before`), `post` | §3.6, §4.4 |
| 3 | 탐구 구동 | `drive`(배타 임대), `on` first(`tool.call.before`) | §3.7, §4.2, §4.5, §4.6 |
| 4 | 지식 소비 | `g.capability` | §3.8, §4.7 |
| 5 | 발견 기록과 작업 연결 | `g.record`, `work.*` 능력 | §3.4, §4.8 |

코드 수준 강제 [결정: product.vision.spec §7.1, ADR-0007]. 아래 두 장치는 모델이 지시를 따르지 않아도 동작한다.

- 쓰기 거부: 확산 단계(`diverge`, `explore`)에서 쓰기 도구 호출은 `tool.call.before` 지점의 first 핸들러가 실행 전에 거부한다. 모델이 쓰기 도구를 불러도 도구는 실행되지 않고 거부 사유가 모델에 돌아간다.
- 단계 머신: 단계 진행(발산 → 다른 분야 탐색 → 수렴 → 적용)은 drive 함수가 커밋된 상태로 결정한다. 서브에이전트 수, 적용 턴 횟수는 모델 응답과 상관없이 코드가 정한다.

정하는 것:

- 매니페스트(`helmManifest`), 상태 스키마(`HelmState`), 레코드 종류 3개의 payload 스키마
- 단계 이름 4개와 전이표, 전이 함수 시그니처
- 신호 종류 3개와 입력, `autoStart` 동작
- 주입 경로(시스템 프롬프트 추가분, turn 입력, post)와 requestId 규칙
- drive 함수의 형태(상태 기반 재호출 함수)와 상한 계산 규칙
- 쓰기 거부 조건과 쓰기 판정 입력
- 지식 소비 경로와 저하 동작, 외부 텍스트 방어 규칙
- 설정 키 5개(`l3.helm.*` 4개와 `ext.helm.enabled`)와 명령 `/helm start|stop|status`
- M3 내장 렌즈 6개와 선택 규칙(§3.6), 신호 임계와 용어 추출 규칙(§3.5)
- 쓰기 판정 입력(도구 메타 `risk`, `hints`, `caller`, §4.6)
- Helm이 내는 효과마다 ADR-0015 효과 등급과 멱등 키(§4.11)
- 실패 값(`HelmFailure`)의 kind와 처리 규칙(§3.12, §4.12)
- group-kit과 slots 위의 그룹 구조(§3.11)
- 실패 처리와 수용 기준

다루지 않는 것(2차 이후):

- 모델이 렌즈를 제안하는 경로(그룹 전용 도구), 다회 라운드와 종료 판정 모델(§10 미결 6, 7)
- 신호 임계의 설정 노출(§10 미결 8)
- 단계별 프롬프트 문구 본문(§4.4는 구조만 정한다. 문구는 구현 작업 H-07에서 쓰고 테스트는 문구에 기대지 않는다)
- explorer 서브에이전트의 정의 본문(프롬프트). 도구 목록의 상한은 §4.6에 둔다. 형식은 L1.agents.spec

다루지 않는 것(다른 문서 소유):

- 임대 중재 메커니즘과 상한 집행: `X.primitives.spec`. 임대 정책, 그룹 전환 명령 `/group …`: `L3.group-kit.spec`
- 서브에이전트 실행: `L1.agents.spec`. 웹·지식·작업 능력의 구현: `L2.web.spec`, `L2.knowledge.spec`, `L2.work.spec`
- 학습 그룹의 정책: `L3.learning.spec`

### 1.1 M3 세부 설계에서 바꾼 것

| 항목 | 이전 판 | 이 판 | 근거 |
|---|---|---|---|
| 마일스톤 | M2 | M3. M2는 `group-helm` 설정(`driveLimits`)만 둔다 | `review.m2-plan` §9 D-a |
| drive 안 능력 호출 | F 효과 목록 밖(미결 C2) | `gatherContext`는 읽기(`readOnly`), `linkWork`는 멱등 쓰기(`idempotent`)로 허용(§4.11) | [결정: adr.0015] |
| 쓰기 판정 입력 | `ToolHints.readOnly`, 출처 미결(미결 8) | `ToolCallPayload.risk`가 `read`가 아니면 쓰기. `hints`는 보조, `caller`로 대상 대화를 고른다(§4.6) | M3-02, REQ-F-04, `L1.tools.spec` §2 위험 등급 |
| 서비스 키 | 미결 C1 | F `ServiceKey`만 쓰고 X 래퍼가 타입을 복원한다 | `review.m3-design-inputs` §3.8 A-01 |
| 실패 처리 | 예외와 표 | `HelmFailure` kind 판별 유니온과 kind별 처리표(§3.12, §4.12). drive 코드에 `!` 단언을 두지 않는다 | `eng.typescript.guide` TY-11, TY-13, TY-24 |
| 렌즈 | 자리표시 3개 | 내장 렌즈 6개와 신호별 우선순위(§3.6) | H-IN-03 |
| 종료·부분 결과·식별자 | 미결 2, 3, 16 | M3는 적용 1회로 끝내고 부분 결과를 허용한다. 단계·신호 식별자를 이 판으로 고정한다 [제안] | H-IN-02, 04, 05 |
| 형태와 사용자 결정 | 내장 그룹(조립 루트 등록), 미결 4 | 기본 플러그인(D-M3-01 c), 임대 충돌 대기(05 a), 유휴 자율 turn 허용(06 a), 안전 모드에서 적재 안 함(07 a), 자체 확장 API만(11 c) | [결정: review.m3-design-inputs D-M3-01, 05, 06, 07, 11] |

### 1.2 UC-2 대응

`product.usecases.spec` UC-2의 흐름을 이 문서의 절과 수용 기준(§9)에 대응시킨다.

| UC-2 흐름 | 이 문서 | 수용 기준 |
|---|---|---|
| 사전 조건: Helm이 설치되어 켜져 있음 | §3.1 플러그인 설치와 `defaultEnabled`, §6 `ext.helm.enabled` | 13 |
| 사전 조건: 임대를 다른 그룹이 갖지 않음 | §4.10, §4.13 대기 규칙 [결정: review.m3-design-inputs D-M3-05] | 5, 19 |
| 주 1. tap 핸들러가 탐구 신호를 기록 | §3.5, §4.3 | 8 |
| 주 2. 탐구 시작과 임대·상한 | §3.3, §4.5, §6 `driveLimits` | 11 |
| 주 3. `input.agent.before` collect가 렌즈를 주입 | §3.6, §4.4 | 18(plan `inject.*`) |
| 주 4. 확산 단계 쓰기 거부 | §4.6 | 1, 6, 7, 17 |
| 주 5. 렌즈마다 `loop.spawn` 병렬 | §4.5 `explore` | 2, 3 |
| 주 6. 결과를 상태로 커밋 | §4.2 `explored`·`converged` | 2 |
| 주 7. 적용 `loop.turn` 1회 | §4.5 `apply` | 2, 3, 16 |
| 주 8. 종료, 임대 반납, 발견 기록과 작업 연결 | §4.2 공통 규칙, §4.8 | 13 |
| 대안: 턴 중 Helm 끔 | §5 5번 | 12 |
| 대안: 서브에이전트 일부 실패 | §4.2 `explore` 행, §5 1번 | 10 |
| 대안: 임대 상한 도달 | §4.5 상한 도달, §5 3번 | 11 |
| 대안: 프로세스 강제 종료 | §4.5 재개, §4.11 | 3, 16 |
| 대안: first 핸들러 예외 | §4.6, §5 9번 | 7 |

- UC-2 수용 기준 "쓰기 도구는 파일을 바꿀 수 있는 도구 전부다"는 §4.6의 `risk` 판정으로 만족한다. `bash`는 `risk: exec`이므로 확산 단계에서 거부된다. M3에 `cap-workspace`의 `write`, `edit`(`risk: write`)이 들어와도 판정 규칙은 같다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 탐구(inquiry) | Helm이 drive 임대를 받아 단계 4개를 한 번 지나는 작업 단위. `inquiryId`로 식별한다 |
| 단계(phase) | `idle`, `diverge`, `explore`, `converge`, `apply` 다섯 값. `idle`은 탐구 밖이다. 나머지 넷이 탐구 단계다 |
| 발산(diverge) | 문제를 넓게 다시 보는 단계. 모델 turn 한 번을 쓰기 거부 아래에서 실행한다 |
| 다른 분야 탐색(explore) | 렌즈마다 서브에이전트(explorer)를 병렬로 띄워 다른 분야 지식을 모으는 단계 |
| 수렴(converge) | 서브에이전트 결과를 발견(finding) 목록으로 정리해 커밋하는 단계. 모델 turn을 쓰지 않는다 |
| 적용(apply) | 발견을 현재 작업에 적용하는 모델 turn을 정확히 한 번 실행하는 단계 |
| 확산 단계 | `diverge`와 `explore`를 함께 부르는 이름. 쓰기 거부가 걸리는 단계다 |
| 렌즈(lens) | 탐색 관점 하나. 예: "생물학의 면역 기억으로 캐시 무효화를 본다". 서브에이전트 하나가 렌즈 하나를 맡는다 |
| 발견(finding) | 렌즈 하나에서 나온 주장과 출처. 수렴 단계가 만든다 |
| 탐구 신호 | 탐구가 필요할 수 있다는 관찰. `stuck`, `repeat`, `newDomain` 셋 |
| 대기 요청(pending) | 시작이 요청됐지만 아직 임대를 받지 못한 탐구. 상태 필드 `pending`에 둔다 |
| 단계 경계 | F.conversation.spec §2의 정의. step이 끝나고 다음 step이 시작되기 전. 그룹 켜기·끄기와 임대 교체 시점이다 |
| turn, step | F.conversation.spec §2. 지점 `boundary.step.after`는 Xeon step 끝, `boundary.settle.after`는 Xeon turn 끝에서 발화한다(F.extensions.spec §2) |
| 효과 등급 | ADR-0015 §3.2의 분류. 코어 멱등(`loop.turn`, `loop.spawn`), 멱등 쓰기(`MethodDef.idempotent`), 읽기(`MethodDef.readOnly`), 선언 없음 |
| 위험 등급(risk) | L1.tools.spec §2의 `read` < `write` < `exec`. 미선언은 `exec` |
| 실패 값 | 예상 가능한 실패를 담는 `HelmFailure`(§3.12). `Result`의 오류 쪽에 싣는다(eng.typescript.guide TY-24) |

## 3. 인터페이스

모든 공개 이름은 `@xeon/group-helm`의 `src/index.ts`가 export한다. 다른 패키지는 이 패키지를 import하지 않는다(CM-06). export는 플러그인 엔트리(§3.1 플러그인 산출물의 `entry`)와 테스트용이다. 설정 정의 `helmSettings`는 호스트 설정 카탈로그도 가져간다(§6) [제안].

외부 이름의 출처:

| 이름 | 출처 |
|---|---|
| `ExtensionManifest`, `defineManifest`, `ScopeApi`, `DriveFn`, `LoopHandle`, `DriveOptions`, `DriveLimits`, `SpawnOutcome`, `TurnOutcome`, `PostItem`, `PostOptions`, `ToolCallPayload`, `ToolCallDecision`, `AgentSettledPayload`, `SessionStartPayload`, `HandlerContext`, `RecordKindDecl`, `RecordSubject`, `GroupRecord` | F.extensions.spec §3.1~§3.6 |
| `ServiceKey`, `CapabilityError`, `ToolHints`, `WebSearchKey` | F.capabilities.spec §3.3, §3.5, §3.6, §3.9 |
| `WebFetchKey`, `KnowledgeSearchKey`, `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `WorkTasksKey` | L2.web.spec §3.3, L2.knowledge.spec §3, L2.work.spec §3.2(정의 위치는 F `capabilities/defs/<domain>.ts`) |
| `ThreadId`, `TurnId`, `JsonValue` | F.conversation.spec §3.1, §3.2 |
| `defineSettings`, `SettingGroup` | F.wire-settings.spec §3.8.3 |
| `defineGroup`, `GroupDef<S>`, `GroupApi<S>`(`registerCommand` 포함), `GroupModule` | L3.group-kit.spec §3.2 |

### 3.1 매니페스트 (`src/manifest.ts`)

```ts
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";
import { HELM_RECORD_KINDS } from "./records.ts";

export const helmManifest = defineManifest({
  schemaVersion: 1,
  name: "helm",
  version: "0.1.0",
  displayName: "Helm",
  description: "탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용하는 의도 그룹",
  layer: "L3",
  kind: "group",
  entry: "./dist/index.js",                    // 번들 산출물(H-22). 소스 진입점은 src/index.ts
  defaultEnabled: true,                        // [결정: D-M3-01] 기본 플러그인. 설치되어 있으면 켠다
  usesDrive: true,
  usesPost: true,
  points: [
    "input.agent.before",                      // collect: 관점 주입(§4.4)
    "tool.call.before",                               // first: 확산 단계 쓰기 거부(§4.6)
    "tool.execution.after",                      // tap: 신호 입력 갱신(§4.3)
    "boundary.settle.after",                           // tap: 신호 판정, 정착 처리(§4.3)
    "session.start",                           // tap: 상태 복원 확인(§4.9)
    "lifecycle.lease.rejected",                // tap: 대기 거부 처리(§4.13). 지점 이름은 ADR-0017
  ],
  requires: [],                                // §4.7 저하 동작으로 모든 능력이 없어도 켜진다
  optional: [
    { id: "web.search", range: "^1.0.0" },     // L2.web.spec §3.2
    { id: "web.fetch", range: "^1.0.0" },      // L2.web.spec §3.3. Helm 코드는 부르지 않는다(§3.8)
    { id: "knowledge.search", range: "^1.0.0" },   // L2.knowledge.spec §1, §3.9
    { id: "knowledge.skills", range: "^1.0.0" },
    { id: "knowledge.memory", range: "^1.0.0" },
    { id: "work.tasks", range: "^1.0.0" },     // L2.work.spec §3.2
  ],
  recordKinds: HELM_RECORD_KINDS,              // §3.4
  readsRecordKinds: [],                        // 다른 그룹의 레코드를 읽지 않는다 [결정: review.decisions-2 D-10]
  components: { agents: ["./agents/explorer.md"] },        // [가정] L1.agents.spec 정의 파일 형식
  trust: { level: "user" },                   // 설치 위치 user의 상한과 같다(§3.1 패키징)
}) satisfies ExtensionManifest;
```

- 능력 ID: L2 spec이 정한 이름을 쓴다. `web.search`, `web.fetch`(L2.web.spec §3.2, §3.3), `knowledge.search`, `knowledge.skills`, `knowledge.memory`(L2.knowledge.spec §1, §3.9 대응표), `work.tasks`(L2.work.spec §3.2, §3.6의 `work.task.create` 대응 문장).
- 모든 능력을 `optional`에 둔다 [제안]. `requires`의 능력은 Cordis `inject`에 들어가므로 provider가 없으면 scope fiber가 켜지지 않는다(X.primitives.spec §3.7 규칙 5). Helm은 웹·지식·작업 능력이 없어도 §4.7 저하 동작으로 탐구를 끝내야 하므로(수용 기준 4, 14) `optional`이 맞다. `optional` 능력은 `g.capability(key)` 호출 때 찾고, 없으면 `capability_unavailable`을 저하 동작으로 바꾼다.
- `web.fetch`는 Helm 코드가 부르지 않는다. explorer가 모델 도구 `web_fetch`로 쓴다(§4.7). 매니페스트에 두는 것은 provider 유무를 저하 판정(explorer 과제의 고지)에 쓰기 위해서다.
- `explorer` 정의 파일은 그룹 패키지 안에 둔다 [가정]. L1.agents.spec이 그룹 제공 정의를 받지 않으면 정의를 L1 기본 정의로 옮긴다.
- `drive_conflict` 경고: 다른 drive 그룹이 기본 활성이면 `validateManifestSet`이 경고한다. 실행 중에는 임대를 하나만 준다(F.extensions.spec §4.7).
- 형태와 기본 켬 [결정: review.m3-design-inputs D-M3-01]: Helm은 기본 플러그인이다. 별도 패키지(`@xeon/group-helm`)로 설치하고, 설치되어 있으면 켠다(`defaultEnabled: true`). 소스 패키지의 층과 kind는 그대로다(`layer: "L3"`, `kind: "group"`, `group-kit`의 `defineGroup` 사용). 조립 루트(`apps/host`)는 Helm을 내장 확장으로 등록하지 않는다.
- 패키징 [제안]: 빌드가 플러그인 산출물 하나를 만든다. 산출물은 `.xeon-plugin/plugin.json`(이 매니페스트를 JSON으로 옮긴 것)과 엔트리 번들(`entry`), `agents/explorer.md`다. 릴리즈는 이 산출물을 앱 자원 디렉터리(`OsDirs.resource`)에 넣고, 첫 실행이 사용자 확장 위치 `<userDir>/extensions/helm/`에 설치한다. 앱이 갱신되면 설치본이 원본 그대로일 때(파일 해시가 같을 때)만 새 산출물로 바꾼다. 사용자가 고친 설치본은 그대로 두고 `/helm status`와 `xeon doctor`가 판 차이를 알린다.
- 적재와 신뢰: X.loading-trust의 외부 확장 로더가 설치 위치 `user`의 후보로 찾는다. 신뢰 상한은 `user`이고 매니페스트도 `trust.level: "user"`를 요청한다. `user` 등급은 `on`, `post`, `drive`, 리소스 등록, 접두 테이블 저장을 쓸 수 있다(X.loading-trust.spec §4.6.2). Helm은 자체 확장 API(`ScopeApi`, `group-kit`)만 쓴다. pi 확장 어댑터는 두지 않는다 [결정: review.m3-design-inputs D-M3-11].
- 의존 해석 [제안]: 엔트리 번들은 `@xeon/contracts`, `@xeon/group-kit`, `typebox`를 넣지 않고 외부 import로 남긴다. X 로더가 이 셋을 호스트의 같은 모듈 인스턴스로 가상 모듈 등록한다(X.loading-trust.spec §4.10.6의 등록 수단). 그래야 F 스키마 객체와 `group-kit` 상태가 호스트와 하나다. 이 등록은 X 쪽 요구다(§8).
- 끄기와 지우기: 끄기는 `ext.helm.enabled`(§6)다. 지우기는 설치 디렉터리를 지우는 것이고, 지운 뒤에는 Helm 지점 핸들러와 명령이 없다. 커밋된 상태(`x_helm_state`)와 기록은 남아 다시 설치하면 이어 쓴다.
- 안전 모드 [결정: review.m3-design-inputs D-M3-07]: 안전 모드는 L3 그룹과 `user` 등급 외부 확장을 싣지 않으므로(X.operations.spec §4.6.2) Helm은 적재되지 않는다. Helm 쪽 코드 변경은 없다(REQ-X-08).

### 3.2 상태 (`src/state.ts`)

```ts
import { Type, type Static } from "typebox";

// 구현 메모: isolatedDeclarations 때문에 상태 타입은 손으로 쓴 인터페이스이고 스키마는
// `Type.Unsafe<T>(shape satisfies SchemaProof<T, typeof shape>)`로 만든다(TY-26). 필드와 제약은 아래와 같다.
export const HELM_STATE_VERSION = 1 as const;

export const HelmPhaseSchema = Type.Union([
  Type.Literal("idle"), Type.Literal("diverge"), Type.Literal("explore"),
  Type.Literal("converge"), Type.Literal("apply"),
]);
export type HelmPhase = Static<typeof HelmPhaseSchema>;

/** 탐구 단계(idle 제외) */
export type InquiryPhase = Exclude<HelmPhase, "idle">;

export const HelmSignalKindSchema = Type.Union([
  Type.Literal("stuck"), Type.Literal("repeat"), Type.Literal("newDomain"),
]);
export type HelmSignalKind = Static<typeof HelmSignalKindSchema>;

export const LensStatusSchema = Type.Union([
  Type.Literal("pending"), Type.Literal("running"), Type.Literal("done"),
  Type.Literal("failed"), Type.Literal("skipped"),
]);
export type LensStatus = Static<typeof LensStatusSchema>;

/** 1~16자. requestId에 들어가므로 짧게 둔다 */
export const LENS_ID_PATTERN = "^[a-z][a-z0-9-]{0,15}$";
/** "h" + 소문자 base32 13자. requestId 64자 상한(§4.4) 안에 들어간다 */
export const INQUIRY_ID_PATTERN = "^h[a-z2-7]{13}$";
export type InquiryId = string;

export const HelmLensSchema = Type.Object({
  id: Type.String({ pattern: LENS_ID_PATTERN }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  status: LensStatusSchema,
});
export type HelmLens = Static<typeof HelmLensSchema>;

export const ConfidenceSchema = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);
export type Confidence = Static<typeof ConfidenceSchema>;

export const HelmSourceSchema = Type.Object({
  /** "web" | "knowledge" | "session" */
  origin: Type.Union([
    Type.Literal("web"), Type.Literal("knowledge"), Type.Literal("session"),
  ]),
  /** URL 또는 L2 지식 항목 참조. 긴 URL은 자른다(§3.2 크기 규칙) */
  ref: Type.String({ minLength: 1, maxLength: 512 }),
  title: Type.Optional(Type.String({ maxLength: 80 })),
});
export type HelmSource = Static<typeof HelmSourceSchema>;

export const HelmFindingSchema = Type.Object({
  /** `${lensId}-${n}`. 탐구 안에서 유일, 재생에서 같은 값(§4.8 중복 제거 키) */
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,15}-[0-9]{1,3}$" }),
  lensId: Type.String({ pattern: LENS_ID_PATTERN }),
  claim: Type.String({ minLength: 1, maxLength: 1000 }),
  sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
  confidence: ConfidenceSchema,
  /** 후속 작업 후보 제목. 없으면 작업을 만들지 않는다(§4.8) */
  followUp: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
export type HelmFinding = Static<typeof HelmFindingSchema>;

/** 시작 요청. 임대를 받기 전까지 phase는 idle로 남는다(§4.2) [제안] */
export const HelmPendingSchema = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  topic: Type.String({ minLength: 1, maxLength: 500 }),
  source: Type.Union([Type.Literal("signal"), Type.Literal("command")]),
  signal: Type.Optional(HelmSignalKindSchema),
});
export type HelmPending = Static<typeof HelmPendingSchema>;

/** turn을 넘어 이어지는 연속 횟수. `boundary.settle.after`에서 turn당 한 번 커밋한다(§4.3) [제안] */
export const HelmWatchSchema = Type.Object({
  /** `${toolName}:${errorDigest}` */
  errorKey: Type.Union([Type.String({ maxLength: 96 }), Type.Null()]),
  errorRun: Type.Integer({ minimum: 0 }),
  /** `${toolName}:${inputDigest}` */
  callKey: Type.Union([Type.String({ maxLength: 96 }), Type.Null()]),
  callRun: Type.Integer({ minimum: 0 }),
});
export type HelmWatch = Static<typeof HelmWatchSchema>;

/**
 * turn 하나 동안 on 핸들러가 프로세스 메모리에 모으는 값. 상태 문서에 넣지 않는다(§4.3).
 * (threadId, turnId)로 구분하고 boundary.settle.after 커밋 뒤 버린다
 */
export interface HelmTurnTally {
  /** 커밋된 watch에서 시작해 이 turn의 도구 결과로 갱신한 값 */
  readonly watch: HelmWatch;
  /** 이미 반영한 toolCallId. 같은 페이로드의 재실행을 한 번으로 센다 */
  readonly seenToolCallIds: readonly string[];
  /** 이 turn의 지식 검색 빈 결과 수 */
  readonly knowledgeMisses: number;
  /** 이 turn 사용자 입력에서 뽑은 분야 용어 후보. 최대 16개, 각 64자 */
  readonly promptTerms: readonly string[];
  /** 이 turn에서 넘은 신호. 중복 없이 최대 3개 */
  readonly crossed: readonly HelmSignalKind[];
  /** 신호별 근거 요약(도구 이름, 횟수). 신호 기록의 `evidence`가 된다 */
  readonly evidence: Readonly<Partial<Record<HelmSignalKind, { readonly toolName?: string; readonly count: number }>>>;
}

export const HelmStateSchema = Type.Object({
  phase: HelmPhaseSchema,
  inquiryId: Type.Union([Type.String({ pattern: INQUIRY_ID_PATTERN }), Type.Null()]),
  topic: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
  lenses: Type.Array(HelmLensSchema, { maxItems: 8 }),
  findings: Type.Array(HelmFindingSchema, { maxItems: 24 }),
  /** 1부터. idle이면 0 */
  round: Type.Integer({ minimum: 0 }),
  appliedTurnId: Type.Union([Type.String(), Type.Null()]),
  // 아래는 이 문서가 더한 필드 [제안]
  pending: Type.Union([HelmPendingSchema, Type.Null()]),
  watch: HelmWatchSchema,
  /** /helm stop이 켠다. drive가 다음 경계에서 읽는다(§4.5) */
  stopRequested: Type.Boolean(),
  /** 수렴 직전에 모은 지식 요약 참조(§4.7). 적용 프롬프트가 쓴다 */
  context: Type.Array(HelmSourceSchema, { maxItems: 8 }),
});
export type HelmState = Static<typeof HelmStateSchema>;

export const INITIAL_HELM_STATE: HelmState = {
  phase: "idle", inquiryId: null, topic: null, lenses: [], findings: [], round: 0, appliedTurnId: null,
  pending: null,
  watch: { errorKey: null, errorRun: 0, callKey: null, callRun: 0 },
  stopRequested: false,
  context: [],
};

/** F.extensions.spec §3.2 StateDecl에 넘기는 값 */
export const helmStateDecl: { readonly schema: typeof HelmStateSchema; readonly initial: HelmState; readonly version: 1 } = {
  schema: HelmStateSchema, initial: INITIAL_HELM_STATE, version: HELM_STATE_VERSION,
};

/** 상태 문서 직렬화 예산. group-kit STATE_DOC_MAX_BYTES(64 KiB)에서 4 KiB를 남긴다 */
export const HELM_STATE_BUDGET_BYTES = 61_440;

/**
 * 순수 함수. 직렬화 UTF-8 크기가 HELM_STATE_BUDGET_BYTES 이하가 되도록 줄인다. 줄일 필요가 없으면 같은 값.
 * 순서: (1) context를 뒤에서부터 뺀다 (2) confidence가 낮은 발견부터, 같으면 뒤의 발견부터 sources를 뺀다
 * (3) confidence가 낮은 발견부터, 같으면 뒤의 발견부터 발견을 뺀다. 각 단계는 예산 안에 들면 멈춘다
 */
export function fitState(state: HelmState): { readonly state: HelmState; readonly dropped: { readonly context: number; readonly sources: number; readonly findings: number } };

/** 모든 상태 쓰기의 단일 경로. g.state() 읽기, fitState, g.commit을 직렬 큐로 묶는다(§4.1) */
export function updateState(
  g: Pick<ScopeApi<HelmState>, "state" | "commit">,
  f: (current: Readonly<HelmState>) => HelmState,
): Promise<Result<Readonly<HelmState>, Extract<HelmFailure, { kind: "state_conflict" | "state_too_large" | "storage" | "disabled" }>>>;
```

- [결정] 단계 순서는 발산, 다른 분야 탐색, 수렴, 현재 작업 적용이다(계획 v2 `_research/layer-plan-v2.json` L3-b "탐구 구동", `_research/decisions-log.md` 2026-10-21 계획 v2).
- [제안] 단계 식별자 `diverge`, `explore`, `converge`, `apply`와 `idle`은 이 문서의 설계다. `diverge`는 사용자 의사코드(`_research/layer-plan-v2-notes.md` "Helm이 보이는 모양")의 이름을 따랐다. M3 판에서 이 식별자와 §4.2 전이표를 고정한다(H-IN-02). 식별자는 상태 문서, 레코드 payload, requestId에 들어가므로 바꾸려면 상태 `version`을 올리고 마이그레이션을 둔다.
- 상태 저장: scope 상태 문서는 X가 `grp.helm.state.committed` 이벤트와 `x_helm_state` 투영 테이블에 둔다(X.primitives.spec §4.6.1, [결정: review.decisions-2 T-21]). 투영 열과 활성 가지 규칙은 X 정의를 따른다 [결정: review.decisions-2 §3 T-20](L3.group-kit.spec §3.6, §4.5 6번 멱등 reducer). 비공개 상태이고 다른 그룹은 읽지 않는다(F.extensions.spec §3.6).
- 크기 상한 [제안]: 개수는 `lenses` 8개, `findings` 24개, `context` 8개, 발견 하나의 `sources` 4개다. 상한을 넘는 입력은 앞에서부터 자른다. 문자열은 스키마 길이(`claim` 1000자, `ref` 512자, `title` 80자)까지 자른다.
- 바이트 상한 [제안]: 개수 상한만으로는 group-kit 상태 문서 상한(직렬화 UTF-8 64 KiB, L3.group-kit.spec §3.6, §4.5)을 지키지 못한다. 한국어 `claim` 1000자는 약 3 KB이고 발견 24개면 그것만으로 64 KiB를 넘는다. 그래서 `updateState`는 커밋 전 `fitState`로 직렬화 크기를 `HELM_STATE_BUDGET_BYTES`(60 KiB) 이하로 줄인다. 빈 탐구 필드의 상태는 예산 안이므로 이 절차는 항상 끝난다. 버린 발견은 `grp.helm.discovery.recorded`에도 쓰지 않는다. 초과 커밋은 group-kit이 거부하고(L3.group-kit.spec §5 9번) drive 예외와 임대 `error` 반납으로 이어지므로 이 검사는 커밋 앞에서 한다.
- 긴 본문은 상태에 두지 않는다. explorer 답 원문은 상태에 넣지 않고(§4.5), 발견은 요약 주장과 출처 참조만 싣는다(L3.group-kit.spec §4.5 규칙 5).

### 3.3 단계 전이 (`src/phase.ts`)

전이 함수는 `src/phase.ts`에 둔다. `state.ts`가 `updateState`의 실패 값(`failures.ts`)을 import하고 `phase.ts`가 상태를 import하므로, 순환을 피하려고 전이와 `HelmReaction`(`src/reaction.ts`)을 `state.ts` 밖에 둔다. `parseExplorerAnswer`와 `dedupeFindings`는 `explored` 전이가 쓰므로 `src/findings.ts`에 둔다(§3.7).

```ts
export type HelmEvent =
  | { readonly type: "requested"; readonly pending: HelmPending }
  | { readonly type: "leaseGranted"; readonly lenses: readonly HelmLens[] }
  | { readonly type: "diverged"; readonly outcome: TurnOutcome }
  | { readonly type: "lensesStarted" }
  | { readonly type: "explored"; readonly results: readonly LensResult[] }
  | { readonly type: "converged"; readonly findings: readonly HelmFinding[]; readonly context: readonly HelmSource[] }
  | { readonly type: "applied"; readonly outcome: TurnOutcome }
  | { readonly type: "stopRequested" }
  | { readonly type: "limitReached"; readonly limit: "turns" | "spawns" | "tokens" }
  | { readonly type: "failed"; readonly failure: HelmFailure };

export interface LensResult {
  readonly lensId: string;
  /** spawn 결과. 예외는 guarded가 HelmFailure로 바꾼 값이다(§3.12). completed가 아닌 SpawnOutcome은 transition이 failed로 센다 */
  readonly outcome: Result<SpawnOutcome, HelmFailure>;
}

export interface TransitionResult {
  readonly state: HelmState;
  /** 이 전이로 탐구가 끝났으면 종료 정보. records.ts가 inquiry.finished로 기록한다 */
  readonly finished?: InquiryFinishedPayload;
}

/** 순수 함수. 시각, 난수, I/O를 쓰지 않는다. 표(§4.2)에 없는 (phase, event) 쌍은 상태를 그대로 돌려준다 */
export function transition(state: Readonly<HelmState>, event: HelmEvent): TransitionResult;

/** 표 검사용. §4.2 전이표와 같은 데이터 */
export const TRANSITIONS: readonly {
  readonly from: HelmPhase;
  readonly on: HelmEvent["type"];
  readonly to: HelmPhase;
}[];
```

- 임대 필요 판정 훅은 두지 않는다 [제안]. X는 drive를 등록한 켜진 그룹을 후보로 삼고, drive 함수가 같은 상태 판으로 두 번 효과 없이 반환하면 임대를 `idle`로 반납하며, 그 그룹은 다음 `turn_settled`나 상태 판이 바뀐 뒤에 다시 후보가 된다(X.primitives.spec §4.4.3). Helm의 drive는 `idle`이고 `pending`이 없으면 효과 없이 반환하므로(§4.5) 임대가 곧 반납된다. `pending`을 커밋하면 상태 판이 바뀌어 다시 후보가 된다. 이 규칙으로 L3.group-kit.spec에 없는 `needsDrive` 필드 없이 같은 동작을 낸다.
- 비용 [가정]: Helm이 켜져 있고 탐구가 없으면 `turn_settled`마다 임대 부여, drive 호출 두 번, `idle` 반납이 생긴다. 그동안 다른 drive 그룹은 대기한다. 부여·반납 이벤트가 turn마다 쌓이는 것이 문제가 되면 X에 후보 제외 조건을 요청한다(§10 미결 10).

### 3.4 레코드 (`src/records.ts`)

[결정] 공개 레코드 kind 3개는 공통 확정 이름을 쓴다. 형식은 F.extensions.spec §3.6 `RECORD_KIND_PATTERN`(`grp.<그룹>.<영역>.<이름>`)이다.

```ts
import { Type, type Static } from "typebox";
import type { RecordKindDecl } from "@xeon/contracts/extensions";

export const SignalDetectedPayloadSchema = Type.Object({
  signal: HelmSignalKindSchema,
  /** 신호를 낸 turn */
  turnId: Type.String(),
  /** 판정 근거. 값은 요약만 둔다(인자 원문, 오류 원문을 싣지 않는다) */
  evidence: Type.Object({
    toolName: Type.Optional(Type.String({ maxLength: 64 })),
    count: Type.Integer({ minimum: 1 }),
    terms: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 })),
  }),
  /** 기록 시점의 autoStart에 따른 처리 */
  action: Type.Union([
    Type.Literal("recorded"),    // autoStart off, 또는 탐구 중
    Type.Literal("suggested"),   // autoStart suggest: 제안 메시지 post
    Type.Literal("requested"),   // autoStart auto: pending 커밋(임대 요청)
  ]),
  inquiryId: Type.Union([Type.String({ pattern: INQUIRY_ID_PATTERN }), Type.Null()]),
});

export const DiscoveryRecordedPayloadSchema = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  /** 렌즈 id */
  lens: Type.String({ pattern: LENS_ID_PATTERN }),
  claim: Type.String({ minLength: 1, maxLength: 1000 }),
  /** 최악 크기: claim 약 3 KB + 출처 4개 × 약 1.8 KB로 16 KiB 안이다(§3.2 바이트 상한) */
  sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
  /** 적용 turn이 completed로 끝났으면 참 */
  applied: Type.Boolean(),
  confidence: ConfidenceSchema,
  /** [제안] 중복 제거 키. HelmFinding.id */
  findingId: Type.String(),
  /** [제안] work 능력으로 만든 작업 id. 없으면 생략 */
  taskId: Type.Optional(Type.String()),
});

export const InquiryOutcomeSchema = Type.Union([
  Type.Literal("applied"),     // 적용 turn 완료
  Type.Literal("empty"),       // 발견 0개라 적용하지 않음
  Type.Literal("stopped"),     // /helm stop
  Type.Literal("limit"),       // 임대 상한 도달
  Type.Literal("failed"),      // 모든 렌즈 실패, turn 오류, 상태 검증 실패
]);
export type InquiryOutcome = Static<typeof InquiryOutcomeSchema>;

export const InquiryFinishedPayloadSchema = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  outcome: InquiryOutcomeSchema,
  topic: Type.String({ maxLength: 500 }),
  rounds: Type.Integer({ minimum: 0 }),
  lensCount: Type.Integer({ minimum: 0 }),
  failedLenses: Type.Integer({ minimum: 0 }),
  findingCount: Type.Integer({ minimum: 0 }),
  appliedTurnId: Type.Union([Type.String(), Type.Null()]),
  limit: Type.Optional(Type.Union([Type.Literal("turns"), Type.Literal("spawns"), Type.Literal("tokens")])),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});

export type SignalDetectedPayload = Static<typeof SignalDetectedPayloadSchema>;
export type DiscoveryRecordedPayload = Static<typeof DiscoveryRecordedPayloadSchema>;
export type InquiryFinishedPayload = Static<typeof InquiryFinishedPayloadSchema>;

export const HELM_RECORD_KINDS: readonly RecordKindDecl[] = [
  { kind: "grp.helm.signal.detected", version: 1, description: "탐구 신호 관찰", payload: SignalDetectedPayloadSchema },
  { kind: "grp.helm.discovery.recorded", version: 1, description: "탐구 발견 1건", payload: DiscoveryRecordedPayloadSchema },
  { kind: "grp.helm.inquiry.finished", version: 1, description: "탐구 종료", payload: InquiryFinishedPayloadSchema },
];
```

| kind | subject | 쓰는 시점 | 읽는 쪽 |
|---|---|---|---|
| `grp.helm.signal.detected` | `{ type: "turn", id: turnId }` | 신호 판정 시(§4.3) | L4 상태 표시 |
| `grp.helm.discovery.recorded` | `{ type: "turn", id: appliedTurnId }`. 적용 turn이 없으면 `{ type: "thread", id: threadId }` | 적용 단계 끝(§4.8) | L4 상태 표시. 다른 그룹은 읽지 않는다 |
| `grp.helm.inquiry.finished` | `{ type: "thread", id: threadId }` | 탐구 종료 전이(§4.2) | L4 상태 표시 |

- [결정: review.decisions-2 T-21] 공개 레코드와 비공개 상태 모두 `grp.helm.` 접두를 쓴다. 공개 레코드는 `g.record`, 비공개 상태는 상태 문서(`grp.helm.state.committed`, 투영 `x_helm_state`)다. 상한을 넘는 비공개 기록이 필요하면 `ScopeApi.recordPrivate`(kind `grp.helm.*`, X.primitives.spec §4.6.5)를 쓴다. 그 kind는 매니페스트 `recordKinds`(`HELM_RECORD_KINDS`)에 넣지 않고 공개 kind와 이름이 겹치지 않게 한다.

### 3.5 신호 (`src/signals.ts`)

```ts
/** [제안] M3 고정 임계. 설정으로 노출하지 않는다(§10 미결 8) */
export const SIGNAL_DEFAULTS: {
  readonly stuckErrorRun: 3;        // 같은 도구의 같은 오류가 연속 3회
  readonly repeatCallRun: 3;        // 같은 도구를 같은 인자로 연속 3회
  readonly newDomainMisses: 2;      // 한 turn에 지식 검색 빈 결과 2회
};

/**
 * tool.execution.after 페이로드에서 Helm이 읽는 필드. F.extensions.spec §3.4 17행, pi types.ts:1087 필드에 input을 더한 형태.
 * input은 REQ-F-04(M3-02)로 F에 더한다. 들어오기 전에는 repeat 판정을 하지 않는다(§3.5 아래 규칙)
 */
export interface ToolExecutionEndView {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly result: unknown;
  readonly input?: Readonly<Record<string, JsonValue>>;
}

/** 순수 함수. 집계표를 갱신하고 넘은 신호를 crossed에 더한다. seenToolCallIds에 있는 호출은 그대로 돌려준다 */
export function observeToolEnd(
  tally: Readonly<HelmTurnTally>,
  end: ToolExecutionEndView,
  thresholds: typeof SIGNAL_DEFAULTS,
): HelmTurnTally;

/** 순수 함수. turn의 첫 지점에서 커밋된 watch로 빈 집계표를 만든다. `tool.execution.after`·`input.agent.before` 페이로드에는 turnId가 없어 집계표는 thread별로 두고 turnId는 `boundary.settle.after`에서 받는다 */
export function openTally(watch: Readonly<HelmWatch>): HelmTurnTally;

/** 순수 함수. 사용자 입력에서 분야 용어 후보를 뽑는다. 규칙은 아래 목록 */
export function extractTerms(prompt: string): readonly string[];

/** 순수 함수. turn 정착 때 newDomain을 판정하고, 커밋할 watch와 이 turn에 넘은 신호 전체를 돌려준다 */
export function settleTurn(
  tally: Readonly<HelmTurnTally>,
  thresholds: typeof SIGNAL_DEFAULTS,
): {
  readonly watch: HelmWatch;
  readonly crossed: readonly HelmSignalKind[];
  readonly evidence: HelmTurnTally["evidence"];
};

/** 순수 함수. 결정적 inquiryId. "h" + base32(fnv1a64(seed)) 13자 */
export function inquiryIdFrom(seed: string): InquiryId;

/** 순수 함수. 신호와 autoStart로 할 일을 정한다(§4.3 표) */
export function decideAction(
  state: Readonly<HelmState>,
  crossed: readonly HelmSignalKind[],
  autoStart: AutoStart,
  seed: { readonly turnId: string; readonly evidence: HelmTurnTally["evidence"]; readonly terms: readonly string[] },
): { readonly action: SignalDetectedPayload["action"]; readonly pending?: HelmPending };
```

판정 세부 [제안] (H-IN-06):

- 오류 다이제스트: `isError`인 결과의 첫 텍스트 내용에서 숫자 열, 16진 해시(8자 이상), 따옴표 안 경로를 `#`으로 바꾼 뒤 앞 200자를 `fnv1a64`로 줄인다. 같은 오류 문장에 줄 번호나 임시 경로만 다른 경우를 같은 오류로 센다.
- 인자 다이제스트: `input`의 키를 정렬한 정규 JSON(`JSON.stringify`에 정렬 키)을 `fnv1a64`로 줄인다. `input`이 없으면(F에 필드가 들어오기 전) `repeat` 집계를 건너뛴다. `stuck`과 `newDomain`은 `input` 없이 동작한다.
- 용어 추출(`extractTerms`): 사용자 입력에서 다음을 순서대로 모은다. (1) 백틱 안 문자열, (2) 대문자 두 자 이상 약어(`[A-Z][A-Z0-9]{1,}`), (3) 낙타 표기 영문 낱말(소문자 뒤에 대문자가 오는 낱말)과 하이픈으로 이은 영문 낱말, (4) 한글 낱말 가운데 `extractTerms`의 내장 불용어 목록에 없고 3자 이상인 것. 소문자로 맞추고 중복을 지운 뒤 앞 16개, 각 64자까지 남긴다. 모델·사전 호출을 쓰지 않는 순수 함수다.
- `newDomain` 조합: 한 turn에 지식 검색 빈 결과가 2회 이상이면 참이다. 빈 결과가 1회이고 용어 후보가 하나 이상이면 참이다. 지식 검색 도구는 `ToolExecutionEndView.capability.id === "knowledge.search"`로 알아보고, 빈 결과는 `structuredContent`의 결과 수 0으로 판정한다 [가정: L2.knowledge.spec 도구 결과 형식].
- 지식 검색 도구 식별: `tool.execution.after` 페이로드에는 능력 참조(`capability`)가 없으므로 모델 도구 이름 `knowledge_search`(L2.knowledge `KnowledgeSearch.tools`)로 알아보고, 빈 결과는 결과의 `structuredContent.hits` 길이 0으로 판정한다 [가정: 도구 결과 형식].
- 임계를 설정으로 노출하지 않는 이유: M3에서 신호 품질을 잴 기준 데이터가 없다. 계측(M3-new-09)으로 신호 수와 `/helm start` 전환율을 모은 뒤 노출 여부를 정한다.

### 3.6 주입 (`src/lenses.ts`, `src/prompts.ts`)

```ts
// lenses.ts
export interface LensDef {
  readonly id: string;           // LENS_ID_PATTERN
  readonly title: string;
  /** explorer 과제 문장 틀. {topic} 자리표시자 하나 */
  readonly taskTemplate: string;
}
/** M3 내장 렌즈 6개(아래 표). 순서가 기본 우선순위다 */
export const BUILTIN_LENSES: readonly LensDef[];
/** 신호(또는 명령)별 렌즈 우선순위. 아래 표 */
export const LENS_PRIORITY: Readonly<Record<HelmSignalKind | "command", readonly string[]>>;
/** 순수 함수. 상한 maxLenses 안에서 렌즈를 고른다. 같은 입력이면 같은 결과다 */
export function selectLenses(pending: Readonly<HelmPending>, maxLenses: number, catalog: readonly LensDef[]): readonly HelmLens[];

// prompts.ts
/** 시스템 프롬프트 추가분. 한 시점에 렌즈 하나만 넣는다(§4.4) */
export interface LensBlock {
  readonly phase: InquiryPhase;
  readonly inquiryId: InquiryId;
  readonly round: number;
  /** 현재 렌즈. diverge·converge·apply는 없음 */
  readonly lens?: Pick<HelmLens, "id" | "title">;
  /** 단계 규칙 문장(쓰기 금지 고지 등). 본문은 다음 단계 */
  readonly rules: readonly string[];
}
export function lensBlockFor(state: Readonly<HelmState>): LensBlock | undefined;
export function renderLensBlock(block: LensBlock): string;

/** loop.turn 입력. 본문 문구는 다음 단계 */
export function divergePrompt(state: Readonly<HelmState>): PostItem;
export function applyPrompt(state: Readonly<HelmState>): PostItem;
/** explorer 과제 문장. 외부 텍스트 방어 규칙(§4.7)을 포함한다 */
export function explorerTask(state: Readonly<HelmState>, lens: HelmLens, defs: readonly LensDef[]): string;

/** post requestId. 64자 이하 */
export function postRequestId(inquiryId: InquiryId, phase: HelmPhase, round: number): string;
// = `helm:${inquiryId}:${phase}:${round}`
```

M3 내장 렌즈 [제안] (H-IN-03):

| id | 제목 | explorer 과제 요지 |
|---|---|---|
| `analogy` | 다른 분야의 유사 문제 | `{topic}`과 구조가 같은 문제를 다른 분야(생물, 물리, 경제, 운영 등)에서 찾고 그 분야의 해법을 옮길 수 있는지 본다 |
| `prior-art` | 선행 사례와 문헌 | `{topic}`을 이미 다룬 논문, 오픈소스, 표준, 사후 분석을 찾고 채택된 방법과 버린 방법을 모은다 |
| `first-principles` | 기본 원리로 다시 보기 | `{topic}`의 전제를 나열하고 각 전제를 빼면 무엇이 달라지는지 본다 |
| `failure-modes` | 실패 사례 | `{topic}`과 비슷한 시도가 실패한 사례와 원인을 모은다 |
| `inversion` | 반대로 보기 | 목표를 뒤집어(어떻게 하면 확실히 실패하는가) 피할 조건을 찾는다 |
| `constraints` | 제약 바꾸기 | 시간, 비용, 규모 같은 제약 하나를 크게 바꿨을 때의 해법을 찾고 현재 제약으로 되돌려 본다 |

| 시작 출처 | 우선순위 |
|---|---|
| `stuck` | `failure-modes`, `first-principles`, `analogy`, `prior-art`, `inversion`, `constraints` |
| `repeat` | `inversion`, `analogy`, `constraints`, `first-principles`, `prior-art`, `failure-modes` |
| `newDomain` | `prior-art`, `analogy`, `first-principles`, `failure-modes`, `constraints`, `inversion` |
| `command`(`/helm start`) | `analogy`, `prior-art`, `first-principles`, `inversion`, `failure-modes`, `constraints` |

- `selectLenses`는 `pending.signal`(없으면 `command`)의 우선순위 앞에서부터 `maxLenses`개를 고른다. 무작위나 모델 호출을 쓰지 않는다. 같은 `pending`이면 같은 렌즈다.
- 렌즈 제안 경로(모델이 발산 turn에서 렌즈를 고르는 그룹 전용 도구)는 M3에 두지 않는다(§10 미결 6). 렌즈 내용과 표는 `lenses.ts` 한 파일에만 있으므로 2차에서 파일 단위로 바꾼다.
- 렌즈별 모델: 그룹 전용 모델 역할을 새로 두지 않는다(`review.m3-design-inputs` §3.8 MD-04). explorer는 정의의 `model`(기존 역할 이름)을 쓴다. F `SpawnSpec`에 모델 필드가 없으므로 Helm 설정으로 모델을 바꾸는 키는 두지 않는다. 사용자는 같은 이름의 사용자 범위 에이전트 정의로 덮어써 모델을 바꾼다 [가정: L1.agents.spec 정의 우선순위].

### 3.7 drive (`src/drive.ts`)

```ts
/** g.drive에 넘기는 함수. 클로저 지역 변수에 진행 상태를 두지 않는다(EV-09) */
export function helmDrive(g: GroupApi<HelmState>): DriveFn<HelmState>;

/** 필드별 작은 값. undefined는 상한 없음 */
export function minLimits(a: DriveLimits | undefined, b: DriveLimits | undefined): DriveLimits;

/** loop.turn·loop.spawn에 넘기는 requestId [제안]. 64자 이하 */
export function turnRequestId(inquiryId: InquiryId, phase: "diverge" | "apply", round: number): string;
// = `helm:${inquiryId}:turn:${phase}:${round}`
export function spawnRequestId(inquiryId: InquiryId, round: number, lensId: string): string;
// = `helm:${inquiryId}:spawn:${round}:${lensId}`

/** explorer 답의 기대 형식. 답 끝의 JSON 블록 하나 [제안] */
export const ExplorerReportSchema = Type.Object({
  findings: Type.Array(Type.Object({
    claim: Type.String({ minLength: 1, maxLength: 1000 }),
    sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
    confidence: ConfidenceSchema,
    followUp: Type.Optional(Type.String({ maxLength: 200 })),
  }), { maxItems: 8 }),
});
/** 순수 함수. 형식이 맞지 않으면 답 전체를 low 신뢰 발견 1건으로 바꾼다 */
export function parseExplorerAnswer(lensId: string, answer: string | undefined): readonly HelmFinding[];

/** 탐구 단계에서 반드시 있는 값. idle이 아니면 inquiryId와 topic이 있어야 한다 */
export interface ActiveInquiry {
  readonly inquiryId: InquiryId;
  readonly topic: string;
  readonly round: number;
}
/**
 * 순수 함수. 탐구 단계인데 inquiryId·topic이 없으면 state_inconsistent 실패를 돌려준다.
 * drive 코드는 비null 단언 대신 이 함수를 거친다(eng.typescript.guide 1.3절)
 */
export function activeInquiry(state: Readonly<HelmState>): Result<ActiveInquiry, Extract<HelmFailure, { kind: "state_inconsistent" }>>;
```

### 3.8 지식 소비 (`src/knowledge.ts`)

능력 서비스 키는 F의 `ServiceKey`를 쓴다. 키 상수는 F `capabilities/defs/<domain>.ts`에 둔다(F.capabilities.spec §3.9 [제안]).

| 용도 | 능력 ID | 서비스 키 | 메서드 | 효과 등급(ADR-0015) | 부르는 곳 | 매니페스트 | 근거 |
|---|---|---|---|---|---|---|---|
| 웹 검색 | `web.search` | `WebSearchKey` | `search({ query, limit, content })` | 읽기(`readOnly: true`) | drive `converge` | optional | F.capabilities.spec §3.9, L2.web.spec §3.2 |
| 본문 읽기 | `web.fetch` | `WebFetchKey` | Helm 코드는 부르지 않는다. explorer가 모델 도구 `web_fetch`로 쓴다 | 해당 없음(도구 경로) | explorer 자식 대화 | optional | L2.web.spec §3.3 |
| 스킬 검색 | `knowledge.search` | `KnowledgeSearchKey` | `query({ query, kinds: ["skill"], limit })` | 읽기 | drive `converge` | optional | L2.knowledge.spec §3.9 대응표 |
| 스킬 본문 | `knowledge.skills` | `KnowledgeSkillsKey` | `view({ name })` | 읽기 | drive `converge` | optional | L2.knowledge.spec §3.9 |
| 메모리 읽기 | `knowledge.memory` | `KnowledgeMemoryKey` | `read({})` | 읽기 | drive `converge` | optional | L2.knowledge.spec §3.9 |
| 과거 대화 검색 | `knowledge.search` | `KnowledgeSearchKey` | `query({ query, kinds: ["session"], limit })` | 읽기 | drive `converge` | optional | L2.knowledge.spec §3.9 |
| 작업 생성 | `work.tasks` | `WorkTasksKey` | `create({ content })`, `CallOptions.requestId` | 멱등 쓰기(`idempotent: true`) | drive `apply` | optional | L2.work.spec §3.2, §3.6, §3.7 |

- 효과 등급은 L2 메서드 정의의 선언이다(REQ-F-01, REQ-L2-01). Helm은 등급을 스스로 정하지 않는다. 표의 등급이 L2 정의에 아직 없으면 X 능력 래퍼가 호출을 `effect_not_allowed`로 거부하고(ADR-0015 §3.6), Helm은 그 실패를 저하 동작으로 처리한다(§4.12).
- on 핸들러에서는 능력을 부르지 않는다. 읽기도 부르지 않는다(ADR-0015 §3.2 [제안], `review.m3-design-inputs` D-M3-31 행 8).

```ts
export interface KnowledgeDigest {
  readonly sources: readonly HelmSource[];
  /** 저하 동작으로 빠진 경로 */
  readonly degraded: readonly ("web" | "knowledge" | "session")[];
}

/** drive 안에서만 부른다. 각 호출은 읽기 메서드다. 실패는 출처별로 저하 동작으로 바꾸고 이 함수는 실패하지 않는다 */
export function gatherContext(
  g: GroupApi<HelmState>,
  state: Readonly<HelmState>,
  inquiry: ActiveInquiry,
  opts: { readonly signal: AbortSignal },
): Promise<KnowledgeDigest>;

/** 출처 하나의 호출 결과. 예외를 attemptAsync로 받아 HelmFailure로 바꾼다 */
export function callSource<T>(
  capability: CapabilityId,
  call: () => Promise<T>,
): Promise<Result<T, Extract<HelmFailure, { kind: "capability" | "lease_lost" }>>>;

/** 순수 함수. capability 실패 → 저하 동작 분류(§4.12 표) */
export function degradeOf(failure: Extract<HelmFailure, { kind: "capability" }>): "skip" | "abort";
```

- 서비스 키 [제안: `review.m3-design-inputs` §3.8 A-01]: F는 능력별 `ServiceKey<Api>`(`WebSearchKey` 등)만 두고, X 래퍼가 Cordis 이름과 타입을 복원한다. Helm은 `g.capability(key)`만 쓴다. 이전 판의 미결 C1은 이 답으로 닫는다.
- `callSource`는 `CapabilityError`와 `PrimitiveError`(`capability_unavailable`, `lease_revoked` 등)만 실패 값으로 바꾼다. 그 밖의 예외(타입 위반, `Bug`)는 다시 던진다. 오류를 삼키지 않는다(eng.typescript.guide TY-11).
- 테스트 가짜 provider는 위 표의 서비스 키(`WebSearchKey`, `KnowledgeSearchKey`, `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `WorkTasksKey`)마다 둔다(L3.helm.plan §5).

### 3.9 명령 (`src/commands.ts`)

```ts
export type HelmCommand =
  | { readonly name: "start"; readonly topic?: string }
  | { readonly name: "stop" }
  | { readonly name: "status" };

export interface HelmStatusView {
  readonly enabled: boolean;
  readonly phase: HelmPhase;
  readonly inquiryId: InquiryId | null;
  readonly topic: string | null;
  readonly lenses: readonly HelmLens[];
  readonly findings: number;
  /** 임대 상태. group-kit GroupStatus에서 온다 [가정] */
  readonly lease: "held" | "waiting" | "none";
  /** 대기 중이면 임대를 가진 그룹 이름 */
  readonly leaseHolder?: string;
  readonly budget?: LeaseBudget;
}

export type HelmCommandError =
  | { readonly kind: "usage"; readonly message: string }          // 하위 명령·인자 형식 오류
  | { readonly kind: "already_running"; readonly inquiryId: InquiryId | null }   // 탐구 중이거나 pending 있음
  | { readonly kind: "no_topic" }                                    // 주제 생략, 신호·입력 용어도 없음
  | { readonly kind: "disabled" }                                    // 그룹이 꺼져 있음(scope_inactive)
  | { readonly kind: "state_write"; readonly failure: Extract<HelmFailure, { kind: "state_conflict" | "state_too_large" | "storage" }> };

/** 순수 함수. "/helm start 주제" 같은 인자 문자열을 해석한다 */
export function parseHelmCommand(args: string): Result<HelmCommand, Extract<HelmCommandError, { kind: "usage" }>>;

/** 명령 실행. 효과는 updateState와 post뿐이다. 명령 처리기는 재실행되지 않으므로 ADR-0015 대상이 아니다(§4.11) */
export function runHelmCommand(g: GroupApi<HelmState>, cmd: HelmCommand, ctx: { readonly turnId: TurnId | null }): Promise<Result<HelmStatusView, HelmCommandError>>;

/** g.registerCommand에 넘기는 정의. parseHelmCommand와 runHelmCommand를 묶는다. 타입은 GroupApi에서 유도해 ext-host를 import하지 않는다 */
export function helmCommand(g: GroupApi<HelmState>): Parameters<GroupApi<HelmState>["registerCommand"]>[1];
```

- 명령 등록은 group-kit `g.registerCommand("helm", …)`로 한다(L3.group-kit.spec §3.2). group-kit은 X `hostOf(g).registerCommand`(X.primitives.spec §4.8)로 넘긴다. 이름은 `helm`이고 하위 명령을 인자로 받는다.
- `/helm start [주제]`: `idle`이고 `pending`이 없을 때만 `pending`(`source: "command"`)을 커밋한다. 주제를 생략하면 마지막 신호 기록의 근거나 현재 turn 입력 용어 후보를 쓴다. `inquiryId`는 `inquiryIdFrom("command:" + (turnId ?? "none") + ":" + topic)`다 [제안].
- `/helm stop`: §5 4번.
- `/helm status`: `HelmStatusView`를 돌려준다. 상태를 바꾸지 않는다.
- 오류 표시: `helmCommand`는 `HelmCommandError`를 kind별 한 줄 문장으로 바꿔 명령 결과로 돌려준다. `switch`가 모든 kind를 다루는지 `assertNever`로 확인한다(TY-13).

### 3.10 그룹 모듈 (`src/index.ts`)

```ts
import { defineGroup, type GroupModule } from "@xeon/group-kit";

export const helmGroup: GroupModule = defineGroup<HelmState>({
  manifest: helmManifest,
  state: helmStateDecl,
  settings: helmSettings,          // §6
  setup(g) {
    g.registerCommand("helm", helmCommand(g));     // §3.9
    g.on("input.agent.before", injectLens(g));      // §4.4
    g.on("tool.call.before", guardWrite(g));               // §4.6
    g.on("tool.execution.after", observeTool(g));     // §4.3
    g.on("boundary.settle.after", settle(g));               // §4.3
    g.on("session.start", checkRestore(g));         // §4.9
    g.drive(helmDrive(g), { limits: g.settings().driveLimits });   // §4.5
  },
});

export { helmManifest, HelmStateSchema, INITIAL_HELM_STATE, HELM_RECORD_KINDS, helmSettings, transition, TRANSITIONS };
```

- `defineGroup`의 필드는 L3.group-kit.spec §3.2 `GroupDef`(`manifest`, `state`, `migrations`, `settings`, `setup`)다. Helm은 그중 `migrations`를 쓰지 않는다(상태 버전 1). `/helm` 명령은 `GroupApi.registerCommand`로 등록한다. 임대 필요 여부를 알리는 별도 필드는 두지 않는다(§3.3).

### 3.11 그룹 구조: group-kit과 slots 위의 배치

Helm은 L3.slots.spec §3.1의 판정과 체크리스트를 따르는 첫 drive 의도 그룹이다. 같은 구조로 제2의 의도 그룹(L3.slots.spec §3.1.5)을 만들 수 있게, Helm 고유 코드와 group-kit이 주는 부분을 나눈다.

판정(L3.slots.spec §3.1.1): 1~3번(스킬, 능력, 정책 플러그인)으로는 부족하다. 여러 turn에 걸친 단계 진행, 병렬 서브에이전트, 결과 커밋 뒤 적용 turn을 런타임이 구동해야 하므로 4번 drive 의도 그룹이다. 템플릿은 drive 템플릿(L3.slots.spec §3.3)과 같은 파일 배치를 쓴다.

| 체크리스트(L3.slots.spec §3.1.2) | Helm의 대응 | 확인 |
|---|---|---|
| C1 매니페스트 | §3.1 `kind: "group"`, `layer: "L3"`, `usesDrive: true`, `usesPost: true` | plan 테스트 1 |
| C2 상태 스키마 | §3.2 `helmStateDecl`(version 1) | plan 테스트 4, 4a |
| C3 drive와 상한 | §4.5, `DriveOptions.limits`는 `l3.helm.driveLimits` | plan 테스트 23 |
| C4 레코드 kind | §3.4 `HELM_RECORD_KINDS` 3개, `readsRecordKinds: []` | plan 테스트 2, 3 |
| C5 설정 네임스페이스 | `l3.helm.*`를 유지한다 [제안]. 공식 기본 플러그인의 설정 정의는 호스트 카탈로그가 정적으로 싣는다(§6, §10 미결 13). `enabled`는 X 예약 키 `ext.helm.enabled` | plan 테스트 6 |
| C6 단위 테스트 | plan §5.1 | |
| C7 재생 테스트 | `replayDrive` 효과 계수(§4.11, ADR-0015 §3.6) | plan 테스트 21, 35 |
| C8 다른 그룹 import 없음 | 소스 import는 `@xeon/contracts`, `@xeon/group-kit`, `typebox`뿐 | check-layers DR-02 |
| C9 코어 diff 0 | Helm 본체 변경에서 `contracts`, `ext-host`, `group-kit`, `core-*`, `platform-*` diff 0 | plan §6 3번 |

group-kit이 주는 것과 Helm이 쓰는 방식:

| group-kit(L3.group-kit.spec) | Helm의 쓰임 |
|---|---|
| `defineGroup`, `GroupApi`(§3.2) | `helmGroup` 정의, `g.settings()`, `g.registerCommand("helm", …)` |
| `commit` 래퍼의 `checkStateCommit`(§3.2) | `updateState`가 그 앞에서 `fitState`로 예산을 맞춘다(§3.2) |
| `DriveArbiter`, `GroupStatus.drive`(§3.5, §3.8) | `/helm status`의 `lease`, 대기 거부 판정(§4.13) |
| `replayDrive`(§3.10)와 G-20 효과 계수 | 재생 2회, 효과 1회 시험(§4.11) |
| `scanDriveSource`(§3.11) | `drive.ts` 정적 결정성 검사(plan H-18) |
| `g.delegate`(§3.4) | 쓰지 않는다. explorer는 임대 안의 `loop.spawn`으로 띄운다. 백그라운드 위임은 임대 상한 밖이라 탐구 비용을 묶지 못한다 |
| `g.registerTool`(§3.2) | M3에는 쓰지 않는다. 렌즈 제안 도구(§10 미결 6)가 생기면 쓴다 |

### 3.12 실패 값 (`src/failures.ts`)

예상 가능한 실패는 `Result<T, HelmFailure>`로 돌려준다(eng.typescript.guide TY-11, TY-24). X 연산(`commit`, `record`, `post`, `loop.*`)과 능력 메서드는 실패를 예외로 알린다(`PrimitiveError`, `CapabilityError`, F.capabilities.spec §3.6). Helm은 그 경계에서 `attemptAsync`로 받아 아래 kind로 바꾸고, 그 안쪽 코드는 `Result`만 다룬다.

```ts
import type { CapabilityId, CommonErrorCode } from "@xeon/contracts/capabilities";
import type { Result } from "@xeon/contracts";

export type HelmFailure =
  /** 임대 회수·중단(PrimitiveError lease_inactive·lease_revoked, CapabilityError aborted, loop.signal) */
  | { readonly kind: "lease_lost" }
  /** 임대 상한(PrimitiveError lease_budget, 또는 LeaseBudget 0) */
  | { readonly kind: "budget"; readonly limit: "turns" | "spawns" | "tokens" }
  /** 상태 커밋 판 충돌(PrimitiveError state_conflict, REQ-X-02) */
  | { readonly kind: "state_conflict" }
  /** fitState 뒤에도 64 KiB 초과(PrimitiveError state_too_large). fitState 규칙상 일어나면 안 되지만 group-kit 검사와 예산이 어긋날 때를 받는다 */
  | { readonly kind: "state_too_large" }
  /** 저장소 실패(PrimitiveError storage_unavailable) */
  | { readonly kind: "storage" }
  /** 그룹이 꺼짐(PrimitiveError scope_inactive) */
  | { readonly kind: "disabled" }
  /**
   * 능력 호출 실패. CapabilityError의 code를 싣는다. PrimitiveError capability_unavailable(provider 없음)은 "unavailable"로 싣는다.
   * ADR-0015의 effect_not_allowed는 REQ-F-01로 공통 코드에 들어온다
   */
  | { readonly kind: "capability"; readonly capability: CapabilityId; readonly code: CommonErrorCode }
  /** loop.turn 결과가 completed가 아님 */
  | { readonly kind: "turn"; readonly phase: "diverge" | "apply"; readonly status: "aborted" | "error" }
  /** loop.spawn 결과가 completed가 아니거나 spawn이 거부됨 */
  | { readonly kind: "spawn"; readonly lensId: string; readonly status: "aborted" | "error" }
  /** 탐구 단계인데 필수 필드가 없음(§3.7 activeInquiry). 상태 검증 실패(§4.9)도 여기에 싣는다 */
  | { readonly kind: "state_inconsistent"; readonly detail: string };

/** PrimitiveError·CapabilityError를 HelmFailure로 바꾼다. 둘 다 아니면 undefined(호출자가 다시 던진다). 순수 함수 */
export function failureOf(error: unknown, at: { readonly capability?: CapabilityId }): HelmFailure | undefined;

/** kind별 처리(§4.12 표)를 정하는 순수 함수. switch + assertNever로 모든 kind를 다룬다 */
export function reactionOf(failure: HelmFailure, phase: HelmPhase): HelmReaction;

export type HelmReaction =
  | { readonly type: "finish"; readonly event: HelmEvent }           // 전이로 탐구를 끝낸다
  | { readonly type: "degrade"; readonly source: "web" | "knowledge" | "session" | "work" }   // 그 출처만 건너뛴다
  | { readonly type: "retry_once" }                                  // 상태를 다시 읽고 같은 단계를 한 번 더
  | { readonly type: "yield" }                                       // 커밋 없이 반환. X가 다음 경계에서 다시 부른다
  | { readonly type: "lens_failed"; readonly lensId: string };      // spawn 실패 하나. 그 렌즈만 failed로 세고 수렴한다(§4.2)
```
`HelmReaction`과 `reactionOf`는 순환을 피하려고 `src/reaction.ts`에 둔다. `reactionOf(failure, phase, source?)`의 `source`는 같은 능력(`knowledge.search`)이 두 출처(스킬, 세션)를 맡을 때 호출한 쪽이 알린다. `failureOf`의 `at`에는 `limit`(`lease_budget`이 어느 상한인지)를 더한다. ext-host를 import하지 않으므로 `PrimitiveError`는 이름과 `code`로 알아본다.

- kind 이름은 X `PrimitiveErrorCode`(X.primitives.spec §3.10)와 F `CapabilityErrorCode`를 그대로 옮기지 않고 Helm의 처리 단위로 묶는다. 처리가 같은 코드는 한 kind로 모은다.
- `failureOf`가 `undefined`를 돌려준 예외(설계 위반, `Bug`, 알 수 없는 오류)는 다시 던진다. drive에서 던지면 X가 임대를 반납하고 drive 등록을 오류로 표시한다(F.extensions.spec §5 6번, `GroupStatus.lastError` `group.driveThrew`).
- `PrimitiveError`의 그 밖의 코드(`record_invalid`, `record_kind_undeclared`, `post_undeclared`, `point_undeclared`, `state_schema`, `capability_undeclared`)는 Helm 매니페스트나 스키마의 잘못이다. 정상 운영에서 일어나지 않으므로 `failureOf`가 바꾸지 않고 다시 던진다(TY-24 판정 질문).

## 4. 동작 규칙

### 4.1 상태 쓰기

- 모든 상태 변경은 `updateState(g, f)`로 한다. `updateState`는 패키지 안 직렬 큐로 `g.state()` 읽기, `f` 적용, `g.commit`을 한 단위로 실행한다. on 핸들러, drive 함수, 명령이 같은 상태를 동시에 바꿀 때 앞선 커밋을 잃지 않게 한다 [제안].
- `ScopeApi.commit`은 교체 커밋이다(F.extensions.spec §3.2). X가 비교 후 교체(CAS)나 커밋 직렬화를 보장하면(REQ-X-02) 큐를 지운다. X가 `state_conflict`를 내면 `updateState`는 상태를 다시 읽어 `f`를 한 번 더 적용한다. 두 번째도 충돌이면 `state_conflict` 실패를 돌려준다(§4.12).
- `updateState`의 반환은 `Promise<Result<Readonly<HelmState>, Extract<HelmFailure, { kind: "state_conflict" | "state_too_large" | "storage" | "disabled" }>>>`다. 실패는 예외로 던지지 않는다.
- 커밋 전 `HelmStateSchema` 검사를 한다. `f`가 스키마를 어기는 값을 만들면 Helm 코드의 잘못이므로 `Bug`를 던진다(on 핸들러면 fold 실패 규칙, drive면 F.extensions.spec §5 6번).

### 4.2 단계와 전이표

[결정] 단계 순서는 발산 → 다른 분야 탐색 → 수렴 → 적용이다(§3.2, 계획 v2 L3-b). 아래 전이표, 진입·중단 조건, 이벤트 이름은 이 문서의 설계다 [제안]. 전이는 `transition(state, event)` 하나가 정한다. drive 함수와 명령은 이 함수를 거쳐서만 `phase`를 바꾼다.

| 단계 | 진입 조건 | 효과(그 단계에서 하는 일) | 다음 단계 | 중단 조건과 결과 |
|---|---|---|---|---|
| `idle` | 초기값, 또는 탐구 종료 | 신호 감지만 한다. 쓰기 거부 없음. `pending`을 커밋하면 상태 판이 바뀌어 X가 Helm을 다시 임대 후보로 삼는다(§3.3) | `diverge`: 임대를 받아 drive가 호출되고 `pending`이 있음(`leaseGranted`) | `stopRequested`: `pending`을 지운다. 기록 없음 |
| `diverge` | `leaseGranted`. `inquiryId`, `topic`을 `pending`에서 옮기고 `round = 1`, `selectLenses`로 `lenses`(모두 `pending`)를 정한다 | 쓰기 거부 켜짐. 발산 프롬프트로 `loop.turn` 1회(`turnRequestId(…, "diverge", round)`). 시스템 프롬프트에 단계 블록 추가 | `explore`: turn이 `completed`(`diverged`) | turn `aborted` → `idle`(`stopped`). turn `error` → `idle`(`failed`). `budget.turns === 0` → `idle`(`limit`, `turns`) |
| `explore` | `diverged` | 쓰기 거부 켜짐. 렌즈를 `running`으로 커밋(`lensesStarted`), `pending`·`running` 렌즈마다 `loop.spawn({ agent: "explorer" })`를 병렬로 실행 | `converge`: 모든 렌즈가 `done`·`failed`·`skipped`(`explored`) | 모든 렌즈 실패 → `idle`(`failed`) [제안: 부분 결과 허용, 하나라도 `done`이면 진행]. 남은 spawn 예산 < 렌즈 수 → 앞 렌즈만 실행하고 나머지 `skipped`. `budget.spawns === 0` → `idle`(`limit`, `spawns`) |
| `converge` | `explored` | 모델 turn 없음. `parseExplorerAnswer`로 발견 정리, `gatherContext`로 지식 요약, 한 번에 커밋(`converged`) | `apply`: 발견 1개 이상 | 발견 0개 → `idle`(`empty`) |
| `apply` | `converged` | 쓰기 거부 없음. 적용 프롬프트로 `loop.turn` 정확히 1회(`turnRequestId(…, "apply", round)`). 끝나면 발견 기록, 작업 연결(§4.8) | `idle`(`applied`): `appliedTurnId` 설정 | turn `error`·`aborted` → `idle`(`failed`·`stopped`), 발견 기록은 `applied: false`. `budget.turns === 0` → `idle`(`limit`, `turns`), 적용 없이 발견만 기록 |

공통 규칙:

- 모든 탐구 단계에서 `stopRequested`가 참이면 다음 drive 경계에서 `idle`(`stopped`)로 간다.
- `idle`로 가는 전이는 `inquiryId`, `topic`, `lenses`, `findings`, `context`, `round`, `stopRequested`를 초기값으로 되돌리고 `TransitionResult.finished`를 채운다. `appliedTurnId`는 다음 탐구 시작까지 남긴다.
- 표에 없는 (단계, 이벤트) 쌍은 상태를 바꾸지 않는다. 테스트가 모든 쌍을 열거해 이 규칙을 확인한다(L3.helm.plan `transitions.table-covers-all-phase-pairs`).
- 종료 판정 [제안] (H-IN-04): M3는 적용 1회로 탐구를 끝낸다(라운드 1). 다회 라운드(적용 뒤 다시 `diverge`)와 판정 방식은 2차다(§10 미결 7). `round` 필드와 requestId의 라운드 자리는 이 확장을 위해 둔다.
- 부분 결과 [제안] (H-IN-05): 허용한다. 실패한 렌즈는 `failed`로 남기고 나머지 결과로 수렴한다. 하나도 `done`이 아니면 `idle`(`failed`)이다.

### 4.3 탐구 신호

[결정] 신호 종류는 막힘, 반복, 새 분야 진입 셋이다(계획 v2 `_research/layer-plan-v2.json` L3-b "탐구 신호 감지"). 식별자 `stuck`, `repeat`, `newDomain`과 아래 입력·판정 지점·임계는 이 문서의 설계다 [제안].

| 신호 | 입력 | 판정 지점 | 기본 임계 [제안] |
|---|---|---|---|
| `stuck` | 같은 도구의 같은 오류(`toolName` + 오류 요약 다이제스트)가 연속으로 남 | `tool.execution.after`(메모리 집계), `boundary.settle.after`(기록) | 3회 |
| `repeat` | 같은 도구를 같은 인자(`toolName` + 정규화 인자 다이제스트)로 연속 호출 | `tool.execution.after`(메모리 집계), `boundary.settle.after`(기록) | 3회 |
| `newDomain` | 한 turn 안의 지식 검색(`knowledge.search` 능력 도구) 빈 결과, 사용자 입력의 낯선 분야 용어 | `boundary.settle.after` | 빈 결과 2회, 또는 용어 후보가 있고 빈 결과 1회 |

핸들러 계약 [결정: F.extensions.spec §4.3, EV-08]:

- 신호 핸들러는 다시 실행해도 되는 질의다. 외부 I/O, 능력 호출, 시각·난수를 쓰지 않는다. 효과는 `g.record`와 `updateState`(commit)로만 낸다. 예외는 하나다: `boundary.settle.after` 핸들러는 `autoStart: "suggest"`일 때 멱등 키를 가진 `post`를 한 번 낸다(F.extensions.spec §4.3이 허용한 효과).
- 같은 페이로드로 다시 실행되면 `HelmTurnTally.seenToolCallIds`에 그 `toolCallId`가 있으므로 누적값을 다시 올리지 않는다. 신호 기록은 `boundary.settle.after`에서만 쓰고, 그 커밋의 멱등 키(X.primitives.spec §4.6.4 `rec:<scope 해시>:<dispatchKey>:<n>`)로 재실행 때 두 번째 기록이 `replayed`가 된다.
- 다이제스트는 `fnv1a64`(순수 함수)로 만든다. 인자·오류 원문은 상태와 레코드에 남기지 않는다.

커밋 빈도 [제안]: 상태 커밋은 turn당 1회(`boundary.settle.after`)다. group-kit 규칙(L3.group-kit.spec §4.5 4번, 카운터 틱은 상태 문서에 커밋하지 않는다)을 따르고, 학습 그룹과 같은 방식이다(L3.learning.spec §4.2 커밋 빈도).

- `input.agent.before`와 `tool.execution.after`는 프로세스 메모리의 `HelmTurnTally`(§3.2)만 갱신한다. 집계표는 (threadId, turnId)로 구분하고, 그 turn의 첫 지점에서 커밋된 `watch`로 연다(`openTally`).
- `boundary.settle.after`는 `settleTurn`으로 커밋할 `watch`(turn을 넘어 이어지는 연속 횟수)와 넘은 신호를 얻고, 신호 기록과 상태 커밋을 한 번씩 한 뒤 집계표를 버린다.
- 크래시로 집계표를 잃으면 그 turn의 도구 결과가 연속 횟수에 들어가지 않는다. 결과는 신호가 한 turn 늦게 나오거나 그 turn의 `newDomain`을 놓치는 것이므로 받아들인다.

지점별 처리:

| 지점 | fold | 처리 |
|---|---|---|
| `input.agent.before` | collect | `phase === "idle"`이면 `extractTerms(payload.prompt)`로 집계표의 `promptTerms`를 채운다. 커밋하지 않고 패치도 돌려주지 않는다. 탐구 단계면 §4.4의 주입만 한다 |
| `tool.execution.after` | tap | `observeToolEnd`로 집계표를 갱신한다. 커밋과 기록은 하지 않는다 |
| `boundary.settle.after` | tap | `settleTurn`으로 `newDomain`을 판정하고 넘은 신호 전체를 얻는다. 넘은 신호가 있으면 `decideAction`으로 처리한다(아래 표). 신호마다 `grp.helm.signal.detected` 한 건을 처리 결과(`action`)와 함께 쓴다. 그 뒤 `updateState`로 `watch`(와 `auto`면 `pending`)를 한 번 커밋한다 |

`autoStart` 동작 [제안]:

| `l3.helm.autoStart` | 탐구 중(`phase !== "idle"` 또는 `pending` 있음) | `idle`, 신호 있음 |
|---|---|---|
| `off` | 기록만(`recorded`) | 기록만(`recorded`) |
| `suggest`(기본) | 기록만 | 제안 메시지를 `post`한다(`kind: "context"`, `customType: "grp.helm.notice.suggested"`, `display: true`, `when: "next"`, `requestId: postRequestId(inquiryIdFrom(turnId), "idle", 0)`). 사용자가 `/helm start`를 실행하면 시작한다(`suggested`) |
| `auto` | 기록만 | `pending`(`source: "signal"`)을 커밋한다. 상태 판이 바뀌어 Helm이 다시 임대 후보가 되고, 다음 판단 시점에 DriveArbiter가 임대를 정한다(§3.3, `requested`) |

- `topic`은 신호 근거에서 만든다: `newDomain`이면 용어 후보, `stuck`·`repeat`이면 도구 이름과 사용자 입력 용어 후보. 형식은 `"<도구 이름 또는 첫 용어>: <용어 후보 앞 3개를 쉼표로 이은 값>"`이고 500자에서 자른다 [제안].
- `inquiryId`는 `inquiryIdFrom(turnId)`로 만든다. 같은 turn의 재실행은 같은 id를 낸다.
- [결정: adr.0013] `when: "next"` 항목은 스스로 turn을 시작하지 않는다. 유휴 thread에서는 다음 사용자 입력의 turn에 붙는다. `followUp`과 `steer`는 유휴 thread에서 turn을 열 수 있으므로 Helm의 제안·알림 `post`는 `next`만 쓴다 [제안]. 이전 판의 `followUp`은 이 규칙으로 고쳤다.
- [가정] `customType`은 `RecordKind` 형식만 맞으면 되고 매니페스트 `recordKinds` 선언이 필요 없다(F.extensions.spec §3.2 `PostItem`).

### 4.4 관점·방법 주입

주입 경로는 셋이다. 셋 모두 커밋된 상태에서 결정적으로 만든다.

| 경로 | 연산 | 쓰는 단계 | 내용 |
|---|---|---|---|
| 시스템 프롬프트 추가분 | `on("input.agent.before")` collect 기여 | `diverge`, `explore`, `converge`, `apply`의 Helm 대화 turn | `renderLensBlock(lensBlockFor(state))`를 현재 시스템 프롬프트 끝에 붙인다 |
| turn 입력 | `loop.turn({ input })` | `diverge`, `apply` | `divergePrompt(state)`, `applyPrompt(state)` |
| 입력 큐 | `post` | 제안, 상한 도달·부분 실패·종료 알림 | `kind: "context"`, `display: true`, `when: "next"`(adr.0013). 단계 중간에 방법 힌트를 넣을 때만 `when: "steer"`이고, 임대를 가진 탐구 turn이 실행 중일 때로 한정한다 |

- collect 패치 [결정: ADR-0017]: `input.agent.before`는 collect 지점이다. 모든 핸들러가 원본 `payload`(`prompt`, `systemPrompt`)를 받고 반환값(`BeforeAgentStartPatch`의 `systemPrompt`, `message`)이 등록 순서로 모인다. 시스템 프롬프트 교체값은 마지막으로 정의한 핸들러가 이긴다. Helm 핸들러는 `{ systemPrompt: payload.systemPrompt + "\n\n" + block }`을 돌려준다. 다른 그룹이 같은 지점에서 교체값을 내면 순서에 따라 한쪽이 이긴다 [미결: 병합 규칙이 바뀌면 이 문장을 고친다].
- 한 시점에 렌즈 하나만 주입한다 [제안]. `explore` 단계에서 부모 대화의 블록에는 렌즈 목록 제목만 넣고, 렌즈별 지시는 각 explorer 과제에만 넣는다. `diverge`, `converge`, `apply`의 블록에는 렌즈 본문을 넣지 않는다.
- 블록 구조(`LensBlock`): 머리줄(`[helm] inquiry <id> round <n> phase <phase>`), 단계 규칙 목록(예: 확산 단계 쓰기 금지 고지), 현재 렌즈 제목. 문구 본문은 다음 단계에서 정한다.
- 대상 thread: 핸들러는 `ctx.threadId`가 Helm 상태를 가진 대화일 때만 패치를 낸다 [가정]. explorer 자식 대화에서 같은 지점이 발화하는지는 L1.agents.spec이 정한다.
- 프롬프트 캐시 [가정]: 블록을 시스템 프롬프트 끝에 두므로 앞부분 접두는 공유된다. 단계가 바뀔 때마다 블록이 바뀌어 그 뒤 캐시는 다시 만든다. 블록 내용은 한 단계 안에서 같으므로 같은 단계의 turn 사이에서는 캐시가 유지된다. 실제 적중률은 L1.models.spec의 캐시 규칙을 확인한 뒤 잰다.
- requestId [제안]:

| 호출 | requestId | 근거 |
|---|---|---|
| `post` | `helm:<inquiryId>:<phase>:<round>` (알림 종류가 둘 이상이면 끝에 `:<종류>`) | 공통 확정 형식 |
| `loop.turn` | `helm:<inquiryId>:turn:<phase>:<round>` | §4.5 |
| `loop.spawn` | `helm:<inquiryId>:spawn:<round>:<lensId>` | §4.5 |
| 멱등 쓰기 능력 호출(`CallOptions.requestId`) | `helm:<inquiryId>:cap:task:<findingId>` | §4.8, §4.11. 읽기 호출은 키를 넘기지 않는다(§4.7) |

  최대 길이는 `helm:`(5) + inquiryId(14) + `:spawn:`(7) + 라운드(3) + `:`(1) + lensId(16) = 46자로 64자 상한 안이다.

### 4.5 탐구 구동 (drive)

[결정] drive 함수는 단계 경계마다 마지막 커밋 상태로 다시 호출된다. 상태 변경은 `commit`으로만 한다(F.extensions.spec §4.6, ADR-0007). 효과 목록은 ADR-0015 §3.2 표를 따른다. Helm drive의 효과는 `loop.turn`, `loop.spawn`, `post`, `record`, 읽기 능력 호출, 멱등 쓰기 능력 호출이다. 효과마다의 키와 보장 주체는 §4.11이다.

의사코드. 사용자 의사코드(`_research/layer-plan-v2-notes.md` "Helm이 보이는 모양")를 상태 기반 재호출 함수로 다시 쓴 것이다. 한 번 호출은 현재 단계 하나만 처리하고 커밋한 뒤 돌아간다. 다음 단계는 X가 다시 호출할 때 처리한다.

```ts
export function helmDrive(g: GroupApi<HelmState>): DriveFn<HelmState> {
  return async (loop, st) => {
    // st는 마지막 커밋 상태. 지역 변수는 이 호출 안에서만 쓴다(EV-09)
    const s = g.settings();
    if (st.stopRequested) return settle(g, st, await step(g, { type: "stopRequested" }));
    if (st.phase === "idle") {
      if (st.pending === null) return;                         // 할 일 없음. X가 idle 반납(F.extensions.spec §5 7번)
      const lenses = selectLenses(st.pending, s.maxLenses, BUILTIN_LENSES);
      return settle(g, st, await step(g, { type: "leaseGranted", lenses }));   // → diverge
    }
    const inq = activeInquiry(st);                             // 비null 단언 대신 Result로 좁힌다
    if (!inq.ok) return settle(g, st, inq);                    // state_inconsistent → idle(failed)

    switch (st.phase) {
      case "diverge": {
        if (loop.budget.turns === 0) return settle(g, st, err({ kind: "budget", limit: "turns" }));
        const out = await guarded(() => loop.turn({
          input: divergePrompt(st),
          requestId: turnRequestId(inq.value.inquiryId, "diverge", inq.value.round),
        }));
        if (!out.ok) return settle(g, st, out);
        return settle(g, st, await step(g, { type: "diverged", outcome: out.value }));   // → explore 또는 idle
      }
      case "explore": {
        const todo = st.lenses.filter((l) => l.status === "pending" || l.status === "running");
        const room = loop.budget.spawns ?? todo.length;
        if (room === 0) return settle(g, st, err({ kind: "budget", limit: "spawns" }));
        const run = todo.slice(0, room);                        // 남은 렌즈는 explored에서 skipped
        if (run.some((l) => l.status === "pending")) {
          const started = await step(g, { type: "lensesStarted" });
          if (!started.ok) return settle(g, st, started);
        }
        const results = await Promise.all(run.map((l) => guarded(() => loop.spawn({
          agent: "explorer",
          task: explorerTask(st, l, BUILTIN_LENSES),
          requestId: spawnRequestId(inq.value.inquiryId, inq.value.round, l.id),
        }))));
        const lost = results.find((r) => !r.ok && r.error.kind === "lease_lost");
        if (lost !== undefined) return;                         // 임대 회수: 커밋 없이 반환(§4.12 yield)
        return settle(g, st, await step(g, { type: "explored", results: toLensResults(run, results) }));
      }
      case "converge": {
        // st.findings는 explored 전이가 parseExplorerAnswer로 채워 커밋한 값이다
        const digest = await gatherContext(g, st, inq.value, { signal: loop.signal });   // 실패하지 않는다. 출처별 저하
        return settle(g, st, await step(g, {
          type: "converged", findings: dedupeFindings(st.findings), context: digest.sources,
        }));
      }
      case "apply": {
        if (loop.budget.turns === 0) {
          await recordDiscoveries(g, st, inq.value, undefined);   // 적용 없이 발견만 기록(applied: false)
          return settle(g, st, err({ kind: "budget", limit: "turns" }));
        }
        const out = await guarded(() => loop.turn({            // 정확히 한 번: 같은 requestId는 기록된 결과를 돌려받는다
          input: applyPrompt(st),
          requestId: turnRequestId(inq.value.inquiryId, "apply", inq.value.round),
        }));
        if (!out.ok && out.error.kind === "lease_lost") return;
        await recordDiscoveries(g, st, inq.value, out.ok ? out.value : undefined);   // §4.8. 중복 제거 키는 findingId
        if (out.ok) await linkWork(g, st, inq.value);           // §4.8. 멱등 쓰기, 실패는 출처 저하
        return settle(g, st, out.ok ? await step(g, { type: "applied", outcome: out.value }) : out);
      }
    }
  };
}
// guarded(f)    = attemptAsync(f) 뒤 failureOf로 HelmFailure. failureOf가 undefined면 다시 던진다(§3.12)
// step(g, e)    = updateState(g, (cur) => transition(cur, e).state). finished가 있으면 inquiry.finished 기록과 종료 알림 post
// settle(g, st, r) = r이 실패면 reactionOf(r.error, st.phase)에 따라 처리한다(§4.12): finish는 step(event),
//                  degrade는 해당 출처만 건너뛰고 계속, retry_once는 updateState가 이미 한 번 다시 시도했으므로 yield와 같다,
//                  yield는 커밋 없이 반환한다. 성공이면 아무것도 하지 않는다
```

- 답 원문(`SpawnOutcome.answer`)은 상태에 두지 않는다 [제안]. `explored` 전이가 렌즈별 답에 `parseExplorerAnswer`(순수 함수)를 실행해 `findings`를 채우고, `converge` 분기는 지식 요약과 정리(`dedupeFindings`: 같은 `claim` 정규화 문자열 제거, 상한 24개, 커밋 전 `fitState`)만 한다. 그래서 `converge`에서 재호출돼도 서브에이전트 결과를 다시 받을 필요가 없다.
- 단계 하나를 처리할 때마다 커밋하고 반환하므로, 재호출된 함수는 커밋된 `phase`에 해당하는 분기 하나만 실행한다. 사용자 의사코드의 `while` 반복은 X의 재호출이 대신한다.
- 병렬 spawn은 `Promise.all`과 `guarded`로 받는다. `guarded`가 예상 가능한 실패를 값으로 바꾸므로 렌즈 하나의 실패가 다른 렌즈의 결과를 지우지 않는다. 이전 판의 `Promise.allSettled`는 알 수 없는 예외까지 값으로 바꿔 삼키므로 쓰지 않는다.
- 상한: `DriveOptions.limits`는 `minLimits(x.primitives.driveLimits, l3.helm.driveLimits)`를 넘지 않는다. Helm은 `l3.helm.driveLimits`를 넘겨 X 일반 기본값 `x.primitives.driveDefaultLimits`를 덮어쓰고, X가 천장 `x.primitives.driveLimits`로 다시 자른다(review.decisions-2 U-12)(F.extensions.spec §3.2 `DriveOptions` 주석, §6). [가정] group-kit은 임대를 새로 받을 때 `DriveOptions`를 설정에서 다시 읽는다.
- 상한 도달: `LeaseBudget`이 0이면 `loop.turn`·`loop.spawn`을 부르지 않고 `budget` 실패로 끝낸다. X가 먼저 거부하면(`PrimitiveError` `lease_budget`, F.extensions.spec §4.6) `failureOf`가 같은 `budget` 실패로 바꾼다. 어느 경우든 `inquiry.finished`에 `outcome: "limit"`과 `limit`을 남기고 알림을 `post`한다(`display: true`). 임대는 X가 `releasing`으로 바꾼다.
- requestId: Helm은 `loop.turn`, `loop.spawn`, 멱등 능력 호출에 탐구 id에서 만든 결정적 키를 직접 넘긴다(ADR-0015 §3.4). X 기본 키(`${leaseId}:${순번}`)는 재시작·재활성화 뒤 `leaseId`가 바뀌면 달라질 수 있는데(REQ-X-04), 명시 키는 커밋된 상태 값(`inquiryId`, `round`, `lensId`, `findingId`)만 재료로 쓰므로 임대가 바뀌어도 같다. 그래서 Helm은 REQ-X-04의 답에 기대지 않는다(이전 판 미결 7을 Helm 쪽에서는 닫는다).
- 재개(UC-2): 커밋 전에 프로세스가 끝나면 drive는 마지막 커밋 상태로 다시 호출된다. `explore` 단계에서 커밋 전이던 spawn은 같은 requestId로 다시 호출된다. 코어(L1.agents)가 이미 자식 대화를 만들었으면 기록된 결과를 돌려받고, 만들지 않았으면 새로 실행한다. 이 보장은 재시작 뒤에도 유지돼야 하므로 (thread, `requestId`) 멱등을 세션 DB에 둔다(ADR-0015 §3.2, REQ-L1-01). 같은 렌즈에 서브에이전트가 두 개 이상 결과를 남기지 않는다.
- 결정성: drive 함수 안에서 `Date.now`, `Math.random`, 직접 I/O를 쓰지 않는다. `replayDrive`의 효과 계수(§4.11)와 `scanDriveSource`의 `drive.ts` 정적 검사(L3.group-kit.plan G-19, L3.helm.plan H-18)로 확인한다.
- 유휴 자율 turn [결정: review.m3-design-inputs D-M3-06]: 임대 상한 안에서 허용한다. 사용자 turn이 끝난 뒤 임대를 받으면 drive는 `diverge`·`apply` turn을 사용자 입력 없이 연다(X.primitives.spec §4.5.5). 비용은 `l3.helm.driveLimits`가 묶는다.

### 4.6 쓰기 거부

```ts
// src/guard.ts
import type { CallerId, ToolRisk } from "@xeon/contracts/services";

export const WRITE_DENY_REASON: string;   // 본문은 구현 작업 H-08. 단계 이름, 해제 방법(/helm stop, 탐구 종료)을 담는다

/** tool.call.before 페이로드에서 Helm이 읽는 도구 메타. REQ-F-04(M3-02)로 F ToolCallPayload에 더한다 */
export interface ToolCallMetaView {
  /** L1.tools.spec §2 위험 등급. 없으면 exec로 본다 */
  readonly risk?: ToolRisk;
  readonly hints?: ToolHints;
  /** 호출 주체. main 또는 subagent:<정의 이름> */
  readonly caller?: CallerId;
}

/** 순수 함수. risk가 read가 아니면 쓰기다 */
export function isWriteCall(meta: Readonly<ToolCallMetaView>): boolean;

/** 순수 함수. 이 호출이 Helm 쓰기 거부의 대상 대화에서 왔는지 */
export function isGuardedCaller(caller: CallerId | undefined): boolean;

export function guardWrite(g: GroupApi<HelmState>): Handler<"tool.call.before", HelmState>;
// (call, ctx) => g.settings().writeGuard
//   && (ctx.state.phase === "diverge" || ctx.state.phase === "explore")
//   && isGuardedCaller(call.caller) && isWriteCall(call)
//   ? { block: true, reason: WRITE_DENY_REASON } : undefined
```

- 조건: `l3.helm.writeGuard`가 참이고 핸들러가 받은 커밋 상태(`ctx.state`)의 `phase`가 `diverge` 또는 `explore`일 때만 거부한다. `idle`(대기 요청 포함), `converge`, `apply`에서는 거부하지 않는다.
- 결정 형태: F.extensions.spec §3.5의 `ToolCallDecision`(`{ block: true, reason }`)을 쓴다. 사용자 의사코드의 `{ deny: "…" }`는 이 형태에 대응한다. `terminate`는 두지 않는다.
- 쓰기 판정 입력 [제안] (G1-05, M3-02, H-IN-07):

| 입력 | 판정 |
|---|---|
| `risk === "read"` | 읽기. 거부하지 않는다 |
| `risk === "write"` 또는 `"exec"` | 쓰기. 거부한다. `bash`는 `exec`라 확산 단계에서 거부된다(UC-2 수용 기준) |
| `risk` 없음 | L1.tools 규칙(미선언은 `exec`)과 같이 쓰기로 본다 |
| `hints.readOnly === true`인데 `risk`가 `write`·`exec` | `risk`를 따른다. `hints`는 작성자 힌트이고 MCP annotation도 `hints`로 들어오므로 등급을 낮추지 않는다(L1.tools.spec 등급 유도 규칙) |

- 대상 대화(`caller`) [제안]: `main`과 `subagent:explorer`를 거부 대상으로 본다. 그 밖의 서브에이전트(다른 그룹의 위임, 학습 검토 포크)는 Helm 탐구와 관계가 없으므로 거부하지 않는다. `caller`가 없으면 `main`으로 본다. 핸들러는 그 밖에 `ctx.threadId`가 Helm 상태를 가진 대화이거나 그 자식인지에 기대지 않는다. 자식 대화에서 그룹 핸들러가 발화하는 범위는 L1.agents가 정한다(REQ-L1-04). 자식 대화에서 발화하지 않으면 explorer의 쓰기 차단은 아래 정의 상한 하나가 맡는다.
- explorer 도구 상한 [제안]: explorer 정의의 도구 목록은 `risk: read` 도구(`read`, `ls`, `grep`, `find`, `web_search`, `web_fetch`, 지식 검색 도구)만 둔다. 이 상한은 L1.agents 권한 상한(§4.3)으로 집행되고 Helm 핸들러 발화와 상관없이 적용된다.
- 처리 순서 [가정] (H-IN-16, REQ-X-11): `tool.call.before` 지점 디스패치는 인자 검증 뒤, 정책 판정·승인 요청 앞에서 실행된다. 그래서 Helm이 거부한 호출은 사용자 승인 창을 띄우지 않는다. 샌드박스는 실행 경로(L0)에서 따로 걸리므로 Helm 거부와 겹치지 않는다. 순서가 다르게 정해지면 이 절의 "승인 창을 띄우지 않는다" 문장만 고친다.
- 핸들러 예외는 `FIRST_DENY["tool.call.before"]`로 바뀌어 호출이 거부된다(F.extensions.spec §4.1 first fail-closed). 이 거부는 Helm 단계와 상관없이 일어나므로 핸들러는 상태 읽기와 순수 판정만 하고 I/O를 하지 않는다.
- 강제력: 이 거부는 모델의 응답 내용과 상관없이 도구 실행 전에 적용된다. 모델이 쓰기 금지 고지(§4.4)를 무시하고 쓰기 도구를 불러도 도구는 실행되지 않는다.
- 메타가 F에 들어오기 전: M3-02가 Helm 본체(M3-01)의 선행이다(`review.m3-plan` §2). 구현 순서상 메타 없는 기간은 없지만, 필드가 비어 있으면 위 표의 "`risk` 없음" 행으로 모두 쓰기로 본다. 그때는 확산 단계에서 읽기 도구도 거부되므로 `/helm status`가 "도구 메타 없음" 경고를 보인다.

### 4.7 지식 소비

- 읽기 경로는 F 정의뿐이다. `g.capability(key)`만 쓴다. `group-learning`과 `cap-*` 패키지를 import하지 않는다(CM-06, F.extensions.spec §4.8, 층 사이 규칙 2).
- `gatherContext` 순서 [제안]: 스킬 검색(`knowledge.search.query`, `kinds: ["skill"]`) → 메모리 읽기(`knowledge.memory.read`) → 과거 대화 검색(`knowledge.search.query`, `kinds: ["session"]`) → 웹 검색(`topic`, `limit: 5`, `content: "highlights"`). 본문 읽기(`web.fetch`)는 explorer가 도구로 하고 drive는 부르지 않는다.
- 각 호출은 `CallOptions`에 `signal: loop.signal`을 넘긴다. 읽기 메서드라 멱등 키가 필요 없으므로 requestId를 넘기지 않는다(ADR-0015 §3.2 읽기 행). 결과는 `converged` 커밋의 `context`에 요약으로 고정한다. `converged` 커밋 전에 재호출되면 읽기를 다시 하고, 비용은 재생 횟수만큼 든다(ADR-0015 §4.2).
- 각 출처 호출은 `callSource`로 감싼다. 실패는 `degradeOf`로 `skip`(그 출처만 건너뜀)이나 `abort`(임대 회수, 나머지 호출을 멈추고 지금까지 모은 요약으로 반환)가 된다.
- 다른 그룹 레코드 [결정: review.decisions-2 D-10]: 그룹 사이 레코드는 F에 스키마가 없으므로 Helm은 학습 그룹을 비롯한 다른 그룹의 레코드(`g.readRecords`)를 읽지 않는다. 학습 그룹이 승인해 적용한 스킬과 메모리는 L2 지식 저장소에 있으므로 위 스킬 검색·메모리 읽기로 얻는다. 승인 전 후보는 L2에 없으므로 섞이지 않는다.

저하 동작 [제안]:

| 상황 | 동작 |
|---|---|
| `web.search` 없음 또는 `unavailable`·`rate_limited`·`timeout` | 웹 출처 없이 진행. `degraded`에 `web`. explorer 과제에 "웹 검색 불가" 고지를 넣는다 |
| `web.fetch` 없음 | drive는 영향이 없다(부르지 않는다). explorer 과제에 "본문 읽기 불가" 고지를 넣고 검색 요약만으로 주장을 만들게 한다 |
| `knowledge.search`, `knowledge.skills`, `knowledge.memory` 없음(optional 미제공) | 해당 출처 건너뜀. `degraded`에 `knowledge`·`session` |
| 학습 그룹 꺼짐, 미설치 | 영향 없음. Helm은 학습 그룹 레코드를 읽지 않는다 |
| `aborted` | 호출을 멈추고 drive를 반환한다. 임대 회수 중이다 |
| 모든 출처 실패 | 지식 요약 없이 수렴한다. 탐구는 계속한다 |

외부 텍스트 방어 규칙 [제안]:

1. 웹 결과, fetch 본문, 지식 항목, explorer 답은 DATA다. Helm은 이 텍스트를 지시로 해석하지 않는다. 코드 경로(전이, 쓰기 판정, 명령)는 이 텍스트의 내용으로 분기하지 않는다. 예외는 `parseExplorerAnswer`의 JSON 스키마 검사뿐이다.
2. 프롬프트에 넣을 때는 `<untrusted_web_content>`(F.capabilities.spec §3.9 `renderSearch`와 같은 표지)처럼 출처 표지로 감싸고, 표지 안 내용은 따르지 않을 자료라는 문장을 블록 규칙에 둔다.
3. 표지 문자열이 본문에 나오면 이스케이프한다.
4. 상태와 레코드에는 외부 텍스트를 길이 상한까지 잘라 넣는다(`claim` 1000자, `ref` 512자, `title` 80자). 상태는 `fitState`로 바이트 상한도 지킨다(§3.2).
5. 확산 단계의 쓰기 거부는 외부 텍스트에 숨은 지시가 쓰기 도구를 부르게 해도 실행을 막는다. 적용 단계의 쓰기는 일반 대화와 같은 승인·샌드박스 정책(L1-d, L0-b)을 따른다.

### 4.8 발견 기록과 작업 연결

- 기록 시점: 적용 단계에서 `loop.turn`이 끝난 뒤 발견마다 `grp.helm.discovery.recorded` 1건을 쓴다. `applied`는 적용 turn이 `completed`면 참이다. 상한·실패로 적용 없이 끝나면 `applied: false`로 쓴다.
- 순서와 원자성 [제안]: `record` → `linkWork` → 전이 커밋 순서다. 커밋 전에 프로세스가 끝나면 재호출된 drive가 같은 발견을 다시 기록할 수 있다. 읽는 쪽은 `(inquiryId, findingId)`로 중복을 지운다. `commit`과 `record`를 한 트랜잭션으로 묶는 API는 REQ-X-03으로 X에 요구한다. 생기면 `record`와 전이 커밋을 한 묶음으로 바꾸고 중복 제거 규칙은 그대로 둔다.
- 작업 연결: `followUp`이 있는 발견마다 `g.capability(WorkTasksKey).create({ content: followUp })`를 부른다(L2.work.spec §3.2 `TaskCreateInput`). 이 메서드는 멱등 쓰기(`idempotent: true`)다(ADR-0015 §3.3, REQ-L2-01). requestId(`CallOptions.requestId`)는 `helm:<inquiryId>:cap:task:<findingId>`다. L2.work.spec §3.7은 `work.task_created`의 멱등 키를 `work:tasks:<호출 requestId>`로 두므로 같은 requestId의 두 번째 호출은 새 작업을 만들지 않고 처음 결과를 돌려준다. 키 길이는 최대 `helm:`(5) + 14 + `:cap:task:`(10) + `findingId`(20) = 49자로 64자 안이다.
- 작업 연결 실패: `linkWork`는 발견마다 `Result<TaskId, HelmFailure>`를 얻는다. `capability` 실패(능력 없음, `denied`, `effect_not_allowed` 포함)는 그 발견의 `taskId`를 비우고 다음 발견으로 간다. `lease_lost`면 남은 호출을 멈춘다. 어느 경우든 적용 결과는 바뀌지 않고 `inquiry.finished`의 `outcome`은 `applied`다.
- `inquiry.finished`는 `idle`로 가는 모든 전이에서 1건 쓴다(§4.2).

### 4.9 세션 시작과 재개

- `session.start`(tap)는 상태 복원을 확인만 한다. 마지막 커밋 상태가 `HelmStateSchema`를 통과하는지 본다.
  - 통과하면 아무것도 하지 않는다. 열린 임대가 있으면 X가 drive를 재호출하고, 없으면 X가 Helm을 후보로 삼아 임대를 다시 정한다(X.primitives.spec §4.4.3). 탐구가 없으면 drive는 효과 없이 반환해 임대가 `idle`로 반납된다.
  - 실패하면 `INITIAL_HELM_STATE`로 커밋하고, 탐구 중이었으면 `inquiry.finished`(`failed`, `reason: "state invalid"`)를 쓴다.
- 상태 `version`이 다르면 X가 마이그레이션 훅을 요구한다(F.extensions.spec §3.2 `StateDecl`). 1차는 버전 1뿐이다.
- `reason: "fork"`로 시작한 대화는 원 대화의 상태를 이어받는다 [가정: 분기 시 scope 상태 복사는 X.primitives.spec].

### 4.10 다른 그룹과의 공존

- 다른 그룹이 drive 임대를 가진 동안 Helm은 대기 상태로 남는다. `pending`은 남고 `phase`는 `idle`이다. 쓰기 거부는 걸리지 않는다. 신호 감지(on 핸들러)와 기록은 계속된다. 임대가 풀리면 DriveArbiter가 Helm에 임대를 준다. 대기·거부 정책은 `x.primitives.activeDriveGroup`과 L3.group-kit.spec §3.5가 정한다. 기본 동작은 대기이고 대기 상한을 넘으면 거부한다 [결정: review.m3-design-inputs D-M3-05]. Helm의 처리는 §4.13이다.
- 학습 그룹은 drive를 쓰지 않으므로 Helm 임대 중에도 on, post, 백그라운드 위임으로 동작한다(F.extensions.spec §4.6 [결정]). Helm은 학습 그룹이 꺼져 있어도 같은 동작을 한다(§4.7 저하 동작).
- 두 그룹의 chain 패치는 X의 디스패치 순서대로 합성되고, first 결정은 먼저 거부한 쪽이 정한다(F.extensions.spec §4.2).

### 4.11 효과 목록 적용 (ADR-0015)

[결정: adr.0015] 재실행되는 확장 코드(on 핸들러, drive 함수)의 효과는 ADR-0015 §3.2 표만 쓴다. Helm이 내는 효과 전부를 아래 표에 둔다. 표에 없는 효과(직접 파일·네트워크 I/O, 시각, 난수, 선언 없는 능력 메서드, `g.delegate`)는 Helm에 없다.

| 효과 | 부르는 곳 | 효과 등급 | 멱등 키 | 보장 주체 | 재실행 때 |
|---|---|---|---|---|---|
| `commit`(`updateState`) | on `boundary.settle.after`, on `session.start`, drive 전 분기, 명령 | 기존 규칙 | X 상태 커밋 키 | X | 같은 판의 두 번째 커밋은 `replayed` |
| `record` 3종 | on `boundary.settle.after`(`signal.detected`), drive(`discovery.recorded`, `inquiry.finished`), on `session.start` | 기존 규칙 | X 커밋 키 `rec:<scope 해시>:<dispatchKey>:<n>` | X | 같은 디스패치의 두 번째 기록은 `replayed`. drive의 `discovery.recorded`는 `(inquiryId, findingId)`로 읽는 쪽이 지운다(§4.8) |
| `post` | on `boundary.settle.after`(suggest), drive(알림) | 기존 규칙 | `helm:<inquiryId>:<phase>:<round>[:<종류>]` | L1 입력 큐 | 두 번째 `post`는 `duplicate` |
| `loop.turn` | drive `diverge`, `apply` | 코어 멱등 | `helm:<inquiryId>:turn:<phase>:<round>` | L1.loop | 기록된 `TurnOutcome`을 돌려받는다 |
| `loop.spawn` | drive `explore` | 코어 멱등 | `helm:<inquiryId>:spawn:<round>:<lensId>` | L1.agents(`creationKey`, 세션 DB) | 기록된 `SpawnOutcome`을 돌려받는다. 재시작 뒤에도 같다(REQ-L1-01) |
| 읽기 능력 호출 4종 | drive `converge`(`gatherContext`) | 읽기(`readOnly`) | 없음 | 필요 없음 | 다시 호출한다. 결과는 `converged` 커밋으로 고정한다 |
| `work.tasks.create` | drive `apply`(`linkWork`) | 멱등 쓰기(`idempotent`) | `helm:<inquiryId>:cap:task:<findingId>` | L2.work(`work:tasks:<requestId>` 내구 기록) | 처음 결과를 돌려받는다 |

- on 핸들러와 `lease.rejected` 구독 핸들러의 효과는 `commit`, `record`, `post` 세 가지다(구독 핸들러는 `commit`과 `post`만 쓴다). on 핸들러에서 능력 메서드(읽기 포함)와 `g.delegate`를 부르지 않는다. 신호 판정에 필요한 입력은 지점 페이로드에서만 얻는다(§4.3).
- 명령 처리기(`runHelmCommand`)는 재실행되는 코드가 아니므로 ADR-0015 대상이 아니다(ADR-0015 §3.1). 그래도 효과는 `updateState`와 `post`뿐이다.
- 이전 판의 미결 C2는 이 표로 닫는다. Helm은 F 문장에 새 예외를 요구하지 않는다. 필요한 것은 ADR-0015 §4.3의 F·X·L1·L2 반영이다(§8 요구 표).

재생 2회, 효과 1회 시험 [결정: adr.0015 §3.6] [제안: 세부]:

1. `replayDrive`(L3.group-kit.plan G-20 확장)로 UC-2 기준 실행의 모든 커밋 지점에서 끊고, 끊기 직전의 drive 호출과 on 핸들러를 두 번 실행한 뒤 재개한다.
2. 가짜 포트의 효과 계수기로 아래 값을 확인한다. 반환값 비교만으로는 통과로 보지 않는다.

| 계수 | 기대값(렌즈 3개, `followUp` 2개, 모든 렌즈 성공) |
|---|---|
| 새 `loop.turn` 실행 | 2(`diverge` 1, `apply` 1) |
| 새 `loop.spawn` 실행 | 3 |
| 새 작업 생성(`work.tasks.create` 처음 결과) | 2 |
| 새 `post`(`duplicate` 아님) | 탐구 종료 알림 1 |
| `grp.helm.inquiry.finished` 새 기록 | 1 |
| 읽기 능력 호출 | 세지 않는다(효과가 아님). 단 `converged` 커밋 뒤 끊은 경우 0회 더 |

3. 같은 시험을 `apply` 분기의 `recordDiscoveries`와 `linkWork` 사이, `linkWork`와 `applied` 커밋 사이에서 끊는 경우로 반복한다. 작업은 2개를 넘지 않는다.

### 4.12 실패 처리 (Result kind별)

`HelmFailure` kind마다의 처리다. `reactionOf`가 이 표를 코드로 옮기고, 테스트는 모든 kind × 단계 쌍을 열거한다(plan `failures.reaction-covers-all-kinds`).

| kind | 원천 | 처리(`HelmReaction`) | 결과 기록 | 사용자 표시 |
|---|---|---|---|---|
| `lease_lost` | `PrimitiveError` `lease_inactive`·`lease_revoked`, `CapabilityError` `aborted`, `loop.signal` 중단 | `yield`: 커밋 없이 반환. X가 임대를 다시 주면 같은 단계에서 이어 간다 | 없음(X가 `lease.released` 기록) | `/helm status`의 `lease` |
| `budget` | `LeaseBudget` 0, `PrimitiveError` `lease_budget` | `finish`(`limitReached`) → `idle` | `inquiry.finished`(`limit`, `limit` 필드). `apply`에서면 발견을 `applied: false`로 기록 | 상한 알림 `post` |
| `state_conflict` | `PrimitiveError` `state_conflict`(두 번째) | `yield`. `updateState`가 이미 한 번 다시 시도했다 | 없음 | 없음. 다음 경계에서 다시 시도한다 |
| `state_too_large` | `PrimitiveError` `state_too_large` | `finish`(`failed`) | `inquiry.finished`(`failed`, `reason: "state too large"`) | 종료 알림 |
| `storage` | `PrimitiveError` `storage_unavailable` | `yield` | 없음(쓸 수 없다) | X 운영 알림이 맡는다 |
| `disabled` | `PrimitiveError` `scope_inactive` | `yield` | 없음. 다시 켜면 커밋된 단계에서 이어 간다(§5 5번) | 없음 |
| `capability` | `CapabilityError` 전 코드(`aborted` 제외), `capability_unavailable`, `effect_not_allowed` | `degrade`: 그 출처(`web`, `knowledge`, `session`, `work`)만 건너뛴다 | `KnowledgeDigest.degraded`, 발견의 `taskId` 비움 | explorer 과제의 고지(§4.7), 종료 알림의 저하 목록 |
| `turn` | `TurnOutcome.status` `aborted`·`error` | `finish`(`failed` 또는 `stopRequested`) | `inquiry.finished`(`aborted`면 `stopped`, `error`면 `failed`) | 종료 알림 |
| `spawn` | `SpawnOutcome.status` `aborted`·`error`, spawn 거부 | 렌즈 `failed`. 하나라도 `done`이면 수렴(§4.2) | `inquiry.finished.failedLenses` | 부분 실패 알림 |
| `state_inconsistent` | `activeInquiry` 실패, `session.start` 검증 실패 | `finish`(`failed`) → 초기 상태 | `inquiry.finished`(`failed`, `reason`에 `detail`) | 종료 알림 |

- `CapabilityError`의 `retryable`(`rate_limited`, `timeout`)도 Helm은 다시 부르지 않는다 [제안]. 다시 부르면 재생 경로와 비용이 늘고, 읽기 출처 하나가 빠져도 탐구는 끝난다. 재시도는 L2 provider 안에서 한다.
- `budget`과 `turn`은 탐구를 끝내지만 drive 함수는 정상 반환한다. drive 예외(F.extensions.spec §5 6번)는 `failureOf`가 모르는 예외에만 생긴다.
- 실패를 버리는 경로는 없다. 모든 kind는 전이, 기록, 상태 표시 가운데 하나 이상으로 이어진다.

### 4.13 사용자 결정에 따른 동작

| 결정 | 동작 |
|---|---|
| D-M3-01 c 형태와 기본 켬 | 기본 플러그인. 설치되어 있으면 켜고(`defaultEnabled: true`), 외부 확장 로더가 `user` 등급으로 싣는다(§3.1) |
| D-M3-05 a 임대 충돌 | 대기. 다른 그룹이 임대를 가진 동안 `pending`을 유지한다(§4.10). 대기 상한을 넘어 X·group-kit이 요청을 거부하면 내구 이벤트 `lease.rejected`가 커밋된다. Helm은 이 이벤트의 구독 핸들러(페이로드만 입력, §7)에서 `pending`을 지우고 "임대 대기 상한" 알림을 `post`한다(`requestId: helm:<inquiryId>:idle:0:rejected`) [제안] |
| D-M3-06 a 유휴 자율 turn | 허용. 사용자 turn 뒤에도 탐구가 임대 상한 안에서 이어진다(§4.5) |
| D-M3-07 a 안전 모드 | Helm을 적재하지 않는다(§3.1). 상태는 남는다 |
| D-M3-04 b 그룹 끄기 때 진행 중 위임 | Helm은 `g.delegate`를 쓰지 않으므로 취소할 위임이 없다. 임대 안의 `loop.turn`·`loop.spawn`은 UC-2 대안 흐름대로 정착까지 진행한다 |
| D-M3-17 알림 | 탐구 종료·상한 알림은 `post`(`display: true`)로 대화에 남긴다. 연결된 클라이언트 알림과 OS 알림은 L4 알림 경로가 `grp.helm.inquiry.finished` 기록을 보고 보낸다. 클라이언트 창이 앞에 있어도 기본으로 보내고 설정으로 끈다. 웹·모바일 푸시는 후순위이고 들어와도 Helm 코드는 같다 |

- 대기 거부를 알리는 값 [제안]: 핸들러는 `GroupStatus.drive`처럼 커밋되지 않은 런타임 값을 읽지 않는다. on 핸들러의 입력은 지점 페이로드뿐이라는 규칙(§4.11, ADR-0015 §3.2)을 지키기 위해서다. 거부는 내구 이벤트 `lease.rejected`(페이로드 `groupId`, `reason`, 거부된 요청의 `requestSeq`)로 커밋되고, Helm은 이 이벤트의 구독 핸들러만으로 처리한다. 구독 수단은 학습 그룹의 `agent.settled` 구독과 같은 것을 쓴다(L3.learning.spec §8.1 REQ-LN-02). `GroupStatus.drive`의 `"rejected"`(와 거부 사유)는 `/group status` 같은 화면용이고 group-kit이 더한다(§8, G-IN-04, REQ-X-08). 두 요구는 `lease.rejected` 이벤트와 `GroupStatus.drive` 값을 F·X·group-kit에 더하는 하위 층 작업이다.

## 5. 실패와 경계 사례

| # | 상황 | 동작 |
|---|---|---|
| 1 | 서브에이전트 일부 실패(`SpawnOutcome.status`가 `error`·`aborted`, 또는 spawn 예외) | 그 렌즈는 `failed`. 하나라도 `done`이면 수렴으로 간다. 실패 수는 `inquiry.finished.failedLenses`에 남고, 부분 실패 알림을 `post`한다 |
| 2 | 모든 렌즈 실패 | `idle`(`failed`). 적용 turn 없음 |
| 3 | 임대 상한 도달 | §4.5. `inquiry.finished`(`limit`)와 알림 `post`(`requestId: helm:<inquiryId>:<phase>:<round>:limit`). 상한 이름과 남은 단계를 표시한다 |
| 4 | 사용자 `/helm stop` | `stopRequested`를 커밋한다. 실행 중인 `loop.turn`·`loop.spawn`은 끊지 않는다. drive가 다음 호출에서 `idle`(`stopped`)로 간다. 임대가 없으면(대기 중) `pending`을 지운다 |
| 5 | 단계 경계에서 disable(`/group off helm`, `ext.helm.enabled` 거짓) | X 순서: on 핸들러 제외 → 임대 반납 → 정리(F.extensions.spec §4.5). 상태는 그대로 남는다. 다시 켜면 Helm이 다시 후보가 되고 임대를 받으면 drive가 커밋된 단계에서 이어 간다. 꺼진 동안 쓰기 거부는 걸리지 않는다 |
| 6 | 다른 그룹이 임대를 가짐 | §4.10. 대기. on 핸들러만 동작. `/helm status`가 `lease: "waiting"`과 보유 그룹을 보여 준다 |
| 7 | 프로세스 강제 종료 뒤 재개 | §4.5 재개. drive는 마지막 커밋 상태로 재호출된다. 커밋 전 spawn 결과는 같은 requestId로 다시 수집한다. 적용 turn은 같은 requestId라 다시 실행되지 않는다 |
| 8 | drive 함수 예외 | X가 임대를 반납하고 drive 등록을 오류로 표시한다(F.extensions.spec §5 6번). 상태는 남는다. `/helm status`가 오류를 보여 준다. 재시도는 X.primitives.spec |
| 9 | `tool.call.before` 핸들러 예외 | 거부로 환산(F.extensions.spec §4.1). 단계와 상관없이 그 호출은 실행되지 않는다 |
| 10 | 신호 핸들러 예외 | tap 규칙: 기록 후 계속. 신호 하나를 놓칠 수 있다 |
| 11 | chain 핸들러 예외 | 그 패치만 버린다. 해당 turn에 렌즈 블록이 빠진다 |
| 12 | explorer 답이 형식 위반 | `parseExplorerAnswer`가 답 전체를 `low` 신뢰 발견 1건으로 바꾼다. 답이 없으면 렌즈 `failed` |
| 13 | `maxLenses` > 남은 spawn 예산 | §4.2 explore 행. 앞 렌즈만 실행하고 나머지 `skipped` |
| 14 | 탐구 중 `/helm start` | 오류 응답("이미 탐구 중"). 상태를 바꾸지 않는다 |
| 15 | `idle`에서 drive가 호출됐고 `pending`이 없음 | 효과 없이 반환한다. 같은 상태 판으로 두 번이면 X가 임대를 `idle`로 반납한다(F.extensions.spec §5 7번, X.primitives.spec §4.4.3). Helm은 다음 `turn_settled`나 상태 판 변경 뒤 다시 후보가 된다. 임대 필요 판정 훅은 두지 않는다(§3.3) |
| 16 | 상태 검증 실패 | §4.9. `state_inconsistent`(§4.12) |
| 17 | X 능력 래퍼가 읽기 호출을 `effect_not_allowed`로 거부(L2 정의에 `readOnly` 선언이 아직 없음) | `capability` 실패로 그 출처를 건너뛴다(§4.12). 탐구는 끝난다. 시험 `knowledge.undeclared-method-degrades`가 이 경로를 확인한다 |
| 18 | `work.tasks.create`에 `idempotent` 선언이 없음 | X가 `effect_not_allowed`로 거부한다. 작업 연결만 빠지고 발견 기록은 남는다 |
| 19 | 상태 커밋 판 충돌(`state_conflict`) | `updateState`가 한 번 다시 읽어 적용한다. 다시 충돌하면 `yield`(§4.12) |
| 20 | 임대 대기 상한 초과로 요청 거부 [결정: review.m3-design-inputs D-M3-05] | `pending`을 지우고 알림을 `post`한다(§4.13) |
| 21 | 도구 메타(`risk`)가 페이로드에 없음 | 쓰기로 본다. 확산 단계에서 읽기 도구도 거부되고 `/helm status`가 경고한다(§4.6) |
| 22 | 안전 모드로 시작 [결정: review.m3-design-inputs D-M3-07] | Helm이 적재되지 않는다. 상태는 그대로 남고 일반 모드로 다시 시작하면 커밋된 단계에서 이어 간다 |

## 6. 설정 노출

`defineSettings("l3.helm", …)`로 선언한다(F.wire-settings.spec §3.8.3). 탭은 `plugins`다. 키는 공통 확정 이름이다.

| 키 | 타입 | 기본값 | 범위 | runtimeChange | allowedScopes | 위젯 |
|---|---|---|---|---|---|---|
| `l3.helm.autoStart` | `"off" \| "suggest" \| "auto"` | `"suggest"` [제안] | enum 3개 | `nextTurn` | managed, user, project, local, session | select |
| `l3.helm.driveLimits` | `DriveLimits`(`{ maxTurns?, maxSpawns?, maxTokens? }`) | `{ maxTurns: 4, maxSpawns: 8, maxTokens: 400000 }` [결정: review.decisions-2 U-12] | 각 필드 1 이상 | `nextTurn`(다음 임대 획득 때) [가정] | managed, user, project, local, session | table |
| `l3.helm.maxLenses` | integer | `3` [제안] | 1~8 | `nextTurn`(다음 탐구 시작 때) | managed, user, project, local, session | number |
| `l3.helm.writeGuard` | boolean | `true` | | `nextTurn` | managed, user, project, local, session | toggle |

```ts
// src/settings.ts
export const AutoStartSchema = Type.Union([Type.Literal("off"), Type.Literal("suggest"), Type.Literal("auto")]);
export type AutoStart = Static<typeof AutoStartSchema>;

export const helmSettings: SettingGroup<"l3.helm", {
  autoStart: SettingDefInput<typeof AutoStartSchema>;
  driveLimits: SettingDefInput<TSchema>;
  maxLenses: SettingDefInput<TInteger>;
  writeGuard: SettingDefInput<TBoolean>;
}>;

export interface HelmSettings {
  readonly autoStart: AutoStart;
  readonly driveLimits: DriveLimits;
  readonly maxLenses: number;
  readonly writeGuard: boolean;
}
```

- `driveLimits.maxTurns` 기본 4는 발산 1, 적용 1에 여유 2를 둔 값이다. `maxSpawns` 기본 8은 `maxLenses` 상한과 같다. 이 기본값은 pi 방식(기본 상한 없음)의 예외다 [결정: review.decisions-2 U-12]. drive는 사용자 입력 없이 턴을 만들기 때문에 상한이 없으면 끝나지 않을 수 있다. 사용자는 설정 화면 `plugins` 탭에서 이 값을 조정한다. 이 키가 X 일반 기본값 `x.primitives.driveDefaultLimits`를 Helm에 한해 덮어쓴다. 일반 대화 턴에는 상한을 두지 않는다.
- `maxLenses`가 `driveLimits.maxSpawns`보다 크면 설정 저장 때 경고하고, 실행 때는 §4.2 explore 행 규칙으로 처리한다.
- Helm 켜기·끄기 키는 X 로더 예약 키 `ext.helm.enabled` 하나다(F.extensions.spec §6, X.loading-trust.spec §4.5, F.wire-settings.spec §3.8.3). 플러그인과 L3 그룹이 모두 이 키를 쓰고 Helm은 이 키를 `defineSettings`로 선언하지 않는다. 기본값은 매니페스트 `defaultEnabled`(§3.1)가 정한다. 값 속성은 X.loading-trust.spec §6 정의를 따른다: `runtimeChange` `live`(요청을 기록하고 적용은 다음 단계 경계), `allowedScopes` managed~session [결정: review.decisions-2 K-04].
- L4 노출: 설정 화면 "플러그인과 그룹" 탭의 Helm 항목, 설정 파일, `/helm` 명령(§3.9). `/group on|off|status`는 group-kit 소유다.
- 비밀 설정은 없다.
- 마일스톤: M2 코드(`xeon/packages/group-helm/src/settings.ts`)는 `driveLimits` 하나만 선언한다. 나머지 세 키는 M3-04로 더한다.

## 7. 확장 지점

| 연산 | 지점·대상 | fold | Helm의 쓰임 | 효과 |
|---|---|---|---|---|
| `on` | `input.agent.before` | collect | 탐구 단계 블록 주입, `idle`에서 용어 후보 메모리 집계 | 패치(커밋 없음) |
| `on` | `tool.call.before` | first | 확산 단계 쓰기 거부 | 결정 |
| `on` | `tool.execution.after` | tap | `stuck`, `repeat` 입력 메모리 집계(§4.3) | 없음 |
| `on` | `boundary.settle.after` | tap | 신호 판정과 기록, `autoStart` 처리, turn당 1회 커밋 | commit, record, post(suggest) |
| `on` | `session.start` | tap | 상태 복원 확인 | commit, record(검증 실패 때만) |
| 구독 | 내구 이벤트 `lease.rejected` [제안] | | 대기 거부 처리(§4.13). 입력은 이벤트 페이로드뿐 | commit, post |
| `post` | 입력 큐 | | 제안, 알림 | requestId 멱등 |
| `drive` | 임대 | | 단계 머신(§4.5) | `loop.turn`, `loop.spawn`, `post`, `commit`, `record`, 읽기 능력 호출, 멱등 쓰기 능력 호출(§4.11) |
| `scope` | `helm` | | 상태 문서 `HelmState`, 켜기·끄기 | |

- 지점 이름은 F.extensions.spec §3.4 표의 이름이다. 사용자 의사코드의 `request`, `tool.before`, `turn.end`는 쓰지 않는다. `request` 형성은 `input.agent.before`로 옮겼다. 시스템 프롬프트를 turn 시작 때 한 번 바꾸면 그 turn의 모든 step 요청에 같은 블록이 실리기 때문이다 [제안]. 관찰은 `boundary.step.after`(Xeon step 끝) 대신 `tool.execution.after`와 `boundary.settle.after`(둘 다 tap)를 쓴다. `boundary.step.after`는 chain이고 경계 엔트리를 다루는 지점이라 관찰 용도에 맞지 않는다. L3.slots.spec의 템플릿과 예(§3.1.5, §3.3.5)도 같은 권장안을 따른다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| 레코드 kind `grp.helm.signal.detected`, `grp.helm.discovery.recorded`, `grp.helm.inquiry.finished`와 payload 스키마 | L4.settings-ui.spec·L4.cli.spec(상태 표시) |
| 설정 키 `l3.helm.*` 4개 | L4.settings-ui.spec, F.wire-settings.spec 카탈로그 |
| 명령 `/helm start\|stop\|status`, `HelmStatusView` | L4.cli.spec, L4.desktop.spec |
| `customType` `grp.helm.notice.suggested`, `grp.helm.notice.status` | L4(표시), F.conversation.spec `XeonCustomMessage` |
| 서브에이전트 정의 이름 `explorer` | L1.agents.spec |
| `helmGroup`(GroupModule), 플러그인 산출물(`.xeon-plugin/plugin.json`, 엔트리 번들) | X.loading-trust.spec 외부 확장 로더, L4 릴리즈(첫 실행 설치) |

요구:

| 이름 | 출처 | 상태 | 요구 ID(`review.m3-design-inputs` §4.4) |
|---|---|---|---|
| `ScopeApi`, `DriveFn`, `LoopHandle`, `DriveOptions`, `PostItem`, `ToolCallDecision`, `RecordKindDecl`, 지점 페이로드 | F.extensions.spec | 확정(M1 지점) | — |
| 효과 목록을 ADR-0015 표로 바꾸고 `LoopHandle` 주석("유일한 통로")을 고친다. `requestId` 결정성 규칙 | F.extensions.spec §3.2, §4.3, §4.6 | 요구 | REQ-F-02 |
| `MethodDef.idempotent?: true`, 읽기 표지(`readOnly` 또는 `effect` 열거), `validateCapability` 코드, 공통 오류 `effect_not_allowed` | F.capabilities.spec §3.2, §3.6 | 요구 | REQ-F-01 |
| `ToolCallPayload`에 `risk`, `hints`, `caller`. `tool.execution.after`에 `input` | F.records.spec, F.extensions.spec §3.4, L1.tools.plan(M3-02) | 요구. Helm 쓰기 판정(§4.6)과 `repeat` 신호(§3.5)의 입력 | REQ-F-04 |
| `input.agent.before` 페이로드(`prompt`, `systemPrompt`)와 패치(`systemPrompt`) 필드 | F.extensions.spec §3.4 3행 | 요구. 지금은 pi 형태를 [가정] | REQ-F-05 |
| `ReplayPolicy` 값 이름은 `safe\|unsafe` 유지 [결정: review.m3-design-inputs D-M3-31] | F.records.spec | 확정. Helm은 이름에 기대지 않는다 | REQ-F-03 |
| 능력 래퍼의 문맥 검사(on에서 능력 호출 거부, drive에서 선언 없는 메서드 거부), `effects` 계수 규칙 | X.primitives.spec §4.4.3, §4.4.4, §4.6 | 요구 | REQ-X-01 |
| `ScopeApi.commit`의 같은 프로세스 직렬화(`expectStateRev` CAS와 `state_conflict`는 이미 있다) | X.primitives.spec §4.6.1 | 요구. 정해지면 `updateState` 큐를 지운다(§4.1) | REQ-X-02 |
| `record`와 `commit` 원자 묶음 | X.primitives.spec, F.extensions.spec | 요구. 없는 동안 `findingId` 중복 제거(§4.8) | REQ-X-03 |
| 재시작 뒤 `leaseId` 유지 | X.primitives.spec | Helm은 명시 키로 기대지 않는다(§4.5) | REQ-X-04 |
| 대기 기본, 대기 상한, 거부 통지, 유휴 자율 turn, 안전 모드의 L3 그룹(D-M3-05·06·07 결정 반영) | X.primitives.spec §4.5.5, X.operations.spec, L3.group-kit.spec §3.5, §3.8 | 요구. 내구 이벤트 `lease.rejected`와 화면용 `GroupStatus.drive` `"rejected"`를 더한다(§4.13) | REQ-X-08, G-IN-04 |
| 서비스 키 A안 래퍼 | X.primitives.spec, F.extensions.spec | 요구. Helm은 `g.capability(key)`만 쓴다 | REQ-X-09 |
| `tool.call.before` 지점과 정책·승인·샌드박스의 처리 순서 | X.operations.spec, L1.tools.spec | 요구. §4.6 처리 순서 [가정] | REQ-X-11 |
| 외부 확장 로더(자체 API), 기본 플러그인의 첫 실행 설치, `@xeon/contracts`·`@xeon/group-kit`·`typebox` 가상 모듈 등록 | X.loading-trust.spec §4.2, §4.10.6, `review.m3-plan` M3-15 | 요구 [제안]. 없으면 Helm을 적재할 수 없다(§3.1) | M3-15 |
| `defineGroup`, `GroupApi.settings()`·`registerCommand`, `DriveArbiter`, `replayDrive`(G-20 효과 계수), `scanDriveSource`, `GroupStatus` | L3.group-kit.spec §3.2, §3.5, §3.8, §3.10, §3.11 | 문서 있음. G-20 효과 계수는 ADR-0015 §4.3 반영 대기 | G-IN-02 |
| `loop.spawn`의 (thread, `requestId`) 멱등을 세션 DB에 남겨 재시작 뒤에도 유지 | L1.agents.spec, L1.loop.spec §4.8 | 요구. 지금은 프로세스 메모리 64개 | REQ-L1-01 |
| 자식 대화의 지점 발화와 그룹 핸들러 적용 범위 | L1.agents.spec | 요구. Helm은 `caller`로 대상을 고르고 explorer 도구 상한으로 보강한다(§4.6) | REQ-L1-04 |
| `explorer` 정의 형식과 확장 경로 적재, 권한 상한 | L1.agents.spec §4.3, §4.9 | 문서 있음 | — |
| 그룹 정의 모델 역할을 두지 않음 | L1.models.spec | 요구(문서 표기) | REQ-L1-06 |
| `web.search`(읽기), `knowledge.search`·`knowledge.skills.view`·`knowledge.memory.read`(읽기), `work.tasks.create`(멱등 쓰기)의 효과 등급 선언과 내구 멱등 근거 | L2.web.spec, L2.knowledge.spec, L2.work.spec | 요구 | REQ-L2-01 |
| 비공개 상태 저장(`grp.helm.state.committed`, `x_helm_state`), 비공개 기록(`recordPrivate`) | X.primitives.spec §4.6.1, §4.6.5, review.decisions-2 T-20, T-21 | 확정. Helm은 `recordPrivate`를 쓰지 않는다 | REQ-X-06 |

## 9. 수용 기준

모두 테스트로 확인한다. 테스트 이름은 L3.helm.plan §5.

1. (UC-2) Helm이 확산 단계(`diverge`, `explore`)일 때 `risk`가 `read`가 아닌 도구 호출(`bash` 포함)은 실행되지 않고 거부 사유가 모델에 돌아간다. 같은 호출은 Helm을 끈 다음 turn에서 실행된다.
2. (UC-2) 렌즈 N개로 탐구하면 서브에이전트 N개가 시작되고, 결과 커밋 이벤트 뒤에 적용 turn이 정확히 한 번 실행된다.
3. drive 함수를 같은 커밋 상태로 두 번 호출하거나 `explore` 단계에서 프로세스를 끊고 재호출해도 렌즈마다 `loop.spawn`은 한 번만 실행되고 적용 turn도 한 번만 실행된다.
4. 학습 그룹이 꺼져 있거나 설치되지 않아도 탐구가 `applied`로 끝난다. Helm은 학습 그룹 레코드를 읽지 않으므로 `gatherContext` 결과는 학습 그룹 유무와 상관없이 같다.
5. 다른 그룹이 임대를 가진 동안 Helm은 `phase: "idle"`, `pending`을 유지하고, 같은 기간에 `stuck` 신호를 만드는 도구 오류 열이 들어오면 `grp.helm.signal.detected`가 기록된다. 쓰기 도구 호출은 거부되지 않는다.
6. `l3.helm.writeGuard`가 거짓이면 확산 단계에서도 쓰기 도구 호출이 거부되지 않는다.
7. `tool.call.before` 핸들러가 예외를 내면 그 호출은 거부된다.
8. 신호 핸들러를 같은 페이로드로 두 번 실행해도 `watch` 카운터와 `signal.detected` 기록 수가 한 번 실행한 것과 같다.
9. `transition`은 §4.2 표에 있는 모든 (단계, 이벤트) 쌍에서 표의 다음 단계를 돌려주고, 표에 없는 쌍에서는 같은 상태를 돌려준다.
10. 렌즈 3개 중 1개의 spawn이 `error`면 렌즈 상태는 `done` 2, `failed` 1이고 적용 turn이 실행되며 `inquiry.finished.failedLenses`는 1이다.
11. `maxSpawns`가 2이고 렌즈가 3개면 spawn은 2번, 렌즈 하나는 `skipped`이고 상한 알림이 1번 `post`된다. `maxTurns` 소진 시 `inquiry.finished.outcome`은 `limit`이다.
12. 단계 경계에서 disable하면 `lease.released`(`disabled`)가 한 번 기록되고, 다시 켜면 같은 `inquiryId`와 단계에서 이어진다.
13. `grp.helm.discovery.recorded` payload가 `DiscoveryRecordedPayloadSchema`와 F `validateGroupRecord`를 통과한다. `helmManifest`가 `validateManifest`와 `validateUsage`를 통과한다.
14. `web.search` provider가 없어도 탐구가 끝나고 `degraded`에 `web`이 들어간다.
15. `group-helm` 패키지의 import 대상은 `@xeon/contracts`, `@xeon/group-kit`, `typebox`뿐이다(check-layers). Helm 그룹 코드를 추가하는 변경에서 `contracts`, `ext-host`, `group-kit` 경로의 diff가 0이다(product.vision.spec S1). 이 항목은 하위 층 요구(§8 요구 표: REQ-F-01·04, X 능력 래퍼, group-kit의 `rejected`·G-20)를 먼저 별도 작업으로 반영한 뒤에 확인한다. 요구 반영 작업의 diff는 이 기준의 대상이 아니다(`L3.helm.plan` §6 3번과 같은 조건).
16. (ADR-0015) UC-2 기준 실행의 모든 커밋 지점에서 끊고 drive와 on 핸들러를 두 번 실행한 뒤 재개해도 효과 계수가 §4.11 표의 기대값과 같다(새 turn 2, 새 spawn 3, 새 작업 2, 종료 알림 1, `inquiry.finished` 1).
17. 쓰기 판정은 §4.6 표를 따른다. `risk: read`는 허용, `write`·`exec`·없음은 거부, `hints.readOnly: true`이고 `risk: exec`이면 거부, `caller`가 `subagent:explorer`가 아닌 서브에이전트면 허용이다.
18. 탐구 단계의 `input.agent.before` 패치는 `payload.systemPrompt`(collect라 핸들러는 원본을 본다) 뒤에 Helm 블록 하나를 붙이고, 렌즈 본문을 둘 이상 넣지 않는다.
19. [결정: review.m3-design-inputs D-M3-05] 임대 대기가 거부되어 `lease.rejected`가 커밋되면 구독 핸들러가 `pending`을 지우고 거부 알림을 한 번 `post`한다. 같은 이벤트로 핸들러를 다시 실행해도 알림은 `duplicate`다. 핸들러는 `GroupStatus`를 읽지 않는다.
20. `reactionOf`는 모든 `HelmFailure` kind와 단계 쌍에서 §4.12 표의 처리를 돌려준다. `failureOf`가 모르는 예외는 다시 던져지고 drive 등록이 `group.driveThrew`로 표시된다. 예상 가능한 실패로 drive가 예외를 내는 경로는 없다.
21. on 핸들러 실행 중 능력 호출 수는 0이다. drive의 능력 호출은 `readOnly` 또는 `idempotent` 선언 메서드뿐이고, 선언 없는 메서드를 가진 가짜 provider로 바꾸면 X 래퍼가 `effect_not_allowed`로 거부하며 탐구는 저하 동작으로 끝난다.
22. 탐구 단계인데 `inquiryId`가 `null`인 상태로 drive를 부르면 예외 없이 `inquiry.finished`(`failed`)가 기록되고 상태가 초기값이 된다.

## 10. 미결 사항

M3 판에서 닫은 항목:

- (닫힘) 이전 미결 3 부분 결과: 허용(§4.2) [제안].
- (닫힘) 이전 미결 7 `leaseId` 유지: Helm은 명시 키를 쓰므로 기대지 않는다(§4.5). X 쪽 답은 REQ-X-04.
- (닫힘) 이전 미결 8 쓰기 판정 메타 출처: `ToolCallPayload.risk`·`hints`·`caller`(§4.6, REQ-F-04, M3-02).
- (닫힘) 이전 미결 9: [결정: review.decisions-2 D-10] 다른 그룹 레코드는 읽지 않는다(§4.7).
- (닫힘) 이전 미결 11 work 연결: `work.tasks.create` 멱등 쓰기(§4.8).
- (닫힘) 이전 미결 12 켜기·끄기 키: `ext.helm.enabled`(§6).
- (닫힘) 이전 미결 16 식별자와 전이표: 이 판으로 고정한다(§3.2) [제안]. 바꾸려면 상태 버전을 올린다.
- (닫힘) C1 서비스 키: A안(§3.8, `review.m3-design-inputs` §3.8 A-01).
- (닫힘) C2 효과 목록: [결정: adr.0015] C안. Helm의 효과 전부를 §4.11에 적었다.
- (닫힘) C3 `xeon.domain`: Helm은 `group-helm` → `helm`으로 두 규칙의 값이 같다. group-kit 쪽 값은 M3-35가 정한다.
- [결정: review.decisions-2 T-21] 레코드 kind 접두: 공개·비공개 모두 `grp.<그룹>.<영역>.<이름>`이다.

사용자 결정으로 닫은 항목(`review.m3-design-inputs` §3, 2026-10-26):

1. (닫힘) [결정: review.m3-design-inputs D-M3-01] 형태: 기본 플러그인, 설치되어 있으면 켬(§3.1, §4.13).
2. (닫힘) [결정: review.m3-design-inputs D-M3-05] 임대 충돌: 대기, 상한 뒤 거부(§4.13).
3. (닫힘) [결정: review.m3-design-inputs D-M3-06] 유휴 자율 turn: 상한 안에서 허용(§4.5, §4.13).
4. (닫힘) [결정: review.m3-design-inputs D-M3-07] 안전 모드: 적재하지 않음(§3.1, §4.13).
5. (닫힘) [결정: review.m3-design-inputs D-M3-17] 알림: 연결된 클라이언트와 OS 알림, 창이 앞이어도 기본 보냄. Helm 코드 영향은 없다(§4.13).

남은 내부 설계:

6. [미결] 렌즈 제안 경로(모델이 발산 turn에서 렌즈를 고르는 그룹 전용 도구)와 렌즈 내용 조정. M3는 `BUILTIN_LENSES` 6개와 신호별 우선순위로 고른다(§3.6). 2차.
7. [미결] 다회 라운드와 종료 판정 모델. M3는 적용 1회(§4.2). 2차.
8. [미결] 신호 임계의 설정 노출. M3는 고정값(§3.5). 계측(M3-new-09) 뒤 정한다.
9. [미결] 단계별 프롬프트 문구 본문과 explorer 정의 본문. 구현 작업 H-07에서 쓴다.
10. [미결] 탐구가 없을 때 turn마다 생기는 임대 부여·`idle` 반납 비용(§3.3, H-IN-15). M3 구현 뒤 turn당 `lease.*` 이벤트 수를 재고, 문제가 되면 X에 후보 제외 조건을 요청한다.
11. [가정] `tool.call.before` 지점이 정책·승인보다 먼저 디스패치된다(§4.6, REQ-X-11).
12. [가정] 지식 검색 도구 결과의 빈 결과 판정 형식(§3.5). L2.knowledge.spec과 맞춘다.
13. [제안] 플러그인이 된 Helm의 설정 네임스페이스. F.wire-settings.spec §3.8.3 규칙 2는 확장이 코어 네임스페이스에 키를 더하지 못하게 한다. 설정 정의는 호스트 카탈로그가 `@xeon/group-helm`의 `helmSettings`로 정적으로 싣고 키 이름 `l3.helm.*`를 유지한다(M2 키 `l3.helm.driveLimits`와 같다). 켜기·끄기는 X 예약 키 `ext.helm.enabled`를 쓴다(C5, 2026-10-28 기본값). 다른 안 `ext.helm.*`은 채택하지 않는다. 기본값이며 사용자 결정은 아니다.
14. [미결] 플러그인 엔트리의 가상 모듈 의존(§3.1 의존 해석). X 로더가 자체 패키지를 가상 모듈로 등록하는 방식이 같은 모듈 인스턴스를 주는지는 X.loading-trust 스파이크에서 확인한다 [가정].

하위 층 반영 대기(§8 요구 표): REQ-F-01, REQ-F-02, REQ-F-04, REQ-F-05, REQ-X-01, REQ-X-02, REQ-X-03, REQ-X-08, REQ-X-09, REQ-X-11, REQ-L1-01, REQ-L1-04, REQ-L2-01, G-IN-02, `lease.rejected` 이벤트, `GroupStatus.drive`의 `"rejected"`.
