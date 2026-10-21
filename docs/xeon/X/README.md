---
id: X.readme
layer: X
domain: readme
kind: readme
status: draft
depends_on: [X.loading-trust.spec, X.primitives.spec, X.operations.spec, F.extensions.spec]
binds: [xeon/packages/ext-host/**]
---

# X 확장 체계 층

## 1. 목적

X는 F 다음 순위(1)의 확장 체계 층이다. L1~L3의 플러그인과 의도 그룹이 루프에 붙는 장치를 맡는다(`architecture.layers.spec` §4.1, §4.4 X 항목).

- 네 연산의 실행: on(fold `tap`/`first`/`chain`), post, drive(배타 임대), scope. [결정] 확장 지점은 이 네 연산이다(`_research/decisions-log.md` 2026-10-21 계획 v2, adr.0007).
- 확장의 탐색·검증·로딩과 신뢰 판정, 선택적 프로세스 격리(2차), pi 확장 어댑터.
- 운영 규칙: 실행 순서 tier, 핸들러 시간 예산, 실패 격리와 자동 끄기, 확장 전용 저장 영역, 이름 충돌, 안전 모드, 외부 훅.
- [결정] DI는 Cordis 하나이고 `ext-host` 뒤에 숨긴다. Cordis를 import하는 패키지는 `ext-host` 하나다(adr.0002, `eng.dependency-rules.guide` DR-11). 다른 층은 `@xeon/ext-host`의 공개 API와 F 타입만 본다.

X가 정하지 않는 것:

| 대상 | 정하는 곳 |
|---|---|
| 지점 이름 41개, fold 배정, 페이로드·결정·패치 타입, `FIRST_DENY`, `CHAIN_RULES`, 매니페스트 스키마 | `F.extensions.spec` |
| 지점을 실제로 발화하는 코드, boundary 최종 검증 | `L1.loop.spec`, `L1.tools.spec`, `L1.context.spec`, `L1.models.spec`, `L1.persistence.spec` |
| 그룹 내부 설계(Helm의 탐구 흐름, 학습 그룹의 제안 대기열), 임대 정책의 그룹 측 판단 | `L3.group-kit.spec`, `L3.helm.spec`, `L3.learning.spec` |
| 세션 커밋 경로와 투영기 실행, 테이블 DDL 실행 | `L1.persistence.spec`, `L0.store.spec` |

## 2. 도메인

계획 v2의 X 하위 층 셋(`_research/layer-plan-v2.json` X-a, X-b, X-c)이 도메인 셋에 1:1로 대응한다. 소유 경계는 세 도메인 문서의 1절과 같다.

| 도메인 | 계획 v2 | 한 줄 책임 | 소유 설정 키 | 문서 | 1차 / 2차 |
|---|---|---|---|---|---|
| loading-trust | X-a 로딩과 신뢰 | 탐색, 로드 순서, 매니페스트 검증 흐름(로드 파이프라인), 신뢰 등급과 프로젝트 신뢰, 프로세스 격리, pi 어댑터 | `ext.<name>.enabled`, `ext.<name>.isolation`, `x.loading-trust.*` | `X.loading-trust.spec`, `X.loading-trust.plan` | 1차: 로딩, 정적 검증, 프로젝트 신뢰. 2차: 프로세스 격리. M2 이후: pi 어댑터 |
| primitives | X-b 원시 연산 네 개 | 4연산 실행, 디스패처, post 큐, drive 임대 중재, scope 토글·상태, 리소스 등록, `@xeon/ext-host` 공개 API, `DispatchPolicy`·`ResourcePolicy` 인터페이스 | `x.primitives.*`(`driveLimits`, `activeDriveGroup`, `capabilityProviders`) | `X.primitives.spec`, `X.primitives.plan` | 1차 전부 |
| operations | X-c 운영 규칙 | tier, 핸들러 시간 예산, 실패 격리·자동 끄기, 확장 전용 저장(`ExtStorage`), 이름 충돌, 안전 모드, 외부 훅 프로토콜. `DispatchPolicy`·`ResourcePolicy` 구현 | `x.operations.*` | `X.operations.spec`, `X.operations.plan` | 1차: tier, 예산·실패 격리, 저장 영역. 2차: 이름 충돌, 안전 모드, 외부 훅 |

- [제안] 소유 경계 조정: `F.extensions.spec` §1·§4.2는 tier와 핸들러 시간 예산을 primitives 몫으로 적었다. X 세 문서는 계획 v2 X-c와 `eng.transactions.design` §8을 근거로 operations 소유로 둔다. primitives는 `DispatchPolicy` 주입 구멍만 정의한다. F 문구 수정 요청은 §8 미결 1이다.
- 런타임 토글(Cordis fiber dispose, 단계 경계 적용)은 계획 v2에서 X-c 행이지만 scope 상태기계와 함께 primitives가 맡는다(`X.primitives.spec` §4.5).

## 3. 패키지 배치

| 도메인 | 소스 디렉터리 | 진입 파일 |
|---|---|---|
| loading-trust | `xeon/packages/ext-host/src/loading-trust/` | `src/loading-trust/index.ts` |
| primitives | `xeon/packages/ext-host/src/primitives/` | `src/primitives/index.ts` |
| operations | `xeon/packages/ext-host/src/operations/` | `src/operations/index.ts` |

- 패키지는 `xeon/packages/ext-host` 하나다. 공개 진입점은 제품 코드용 `@xeon/ext-host`(`src/index.ts`)와 테스트용 `@xeon/ext-host/testing`(`src/testing/index.ts`, 인메모리 포트·가짜 타이머, `X.primitives.plan` §2) 둘이다. 루트 진입점이 다시 내보내는 이름의 목록은 세 도메인 모두 `X.primitives.spec` §3.1 표가 정한다. 같은 패키지 안의 도메인 사이 import는 상대 경로이고, operations와 loading-trust는 primitives의 타입을 `import type`으로 쓴다.
- `package.json`의 현재 값은 `"xeon": { "layer": "X", "domain": "ext-host" }`다. routes.yaml은 X 도메인을 셋으로 둔다. 패키지 하나가 도메인 여럿을 담는 F·X의 `xeon.domain` 값을 패키지 이름으로 둘지는 `architecture.layers.spec` §10의 [미결]이다. 문서 라우팅은 `binds`(`src/<도메인>/**`)로 도메인을 고르므로 이 값과 무관하게 동작한다.
- 이 README의 `binds`는 패키지 전체(`xeon/packages/ext-host/**`)다. 도메인 문서의 `binds`는 각자의 `src/<도메인>/**`다(`_routing/routes.yaml` layout.X).

## 4. 이름 규칙 모음

| 대상 | 규칙 | 정본 |
|---|---|---|
| 확장 이름 `ExtensionName` | `^[a-z][a-z0-9-]{1,31}$`(소문자, 숫자, 하이픈. 밑줄 없음, [결정(잠정): review.decisions-2 U-18]). 매니페스트 `kind`는 `plugin` 또는 `group` | `F.extensions.spec` §3.1 |
| `ScopeId` | `<확장 이름>` 또는 `<확장 이름>/<하위 이름>`(`SCOPE_ID_PATTERN`). 주 scope id는 확장 이름 | `F.extensions.spec` §3.2 |
| 이벤트·레코드 kind | 플러그인 `x.<확장 이름>.<영역>.<이름>`, 그룹 `grp.<그룹 이름>.<영역>.<이름>`. scope 상태 커밋은 `<x\|grp>.<이름>.state.committed`이고 영역 `state`는 X 예약 | `F.records.spec` §3.2, `X.primitives.spec` §4.6.1 |
| X가 쓰는 코어 kind | `scope.changed`, `lease.acquired`, `lease.released`, `post.accepted`(유지, payload에 `inputId`, [결정(잠정): review.decisions-2 U-05]). 추가 요청: `scope.handler_failed`(휘발), `ScopeChangedPayload.reason` | `F.records.spec` §3.3, `X.operations.spec` §10 |
| 비공개 기록 kind | 자기 접두(`grp.<그룹>.*`, 플러그인 `x.<이름>.*`)만. `ScopeApi.recordPrivate`로 쓰고 다른 확장의 `readRecords`로 조회되지 않는다([결정(잠정): review.decisions-2 T-21]) | `X.primitives.spec` §4.6.5 |
| 설정 키 | X 층 `x.loading-trust.*`, `x.primitives.*`, `x.operations.*`. 확장 `ext.<확장 이름>.<이름>`, 예약 `ext.<name>.enabled`, `ext.<name>.isolation` | `F.wire-settings.spec` §3.8.1, §3.8.3 |
| DB 테이블 | 확장 `x_<확장 이름의 하이픈을 밑줄로>_<지역 이름>`, 지역 이름 `^[a-z][a-z0-9]{0,31}$`(밑줄 없음, [결정(잠정): review.decisions-2 U-18]). X 내부 `xh_*`(예: `xh_ext_tables`) | `X.operations.spec` §4.4.2, `eng.context-map.design` §5.2 |
| 서비스 이름 | 능력 바인딩 `cap:<CapabilityId>`, 공급자별 `cap:<CapabilityId>@<확장 이름>`. 포트는 `xeon.*`(예약). 같은 `xeon.*` 이름에 등록되는 F 서비스 인터페이스가 X 포트를 부분형으로 포함한다([결정(잠정): review.decisions-2 D-04]). X 자신은 `xeon.ext` | `X.primitives.spec` §3.6 규칙 6, §3.7, `eng.context-map.design` §5.3 |
| 리소스 이름 | 정식 이름 `<확장 이름>:<이름>`, 모델 도구는 `<확장 이름>__<이름>`. 짧은 이름은 충돌·예약이 없을 때만 | `X.operations.spec` §4.5 |
| tier | `guard` → `user` → `project` → `builtin` → `core`(바깥에서 안쪽) | `X.operations.spec` §3.1, §4.1 |
| 신뢰 등급, 설치 위치 | `builtin`, `user`, `project`, `untrusted` / `builtin`, `managed`, `user`, `project` | `X.loading-trust.spec` §3.1 |
| 외부 훅 | id `^[a-z][a-z0-9-]{1,63}$`, 페이로드 버전 `xeon.hook.v1` | `X.operations.spec` §3.7 |

알려진 불일치와 따를 쪽:

- extId 형식: [결정(잠정): review.decisions-2 U-18] `^[a-z][a-z0-9-]{1,31}$`, 테이블 접두 `x_<하이픈을 밑줄로>_`. F.extensions.spec `EXTENSION_NAME_PATTERN`, `eng.domain-types.guide` DT-08, `eng.context-map.design` §5.2·CM-07, `eng.events.design` §4.5, `L0.store.spec`, adr.0004 §3.3이 모두 이 정규식과 `x_` 접두로 고쳐졌다(해소).
- 확장 kind 접두: F 접두 규칙(`x.`/`grp.`)이다. eng 문서의 옛 밑줄 접두와 옛 코어 kind(`scope.toggled`, `drive.leased`/`drive.released`)는 F 이름(`scope.changed`, `lease.*`)으로 고쳐졌다([결정(잠정): review.decisions-2 T-21]).
- 서비스 이름: `architecture.layers.spec` §4.4는 X 서비스를 `ext`로, L0 프로세스를 `os.process`로 적었다. `eng.context-map.design` §5.3의 `xeon.ext`, `xeon.process`를 따른다.
- 세션 열 이름: eng 문서는 `session_id`, X는 F 용어를 따라 `thread_id`를 쓴다.

## 5. 소비 지도

| 소비 층·도메인 | X에서 쓰는 것 | 정본 |
|---|---|---|
| L0 `platform-*` | `ExtHost.registerPlatform`(`PlatformModule`, `PlatformContext.providePort`)으로 포트 제공(`ScopedStorePort`, `ProcessPort` 등) | `X.primitives.spec` §3.2, §3.6 |
| L1 `core-loop`, `core-tools`, `core-context`, `core-models`, `core-persistence` | `ExtHost.dispatch`(지점 발화), `ExtHost.boundary`(단계 경계 `prepare`/`settle`), 포트 제공(`LoopPort`, `InputQueuePort`, `RecordCommitPort`, `ProjectorRegistryPort` 등, `hostOf(g).providePort`), 확장 투영기 등록 받기 | `X.primitives.spec` §3.2~§3.6, `X.operations.spec` §4.4.4 |
| L2 `cap-*` | 능력 공급자 등록(`hostOf(g).provide`), 리소스 등록(도구, MCP 서버), on 핸들러 | `X.primitives.spec` §3.7~§3.9 |
| L3 `group-kit`, `group-helm`, `group-learning` | scope(상태 문서, `commit`, `record`/`readRecords`), on, post, drive(Helm만, 학습 그룹은 쓰지 않음), `storageOf(g)`의 확장 전용 테이블 | `X.primitives.spec` §4.4~§4.7, `X.operations.spec` §3.4 |
| L4 `apps/host` | 조립: `createOperationsPolicy` → `createExtHost`(`policy`, `setupBudgetMs`, `resourcePolicy`) → `registerPlatform`(L0) → `createExtensionLoader({ host, policy, … })` → `loadAll`. 로더는 Cordis 서비스가 아니고 조립 루트가 직접 쥔다. `OperationsDeps.ports`·`ScopeControl` 늦은 연결, `x.*` 설정 그룹과 `LoadReport.settingGroups`의 `buildCatalog`, `StartupHealthStore`, 설정 소스 연결 | `X.primitives.spec` §3.2, `X.loading-trust.spec` §3.5, `X.operations.spec` §3.8 |
| L4 `apps/cli`, `apps/desktop`, 설정 화면 | 활성화 토글(`ext.<name>.enabled`), 신뢰 대화상자(`TrustPrompter`), 안전 모드(`--safe-mode`, `--disable-ext`, 설정 항목), drive 임대 상한·구동 그룹 화면(`x.primitives.*`), 확장 목록·진단·자동 끄기 상태 | `X.loading-trust.spec` §6, `X.primitives.spec` §6, `X.operations.spec` §4.6.5, §6 |

## 6. 층 경계

- [결정] 순위는 F(0) → X(1) → L0(2) → L1(3) → L2(4) → L3(5) → L4(6)이다(`_research/foundation-plan.md` §3). X는 F만 import한다.
- [결정(잠정): review.decisions-2 U-14] X는 순위 1(L0 아래)을 유지한다. 조건은 `architecture.layers.spec` §4.3.3 결론의 세 가지다. (1) X 소스와 테스트에서 L0·L1 import가 0건이다. (2) X가 받는 포트와 각 층의 서비스 인터페이스는 F에 정의한다(F.extensions.spec §3.2.1 `ports.ts`, F.records.spec §3.9, `@xeon/contracts/services`, [결정(잠정): review.decisions-2 D-04]). (3) L0는 `ExtHost.registerPlatform`으로 등록한다.
- L0·L1 기능은 Cordis 서비스 주입으로 받는다(`architecture.layers.spec` §4.3.3). 대상은 세션 커밋과 투영기 등록(`xeon.session`), 접두 테이블 읽기(`xeon.store`의 `scoped`), 프로세스 실행(`xeon.process`: 격리 확장, 외부 훅), 루프 구동(`xeon.loop`)이다. 포트와 키의 정의는 `F.extensions.spec` §3.2.1 `ports.ts`에 있고, X가 다시 export하는 목록과 사용 규칙은 `X.primitives.spec` §3.6에 있다. 탐색과 신뢰 판정용 파일 접근은 F 로더 포트(`LoaderFs`, `LoaderPaths`, `TrustStoreBackend`)로 받는다. 구현은 L0.os가 하고 조립 루트가 `LoaderDeps`로 주입하며, 없으면 시작 실패다(`X.loading-trust.spec` §3.2, §3.5, §4.3.2).
- 시작 순서 요약:
  1. 조립 루트가 operations 정책과 `ExtHost`를 만들고 L0 플랫폼 패키지를 `ExtHost.registerPlatform`으로 등록한다.
  2. 로더가 쓰는 주입 서비스(파일, 경로, 신뢰 저장소)가 있는지 확인한다. 없으면 시작 실패다.
  3. 내장 확장(L1 → L2 → L3)을 싣는다. 필수(`essential`) 내장이 실패하면 시작을 거부한다.
  4. 관리·사용자 확장을 싣고 프로젝트 신뢰를 판정한다. 안전 모드면 외부 확장, 외부 훅, L3 내장 그룹([제안], `X.operations.spec` §4.6.2)을 건너뛴다.
  5. 신뢰된 프로젝트 확장과 외부 훅을 싣는다.
  세부는 `X.loading-trust.spec` §4.3과 `L4.host-service.spec`이다.
- 주입 서비스로 받을 수 없는 L0 기능이 X 구성요소에서 나오면 위 조건 1을 지킬 수 없으므로 순위 변경(X를 L0 위로)을 ADR로 다시 정한다. 현재 세 도메인 문서에는 그런 경로가 없다.
- [결정(잠정): review.decisions-2 D-05] X 테스트도 L0를 import하지 않는다. 저장·프로세스 대역은 X `test/`와 `@xeon/ext-host/testing` 안에 F 인터페이스로 만든다.
- [결정(잠정): review.decisions-2 U-17] 하위 층(L0~L3)이 `@xeon/ext-host`를 import하는 것은 DR-14 예외다. 쓰는 범위는 서비스 등록·주입 API(`ExtHost.registerPlatform`, `hostOf`, 포트 키)다.
- L0는 on을 쓰지 않는다. 그래도 Cordis 플러그인 수명주기(`provide`, `dispose`) 때문에 X 위에 있다(`architecture.layers.spec` §4.3.3 2번). 등록 API는 `ExtHost.registerPlatform`이다(`X.primitives.spec` §3.2).

## 7. 결정 근거

| 결정 | 근거 |
|---|---|
| [결정] 확장 지점은 on(fold tap/first/chain), post, drive(배타 임대), scope 4연산이다. fold별 실패 규칙은 세 줄이다 | `_research/decisions-log.md` 2026-10-21 계획 v2, adr.0007 §3 |
| [결정] drive 임대는 한 번에 그룹 하나다. Helm과 학습 그룹은 L3 기본 그룹이고 학습 그룹은 drive를 쓰지 않는다 | `_research/decisions-log.md` 2026-10-21 계획 v2, adr.0007 §3.6 |
| [결정] 예산은 pi 방식이다. 기본 단계·비용 상한은 두지 않고 상한은 drive 임대에만 건다. 핸들러 시간 예산은 이것과 다른 대상이다 | `_research/decisions-log.md` 2026-10-21 계획 v2, adr.0007 §3.5 |
| [결정] 확장 프로세스 격리는 기본값이 꺼짐인 2차 선택 기능이다 | `_research/decisions-log.md` 2026-10-21 결정(2차) |
| [결정] 세션 저장은 SQLite 이벤트 소싱 + 투영, 단일 DB, 확장 접두사 테이블이다. outbox는 격리 확장에만 쓴다 | `_research/decisions-log.md` 2026-10-21 결정(2차), adr.0004 §3.1·§3.3 |
| [결정] DI는 Cordis 하나이고 vendored로 고정해 ext-host 뒤에 숨긴다 | `_research/decisions-log.md` 2026-10-21 결정(3차), adr.0002, `_research/foundation-plan.md` §2·§7 |
| [결정] 엔진은 라이브러리이고 호스트 계약 하나에 전송만 바꾼다. 서비스 모드는 1차 | adr.0006, `_research/foundation-plan.md` §1 2번 |
| [결정] M0 범위에 `ext-host`(on/post/drive/scope 최소형)가 들어가고, M1에서 테스트용 그룹이 on/post/drive를 쓴다 | `_research/foundation-plan.md` §5 P4 |

## 8. 미결 사항

세 도메인의 [미결] 가운데 층 전체에 걸리는 것을 모은다. 세부와 선택지는 각 문서 10절에 있다.

1. [미결] tier와 핸들러 시간 예산의 소유는 `F.extensions.spec` §1·§4.2에서 operations로 고쳐졌다(`X.primitives.spec` §1, `X.operations.spec` §1.1). 예산 초과 처리는 `X.operations.spec` §4.2.4가 정한다. 남은 일은 `L3.readme` 표의 옛 소유 표기다(`X.operations.spec` §10 미결 1).
2. [미결] `post.when = next`의 의미. 조사(`_research/notes/X-1.md`)는 pi `nextTurn`이 요청을 시작하지 않음을 확인했다. [제안] 시작하지 않는다. 유휴 시작 값 `start` 추가 여부도 함께 정한다(`X.primitives.spec` §4.7, adr.0007 §6).
3. [미결] fold 3종의 충분성. boundary의 "엔트리 추가 + 계속"을 chain 교체 + `finalize`로 표현할지, 4번째 fold를 둘지(`F.extensions.spec` §4.1, adr.0007 §6).
4. [미결] first fail-closed의 예외. pi는 `session_before_*`와 `project_trust`에서 fail-open이다. 이 결정은 operations의 예산 초과 처리와 외부 훅 종료 코드 표의 first 열에도 걸린다(`F.extensions.spec` §10, `X.operations.spec` §10 미결 15).
5. [미결] 비협조적 확장 코드의 한계. 같은 프로세스에서는 시간 예산과 임대 회수가 코드 실행을 멈추지 못한다. 자동 끄기와 격리(2차)로 보완하는 범위를 받아들일지, 그룹별 격리를 1차로 올릴지(adr.0007 §6, `X.operations.spec` §5 1번).
6. [미결] 그룹 간 이벤트 격리. Cordis 일반 `emit`의 전역 전달을 그룹 접두 필터로 막을지(`X.primitives.spec` §4.9, adr.0007 §6).
7. [결정(잠정): review.decisions-2 U-06] `tool_call` 지점에서 인자 변경은 지원하지 않는다(fold `first`, 허용·거부·결과 대체만). 인자 변경이 필요하면 2차에 chain 지점을 따로 더한다. pi는 `event.input` 제자리 수정을 허용하므로 pi 어댑터는 이 의존을 진단(`pi_input_mutation`)으로 알린다(`F.extensions.spec` §10, `X.loading-trust.spec` §3.9).
8. [미결] 지점 이름 표기. pi snake_case 정본과 조사 자료의 점 표기 별칭 허용 여부(`F.extensions.spec` §4.10).
9. [미결] `ResourcePolicy`의 리소스 집합 판정 메서드(`X.operations.spec` §10 미결 17). `DispatchPolicy`의 성공 보고(`onHandlerSettled`)와 예산 실행 위임(`run`, 사용자 응답 대기 제외)은 `X.primitives.spec` §3.4에 선택 메서드로 넣어 해소했다 [제안]. 마일스톤은 두 plan 모두 M0다(P-06, P-20, O-03, O-06).
10. (해소) [결정(잠정): review.decisions-2 U-14, D-04] 포트 타입의 정본은 F다(§6 조건 2). 호스트 포트, 리소스 등록 포트, 로더 포트와 키는 `F.extensions.spec` §3.2.1 `ports.ts`에, `RecordCommitPort`는 `F.records.spec` §3.9에 있다. X 세 도메인은 F 이름을 다시 export만 하고(`X.primitives.spec` §3.6·§3.9, `X.loading-trust.spec` §3.2·§3.7·§3.8, `X.operations.spec` §3.7), ext-host 고유 키는 `ExtHostPortKey`뿐이다.
11. [미결] F 추가 요청 모음: 상태 영역 예약 오류 코드(`record_kind_reserved`, `X.primitives.spec` §10). `ScopeChangedPayload.reason`과 휘발 kind `scope.handler_failed`는 `F.records.spec` §3.3에 들어갔다(`X.operations.spec` §10 미결 4). 매니페스트 `storage`·`hooks` 필드와 `HandlerContext.ui`는 M1에 넣지 않는다([결정(잠정): review.decisions-2 U-07], `X.operations.spec` §10 미결 2·5).
12. [미결] `xeon.domain` 값과 routes.yaml 도메인의 불일치(`architecture.layers.spec` §10).
13. 이름 정리(§4). extId 형식은 [결정(잠정): review.decisions-2 U-18], kind 접두는 [결정(잠정): review.decisions-2 T-21]로 정했고 F·eng·L0·ADR 문서에 반영됐다. 남은 일은 §4 "알려진 불일치"의 서비스 이름·열 이름 정리다.
14. [미결] 안전 모드에서 L3 내장 그룹(Helm, 학습 그룹)을 끌지. [제안] 끈다. Helm이 L3 기본 그룹이므로 사용자 확인이 필요하다(`X.operations.spec` §10 미결 19).
15. [미결] 샌드박스 강제를 on 핸들러로 둘지, L0 실행 경로에서만 할지. [제안] L0 실행 경로. L0는 on을 쓰지 않으므로 `GUARD_EXTENSIONS`에 L0 패키지를 넣지 않는다(`X.operations.spec` §10 미결 20).

## 이 층 문서의 읽는 순서

1. 이 문서(`X.readme`)
2. `X.primitives.spec`: 4연산, 디스패처, 공개 API, 포트. 다른 두 도메인이 이 이름에 기댄다.
3. `X.loading-trust.spec`: 확장이 어떻게 실리고 어떤 등급을 받는가.
4. `X.operations.spec`: 실린 확장이 어떤 순서·시간·실패 규칙으로 실행되고 무엇을 저장하는가.
5. 구현 작업이면 각 도메인의 `plan.md`.

- 문서 의존: `X.loading-trust.spec`과 `X.operations.spec`은 서로의 이름을 인용하므로 `depends_on`이 양방향이고, `X.primitives.spec`도 operations의 예산 값을 인용한다(포트 타입은 세 문서 모두 F에서 가져온다). plan도 같다. 규칙은 한 방향이다. 이름과 시그니처의 정본은 그 이름을 정의한 문서 하나이고, 다른 문서는 이름과 절 번호만 인용하며 다시 정의하지 않는다. 공개 이름 목록만은 `X.primitives.spec` §3.1이 모은다.
- `_routing/routes.yaml`의 `by_task.extension`은 이 문서(`X.readme`), `X.primitives.spec`, `F.extensions.spec`을 확장 작업의 필수 문서로 둔다. 코드 경로가 `xeon/packages/ext-host/src/<도메인>/**`이면 binds로 해당 도메인 spec·plan이 더해지고, 이 README는 패키지 전체 binds로 함께 고려된다.
