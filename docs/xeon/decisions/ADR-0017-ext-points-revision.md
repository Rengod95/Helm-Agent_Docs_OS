---
id: adr.0017
layer: adr
domain: extension-points
kind: adr
status: accepted
depends_on: [adr.0007, adr.0013, adr.0015, F.extensions.spec, X.primitives.spec, X.loading-trust.spec, review.m3-design-inputs]
binds: [xeon/packages/contracts/src/extensions/**, xeon/packages/ext-host/**, xeon/packages/core-loop/**, xeon/packages/group-kit/**]
---

# ADR-0017 확장 지점 개정: 자체 이름 규칙, collect fold, 지점별 실패 정책, 수명주기·가드레일 지점, pi 어댑터 없음

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-26
- [결정] 확장 지점 표를 권고 확장안으로 개정한다. 현행 a안(연산 4개와 fold 3종, 지점 종류 5개)을 바탕으로 4번째 fold `collect`, 지점 선언이 정하는 지점별 실패 정책 표, 수명주기 지점을 더한다. 지점 이름은 자체 규칙으로 정리한다. ADR-0007을 개정하고 M3-15에서 pi 어댑터를 지운다(사용자 결정 2026-10-26, `review.m3-design-inputs` D-M3-10).
- [결정] 외부 확장은 pi 호환 없이 자체 확장 API만 쓴다(사용자 결정 2026-10-26, D-M3-11 c).
- [결정] 입출력 가드레일은 내장 검사를 두지 않고 fail-closed 지점 셋(모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전)을 제공한다(사용자 결정 2026-10-26, D-M3-30 행 1).
- 이 ADR은 ADR-0007을 부분 대체한다(`adr.readme` §1.4 부분 번복). 이어받는 부분과 바꾸는 부분은 §3.1에 나눠 적는다.

## 2. 맥락

- ADR-0007은 연산 4개(`on`, `post`, `drive`, `scope`)와 fold 3종(`tap`, `first`, `chain`)을 [결정]으로, 지점 종류 5개, 지점 이름(pi 이벤트명 snake_case), 지점별 fold 배정을 [제안]으로 두었다. 미결은 넷이었다: fold 3종으로 충분한지, `first` 실패를 모든 지점에서 거부로 볼지, 지점 목록 합의, 그룹 간 이벤트 격리(ADR-0007 §6).
- pi 이벤트 41종의 fold 분포는 tap 22, 제자리 변경 tap 1, first 7, chain 9, collect 2다(`F.extensions.spec` §3.4, `_research/notes/F-1.md` §2.6). F는 collect 2종과 boundary 엔트리 추가를 chain 교체와 `finalize` 표지로 표현했다(`F.extensions.spec` §4.1).
- pi는 `session_before_*`와 `project_trust`에서 핸들러 예외를 모으고 계속한다(fail-open). F 표는 `first` 전부를 fail-closed로 두었다.
- L3 Helm·학습 설계는 지점 밖 Xeon 고유 이벤트(위임 정착 `agent.settled`, 임대 거부 `lease.rejected`)를 구독해야 한다(`L3.learning.spec` §8.1 REQ-LN-02, `review.m3-lower-requirements` M3-REQ-99).
- pi 확장 어댑터(X.5)는 M2 이후 범위로 설계만 있었다(`X.loading-trust.spec` §4.10). pi 이름을 정본으로 둔 이유는 pi 확장을 거의 수정 없이 올리기 위해서였다(ADR-0007 §4.1). 이 목표를 두지 않으면 pi 이름에 묶일 이유가 없다.
- 2026-10-26 조사: pi, Claude Code, Codex CLI는 내장 콘텐츠 가드레일이 없다. 셋 다 훅·확장 이벤트와 권한·샌드박스로 막는다. OpenAI Agents SDK는 입력·출력·도구 가드레일 프레임워크를 둔다(`L3.slots.spec` §3.2.4).

## 3. 결정

### 3.1 ADR-0007과의 관계

| ADR-0007 항목 | 처리 |
|---|---|
| §3.1 연산 4개, §3.5 v1 필드 처리(실패 정책 행 제외), §3.6 임대와 켜고 끄기 | 그대로 이어받는다 |
| §3.2 fold 3종 | 바꾼다. fold는 4종이다(§3.3) |
| §3.3 지점 종류와 pi 이름 정본 | 바꾼다. 종류는 7개(§3.5, §3.6)이고 이름은 자체 규칙이다(§3.2) |
| §3.4 리소스 등록은 pi API를 따른다 | 바꾼다. 리소스 등록은 자체 확장 API(`F.extensions.spec` 등록 연산)를 따른다(§3.7) |
| §3.5 실패 정책 행(세 줄 규칙) | 바꾼다. 지점별 실패 정책 표(§3.4) |
| §4.1 pi 호환 좋은 점, §5.2 가드레일 보류 행 | 이 ADR의 §3.6·§3.7로 대체한다 |

### 3.2 이름 규칙

1. [결정] 지점 이름은 pi 이벤트명(snake_case)을 정본으로 두지 않는다. Xeon 자체 규칙으로 정리한다.
2. [결정] 새 이름 표는 M3 F 첫 작업이 `F.extensions.spec` §3.4에 정한다. 코드 `POINTS`와 L1·X·L3 문서의 지점 이름은 같은 작업에서 바꾼다.
3. [제안] 규칙 초안: 소문자 점 표기 `<종류>.<대상>[.<시점>]`이다. 시점 단어는 `before`, `after`다. 예: `tool_call` → `tool.call.before`, `tool_result` → `tool.result`, `before_agent_start` → `input.agent.before`, `turn_end` → `boundary.step.after`. 점 표기는 레코드 kind(`grp.<id>.<영역>.<이름>`)와 같은 모양이라 읽기 규칙이 하나다. 별칭은 두지 않는다.
4. [제안] Xeon 용어(turn, step)와 pi 용어(agent, turn)가 다른 곳은 Xeon 용어를 쓴다(`F.extensions.spec` §3.4 "pi와 차이" 열의 대응을 따른다).

### 3.3 fold 네 종류

[결정] fold는 `tap`, `first`, `chain`, `collect` 넷이다. 합성 방식은 지점을 선언할 때 정한다(ADR-0007 §3.2 원칙 유지).

| fold | 합성 | 쓰는 곳 |
|---|---|---|
| `tap` | 모든 핸들러가 받는다. 반환값은 쓰지 않는다 | 관찰 |
| `first` | 첫 결정이 이긴다 | 허가·차단 |
| `chain` | 앞 핸들러의 결과를 뒤 핸들러가 이어받는다 | 값 변형 |
| `collect` | 모든 핸들러가 원본 페이로드를 받고, 반환값을 등록 순서대로 목록에 모은다. 병합은 지점의 순수 함수가 한 번 한다 | 추가(누적) |

- [제안] `collect` 배정 후보: `resources_discover`(경로 추가), `before_agent_start`의 message 수집, boundary 지점의 엔트리 추가. 최종 배정은 §3.2 2번 작업에서 F 표에 적는다. chain 교체와 `finalize` 표지로 이미 쓴 지점은 배정이 바뀌면 같은 작업에서 고친다.

### 3.4 지점별 실패 정책

1. [결정] 핸들러 실패 정책은 지점 선언이 정한다. fold가 기본값을 주고, 지점 선언이 그 지점의 값을 표에 적는다.
2. [결정] 역할별 기본값:

| 지점 역할 | 기본 실패 정책 | 예 |
|---|---|---|
| 권한·차단(`first`) | fail-closed. 핸들러 예외는 그 지점의 거부값이다 | 도구 호출 허가, 사용자 bash, 프로젝트 신뢰, 가드레일 지점 셋 |
| 관찰(`tap`) | fail-open. 기록하고 계속한다 | 도구 실행 시작·끝, 세션 시작 |
| 추가(`collect`) | fail-open. 그 핸들러의 몫만 버리고 계속한다 | 자원 탐색 |
| 변형(`chain`) | 그 핸들러의 패치만 버리고 계속한다 | 컨텍스트, 도구 결과 |

3. [제안] 기본값과 다른 지점: `session_before_compact`(취소 결정, `first`)는 fail-open이다. 컨텍스트가 넘친 상태에서 핸들러 예외로 컴팩션이 막히면 대화를 이어 갈 수 없기 때문이다. 다른 `session_before_*`는 fail-closed다. 예외 목록은 F 표의 실패 열이 정본이다.
4. [제안] 지점 선언에 `failure: "closed" | "open" | "skip"` 필드를 둔다. 값이 fold 기본값과 다르면 선언에 사유 주석을 단다(`review.m3-lower-requirements` M3-REQ-12).

### 3.5 수명주기 지점

1. [결정] 루프 밖 Xeon 고유 수명주기 이벤트를 지점으로 연다. 새 종류 `lifecycle`을 둔다.
2. [결정] 첫 목록은 L3 요구에서 나온 것만 연다. 위임 정착(`agent.settled`, `L3.learning.spec` REQ-LN-02)과 임대 거부(`lease.rejected`, M3-REQ-99)다. 다른 수명주기 이벤트는 요구가 생길 때 더한다.
3. [제안] 수명주기 지점은 `tap`(관찰, fail-open)이다. 페이로드는 커밋된 내구 이벤트의 payload이고, 핸들러는 재실행되는 코드라 ADR-0015 표를 따른다.
4. 이 결정으로 `review.m3-design-inputs` §3.8 A-22("지점 5종 밖 고유 이벤트는 내구 이벤트 구독으로 다룬다")를 대체한다.

### 3.6 가드레일 지점

1. [결정] Xeon은 내장 콘텐츠 검사를 두지 않는다. 대신 가드레일 플러그인이 붙을 fail-closed 지점 셋을 제공한다.

| 지점(개념 이름) | 발화 시점 | fold | 실패 정책 | 결정 |
|---|---|---|---|---|
| 모델 요청 직전 | provider 요청 본문이 확정된 뒤, 전송 전 | `first` | fail-closed | 허용 또는 차단(사유) |
| 도구 호출 직전 | 도구 호출 허가 판정이 끝난 뒤, 실행 전 | `first` | fail-closed | 허용 또는 차단(사유) |
| 출력 표시·실행 직전 | 모델 출력이 클라이언트 표시나 다른 실행 경로(명령, 산출물 적용)로 넘어가기 전 | `first` | fail-closed | 허용 또는 차단(사유) |

2. [제안] 새 종류 `guard`를 둔다. F는 상수 `GUARD_POINTS`(`request`, `tool`, `output` 세 키)로 세 지점 이름을 내보내고, 결정 타입은 `GuardDecision`이다. 이름 값은 §3.2 규칙으로 정한다(초안: `guard.model.before`, `guard.tool.before`, `guard.output.before`). 가드 지점은 같은 대상의 일반 지점(`before_provider_request`, `tool_call`)의 모든 핸들러가 끝난 뒤 최종 값으로 발화한다. 가드 핸들러는 값을 바꾸지 않고 허용·차단만 정한다.
3. [제안] 차단은 해당 동작을 실행하지 않고 사유를 기록한다. 모델 요청 차단은 turn을 오류로 끝내고, 도구 호출 차단은 거부 결과를 모델에 돌려주고, 출력 차단은 표시를 가린 표지와 사유를 보인다. 저장 제외 범위는 `L1.loop.spec`이 정한다.
4. [제안] 핸들러가 없으면 발화 비용이 없다. 예시 플러그인 골격은 `L3.slots.spec` §3.2.4의 `guardrail`이다.

### 3.7 외부 확장과 pi

1. [결정] 외부 확장은 자체 확장 API(`F.extensions.spec` 매니페스트, `ScopeApi`, 등록 연산)만 쓴다. pi 확장 어댑터(X.5), pi 가상 모듈(`pi-coding-agent` shim, `pi-agent-core`), pi 확장 디렉터리(`pi-extensions/`)와 설정 `x.loading-trust.piCompat`을 두지 않는다.
2. [결정] M3 외부 확장 범위는 로더(자체 API 확장, `.xeon-plugin/plugin.json`)와 안전 모드다(D-M3-11 행 1 c).
3. [가정] 비협조 확장 코드는 같은 프로세스의 한계를 받아들이고 자동 끄기로 보완한다. 그룹별 프로세스 격리는 M4에서 다시 본다(D-M3-11 행 5는 답이 없어 권고를 적었다).
4. [제안] 기본 플러그인(Helm, D-M3-01 c)과 외부 확장이 import하는 Xeon 모듈(`@xeon/contracts`, `@xeon/group-kit`, `typebox`)은 X 로더가 가상 모듈로 등록한다(`X.loading-trust.spec` §4.10.6의 등록 수단을 자체 모듈에만 쓴다).

## 4. 결과

### 4.1 좋은 점

- 지점 이름이 Xeon 용어와 같은 모양이 되어 turn·step 대응을 따로 외울 필요가 없다.
- 누적 지점(`collect`)이 chain 교체로 흉내 내지 않고 바로 표현된다.
- 실패 정책이 지점 선언 한 곳에 있어 pi와의 차이(`session_before_compact`)를 예외로 기록할 수 있다.
- 학습·Helm이 쓰는 수명주기 이벤트를 같은 `on` 연산으로 받는다. 별도 구독 API가 필요 없다.
- 가드레일 플러그인이 붙을 지점이 정해져 있고, 검사 정책은 사용자가 고른다.
- pi 어댑터 범위(가상 모듈, 지원 표, 호환 보고)가 사라져 M3 외부 확장 작업이 줄어든다.

### 4.2 감수할 점

- pi 확장을 그대로 올릴 수 없다. pi 확장 사용자는 자체 API로 옮겨야 한다.
- M2 코드의 지점 이름을 모두 바꾼다. F `POINTS`, L1 디스패치, X 검증, 테스트 그룹, L3 문서가 한 작업에서 함께 바뀐다.
- fold가 4종이 되어 X 디스패치 래퍼와 F 타입(`PointSignatures`)에 분기가 하나 는다.
- 가드 지점은 일반 지점 뒤에 한 번 더 디스패치한다. 핸들러가 있을 때만 비용이 든다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| a. 현행 표 승인 | pi snake_case 정본, fold 3종, boundary는 chain + `finalize` | 채택하지 않음(바탕으로만 씀) | pi 호환을 목표로 두지 않으므로 pi 이름의 이점이 없다. 누적과 실패 예외를 표현하는 수단이 없다 |
| b. collect만 추가 | a + `collect` | 채택하지 않음 | 지점별 실패 예외를 표현하지 못한다 |
| c. 실패 예외 표만 추가 | a + 지점별 fail-open 예외 | 채택하지 않음 | 누적 지점이 chain 교체로 남는다 |
| pi 어댑터 최소형 | 도구·명령·`on` 지점만 pi API로 받음 | 채택하지 않음 | 사용자 결정 D-M3-11 c. 자체 API 하나로 문서·시험 범위를 줄인다 |
| 내장 가드레일 검사 | 패턴·분류기 검사를 코어에 둠 | 채택하지 않음 | 사용자 결정 D-M3-30 행 1. 조사한 코딩 에이전트 런타임도 내장 검사를 두지 않는다 |

## 6. 미결 사항

- [결정: 2026-10-28 오케스트레이터] 자체 이름 표는 `F.extensions.spec` §3.4가 정본이다. lifecycle 지점은 `lifecycle.agent.settled`, `lifecycle.lease.rejected`로 종류 접두 규칙을 지키고, 내구 레코드 kind(`agent.settled`, `lease.rejected`)는 다른 이름 공간으로 둔다. 둘의 대응은 `LIFECYCLE_POINTS` 표 하나다. 명사형 마지막 마디는 `update`, `failed`, `start`, `shutdown`, `stream`을 허용한다. 옛 `agent_settled`는 `boundary.settle.after`다.
- [결정: 2026-10-28 오케스트레이터] `collect`는 `input.agent.before`와 `session.resources`에만 배정한다. boundary 엔트리 추가(`boundary.step.after`, `boundary.settle.before`)는 chain + `finalize`로 둔다. `collect`로 옮기면 `entries`가 교체에서 추가로 바뀌므로 Helm·학습 설계(A5)가 필요를 보인 뒤 다시 본다. `request.cache.before`는 chain으로 둔다.
- [결정: 2026-10-28 오케스트레이터] 가드 출력 페이로드는 최소형 `GuardOutputPayload { threadId, turnId, target: "display" | "execution", content }`이고 `target` 값은 [가정]이다. 가드 결정은 `{ block: true, reason }`이며 값이 없으면 통과다.
- [결정: 2026-10-28 사용자] 외부 훅(`X.operations.spec` §3.7)은 M3 밖이고 M4로 옮긴다. 근거는 D-M3-11 행 1 c안 원문("로더·안전 모드만")이다. 이 ADR은 외부 훅을 M3 범위에 넣지 않는다(§3.7 2번).
- [미결] 그룹 간 이벤트 격리(ADR-0007 §6 같은 항목). REQ-X-05가 정한다.
- [가정] 가드 지점의 출력 대상(표시와 실행 경로)은 L1·L4 출력 경로 목록이 정해진 뒤 확정한다.
