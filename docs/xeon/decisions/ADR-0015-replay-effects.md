---
id: adr.0015
layer: adr
domain: replay-effects
kind: adr
status: accepted
depends_on: [adr.0004, adr.0007, adr.0009, F.extensions.spec, F.capabilities.spec, X.primitives.spec]
binds: [xeon/packages/contracts/src/extensions/**, xeon/packages/contracts/src/capabilities/**, xeon/packages/ext-host/src/primitives/**, xeon/packages/group-kit/**, xeon/packages/group-helm/**, xeon/packages/group-learning/**]
---

# ADR-0015 재실행되는 확장 코드의 효과 목록: 선언형 허용(C안)

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-26(결정 2026-10-25)
- [결정] C안(선언형 허용)을 채택한다. `g.delegate`와 `loop.spawn`은 코어가 멱등을 보장한다. 능력 메서드는 F 정의에 `idempotent: true`를 선언하고 `requestId`를 받는 것만 허용한다. 읽기(replay safe) 메서드는 drive에서 허용한다. 선언 없는 쓰기는 요청 레코드와 워커를 거친다. 시험은 "재생 2회, 효과 1회"로 둔다(사용자 결정 2026-10-25, M3 설계 단계 순서 결정).
- 이 ADR은 `review.m3-plan` M3-03과 마일스톤 재점검 G1-06을 닫는다. `adr.readme` §6의 G1-06 미결, `L3.helm.spec` §10 [미결 C2], `L3.learning.spec` §10 미결 2, `L3.group-kit.spec` §3.4·§10 공통 모순 2의 결정 근거다.
- 함께 닫는 사용자 결정: `product.scope.spec` §10 미결 4(Helm 내부 설계 착수 시점)는 "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(이 ADR)"이다. 문서 반영은 §4.3 후속 작업에 적는다.
- 개정: 2026-10-26 `review.m3-design-inputs` D-M3-31 행 1·8(§6 미결 두 항목을 닫음). §3.2 on 핸들러 읽기 불허 [제안]을 [결정]으로 올린다.

## 2. 맥락

- on 핸들러는 다시 실행해도 되는 질의다. 소비 커밋 전에 프로세스가 끝나면 같은 지점이 같은 페이로드로 다시 발화한다. 그래서 핸들러의 외부 효과는 `post`(멱등 키 필수), `commit`, `record` 세 연산으로 한정했다(`F.extensions.spec` §4.3, ADR-0007).
- drive 함수는 단계 경계마다 마지막 커밋 상태로 다시 호출되고, 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다. 상태 변경은 `commit`으로만 한다(`F.extensions.spec` §4.6, `_research/decisions-log.md` 20행).
- L3 그룹 설계에는 이 목록 밖의 효과를 쓰는 곳이 있다.
  - 학습 그룹은 `agent_settled` on 핸들러에서 `g.delegate`로 검토 포크를 시작한다(`L3.learning.spec` §4.3). 지금 규칙으로는 on 핸들러에서 위임을 시작할 수 없다.
  - Helm drive의 `gatherContext`는 `knowledge.search.query`, `knowledge.memory.read`, `web.search`를 부르고, `linkWork`는 `work.tasks.create`를 부른다(`L3.helm.spec` §4.5). 능력 호출은 drive 효과 목록에 없다.
- 멱등 장치는 이미 일부 있다.
  - `loop.turn`과 `loop.spawn`의 기본 `requestId`는 `${leaseId}:${순번}`이고, 같은 순서의 재호출은 커밋된 결과를 돌려받는다(`X.primitives.spec` §4.4.4).
  - 자식 대화 생성은 `creationKey`와 `TxView.agentByRequestId`로 같은 `requestId`의 두 번째 생성을 막는다(`L1.agents.spec` §4.1 3번).
  - `CallOptions.requestId`는 선택 필드다(`F.capabilities.spec` §3.2). L2.work의 쓰기 메서드는 `requestId`를 필수로 받고 같은 키의 재호출에 처음 결과를 돌려주며, 그 근거로 `replay: "safe"`를 선언한다(`L2.work.spec` §3.1, `eng.transactions.design` TX-05).
- 문제는 F 정의만 보고 메서드가 읽기인지, 멱등 쓰기인지, 선언 없는 쓰기인지 알 수 없다는 점이다. `ReplayPolicy = "safe"`는 읽기와 멱등 쓰기에 함께 쓰인다. `ToolHints.idempotent`는 모델 도구의 검증되지 않는 작성자 힌트다(`F.capabilities.spec` §3.3).
- Helm 본체(M3-01)는 이 결정이 정해져야 착수할 수 있다(`review.m3-plan` §2 선행 열, `review.m2-plan` §9 D-a).

## 3. 결정

### 3.1 적용 범위

1. [제안] 이 ADR의 규칙은 재실행되는 확장 코드에 적용한다. 재실행되는 코드는 on 핸들러와 drive 함수 두 가지다. 명령 처리기, 도구 `execute`, 호스트 호출은 재실행되지 않는 문맥이라 이 ADR의 대상에서 뺀다. 이 문맥은 각 문서의 규칙(`L1.tools.spec` 효과 3단 커밋 등)을 따른다.
2. [제안] 호출이 어느 문맥에서 왔는지는 ambient 문맥(`withAmbient`, `X.primitives.spec` §4.4.3)으로 판별한다. 아래 규칙의 검사는 X의 연산 래퍼와 능력 래퍼(`g.capability`)가 수행한다.

### 3.2 허용 효과 표

| 효과 | on 핸들러 | drive 함수 | 멱등 보장 주체 | 조건 |
|---|---|---|---|---|
| `commit` | 허용 | 허용 | X(상태 커밋 멱등 키) | 기존 규칙(`X.primitives.spec` §4.6.1) |
| `record`, `recordPrivate` | 허용 | 허용 | X(커밋 키) | 기존 규칙 |
| `post` | 허용 | 허용 | L1 입력 큐(`(scope, requestId)`) | `requestId` 필수(기존) |
| `loop.turn` | 해당 없음 | 허용 | 코어(L1.loop, `(scopeId, requestId)`) | 기본 `requestId` 또는 결정적 명시 키 |
| `loop.spawn` | 해당 없음 | 허용 | 코어(L1.agents, `creationKey`) | 기본 `requestId` 또는 결정적 명시 키 |
| `g.delegate` | 허용 | 허용 | 코어(L1.agents, 부모 대화 + `requestId`) | `requestId` 필수, 결정적 키 |
| `g.delegateStatus` | 허용하지 않음 | 허용 | 필요 없음(효과 없음) | 읽기. 결과를 고정하려면 상태에 커밋 |
| `g.cancelDelegates` | 허용하지 않음 | 허용하지 않음 | 해당 없음 | `onDispose`와 명령 처리기에서만 부른다 |
| 능력 메서드: 멱등 쓰기(`idempotent: true`) | 허용 | 허용 | 능력 공급자(내구 기록) | `requestId` 필수, 결정적 명시 키(§3.4 3번) |
| 능력 메서드: 읽기(`readOnly: true`) | 허용하지 않음 | 허용 | 필요 없음(효과 없음) | 결과를 고정하려면 상태에 커밋 |
| 능력 메서드: 선언 없음 | 허용하지 않음 | 허용하지 않음 | 해당 없음 | §3.5 요청 레코드와 워커를 거친다 |
| 그 밖의 I/O(직접 파일·네트워크, 시각, 난수) | 허용하지 않음 | 허용하지 않음 | 해당 없음 | 기존 결정성 규칙(`L3.group-kit.spec` lint) |

- [결정] `g.delegate`와 `loop.spawn`은 코어가 멱등을 보장한다. 같은 대화에서 같은 `requestId`의 두 번째 호출은 새 자식 대화나 위임을 만들지 않고 처음 결과(`duplicate` 또는 기록된 `SpawnOutcome`)를 돌려준다. 이 보장은 프로세스 재시작 뒤에도 유지된다(키를 세션 DB에 커밋한다).
- [결정] 능력 메서드는 F 정의가 `idempotent: true`를 선언하고 `requestId`를 받을 때만 효과가 있는 호출로 허용한다.
- [결정] 읽기(replay safe) 메서드는 drive에서 허용한다.
- [결정: review.m3-design-inputs D-M3-31 행 8] on 핸들러의 읽기 메서드 호출은 허용하지 않는다. on 핸들러는 fold 시간 예산 안에서 도는 질의이고, 읽기 결과가 재실행마다 달라지면 핸들러 결과도 달라진다. 바꾸려면 §1.4 절차로 이 표를 개정한다.

### 3.3 F 메서드 정의의 선언

1. [결정] `MethodDef`에 `idempotent?: true`를 더한다. 뜻은 "같은 대화에서 같은 `requestId`로 다시 불러도 추가 효과가 없고 처음 결과를 돌려준다"이다.
2. [제안] `MethodDef`에 `readOnly?: true`를 더한다. 뜻은 "대화 상태, 세션 DB, 작업 공간, 외부 시스템 어디에도 효과를 남기지 않는다"이다. 결정 문장의 "읽기(replay safe) 메서드"를 정의에서 구별하는 표지다. 이름은 `ToolHints.readOnly`와 맞췄다(§6 미결).
   - [결정: 2026-10-28 오케스트레이터] `readOnly` 메서드는 관찰상 순수한 파생 데이터를 쓸 수 있다: 캐시, 검색 색인, 내용 주소 blob, 사용량·비용 계량, 시간과 현재 데이터만으로 정해지는 정리(제안 만료 정리, 바깥 편집을 원장에 기록하는 지연 재색인). 대화 기록, 사용자 파일과 사용자가 쓴 데이터, 외부 시스템의 상태는 바꿀 수 없다. 외부 서버의 읽기 메서드를 부르는 것은 허용한다(MCP `tools/list` 등). 유료 모델 호출처럼 비용이 드는 효과가 있는 메서드(`dialog.aside.ask`)와 공급자가 없는 메서드(`dialog.notify.emit`)는 선언 없음으로 둔다. 계량을 쓰는 읽기(`web.fetch`의 세션당 상한 카운터)는 drive 재생이 계량을 다시 소모할 수 있다.
3. [제안] `validateCapability` 규칙을 더한다.
   - `idempotent: true`인데 `replay`가 `"safe"`가 아님(생략 포함): error `idempotent_replay_unsafe`.
   - `readOnly: true`인데 `replay`가 `"safe"`가 아님: error `read_only_replay_unsafe`.
   - `idempotent`와 `readOnly`를 함께 선언: error `effect_class_conflict`. 읽기는 멱등 키가 필요 없으므로 두 표지를 겹치지 않게 둔다.
4. [제안] `replay: "safe"`이고 두 표지가 모두 없는 메서드는 선언 없는 메서드로 본다. 정적 검증은 warning `effect_class_missing`을 낸다. 기존 정의(L2.work 쓰기 등)가 표지를 더할 때까지 error로 올리지 않는다.
5. [결정] `idempotent: true` 메서드는 `requestId`를 받는다. [제안] 공급자는 `CallOptions.requestId`가 없으면 `invalid_input`으로 거부한다. X 능력 래퍼는 재실행되는 코드에서 온 호출에 `requestId`가 없으면 공급자를 부르지 않고 거부한다.
6. [제안] 멱등 쓰기의 기억은 효과와 같은 커밋에 둔다(`eng.transactions.design` TX-05). 프로세스 메모리에만 두는 멱등 표는 이 조건을 만족하지 않는다. 키 범위는 (대화, 능력 메서드, `requestId`)다.
7. `ToolHints.idempotent`는 모델 도구용 힌트로 그대로 둔다. 재실행 허용의 근거는 `MethodDef.idempotent`뿐이다.

### 3.4 `requestId` 만드는 규칙

1. [제안] 재실행되는 코드가 넘기는 `requestId`는 결정적이어야 한다. 같은 커밋 상태와 같은 페이로드로 다시 실행하면 같은 키가 나와야 한다. 멱등이 "재생 2회, 효과 1회"를 지키는 전제다.
2. [제안] 키의 재료로 쓸 수 있는 값: 커밋된 id(`turnId`, `stepId`), 커밋된 상태 문서의 값(예: 학습 그룹의 `epoch`, Helm 탐구 id), 디스패치 키. `Date.now`, `Math.random`, 클로저 지역 변수의 진행 값은 쓰지 않는다. `leaseId`는 재시작 뒤 바뀔 수 있어 `leaseId` 유지 규칙(REQ-X-04)이 닫히기 전에는 명시 키의 재료로 쓰지 않는다.
3. [제안] 기본 키는 `loop.turn`과 `loop.spawn`에만 준다(`X.primitives.spec` §4.4.4의 `${leaseId}:${순번}`). 능력 호출 가운데 읽기는 멱등 키가 필요 없으므로 `requestId`를 생략해도 된다. `idempotent` 쓰기는 drive 함수 안에서도 기본 키를 받지 않고 명시 키를 요구한다. 이유는 재시작이나 재활성화 뒤 `leaseId`가 바뀔 수 있어(`L3.helm.spec` §4.5, 요구 REQ-X-04) 기본 키가 달라지면 공급자의 (대화, 메서드, `requestId`) 멱등이 깨져 효과가 두 번 날 수 있기 때문이다. on 핸들러 안의 `g.delegate`와 능력 쓰기도 명시 키를 요구한다. 명시 키는 다른 scope와 섞이지 않게 scope id로 시작한다(예: `learning:review:<epoch>`). `leaseId` 유지 규칙이 닫히면 drive의 쓰기에도 기본 키를 줄지 다시 본다(§6 미결).
4. 길이와 형식은 `F.capabilities.spec` §3.1의 `requestId`(1~64자)를 따른다. `g.delegate`의 보고 키 접미사(`:report`)를 위해 위임 키는 48자 이하로 둔다(`L3.group-kit.spec` §3.4).

### 3.5 선언 없는 쓰기: 요청 레코드와 워커

1. [결정] 선언 없는 쓰기(멱등 표지가 없는 효과 메서드, 외부 시스템 호출)는 재실행되는 코드에서 직접 부르지 않는다. 대신 요청 레코드를 커밋하고 워커가 실행한다.
2. [제안] 순서:
   1. 핸들러나 drive 함수는 `record`(또는 상태 `commit`)로 요청을 남긴다. 레코드 본문은 메서드, 입력, 결정적 요청 키다. 재실행돼도 같은 커밋 키라 한 번만 남는다.
   2. 워커는 재실행되지 않는 문맥에서 커밋된 요청을 읽는다. 실행 전에 `started`를 커밋하고, 메서드를 부른 뒤 결과를 커밋한다. 이 순서는 도구 효과 3단 커밋(ADR-0004 E1~E3)과 같다.
   3. 재시작 뒤 `started`는 있고 결과가 없으면 결과 불명이다. 메서드 `replay`가 `"unsafe"`면 다시 부르지 않고 결과 불명으로 닫아 사용자에게 보인다. `"safe"`면 다시 부른다.
   4. 그룹은 결과 레코드를 다음 경계의 상태나 on 핸들러에서 읽는다.
3. [제안] 워커의 소유와 실행 위치는 X.primitives가 정한다. 후보는 X가 scope마다 두는 효과 워커와 L1 백그라운드 작업 경로 두 가지다(§6 미결).

### 3.6 재생 2회, 효과 1회 시험

1. [결정] 재실행되는 코드와 멱등 메서드는 "재생 2회, 효과 1회" 시험을 둔다. 같은 커밋 상태와 같은 입력으로 두 번 실행해도 외부 효과는 한 번만 생겨야 한다.
2. [제안] 시험 세 가지:
   - 그룹 시험(`replayDrive` 확장, `L3.group-kit.plan` G-20): 기준 실행의 모든 커밋 지점에서 끊고 재개한다. 끊기 직전의 drive 호출과 on 핸들러를 두 번 실행한다. 가짜 포트(`LoopPort`, 위임 서비스, 능력 공급자)의 효과 계수기로 turn, spawn, delegate, 능력 쓰기, post가 각각 한 번인지 확인한다. 반환값 비교만으로는 통과로 보지 않는다.
   - 능력 적합성 시험(공급자 패키지마다): `idempotent: true` 메서드를 같은 `requestId`로 두 번 부르고, 사이에 저장소를 닫았다 다시 연다. 이벤트·행·외부 호출이 한 번이고 두 번째 결과가 처음 결과와 같아야 한다. `readOnly: true` 메서드는 호출 전후 세션 DB 이벤트 수가 같아야 한다.
   - X 래퍼 시험(`X.primitives.plan`): drive·on 문맥에서 선언 없는 메서드 호출은 `effect_not_allowed`로 거부되고 공급자가 불리지 않는다. on 문맥의 읽기 호출도 거부된다. 재실행되는 코드의 `idempotent` 호출에 `requestId`가 없으면 거부된다.
3. [제안] 효과 계수 규칙은 `X.primitives.spec` §4.4.3의 `effects`에 맞춘다. 재생된 `loop.turn`·`loop.spawn`, `duplicate`인 `post`·`g.delegate`, 처음 결과를 돌려준 멱등 능력 호출은 효과로 세지 않는다. 읽기 호출도 효과가 아니다.

## 4. 결과

### 4.1 좋은 점

- 학습 그룹은 `agent_settled`에서 바로 `g.delegate`를 부를 수 있다. 레코드를 남기고 다음 경계에서 위임하는 우회가 필요 없다.
- Helm의 `gatherContext`(읽기)와 `linkWork`(`work.tasks.create`, 멱등 쓰기)가 규칙 안에 들어온다. Helm 본체 설계가 F 예외 없이 진행된다.
- 허용 여부가 F 정의의 선언으로 정해진다. X는 정의만 보고 기계적으로 검사하고, 공급자는 적합성 시험으로 선언을 증명한다.
- 선언 없는 쓰기도 막히지 않는다. 요청 레코드와 워커로 같은 일을 할 수 있다.

### 4.2 감수할 점

- F `MethodDef`에 필드 두 개가 늘고, 기존 L2 정의를 모두 다시 분류해야 한다. `replay: "safe"`인 쓰기 메서드(L2.work, L2.knowledge 등)는 `idempotent: true`를 더하고 내구 멱등 기록을 증명해야 한다.
- 읽기 메서드는 재실행마다 다시 불린다. `web.search`처럼 호출마다 비용이 드는 읽기는 재생 횟수만큼 비용이 든다. 결과를 고정하거나 비용을 줄이려면 그룹이 결과를 상태에 커밋한다(Helm은 `converged` 커밋에 요약을 넣는다).
- 선언이 틀려도(멱등이 아닌데 `idempotent: true`) 타입으로 막을 수 없다. 적합성 시험이 유일한 확인 수단이다. 외부 확장이 공급하는 능력은 시험을 강제할 수 없으므로 신뢰 등급 정책이 필요하다(§6 미결).
- 워커 경로는 결과가 한 경계 늦게 들어온다.

### 4.3 후속 작업

이 ADR을 쓴 작업은 L3 문서 일부를 함께 고쳤고 나머지는 M3 설계 단계(F·X·L1 요구 작업)에서 반영한다. 상태 열은 2026-10-26 작업 트리 기준이다.

| 문서 | 고칠 내용 | 상태 |
|---|---|---|
| `F.capabilities.spec` §3.2, §4.6, §9, §10 | `MethodDef.idempotent?: true`, `readOnly?: true`(§3.3), `validateCapability` 코드 4개, 공통 오류 `effect_not_allowed`(§3.6 표), 수용 기준 | 반영(F, M3a A2) |
| `F.extensions.spec` §4.3, §4.6, §3.2 | on 핸들러와 drive 함수의 효과 목록을 §3.2 표로 바꾼다. `LoopHandle` 주석("유일한 통로")을 고친다. `requestId` 결정성 규칙(§3.4) | 반영(F, M3a A2. 표는 `REPLAY_EFFECT_TABLE`) |
| `F.README` | M3로 넘긴 요청 목록의 "효과 목록(G1-06)"을 이 ADR로 닫는다 | 대기 |
| `X.primitives.spec` §4.4.3, §4.4.4, §4.6, §9 | 능력 래퍼의 문맥 검사, drive 쓰기 호출의 명시 키 요구(§3.4 3번), `effects` 계수 규칙, 워커 소유(§3.5) | 대기 |
| `L1.loop.spec` §4.8 | drive 효과 목록 문장을 이 ADR로 바꾼다 | 대기 |
| `L1.agents.spec` | `delegate`의 (부모 대화, `requestId`) 멱등이 재시작 뒤에도 유지된다는 문장과 시험 | 대기 |
| L2 각 spec(`work`, `knowledge`, `web`, `dialog`, `mcp`, `workspace`) | 메서드마다 `readOnly`·`idempotent`·선언 없음 분류. 멱등 쓰기의 내구 기록 근거 | 반영(M3a A4 T-L2). `artifacts`, `schedule`은 정의가 없어 해당 패키지 구현 때 분류한다 |
| L2 각 plan | 능력 적합성 시험(§3.6 2번 둘째 항목)을 공급자 패키지마다 단위 테스트 목록에 더한다 | 대기 |
| `L3.group-kit.spec` §3.4, §10 | on 핸들러 `delegate` 허용, 공통 모순 2 닫음 | 반영 |
| `L3.group-kit.spec` §3.10 / plan G-20 | `replayDrive`의 효과 계수 확인(§3.6 2번 첫째 항목), `delegateStatus`·`cancelDelegates`·`report?`·`GroupStatus.drive "rejected"` 작업 | 반영(group-kit plan G-20 확장, G-28~G-30 추가) |
| `L3.helm.spec` §4.5, §4.11, §10 C2 | `gatherContext`는 읽기, `linkWork`는 멱등 쓰기로 적고 C2를 닫는다 | 반영 |
| `L3.learning.spec` §4.3, §4.10, §10 미결 2 | 대체안(요청 레코드 + L1-g 워커) 문단을 정리하고 미결 2를 닫는다 | 반영 |
| `L3.slots.spec` §10 | 공통 모순 2를 닫음으로 적는다 | 반영 |
| `L3.readme` §10.2 미결 2 | 공통 모순 2를 닫음으로 적는다 | 대기 |
| `review.m3-plan` §2, §6, §7 | M3-03 완료 표시, §7 미결 "`product.scope.spec` §10 미결 4" 닫음 | 대기(M2 마감 작업) |
| `product.scope.spec` §10 미결 4 | "M2 마감 직후, M3 설계 단계 첫 트랙. 선행은 M3-03(ADR-0015)"으로 닫는다 | 완료(M3 설계 결정 반영, 2026-10-26) |

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| A. 목록 고정 | 효과는 지금 목록(`post`, `commit`, `record`, drive의 `loop.turn`·`loop.spawn`)만 둔다. 위임과 능력 호출은 모두 요청 레코드와 워커를 거친다 | 채택하지 않음 | F 변경이 없고 규칙이 가장 단순하다. 학습 검토 포크와 Helm `linkWork`가 모두 한 경계 늦어지고, 읽기 호출까지 워커를 거쳐 Helm `gatherContext`가 여러 경계로 쪼개진다 |
| B. 이름 목록 허용 | `g.delegate`, `loop.spawn`, 그리고 Helm·학습이 쓰는 능력 메서드 이름을 F 문장에 예외로 적는다 | 채택하지 않음 | 지금 필요한 것만 빠르게 연다. 새 그룹이나 새 메서드마다 F 문장을 고쳐야 하고, 메서드가 실제로 멱등인지 확인하는 장치가 없다 |
| C. 선언형 허용(채택) | 코어 연산은 코어가 멱등을 보장하고, 능력 메서드는 F 정의의 `idempotent: true`·`readOnly: true` 선언으로 허용 여부를 정한다. 선언 없는 쓰기는 요청 레코드와 워커 | 채택 | 허용 기준이 정의 한 곳에 있고 시험으로 증명된다. 그룹이나 메서드가 늘어도 F 문장을 고치지 않는다. 비용은 F 필드 추가와 L2 재분류다 |

## 6. 미결 사항

- 닫음 [제안: M3-REQ-01, 2026-10-28 F 구현]: 표지는 `MethodDef.readOnly?: true`와 `idempotent?: true` 두 필드다. 열거 `effect`는 두지 않는다. 기존 `replay` 필드와 겹치지 않고 `ToolHints.readOnly`와 이름이 같다. 코드 `xeon/packages/contracts/src/capabilities/method.ts`.
- 닫음 [결정: review.m3-design-inputs D-M3-31 행 8]: on 핸들러의 읽기 메서드 호출은 허용하지 않는다(§3.2).
- [미결] 요청 레코드 워커의 소유(X 효과 워커 또는 L1 백그라운드 작업)와 결과 통지 방법(§3.5).
- 닫음 [결정: M3-REQ-31, B3-SEC]: 능력의 현재 공급자가 내장 확장일 때만 `idempotent` 선언을 믿는다. 외부 확장 공급자의 `idempotent` 메서드는 재실행되는 문맥에서 선언 없음으로 본다. 규칙은 `X.loading-trust.spec` §4.6.4, 구현은 `ext-host` `capability-guard.ts`다.
- 닫음 [결정: review.m3-design-inputs D-M3-31 행 1]: `safe|unsafe`를 유지한다. 옛 질문: `ReplayPolicy` 값 이름(`safe|unsafe` 대 `never|safe`). 이 ADR은 현행 F 표기 `safe|unsafe`(`F.conversation.spec` §3.6)를 쓴다(§3.3, §3.5). `F.records.spec` §10 미결 4가 사용자 확인 대상이라고 적었으므로 사용자 답(`review.m3-design-inputs` D-M3-31 행 1)이 바뀌면 §3.3의 검증 규칙 이름과 §3.5의 값도 함께 바꾼다.
- [미결] drive의 `idempotent` 쓰기에 기본 키를 줄지. `leaseId` 유지 규칙(REQ-X-04)이 닫힐 때까지는 명시 키만 받는다(§3.4 3번).
- [가정] `L2.knowledge`의 쓰기 메서드가 `CallOptions.requestId = idempotencyKey`로 내구 멱등을 이미 보장한다고 본다(`L3.learning.spec` §3.6). 적합성 시험으로 확인한다.
