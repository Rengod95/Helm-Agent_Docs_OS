---
id: review.consistency-1
layer: meta
domain: review
kind: review
status: draft
depends_on: [architecture.layers.spec, eng.dependency-rules.guide, eng.context-map.design]
binds: []
---

# 정합성 검토 1차

## 1. 목적과 범위

- 이 문서는 `_research/foundation-plan.md` §5 P2(정합성 검정)의 결과다. 1차 검토 지적, 각 층 작성자의 수정 결과, 수정 뒤 실제 파일에서 확인한 잔여 상태를 함께 적는다.
- 판정 근거는 `_research/foundation-plan.md`(최우선), `_research/decisions-log.md`, accepted ADR, `engineering/` 구속 문서 순이다. 이름은 F 문서를 따른다(`_templates/README.md` 문체 규칙).
- 다루지 않는 것: 코드(`xeon/`)의 정합성. 이 검토는 문서만 본다.
- 확인 시점: 2026-10-21. 수정 결과 보고와 별개로 지적마다 해당 문장을 실제 파일에서 다시 찾아 상태를 정했다.
- foundation-plan §6은 "미해결 상충 0"을 문서 검사 통과 조건으로 둔다. 이번 1차 수정 뒤에는 이 조건을 만족하지 못한다(§4).

## 2. 검토 관점

| 관점 | 기호 | 확인한 것 | foundation-plan 근거 |
|---|---|---|---|
| ① 계약 | K | F 계약(타입, 스키마, 이벤트 kind, 서비스 이름, 설정 키)과 소비 층(X, L0~L4, engineering, ADR)의 이름·모양 일치 | §5 P2 ① |
| ② 의존 | D | 층 순위 F → X → L0 → L1 → L2 → L3 → L4 위반, 같은 층 import, DR-01·DR-14 예외, 문서 depends_on 방향 | §5 P2 ② |
| ③ 데이터 | T | 커밋 단위, 멱등 키, seq 범위, 복구 판정, 쓰기 소유, 재생·분기 규칙, 확장 접두 테이블의 상충 | §5 P2 ③ |
| ④ 제품 | S | 설정 키 소유와 기본값, 데몬(서비스 모드) 범위, 마일스톤 배치, 사용자 결정과의 일치 | §5 P2 ④ |

## 3. 지적 목록

상태 표기:

- 해결: 지적한 상충이 어느 문서에도 남지 않았다.
- 부분: 기준 쪽 또는 일부 문서는 고쳤고, 다른 문서에 옛 서술이 남았다. 남은 문장을 "잔여"로 적는다.
- 미반영: 지적한 문서가 바뀌지 않았다.
- (사용자): 남은 상충의 해소에 사용자 결정이 먼저 필요하다. §5에 같은 항목이 있다.

경로는 `docs/xeon/` 기준이다.

### 3.1 ① 계약 (K)

