---
id: review.decisions-2
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.consistency-1]
binds: []
---

# 잠정 결정 2차 (정합성 검토 1차 후속)

## 1. 목적

- `review/consistency-1.md` §5의 U-01~U-23과, 같은 문서에서 키 중복·표기 충돌로 남은 항목의 답을 정한다.
- 사용자가 "너의 추천"으로 판단을 맡긴 범위(2026-10-21) 안에서 메인 조정자가 정한 답이다. 표기는 `[결정(잠정)]`으로 하고, 최종 보고에서 사용자 확인을 받는다. 확인 전에도 문서와 M0·M1 구현은 이 답을 따른다.
- 사용자가 다르게 답하면 이 문서의 해당 행을 고치고, 영향 문서 열의 문서를 다시 맞춘다.

## 2. 사용자 확인 대상 결정

| 번호 | 답 | 이유 | 영향 문서 |
|---|---|---|---|
| U-01 | scope 켜기·끄기와 drive 임대 교대는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에 적용한다. 문서의 "턴 경계"는 모두 "단계 경계"로 쓴다. | 턴은 여러 단계로 이어질 수 있어 턴 끝까지 기다리면 긴 턴에서 토글이 늦게 적용된다. 단계 경계는 커밋된 상태만 보이는 가장 이른 안전 지점이고, 턴 경계는 그 부분집합이다. | architecture.layers, architecture.runtime-flow, ADR-0002, ADR-0007, L2.dialog, product 세 문서 |
| U-02 | 승인 요청은 A안(내구 이벤트 `approval.requested` + 호스트 메서드 `approval.respond`)으로 한다. | 승인 대기 중 프로세스가 죽어도 재개 뒤 같은 요청을 다시 보일 수 있다. | F.wire-settings, F.records |
| U-03 | F에는 `Clock`·`RandomSource`·`IdFactory` 인터페이스와 순수 함수만 둔다. 구현은 `platform-os`에 둔다. `./testing` 서브패스는 두지 않고, 테스트 대역은 각 패키지 `test/` 안에 둔다. `createIdFactory`는 F에 두지 않는다. | F를 타입·스키마·순수 판정 함수로 한정하는 규칙(DT·F README)을 지킨다. | F.readme, L0.os, L4.host-service, eng.typescript, eng.domain-types |
| U-04 | 판정하지 않은 호스트 계약 요청은 M1에 넣지 않는다. M2 계획에서 하나씩 정하고, 그때까지 F.wire-settings 미결로 둔다. | M1 걸어 다니는 골격에는 필요 없다. | F.wire-settings |
| U-05 | `post.accepted`는 유지한다. payload에 `inputId`를 더한다. | 재개 때 post 멱등 판정의 근거가 된다. | F.records, L1.tasks |
| U-06 | `tool_call` 지점에서 인자 변경은 지원하지 않는다(fold `first`, 허용·거부·결과 대체만). 인자 변경이 필요하면 2차에 chain 지점을 따로 더한다. | 인자를 바꾸면 의도 커밋과 실행 인자가 달라져 재생 판정이 복잡해진다. | F.extensions, ADR-0007 |
| U-07 | 매니페스트 `storage`·`hooks`·`delegates`, `HandlerContext.ui`는 M1에 넣지 않는다. | M1 테스트 그룹은 on/post/drive/scope만 쓴다. | F.extensions |
| U-08 | `SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`는 F `capabilities/secrets.ts`에 둔다. `SECRET_REF_PATTERN` 정본도 F다. | L0.secrets, L2.workspace, L4 설정 화면이 같은 타입을 쓴다. | F.capabilities, L0.secrets |
| U-09 | 쓰기 소유 판정은 OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱으로 한다. `session_owner`는 두지 않고 `sys_leases` 행이 표시를 겸한다. ADR-0004 §3.4와 ADR-0006을 이에 맞게 개정한다. | OS 잠금만으로는 잠금을 잃은 옛 소유자의 늦은 쓰기를 막지 못한다. epoch를 커밋마다 대조하면 막힌다. | ADR-0004, ADR-0006, eng.transactions, L0.store, L1.persistence |
| U-10 | 도구별 효과 커밋(E1 의도, E2 실행 시작, E3 결과)을 ADR-0004 §3.2 3번 보충으로 올린다. 단계당 커밋 수는 `3 + 3n`이다. | L1.persistence와 eng.transactions가 이미 이 모양이다. | ADR-0004, L0.store |
| U-11 | 원격은 1차(M3)에 넣되, 자체 TLS WebSocket 대신 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 방식으로 한다. 내장 TLS + 토큰 WebSocket은 2차다. | 사용자는 원격이 필요하다고 답했다(결정 2). 인증서·노출 위험이 큰 내장 서버 없이 원격 사용이 가능하다. | ADR-0006, L0.process, product.scope, product.usecases, L2.schedule |
| U-12 | drive 임대 상한은 둔다. `l3.helm.driveLimits` 기본값 4/8/400000을 pi 방식(기본 상한 없음)의 예외로 인정한다. 일반 대화 턴에는 상한을 두지 않는다. | drive는 사용자 입력 없이 턴을 만들기 때문에 상한이 없으면 무한 실행된다. 이 예외는 계획 v2에서 이미 정했다. | ADR-0007, L3.helm, product.scope |
| U-13 | 커밋 키 정본은 eng.transactions의 `COMMIT_KEY_PATTERN`이다. scope id의 `/`는 키에 넣을 때 `:`로 바꾼다. | 키 형식이 한 곳에 있어야 L1·X가 같은 검사를 쓴다. | eng.transactions, L1.tasks, L1.persistence |
| U-14 | X는 순위 1(L0 아래)을 유지한다. 조건은 architecture.layers 4.3.3의 세 가지다. | X가 L0 기능을 직접 쓰지 않고 F 포트로 받는다. | eng.dependency-rules, X.readme, L0.readme |
| U-15 | 같은 층 예외 두 개를 허용 목록에 둔다: `apps/cli`→`apps/host`(`DR-10/cli-host`), `group-*`→`group-kit`(`DR-02/group-kit-*`). | 엔진 조립 코드를 한 곳에 두고, 그룹 공통 기반을 중복하지 않는다. | eng.dependency-rules, architecture.layers |
| U-16 | `plugins/*`는 L1 순위다. 플러그인은 F, X, L0, 외부 패키지(pi-ai)만 import하고 `core-*`는 import하지 않는다. 위장 provider는 F의 provider 인터페이스로 `core-models` 서비스에 등록한다. 같은 층 예외는 두지 않는다. | 층 규칙에 예외를 더하지 않고 플러그인 경계를 지킨다. | eng.dependency-rules(DR-09), L1.readme, L1.models, X.loading-trust, architecture.layers, L2.web.plan |
| U-17 | 구속 문서 개정을 승인한다: DR-14에 `@xeon/ext-host` import 예외(하위 층이 서비스 등록·주입 API만 사용), DR-07 F의 pi 타입 재노출 예외, DR-08·DR-14 testing 정의 통일(테스트 파일만 교차 import 허용), 서비스 모드 1차 표기, 확장 id 정규식 통일. | 결정 2와 U-03, U-18을 구속 문서에 반영한다. | eng 전체 |
| U-18 | 확장 id는 `^[a-z][a-z0-9-]{1,31}$`(소문자, 숫자, 하이픈)이다. 밑줄은 쓰지 않는다. 테이블 접두는 `x_<id에서 하이픈을 밑줄로>_`이고 지역 테이블 이름에는 밑줄을 쓰지 않는다. | 밑줄을 금지하면 접두 일치로 다른 확장의 테이블을 지우는 일이 생기지 않는다(T-18). | eng.context-map, eng.domain-types, eng.events, X.operations, L0.store, ADR-0004 |
| U-19 | M1 비밀 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다. | 가장 단순하고 SOPS 해석 경로 전체를 확인한다. | product.scope, L0.readme, L2.workspace |
| U-20 | 비밀 값 열람은 M2 CLI `xeon secret reveal`(OS 인증 재확인이 가능한 곳은 재확인)과 M3 데스크톱 화면 둘이다. 에이전트 경로에는 열람이 없다. | 사용자가 요청한 키체인식 열람을 CLI에서 먼저 제공한다. | product.scope, L4.cli, L4.settings-ui |
| U-21 | 레이트 리밋·계정 회전 설정은 M3 설정 화면에 넣는다(2차로 미루지 않음). | 사용자가 L4에서 조작 가능해야 한다고 지시했다. | product.scope, L1.models, L4.settings-ui |
| U-22 | 예약 안전 상한(`maxRunsPerHour`, 최소 간격, 루프 `maxIterations`)과 `l3.learning.review.maxIterations`를 pi 방식의 예외로 인정한다. | 사용자 입력 없이 실행되는 경로라 U-12와 같은 이유다. | product.scope, L2.schedule, L3.learning |
| U-23 | 서비스 모드가 꺼져 있을 때 예약을 만들면 서비스 자동 기동을 시도한다. 실패하면 조치 안내와 함께 거부한다. 기본값 이름은 `autoStart`다. | 서비스 모드 자동 기동은 결정 2의 1차 범위다. | L2.schedule, product.usecases, L2.readme |
| U-24 | TypeBox는 1.3.27로 고정한다(catalog). 외부 패키지 `@earendil-works/pi-ai`·`pi-agent-core` 1.3.0, `@anthropic-ai/sandbox-runtime` 0.0.79를 catalog에 정확 고정한다. | pi-ai·pi-agent-core가 typebox 1.3.27을 정확 고정한다. 두 버전이 함께 설치되면 도구 스키마 값이 섞인다. 1.4로 올리는 시점은 pi가 올릴 때다. | ADR-0001, eng.toolchain, eng.domain-types |