| 번호 | 심각도 | 경로 | 문제 | 조치 결과 |
|---|---|---|---|---|
| K-01 | high | `F/records/spec.md` | 소비 층이 쓰는 `approval.*`, `input.*`, `agent.*`, `secret.*`, `turn.abort_requested`, `thread.resumed`, `scope.handler_failed`가 F 코어 카탈로그에 없어 `parseEventKind`가 `reserved_area`로 거부한다 | 부분. F.records §3.2·§3.3에 영역·kind·payload를 더했다(승인 kind는 F.wire-settings §4.6 A안 전제). 잔여: `L1/README.md` §7.1 표의 "F 상태: 요청" 6행, L1.tools·L1.tasks·L1.agents plan의 M1 표지 |
| K-02 | high | `F/records/spec.md` | L2 도메인 kind(`work.`, `dialog.`, `artifact.`, `schedule.`)가 F 규칙상 거부 대상이고, L2.work는 이벤트와 `customType` 접두 규칙이 다르다 | 부분. F.records에 도메인 소유 카탈로그(`WORK_EVENT_CATALOG` 등), `TYPE_PREFIX_OWNERS`, 내장 패키지 예외를 두었다. 잔여: `L2/README.md` §5.9·§10 미결 13이 "F에 요청" 상태로 남음, `L2/work/spec.md`에 `customType`이 `x.cap-work.…`인 이유 문장 없음 |
| K-03 | high | `L1/loop/spec.md` | 서비스 `xeon.loop`에 X `LoopPort`와 L1 `LoopService` 두 인터페이스가 있고 메서드·`status` 반환형·`leaseEpoch`가 다르다. 입력 큐 포트도 같다 | 부분. L1.loop `LoopService extends LoopPort`·`threadStatus`, L1.tasks `enqueue` 최상위 노출, F.extensions §3.2.1 `ports.ts` 표를 두었다. 잔여: `X/primitives/spec.md` §3.6이 "F에 포트 타입 없음 [미결]"과 자체 `primitives/ports.ts` 정의를 유지하고, §3.6 규칙 6 미결도 그대로다. 필드 이전은 F.extensions.plan 몫으로 남음 |
| K-04 | high | `L3/group-kit/spec.md` | 확장 켜기 키가 `ext.<name>.enabled`(F·X)와 `l3.<이름>.enabled`(L3) 둘이고 범위·적용 시점도 다르다 | 부분. L3 문서는 `ext.<name>.enabled` 하나로 맞췄다. 잔여: `F/wire-settings/spec.md` §3.8.1 예시 `l3.helm.enabled`, `F/extensions/spec.md` §6 범위 "사용자, 프로젝트, 세션"(X는 managed~session, live), `L4/settings-ui/spec.md` 878행 "그룹 켜기·끄기 키도 일반 토글"(키가 `l3.*`라는 전제) |
| K-05 | high | `engineering/events/design.md` | envelope 필드, kind 형식, 확장 접두 `_ext.`, `BlobRef`가 F와 다르다 | 해결. F 이름(kind/version/threadId, `x.`/`grp.`, `{type:'blob', sha256, mediaType}`)으로 바꿨다 |
| K-06 | high | `engineering/domain-types/guide.md` | DT-06 두 글자 ID 접두, DT-08 `_ext.` 열린 유니온, DT-12 서브패스 순서가 F와 다르다 | 해결. F 8종 접두와 `IdPrefix`·`IdByPrefix`, `x.`/`grp.`, F.readme §3 순서를 따른다. `createIdFactory` 위치는 K-18 |
| K-07 | medium | `engineering/transactions/design.md` | 커밋 표와 소유표가 `tool.intended`, `scope.toggled`, `drive.leased`, `_ext.helm.`, envelope `producer`를 쓴다 | 해결. F kind 이름으로 바꾸고 생산자 검사를 커밋 호출자 id 대조로 고쳤다 |
| K-08 | medium | `decisions/ADR-0004-session-storage.md` | ADR-0004 seq 범위·필드명과 ADR-0007 시그니처·지점 kind 배정이 F와 다르다 | 해결. ADR-0004 §3.2는 F envelope와 DB 전역 seq로, ADR-0007 §3.3·§3.7은 F.extensions 시그니처와 kind 배정(`message_end` = boundary)으로 맞췄다 |
| K-09 | medium | `F/conversation/spec.md` | `IdPrefix` 밖 ID를 문서마다 다른 방식(두 글자 비ULID, F 추가 요청, 지역 형식)으로 만든다 | 부분. F.conversation §3.2.1에 `LocalIdPrefix`·`LocalIdFactory`와 지역 접두 표(wcl, wbr, wrs, knl, knp, bgp 등)를 두었다. 잔여: `L2/web/spec.md` `^wc_`·`^wb_`·`^wr_`, `L2/knowledge/spec.md` `^kl_`·`^kp_`, `L0/process/spec.md` `bg_`, `L0/secrets/spec.md` `sls_` 서술 |
| K-10 | medium | `L1/tasks/spec.md` | `post.accepted`를 F·X는 유지하고 L1.tasks는 retire를 제안한다 | 부분. 유지안으로 L1.tasks·L1 README를 맞췄다. 잔여: F.records `PostAcceptedPayload`에 `inputId`가 없다(L1.tasks FR-T3 요청). retire 안은 L1 README §14 15번 [미결] |
| K-11 | medium | `F/capabilities/spec.md` | §3.9 `web.search` 예시가 L2.web 정의와 다른데 정합성 검사 기준으로 지정되어 있다 | 부분. F 예시를 줄인 설명용 예시로 선언하고 정본을 `defs/web.ts`·L2.web §3.2로 두었으며 `ProviderSelectionMeta`(§3.11)를 신설했다. 잔여: `L2/README.md` §5.2 마지막 불릿과 §10 미결 2·3이 "F 예시는 최상위 `provider`"라고 서술 |
| K-12 | medium | `F/wire-settings/spec.md` | `SecretRef` 정규식 정본이 F settings와 L0.secrets 두 곳이다 | 부분. F.capabilities §3.10을 정본으로 두고 wire-settings가 다시 export한다. 잔여: `L0/secrets/spec.md` §3.1 주석과 §8.3 R1이 `SECRET_REF_PATTERN` 정본을 L0 요청 파일로 두고 서비스 타입 일습의 F 배치를 요청 |
| K-13 | medium | `L4/host-service/spec.md` | 서비스 켜기·유휴 유예·종료 시한·자동 재개 키가 L0·L1·L4에 중복 정의되어 이름·단위·기본값이 다르다 | 부분. L4는 자기 키를 지우고 `l0.process.*`(서비스 수명)와 `l1.persistence.*`(자동 재개)를 가리킨다. 잔여: `L0/process/spec.md` §6 `l0.process.autoResume.enabled`·`maxAttempts`가 `l1.persistence.autoResume`·`maxResumeAttempts`와 중복(S-03) |
| K-14 | medium | `F/records/spec.md` | X·L0·L1이 import하는 저장·투영 타입(`StoreDb`, `Projector`, `SessionService` 등)이 F에 없다 | 해결. F.records §3.9에 시그니처와 파일 배치를 두었다. 일부 필드 이전은 F.records.plan R12 |
| K-15 | medium | `F/wire-settings/spec.md` | 호스트 계약에 `host.shutdown`, `$/connectionReset`, 인증 토큰, `secret.*`, `turn.start` 암묵 획득이 없다 | 해결. 해당 메서드와 오류(1004 `host.authFailed`)를 M2로 추가하고 `turn.start` 암묵 획득과 3002를 적었다. 판정하지 않은 요청은 F.wire-settings §10 미결 10 |
| K-16 | medium | `F/extensions/spec.md` | 발화 문서 배정(§7), M1 밖 페이로드, `provide`·포트, 매니페스트 필드, tier 소유 문구가 소비 층 제안과 맞지 않는다 | 부분. §7 배정을 L1 소유표대로 고치고 §3.5 페이로드, `ports.ts`, operations 소유 문구를 반영했다. 잔여: `L1/README.md` §6 표 34·40번 등의 "다름. F §7은 persistence" 표기, `architecture/runtime-flow/design.md` 73행 `TASKS->>EXT: on input` |
| K-17 | medium | `F/capabilities/spec.md` | `CallOptions.context`, provider 공통 타입, 정의 파일 위치, 확장 도구 이름, 서비스 이름 규칙이 소비 층 전제와 다르다 | 부분. `CallContext`, `provider.ts`, `defs/<domain>.ts` 확정, `EXTENSION_TOOL_NAME_PATTERN`, 서비스 이름 주석을 반영했다. 잔여: `L2/README.md` §5.6·70행·241행이 `xeon.<domain>` 묶음을 Cordis 서비스로 등록한다고 서술 |
| K-18 | medium | `F/README.md` | `Clock`·`RandomSource`·`IdFactory` 구현과 `./testing` 서브패스의 위치를 F와 L0·eng가 다르게 전제한다 | 부분. F 루트에 주입 인터페이스만 두고 구현과 테스트 대역은 F 밖, `./testing` 서브패스는 두지 않는다로 정리했다. 잔여: `L0/os/spec.md` 34행 "contracts base의 `createIdFactory`"와 250·309행 `@xeon/contracts/testing`, `L4/host-service/spec.md` 154행 루트 `IdFactory` import, `engineering/typescript/guide.md` §1.2·DT-06 [미결] |
| K-19 | medium | `product/usecases/spec.md` | 제품·아키텍처·ADR의 "턴 경계"(턴 사이)와 F·X·L1의 "단계 경계"(step 종료 직후)가 다른 적용 시점을 뜻한다 | 부분(사용자). product 세 문서는 단계 경계로 고치고 [미결]을 달았다. 잔여: `architecture/layers/spec.md` 63행 규칙 5, `architecture/runtime-flow/design.md` 128·146·280행, `decisions/ADR-0002-di-cordis.md` 47행, `decisions/ADR-0007-ext-points.md` 44·106행, `L2/dialog/spec.md` 548·871행 "다음 턴 경계" |
| K-20 | low | `F/records/spec.md` | §3.5·§7이 `tool_call` 지점을 chain·인자 변경 가능으로 적어 F.extensions(first, 인자 변경 [미결])와 어긋난다 | 해결. 두 문장을 F.extensions 기준으로 고쳤다 |

### 3.2 ② 의존 (D)

| 번호 | 심각도 | 경로 | 문제 | 조치 결과 |
|---|---|---|---|---|
| D-01 | high | `engineering/dependency-rules/guide.md` | 하위 층의 `@xeon/ext-host` import를 layers·ADR-0002·X·L0·L1은 허용하고 DR-14 예외 목록에는 없다. `xeon.ext` 인터페이스 이름(`ExtensionHost`)과 L0.os `XeonPlugin`도 X 정의(`ExtHost`, `PlatformModule`)와 다르다 | 미반영. DR-11·DR-14, `engineering/context-map/design.md` 339행, `L0/os/spec.md` 557행, `L3/group-kit/spec.md` 1119행 [미결] 그대로 |
| D-02 | high | `architecture/layers/spec.md` | 4.2.2 지도가 DR-14가 금지하는 구현 패키지 사이 import 간선을 그린다 | 해결. 실선을 `contracts`·`ext-host`로 가는 간선으로 한정하고 4.2.1 표 아래에 DR-14 문장을 더했다 |
| D-03 | medium | `architecture/overview/spec.md` | 4.1 그림이 L2→L1, L1→L0 구현 import를 실선으로 그린다 | 부분. 구현 import 실선은 지웠다. 잔여: `cap --> exthost` 간선을 D-01 결정 대기 [미결]로 둠 |
| D-04 | high | `F/capabilities/spec.md` | DR-02·DR-14·CM-05가 유일한 협력 경로로 지정한 F의 서비스 인터페이스가 없다 | 부분. F.records §3.9에 `StoreService`·`SessionService`, F.capabilities에 비밀 서비스 형식을 두었다. 잔여: `TaskService`, `LoopService`, `ExecutionEnv`, `SandboxService`, `ProcessService`, `OsService`, `ModelService`, `ToolService`, `ContextService`가 F 문서에 없음. L0 서비스 서브패스(`L0/README.md` 미결 2) 미정 |
| D-05 | high | `X/operations/plan.md` | X 테스트가 L0 가짜 저장소를 import하는 작업(O-15)과 완료 기준 2, 상위 층 plan을 가리키는 depends_on이 있다 | 미반영. 100·175행과 프런트매터 그대로 |
| D-06 | medium | `architecture/layers/spec.md` | X 순위 판정이 문서마다 [미결]이고 근거(Bun 표준 API 대 L0.os 포트)도 둘이다 | 부분. 4.3.3에 판정(순위 유지, 조건 3개)과 포트 근거를 적었다. 잔여: `L0/README.md` 22행 "Bun 표준 API로 한다", `engineering/dependency-rules/guide.md` §1.1·758행, `X/README.md` 6절·§8 10번 [미결] |
| D-07 | medium | `X/primitives/spec.md` | `ToolsPort`·`ModelsPort`·`McpPort`가 F 서비스(`ToolService` 등)와 같은 서비스 이름을 쓴다 | 미반영. §3.9 724·727행 그대로. L1.tools·L2.mcp에 등록 메서드 서술 없음 |
| D-08 | medium | `L2/workspace/spec.md` | 절단 함수를 `core-tools`에서 import하는 안(L2→L1 구현 import)과 ADR-0003 배치가 다르다 | 미반영. `L2/workspace/spec.md` 615행, `decisions/ADR-0003-pi-durable-fork.md` 49행 그대로 |
| D-09 | medium | `engineering/dependency-rules/guide.md` | DR-07 소유표에 F의 pi 타입 재노출 예외가 없다 | 미반영 |
| D-10 | medium | `F/extensions/spec.md` | 그룹 사이 레코드 payload 스키마가 F에 없고 §4.8 예시가 Helm이 `skill.proposed`를 읽는다고 적는다 | 미반영. 934행 예시와 `group-records.ts` 부재 그대로 |
| D-11 | medium | `L2/knowledge/spec.md` | L2 기본값과 규칙이 L3 학습 그룹 이름(`learning.queue`)과 `group-*`를 안다 | 미반영. `L2/knowledge/spec.md` 1033행, `L2/dialog/spec.md` 944·955행, `L2/schedule/spec.md` 40·974행 그대로 |
| D-12 | medium | `engineering/dependency-rules/guide.md` | 같은 층 예외(`apps/cli`→`apps/host`, `group-*`→`group-kit`)의 상태와 예외 목록 위치가 문서마다 다르다 | 부분(사용자). layers 3.2의 목록 위치를 허용 목록 파일로 고쳤다. 잔여: DR-10 본문, DR-14 예외 2, DR 가이드 4절 승인 예외 목록에 `DR-10/cli-host` 없음 |
| D-13 | medium | `architecture/layers/spec.md` | `plugins/*` 순위가 L1(layers·DR-01), L1·L2 사이 제안, `"layer": "plugin"`(L2.web plan) 셋이다 | 미반영. layers 95·214·409행, DR-09 365·699행, `L2/web/plan.md` 50행 그대로 |
| D-14 | low | `architecture/layers/spec.md` | L3→`cap-*` 금지가 문서마다 [제안]·[미결]·원칙으로 다르다 | 해결. layers 102행에서 [결정: 계획 v2 규칙 2, DR-14]로 올렸다. `L3/README.md` 91행의 [제안] 표기는 내용 상충이 아니다 |
| D-15 | low | `engineering/dependency-rules/guide.md` | DR-08은 `testing` 서브패스 소스의 교차 import를 허용하고 DR-14 예외 3은 테스트 파일만 허용한다 | 미반영. 537행 그대로 |
| D-16 | low | `L3/slots/plan.md` | L3 plan의 depends_on이 L4 plan을 가리킨다 | 미반영. `L3/slots/plan.md`·`L3/learning/plan.md` 7행 그대로 |