## 3. 키·이름 충돌 정리 (사용자 확인 불필요)

| 지적 | 답 |
|---|---|
| K-04 | 확장 켜기 키는 `ext.<name>.enabled` 하나다. 범위는 X 정의(managed~session, live)를 따른다. |
| S-03 | 자동 재개 키는 `l1.persistence.autoResume`, `l1.persistence.maxResumeAttempts`만 둔다. `l0.process.autoResume.*`는 지운다. |
| S-04 | 알림은 1차(M3)다. 켜기 기본값·종류 목록·탭은 L2.dialog 정의를 따르고 L0.os는 전달 수단만 소유한다. |
| S-06 | 판정 상한 키는 `l1.agents.judge.maxRuns` 하나다. L2.work는 이 키를 참조한다. 판정 역할 이름은 L1.models 역할 표를 따른다. |
| S-11 | L4 탭 표는 각 키를 소유한 층 문서의 `ui.tab`을 따른다. |
| S-14 | `l1.agents.*` 탭은 F 12탭 기준 모델 탭이다. |
| S-15 | drive 보유 그룹 설정은 `x.primitives.activeDriveGroup` 하나다. |
| S-01 | 서비스 모드는 1차, OS 서비스 등록만 2차다(결정 2). |
| D-04 | L1·L0 서비스 인터페이스(`TaskService`, `LoopService`, `ExecutionEnv`, `SandboxService`, `ProcessService`, `OsService`, `ModelService`, `ToolService`, `ContextService`)는 F `@xeon/contracts/services` 서브패스에 둔다. 서비스 이름 상수도 같은 곳에 둔다. |
| D-05 | X 테스트는 L0를 import하지 않는다. 저장 대역은 X `test/` 안에 F 인터페이스로 만든다. |
| D-08 | 출력 절단 함수는 ADR-0003대로 `platform-exec`에 둔다. L2는 F 서비스로 호출한다. |
| D-10 | 그룹 사이 레코드는 F에 스키마를 두지 않는다. 그룹은 다른 그룹의 비공개 레코드를 읽지 않는다. 예시를 지운다. |
| D-11 | L2 문서는 L3 그룹 이름을 쓰지 않는다. 기본값은 일반 이름으로 쓰고 L3가 설정으로 채운다. |
| D-16 | L3 plan의 depends_on은 L4를 가리키지 않는다. |
| T-21 | X `ScopeApi.recordPrivate(kind, payload)`를 둔다. kind는 `grp.<그룹>.*`이다. `_ext.` 표기는 모두 `x.`/`grp.`로 바꾼다. |
| T-20 | 확장 상태 투영은 X.primitives 정의(활성 가지 규칙, `prev_event_id` 열)를 따른다. L3.group-kit `StateProjectionRow`는 X 열 이름을 그대로 쓰고, L1.persistence `latestEvent`는 가지 옵션을 받는다. |
| 기타 ID 접두(K-09) | 지역 ID는 F.conversation §3.2.1 `LocalIdPrefix` 표를 따른다. |