### 3.3 ③ 데이터 (T)

| 번호 | 심각도 | 경로 | 문제 | 조치 결과 |
|---|---|---|---|---|
| T-01 | high | `engineering/transactions/design.md` | 커밋 지점 표·TX-08·키 표가 L1의 도구별 E1~E3 커밋과 다르고 단계당 커밋 수가 둘로 계산된다 | 부분. eng.transactions §3.2·§4.1·§4.8·TX-08을 L1.persistence 표(`3 + 3n`)로 바꿨다. 잔여: `L0/store/spec.md` 545행 "응답 1 + 도구 정착 수 + 단계 끝 1", ADR-0004 §3.2의 도구별 커밋 미반영(eng 미결 T-8, 사용자) |
| T-02 | high | `engineering/transactions/design.md` | 결과 불명 판정이 실행 시작 여부를 구분하지 않고 `tool.replay_started`를 쓴다 | 해결. F `decideEffectRecovery` 결정표(`not_started`/`outcome_unknown`)와 `effect.exec` 건수 규칙으로 바꿨다 |
| T-03 | high | `L0/store/spec.md` | 복구 표식이 `sys_run_marks`(L0)와 `p_threads` 열(L1) 두 곳에 있다 | 부분. L0.store·L0.process에서 `sys_run_marks`를 지우고 L1 정의를 따른다(FR-S3 철회, `ResumeCandidate`). 잔여: `architecture/runtime-flow/design.md` 76행의 별도 "복구 표식 running_since 커밋" 화살표 |
| T-04 | high | `decisions/ADR-0004-session-storage.md` | accepted ADR-0004 §3.4(OS 잠금만)와 L0·L1·eng의 OS 잠금 + `sys_leases` epoch 펜싱이 다르고, ADR-0006 `session_owner`도 L0 `sys_leases`와 겹친다 | 미반영(사용자). ADR-0004 §3.4, `decisions/ADR-0006-process-service-mode.md` 157행 그대로. L1.persistence가 펜싱으로 옮겨 ADR과의 차이는 커졌다 |
| T-05 | high | `L1/persistence/spec.md` | `OwnershipGuard.holds()`가 인자 없는 메모리 확인이라 펜싱이 안 되고 `session_owner`가 `sys_leases`와 이중이다 | 해결(L1 안). `LeaseToken`과 `leases.holds(tx, token)`로 바꾸고 `session_owner`를 지웠다. 확정은 T-04 개정에 묶인다 |
| T-06 | medium | `engineering/transactions/design.md` | §3.3 `sys_leases` DDL과 반납 규칙(행 삭제)이 L0.store(epoch 유지)와 다르다 | 해결. `released_at`, `kind`, `host`와 L0.store 획득 순서로 바꿨다 |
| T-07 | high | `engineering/events/design.md` | seq가 세션 안 수열(eng)과 DB 전역 수열(F·L1·wire)로 다르다 | 부분. eng.events·eng.transactions를 전역 seq와 `seq` 커서로 바꿨다. 잔여: `architecture/overview/spec.md` 73행 "seq는 세션 안 내구 이벤트의 단조 증가 번호" |
| T-08 | medium | `engineering/events/design.md` | envelope `requestId`·`producer`, 체크포인트의 이벤트 지위, `BlobRef`, `awaiting_approval`, `leaseEpoch`가 F와 다르다 | 해결 |
| T-09 | medium | `engineering/events/design.md` | 재개 알고리즘이 취소 판정 전에 `safe` 도구를 재실행한다 | 해결. 취소 판정을 앞으로 옮기고 수용 기준 7을 더했다 |
| T-10 | medium | `engineering/transactions/design.md` | §4.2 타입 이름·시그니처가 L0.store·L1.persistence와 다르다 | 해결. 대응표와 정본 인용으로 바꿨다 |
| T-11 | medium | `engineering/transactions/design.md` | 내부 쓰기 키 표와 형식 규칙이 X·L1 키와 다르고, `COMMIT_KEY_PATTERN`이 하위 scope id의 `/`를 거부한다 | 부분(사용자). §4.7·§4.8을 X·L1 값으로 교체하고 `COMMIT_KEY_PATTERN`을 [제안] 정본으로 두었다. 잔여: `L1/tasks/spec.md` §4.7에 scope id `/` 치환 규칙 없음. 정본 확정은 eng 미결 T-7 |
| T-12 | medium | `L1/tasks/spec.md` | 내용이 다른 같은 requestId post가 `key_reused`가 되어 약속한 `duplicate: true`가 나오지 않는다 | 해결. 지문을 신원만으로 줄이고 L1.loop §4.8도 같은 원칙으로 맞췄다 |
| T-13 | medium | `L1/persistence/spec.md` | drive 턴 멱등 조회(`turnByRequestId`)와 `p_turns.scope_id`가 없다 | 부분. L1.persistence에 조회·열·색인을 두고 L1.loop가 T1 `build` 안에서 조회한다. 잔여: `F/conversation/spec.md` 413행 `TurnStartedPayload`에 `scopeId` 없음(FR-L8·FR-P10) |
| T-14 | medium | `L1/persistence/spec.md` | 컴팩션 커밋 지점이 C5 포함(eng·L1)과 직접 커밋(L1.context)으로 다르다 | 해결. 별도 지점 C7과 키 `compact:<threadId>:<stepId>:<reason>`로 정하고 eng 쪽 행을 지웠다 |
| T-15 | medium | `L1/agents/spec.md` | 백그라운드 위임의 `agent.settled`와 보고 입력이 다른 커밋이라 보고가 유실될 수 있다 | 해결. 한 커밋으로 묶었다 |
| T-16 | medium | `L1/agents/spec.md` | 자식 대화의 쓰기 소유 획득·전파 규칙이 없다 | 해결. 부모 소유자의 `session:<childThreadId>` 임대, `inheritOwnerFrom`, 재개 시 재획득을 적었다. 조립 배선은 [가정](L4) |
| T-17 | medium | `L1/persistence/spec.md` | 세션 생성 멱등이 없어 예약 실행이 세션을 중복 생성할 수 있다 | 부분. `creationKey`와 `thread_creation_keys`를 두었다. 잔여: `L2/schedule/spec.md` 1338행이 requestId 전역 멱등 [가정]을 유지 |
| T-18 | high | `L0/store/spec.md` | 확장 테이블 접두 규칙이 X(하이픈 허용)와 다르고 접두 일치 삭제가 다른 확장 테이블을 지울 수 있다 | 부분. L0.store가 `ExtensionName`을 받고 `drop(name, tables)`와 `table_not_owned`로 바꿨다. 권고(접두 충돌 거부)와 다르게 지역 이름 밑줄 금지 규칙으로 소유를 판정한다(X.operations AC 18과 맞춤). 잔여: `engineering/context-map/design.md` 315·378행 `EXT_ID_PATTERN`, DT-08, eng.events §4.5 같은 정규식, `X/operations/spec.md` §4.4.7에 목록 전달 서술 없음 |
| T-19 | medium | `X/primitives/spec.md` | on 핸들러 재실행 때 상태 커밋 재생 결과와 캐시가 어긋날 수 있고 거부 코드 변환이 없다 | 부분. X에 신원 지문, `replayed.stored`, 거부 코드 확장을 두었다. 권고와 다르게 지문에서 `rev`를 뺐고 근거를 §4.6.1에 적었다. 잔여: `L1/persistence/spec.md` §3.3 변환표(`key_reused`, `busy`, `disk_full`, `read_only`), `F/extensions/spec.md` §4.3 재실행 규칙 문장 |
| T-20 | medium | `X/primitives/spec.md` | 분기·되감기 뒤 상태 복원이 가지를 구분하지 않고 상태 투영 열이 X와 group-kit에서 다르다 | 부분. X에 활성 가지 규칙과 `prev_event_id` 열을 두었다. 잔여: `L1/persistence/spec.md`에 `latestEvent` 가지 옵션 없음, `L3/group-kit/spec.md` 471~478행 `StateProjectionRow`(`session_id`, `doc_json`) 그대로 |
| T-21 | medium | `L3/learning/spec.md` | 학습 그룹 비공개 이벤트(`_ext.learning.*`)를 쓸 X API가 없고 `_ext.`와 `grp.` 표기가 섞인다 | 부분. L3.learning을 `grp.learning.*` 9종으로 바꾸고 X 요청을 적었다. 잔여: `X/primitives/spec.md`에 `ScopeApi.recordPrivate` 없음(L3.learning 비공개 기록·AC 15·16은 [미결]), `L3/group-kit/spec.md` 188·448·454행과 `L3/helm/spec.md` 295·424행의 `_ext.<그룹>.*` |
| T-22 | medium | `engineering/transactions/design.md` | 격리 확장 outbox 행이 읽기 경로 없이 정의되고 X의 상태 저장 위치와 다르다 | 부분. eng.transactions §7을 호스트 대리인 전달과 `XEON_EXT_DATA` 커서로 고쳤다. 잔여: `X/operations/spec.md` 1164행 "자기 DB 파일, outbox로 반영" |
| T-23 | medium | `F/records/spec.md` | `AppendBatch.durability`와 트랜잭션 없는 `runChunk`가 L0·L1 규칙과 다르다 | 해결 |
| T-24 | low | `engineering/context-map/design.md` | CM-02 예제가 알림 안 동기 쓰기와 커서 누락을 보인다 | 해결. `queueMicrotask`와 커서 갱신 예로 바꿨다 |

### 3.4 ④ 제품 (S)

| 번호 | 심각도 | 경로 | 문제 | 조치 결과 |
|---|---|---|---|---|
| S-01 | high | `engineering/transactions/design.md` | 결정 2(서비스 모드 1차, OS 등록만 2차)와 달리 eng 문서가 서비스 모드 자체를 2차로 적는다 | 미반영. eng.transactions 17·44·598행, `engineering/context-map/design.md` 77·203행 그대로 |
| S-02 | high | `L0/process/spec.md` | 서비스 켜기·유휴 유예·종료 시한 키가 L0·L4에 따로 있어 기본값이 다르다 | 해결. 권고(L4 소유)와 반대로 L0.process 키 하나를 남기고 L4 키를 지웠다. 기본값은 유휴 유예 60000 ms, 종료 시한 3000 ms가 된다 |
| S-03 | high | `L4/host-service/spec.md` | 자동 재개 켜기 키 셋과 재개 상한 키 둘이 L0·L1·L4에 있다 | 미반영. L4 키는 지웠으나 `L0/process/spec.md` 354·355·636행 `l0.process.autoResume.*`가 `l1.persistence.*`와 중복으로 남음. `L1/persistence/spec.md` 1252행 중복 메모도 그대로 |
| S-04 | medium | `L0/os/spec.md` | 알림은 결정 2로 1차(M3)인데 L0.os는 2차로 두고, 켜기 기본값·종류 목록·탭이 L2.dialog와 다르다 | 미반영. `L0/os/plan.md` 21행, `L0/README.md` 33행, L0.os 설정 표 그대로 |
| S-05 | medium | `L0/process/plan.md` | 원격 전송 단계가 미결(ADR-0006 §6, scope)인데 L0.process만 2차로 단정한다 | 미반영(사용자). plan 24·111행, spec 429행 "2차다"와 같은 문서 717행 미결 P-9가 함께 있다 |
| S-06 | high | `L1/agents/spec.md` | 판정 상한이 `l1.agents.judge.maxRuns`(3)와 `l2.work.goal.maxJudgments`(10) 둘이라 L2 상한에 도달할 수 없고, 판정 오류 셈과 판정 역할 키도 다르다 | 미반영. L1.agents 455·493·561행, L2.work 479·520행, L1.models 724행 그대로 |
| S-07 | medium | `L3/helm/spec.md` | `l3.helm.driveLimits` 기본값 4/8/400000이 pi 방식(기본 상한 없음)과 다르고 사용자 확인 대상(ADR-0007 §6)이다 | 미반영(사용자). 916행 그대로. ADR-0007 §3.1·§3.5의 `{turns, tokens, spawns}`는 개념 이름으로 유지했다 |
| S-08 | medium | `L2/schedule/spec.md` | `whenServiceOff` 기본 `reject`가 UC-4 대안 흐름과 다르고, 예약 안전 상한이 pi 방식 예외 목록에 없다 | 부분(사용자). `product/scope/spec.md` N11에 [제안, 예외]를 적었다. 잔여: `L2/schedule/spec.md` 1455행 기본 `reject`와 `product/usecases/spec.md` 167행, `L2/README.md` 미결 9 |
| S-09 | medium | `L1/models/spec.md` | 결정(2차)은 레이트 리밋·계정 회전을 설정 화면에 두는데 L1.models는 2차로 둔다 | 미반영(사용자). `L1/models/spec.md` 734·735행, `product/scope/spec.md` 68행 [미결] 그대로 |
| S-10 | medium | `L4/settings-ui/spec.md` | ADR-0005 ④ 첫 실행 권장 화면(검색 provider 상태, SearXNG 주소, 권장 목록)이 L4에 없다 | 부분. scope I10을 ①~③ M2, ④ M3로 나눴다. 잔여: `L4/settings-ui/spec.md`·`L4/cli/spec.md`에 해당 화면·출력 없음, `decisions/ADR-0005-web-search-default.md` 84행 키 `web.search.*` |
| S-11 | medium | `L4/settings-ui/spec.md` | L4 탭 표와 소유 층 `ui.tab`이 다르다(재시도, 비밀 승인 정책, `x.operations.*`, `l2.dialog.*`) | 미반영. 466행 budgets 행 그대로, `x.operations`·`l2.dialog`·`l0.secrets.approval` 언급 없음 |
| S-12 | medium | `product/scope/spec.md` | 비밀 열람 단계와 M1 비밀 검증 모드가 층마다 다르다 | 부분(사용자). scope UC-6에서 열람을 미결 10으로 나누고 미결 9에 근거를 더했다. 잔여: `L2/workspace/spec.md` 454행 env 모드 M1 검증, `L0/README.md` 미결 11 |
| S-13 | medium | `engineering/dependency-rules/guide.md` | 위장 provider 플러그인의 import 규칙이 DR-09와 L1.models §3.11에서 반대다 | 미반영. DR-09 364행, `L1/README.md` 272행, `X/loading-trust/spec.md` 1166행 그대로 |
| S-14 | low | `L1/agents/spec.md` | `l1.agents.*` 탭을 `agents`로 적었으나 F 12탭은 에이전트를 모델 탭에 합쳤다 | 미반영. 490·493·497·543행 그대로 |
| S-15 | low | `X/primitives/spec.md` | drive 보유 그룹 설정이 `x.primitives.activeDriveGroup`과 `l3.group-kit.driveHolder` 둘이다 | 미반영. X 145·915·1285행 그대로, L4.settings-ui에 `driveHolder` 없음 |
| S-16 | low | `architecture/runtime-flow/design.md` | §4.6 service 열이 로컬 서비스 전송을 WebSocket으로 적는다 | 해결. 로컬 소켓과 원격 [미결]로 나눴다 |

### 3.5 집계

| 관점 | 지적 | 해결 | 부분 | 미반영 |
|---|---|---|---|---|
| ① 계약 | 20 | 7 | 13 | 0 |
| ② 의존 | 16 | 2 | 4 | 10 |
| ③ 데이터 | 24 | 12 | 11 | 1 |
| ④ 제품 | 16 | 2 | 3 | 11 |
| 합계 | 76 | 23 | 31 | 22 |

## 4. 미해결 상충

부분 31건과 미반영 22건, 합계 53건이 남았다. foundation-plan §6의 "미해결 상충 0" 조건을 만족하지 못한다.

### 4.1 원인별 분류

| 원인 | 건수 | 번호 |
|---|---|---|
| 사용자 결정이 먼저 필요하다 | 10 | K-19, D-12, T-01, T-04, T-11, S-05, S-07, S-08, S-09, S-12 |
| 구속 문서(engineering, decisions) 개정이 필요한데 작성자가 기준 문서라 손대지 않았다 | 9 | D-01, D-09, D-13, D-15, S-01, S-13, K-18, T-18, D-06 |
| 이번 수정 범위에 작성자가 없는 문서에 옛 서술이 남았다(L2 전체, X.operations, X.loading-trust, X README, L0.os, L0.secrets, L1.models, L1.tools, L3.slots) | 22 | K-02, K-09, K-11, K-12, K-17, D-04, D-05, D-07, D-08, D-10, D-11, D-16, T-17, T-21, T-22, S-03, S-04, S-06, S-10, S-11, S-14, S-15 |
| 고친 층의 다른 문서나 이웃 층 문서에 옛 표기가 남았다 | 12 | K-01, K-03, K-04, K-10, K-13, K-16, D-03, T-03, T-07, T-13, T-19, T-20 |

- 한 건이 여러 원인에 걸리면 처리가 먼저 필요한 원인 하나에만 넣었다.
- 수정 결과가 권고와 다른 방향으로 간 건: S-02(L4 대신 L0 소유), T-18(접두 충돌 거부 대신 지역 이름 밑줄 금지), T-19(지문에서 `rev` 제외), K-18(`./testing` 서브패스를 두지 않음). 네 건 모두 근거가 해당 문서에 있고 상충은 만들지 않았다. K-18의 `./testing` 정리는 사용자 확인 대상이다(§5 U-03).

### 4.2 고칠 문서별 잔여

| 문서 | 남은 지적 |
|---|---|
| `F/wire-settings/spec.md` | K-04 |
| `F/extensions/spec.md` | K-04, D-10, T-19 |
| `F/records/spec.md` | K-10(`inputId`) |
| `F/conversation/spec.md` | T-13(`scopeId`) |
| F 서비스 인터페이스(서브패스 미정) | D-04 |
| `X/primitives/spec.md` | K-03, D-07, T-21, S-15 |
| `X/operations/spec.md`, `X/operations/plan.md` | D-05, T-18, T-22 |
| `X/loading-trust/spec.md` | S-13 |
| `X/README.md` | D-06 |
| `L0/README.md` | D-04, D-06, S-04, S-12 |
| `L0/os/spec.md`, `L0/os/plan.md` | K-18, D-01, S-04 |
| `L0/process/spec.md`, `L0/process/plan.md` | K-09, K-13, S-03, S-05 |
| `L0/secrets/spec.md` | K-09, K-12 |
| `L0/store/spec.md` | T-01 |
| `L1/README.md` | K-01, K-16, S-13 |
| `L1/tools/plan.md`, `L1/tasks/plan.md`, `L1/agents/plan.md` | K-01 |
| `L1/tasks/spec.md` | T-11 |
| `L1/persistence/spec.md` | S-03, T-19, T-20 |
| `L1/agents/spec.md` | S-06, S-14 |
| `L1/models/spec.md` | S-09, S-13 |
| `L2/README.md` | K-02, K-11, K-17, S-08 |
| `L2/work/spec.md` | K-02, S-06 |
| `L2/web/spec.md`, `L2/web/plan.md` | K-09, D-13 |
| `L2/knowledge/spec.md` | K-09, D-11 |
| `L2/dialog/spec.md` | K-19, D-11 |
| `L2/schedule/spec.md` | D-11, T-17, S-08 |
| `L2/workspace/spec.md` | D-08, S-12 |
| `L3/group-kit/spec.md` | D-01, T-20, T-21 |
| `L3/helm/spec.md` | T-21, S-07 |
| `L3/slots/plan.md`, `L3/learning/plan.md` | D-16 |
| `L4/settings-ui/spec.md` | K-04, S-10, S-11, S-15 |
| `L4/cli/spec.md` | S-10 |
| `L4/host-service/spec.md` | K-18 |
| `engineering/dependency-rules/guide.md` | D-01, D-06, D-09, D-12, D-13, D-15, S-13 |
| `engineering/context-map/design.md` | D-01, T-18, S-01 |
| `engineering/transactions/design.md` | S-01 |
| `engineering/domain-types/guide.md`, `engineering/events/design.md` | T-18(정규식) |
| `engineering/typescript/guide.md` | K-18 |
| `architecture/layers/spec.md` | K-19, D-13 |
| `architecture/overview/spec.md` | D-03, T-07 |
| `architecture/runtime-flow/design.md` | K-16, K-19, T-03 |
| `decisions/ADR-0002-di-cordis.md` | K-19 |
| `decisions/ADR-0003-pi-durable-fork.md` | D-08 |
| `decisions/ADR-0004-session-storage.md` | T-01, T-04 |
| `decisions/ADR-0005-web-search-default.md` | S-10 |
| `decisions/ADR-0006-process-service-mode.md` | T-04 |
| `decisions/ADR-0007-ext-points.md` | K-19, S-07 |
| `product/usecases/spec.md` | S-08 |
| `product/scope/spec.md` | S-09, S-12 |

### 4.3 위험이 큰 잔여

- T-04: accepted ADR-0004 §3.4(OS 잠금으로 소유 판정)와 L0·L1·eng(OS 잠금 + `sys_leases` epoch 펜싱)이 다르다. M0 `platform-store`의 세션 잠금 구현이 이 결정에 의존한다.
- D-01·D-04: 하위 층이 `@xeon/ext-host`를 import할 근거(DR-14 예외)와 F 서비스 인터페이스가 없으면 L0·L1 plan의 `package.json`과 서비스 주입 설계가 DR-14 검사에 걸린다. M0·M1 착수 조건이다.
- K-03·T-21: X와 F 사이 포트 정본과 `recordPrivate`가 정해지지 않아 X `ext-host` M0 구현과 L3 학습 그룹 기록 경로가 막힌다.
- S-03·S-06: 같은 동작을 두 키가 제어한다. 구현하면 어느 쪽이 적용되는지 정해지지 않는다.
- K-19: 켜기·끄기 적용 시점이 M1 스모크("drive 그룹 토글의 턴 경계 적용", foundation-plan §6) 판정 기준이다.

## 5. 사용자 결정이 필요한 [미결] 모음

이번 검토와 관련된 항목만 모았다. 문서 전체의 `[미결]` 표지는 1,161개(본문 인용 포함)이고 각 문서 끝 "미결 사항" 절에 있다.

### F

| 번호 | 문서·위치 | 내용 | 관련 지적 |
|---|---|---|---|
| U-01 | `F/README.md` §8 미결 1 (`F.conversation.spec` §10 미결 1, `product/usecases/spec.md` §10 미결 7, `product/vision/spec.md` §10 미결 6) | 사용자 결정 원문의 "턴 경계"를 단계 경계(step 종료 직후)로 읽는 해석이 의도와 같은지 | K-19 |
| U-02 | `F/README.md` §8 미결 5, `F/wire-settings/spec.md` §10 미결 1 | 승인 요청 방향. A안(내구 이벤트 + `approval.respond`)을 전제로 승인 kind를 카탈로그에 넣었다 | K-01 |
| U-03 | `F/README.md` §8 미결 10, `engineering/domain-types/guide.md` DT-06 | `./testing` 서브패스를 두지 않고 대역 구현을 F 밖에 두는 정리, `createIdFactory`를 F 런타임 로직 예외에 넣을지 | K-18 |
| U-04 | `F/wire-settings/spec.md` §10 미결 10 | 판정하지 않은 호스트 계약 요청: `settings.invalidated`, `settings.readFile`·`writeFile`, 사용량 메서드, `ThreadSummary` 후보 필드, thread 오류 kind, `turn.interrupt`의 M1 당김, `host.diagnose`, `secret.beginReveal`, 사용자 알림 | K-15 |
| U-05 | `F/records/spec.md` §10 미결 8, `L1/README.md` §14 15번 | `post.accepted` retire 안. 택하면 F.records, F.extensions, X.primitives, X README, L4.cli를 함께 고친다. 현재는 유지안 | K-10 |
| U-06 | `F/extensions/spec.md` §10, `decisions/ADR-0007-ext-points.md` §6 | `tool_call` 인자 변경 경로(지원 안 함, chain 지점 추가, `ToolCallDecision` 변형) | K-20 |
| U-07 | `F/extensions/spec.md` §10 | 매니페스트 선택 필드 `storage`·`hooks`, 위임 선언 `delegates`, `HandlerContext.ui` 추가 여부 | K-16 |
| U-08 | `F/capabilities/spec.md` §10 | `SecretMeta`, `SecretUsePolicy`, `SecretAuditRecord`를 F `secrets.ts`에 둘지 | K-12 |

### decisions

| 번호 | 문서·위치 | 내용 | 관련 지적 |
|---|---|---|---|
| U-09 | `decisions/ADR-0004-session-storage.md` §3.4, `decisions/ADR-0006-process-service-mode.md` §3.6 4번, `engineering/transactions/design.md` T-4 | 쓰기 소유 판정을 OS 잠금(생존) + `sys_leases.epoch` 펜싱으로 개정하고 `session_owner`를 `sys_leases` 표시 열로 대신할지. 승인되면 ADR-0004 §3.2 5번 FULL 문구도 함께 정한다 | T-04, T-05 |
| U-10 | `engineering/transactions/design.md` T-8, `decisions/ADR-0004-session-storage.md` §3.2 | 도구별 효과 커밋(E1~E3)을 ADR-0004 §3.2 3번 보충으로 올릴지 | T-01 |
| U-11 | `decisions/ADR-0006-process-service-mode.md` §6, `L0/process/spec.md` P-9, `product/scope/spec.md` §10 미결 8 | 원격 전송(TLS + 토큰 WebSocket)을 M3(1차)에 넣을지 2차로 둘지. 결과에 따라 UC-5, I13, L2.schedule S4, L0.process PR-18을 맞춘다 | S-05 |
| U-12 | `decisions/ADR-0007-ext-points.md` §6 | drive 임대 상한 기본값. `l3.helm.driveLimits` 4/8/400000을 pi 방식의 예외로 인정할지, `{}`로 둘지 | S-07 |

### engineering

| 번호 | 문서·위치 | 내용 | 관련 지적 |
|---|---|---|---|
| U-13 | `engineering/transactions/design.md` T-7, `L1/persistence/spec.md` §10 6번 | 커밋 키 형식 정본을 `COMMIT_KEY_PATTERN`으로 확정할지, scope id `/` 치환 규칙 포함 | T-11 |
| U-14 | `engineering/dependency-rules/guide.md` §1.1·758행 | X를 L0 아래(순위 1)에 두는 판정을 `architecture/layers/spec.md` 4.3.3 결론(순위 유지, 조건 3개)으로 닫을지 | D-06 |
| U-15 | `engineering/dependency-rules/guide.md` 762행, `architecture/layers/spec.md` §10 408행 | 같은 층 예외(`apps/cli`→`apps/host` `DR-10/cli-host`, `group-*`→`group-kit`)를 둘지 | D-12 |
| U-16 | `architecture/layers/spec.md` §10 409행 | `plugins/*` 순위와 위장 플러그인의 import 허용(DR-07·DR-09 예외) | D-13, S-13 |
| U-17 | 구속 문서 개정 승인 | 작성자가 기준 문서라 손대지 않은 engineering 개정을 진행할지: DR-14 ext-host 예외(D-01), DR-07 F 예외(D-09), DR-08·DR-14 testing 정의(D-15), 서비스 모드 1차 표기(S-01), `EXT_ID_PATTERN`·DT-08 하이픈 허용(T-18) | D-01, D-09, D-15, S-01, T-18 |
| U-18 | `engineering/context-map/design.md` 미결 C-6 | 확장 id에 밑줄·하이픈을 허용할지(ADR-0004, DT-08, X `ExtensionName`이 서로 다름) | T-18 |

### product

| 번호 | 문서·위치 | 내용 | 관련 지적 |
|---|---|---|---|
| U-19 | `product/scope/spec.md` §10 미결 9, `L0/README.md` 미결 11 | M1 비밀 검증 모드: `env` 주입(bash) 대 `withHttp` + 테스트 그룹 HTTP 도구 | S-12 |
| U-20 | `product/scope/spec.md` §10 미결 10, `L4/cli/spec.md` 548행 | 비밀 값 열람의 단계와 경로: M3 데스크톱 화면(재인증) 대 M2 CLI `secret reveal` | S-12 |
| U-21 | `product/scope/spec.md` 68행 | I14의 레이트 리밋·계정 회전을 M3로 당길지, 화면에 자리만 두고 첫 릴리즈 뒤에 채울지 | S-09 |
| U-22 | `product/scope/spec.md` N11 | 예약 안전 상한(`maxRunsPerHour`, 최소 간격, 루프 `maxIterations`)과 `l3.learning.review.maxIterations`를 pi 방식의 예외로 인정할지 | S-08 |

### L2

| 번호 | 문서·위치 | 내용 | 관련 지적 |
|---|---|---|---|
| U-23 | `L2/README.md` 미결 9, `L2/schedule/spec.md` 1455행, `product/usecases/spec.md` UC-4 | 서비스 모드가 꺼져 있을 때 예약 생성: 기본 `reject` 유지(거부 메시지에 조치 안내), `keepWithWarning`, 자동 기동 시도 중 무엇으로 할지 | S-08 |

## 6. 다음 조치

1. [제안] U-09, U-14, U-15, U-17을 먼저 받는다. M0 착수 조건(D-01, D-04, T-04)이 여기에 묶여 있다.
2. [제안] 2차 수정은 이번에 작성자가 없던 문서(§4.1 셋째 행 22건)부터 배정한다. 대상은 L2 전체, `X/operations`, `X/loading-trust`, `X/README.md`, `L0/os`, `L0/secrets`, `L1/models`, `L1/tools`, `L3/slots`다.
3. [제안] 이웃 문서의 옛 표기(§4.1 넷째 행 12건)는 해당 층 작성자가 F 반영 사실을 확인하고 "요청" 표지를 닫는다.
4. 문서 검사: `just docs-route --check --allow-missing`이 종료코드 1이다. 원인은 `L1/README.md`와 `L1/models/plan.md`의 `binds`(`xeon/plugins/provider-anthropic-oauth/**`)가 routes.yaml L1 layout과 맞지 않는 것이다. D-13(`plugins/*` 순위) 결정 뒤 routes.yaml `layout`과 함께 고친다.
5. 2차 수정 뒤 `review/consistency-final.md`에서 이 문서의 53건을 다시 대조한다(foundation-plan §5 P2).
