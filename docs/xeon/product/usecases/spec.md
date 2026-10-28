---
id: product.usecases.spec
layer: product
domain: usecases
kind: spec
status: draft
depends_on: [product.vision.spec, adr.0005, adr.0006, adr.0007]
binds: []
---

# 유즈케이스

## 1. 목적과 범위

### 1.1 정하는 것

- Xeon의 주 유즈케이스 6개(UC-1~UC-6)와 보조 유즈케이스 4개
- 유즈케이스마다 행위자, 사전 조건, 주 흐름, 대안·실패 흐름, 관여 층과 패키지, 수용 기준
- 유즈케이스 x 층 매트릭스

UC 번호(UC-1~UC-6)는 고정 식별자다. `product.scope.spec`과 `architecture.runtime-flow.design`이 이 번호를 인용한다.

### 1.2 다루지 않는 것

- 유즈케이스가 처음 동작하는 마일스톤: `product.scope.spec` 5절
- 메시지 순서, 트랜잭션 경계 같은 런타임 흐름의 상세: `architecture.runtime-flow.design`
- Helm과 학습 그룹의 내부 설계: `L3.helm.spec`, `L3.learning.spec`

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 행위자 | 유즈케이스를 시작하거나 그 결과를 받는 주체. 사용자, 모델, 그룹, 서비스 프로세스, 원격 클라이언트. |
| 입력 큐 | 사용자 입력과 `post` 항목이 들어가는 내구 큐. L1-a(`core-tasks`)가 소유한다. |
| 큐 모드 | `post`의 `when` 값. 정의는 ADR-0007 §3.1 표를 따른다. `steer`는 다음 도구 라운드 뒤 입력으로 들어간다. `followUp`은 에이전트 정착 뒤 입력으로 들어간다. `next`는 경계 뒤 정확히 한 요청에 들어간다. `next`가 그 요청을 스스로 시작하는지는 [미결](ADR-0007 §6)이다. |
| 단계 경계 | step(모델 요청 한 번과 그 도구 실행)이 끝나고 다음 step이 시작하기 전의 지점이다. `turn_end` 지점 처리 직후이며 한 턴 안에 여러 번 있다. 그룹 켜기·끄기, drive 임대 부여, 임대 반납이 여기서 적용된다(`F.conversation.spec` §2.1, `F.extensions.spec` §4.5). 사용자 결정 원문의 '턴 경계'는 이 지점으로 읽는다 [결정: review.decisions-2 U-01]. |
| 공유 서비스 모드 | `xeon service`. 클라이언트가 없으면 자동 기동하고 연결과 작업이 없으면 유휴 종료하는 엔진 프로세스. ADR-0006. |
| 모델 테이프 | 기록해 둔 모델 응답을 재생하는 테스트용 가짜 모델. `eng.testing.guide`. |

패키지 이름은 `_routing/routes.yaml`의 layout을 따른다. L4 앱은 `apps/cli`, `apps/desktop`, `apps/host`, 설정 화면은 `apps/desktop/src/settings`(이하 settings-ui)다.

## 3. 인터페이스

해당 없음. 각 유즈케이스가 쓰는 서비스 API와 도구의 시그니처는 관여 층의 spec이 정한다.

## 4. 동작 규칙: 주 유즈케이스

### UC-1 대화

기본 대화다. M1의 걸어 다니는 골격(foundation-plan.md §5 P4)이 이 유즈케이스다.

- 행위자: 사용자, 모델
- 사전 조건
  - 모델 provider 하나가 설정되어 있다. 키는 `secret://` 참조로 등록되어 있다(UC-6).
  - 작업 폴더가 정해져 있다. OS 샌드박스가 켜져 있다(기본값).
- 주 흐름
  1. 사용자가 CLI(`xeon chat`) 또는 데스크톱에서 입력한다. 두 클라이언트는 같은 호스트 계약으로 엔진에 입력을 보낸다.
  2. 입력이 입력 큐에 들어가고, 실행 중인 턴이 없으면 새 턴이 시작된다.
  3. 컨텍스트가 조립되고 모델 요청이 나간다. request 종류 지점(`before_agent_start` 등)의 chain 핸들러가 있으면 요청이 형성된다.
  4. 모델이 도구를 호출하면 `tool_call` 지점(tool 종류)의 first 핸들러와 정책 엔진을 거쳐 실행된다. 기본 도구는 `read`, `ls`, `bash`다. `bash`는 OS 샌드박스 안에서 실행되며, 샌드박스 범위 안의 명령은 매번 묻지 않는다(layer-plan-v2-notes.md "OS 샌드박스가 왜 필요한가").
  5. 도구 결과와 완성된 메시지 파트가 이벤트로 저장되고 투영이 같은 트랜잭션에서 갱신된다. 스트리밍 토큰은 휘발 이벤트로 클라이언트에 전달된다.
  6. 모델이 도구 호출 없이 답하면 턴이 끝난다. step마다 그 step이 끝난 직후 단계 경계 처리가 실행된다.
- 실행 중 입력(큐 모드)
  - 사용자가 실행 중에 입력하면 기본 큐 모드로 큐에 들어간다. 기본 모드는 설정으로 정한다(L4 "실행과 서비스" 탭).
  - `steer`: 다음 도구 라운드 뒤 입력으로 들어간다.
  - `followUp`: 에이전트 정착 뒤 입력으로 들어간다.
  - `next`: 경계 뒤 정확히 한 요청에 들어간다. 이 입력이 그 요청을 스스로 시작하는지는 [미결](ADR-0007 §6)이다.
  - 같은 `requestId`로 두 번 들어온 입력은 한 번만 반영된다.
- 대안·실패 흐름
  - 샌드박스 범위 밖 쓰기나 금지 도메인 접근: 샌드박스가 거부하고 도구 결과에 거부 사유가 들어간다. 모델은 다음 행동을 고른다.
  - 사용자 중단: 진행 중인 도구에 취소가 전파되고 턴이 중단 상태로 기록된다.
  - 컨텍스트 한도 초과: 컴팩션 후 재시도한다(L1-e).
  - 같은 세션을 다른 프로세스가 실행 중: 세션 잠금을 얻지 못하고 위임, 관찰, 분기 중 하나를 고른다(process.md §6.3).
  - 프로세스 강제 종료: 다음 열기에서 재개 후보로 표시된다(보조 유즈케이스 재개).
- 관여 층과 패키지
  - F `contracts`, X `ext-host`, L0 `platform-exec`, `platform-sandbox`, `platform-store`, `platform-secrets`
  - L1 `core-tasks`, `core-loop`, `core-models`, `core-tools`, `core-context`, `core-persistence`
  - L2 `cap-workspace`, L4 `apps/cli`, `apps/desktop`, `apps/host`
- 수용 기준
  - 모델 테이프로 `xeon chat` 한 턴을 실행하면 `read`, `ls`, `bash` 호출과 결과가 이벤트로 저장되고, 같은 DB를 다시 열었을 때 투영에서 같은 대화가 복원된다.
  - 도구 실행 중 `steer`로 넣은 입력은 그 턴의 다음 모델 요청에 포함된다.
  - `next`로 넣은 입력의 수용 기준은 ADR-0007 §6 [미결](`next`가 요청을 스스로 시작하는지)이 정해진 뒤에 쓴다.

### UC-2 탐구(Helm)

모르는 분야의 지식과 새 관점을 현재 작업에 적용하는 발견 지원이다. 근거는 layer-plan-v2-notes.md "Helm이 보이는 모양(의사코드)"와 decisions-log 2026-10-21 사용자 의중이다. [미결] 단계 이름, 렌즈 목록, 종료 판정 같은 내부 설계는 `L3.helm.spec`으로 위임한다. 착수 시점은 `product.scope.spec` 미결 사항에 있다.

- 행위자: 사용자, 모델, Helm 그룹, 서브에이전트(explorer)
- 사전 조건
  - UC-1이 동작한다.
  - Helm 그룹이 켜져 있다. 켜기는 다음 단계 경계에서 적용된다.
  - drive 임대를 다른 그룹이 가지고 있지 않다.
- 주 흐름
  1. 사용자가 작업 중에 모르는 분야의 문제를 꺼낸다. Helm의 tap 핸들러가 턴 결과에서 탐구 신호를 기록한다.
  2. Helm이 탐구를 시작하면 drive 임대를 얻는다. 상한 `{maxTurns, maxSpawns, maxTokens}`가 함께 걸린다.
  3. request 종류 지점(`before_agent_start`)의 chain 핸들러가 현재 단계에 맞는 관점(렌즈)을 시스템 프롬프트에 더한다.
  4. 확산 단계 동안 `tool_call` 지점(tool 종류)의 first 핸들러가 쓰기 도구 호출을 거부한다. 읽기와 웹 검색은 허용된다.
  5. drive 함수가 렌즈마다 `loop.spawn`으로 서브에이전트를 병렬로 띄운다. 서브에이전트는 `web.search`, `web.fetch`, 지식 검색을 쓴다.
  6. 결과가 모이면 그룹 상태로 커밋한다(`g.commit`).
  7. drive 함수가 커밋된 상태에서 적용 프롬프트를 만들어 `loop.turn`을 실행한다. 이 턴에서 발견을 현재 작업에 적용한다. 파일 쓰기는 그 시점에 있는 쓰기 도구로 한다. `cap-workspace`의 `write`, `edit`이 생기기 전(M3 전)에는 쓰기 도구가 `bash`뿐이다(`product.scope.spec` §4.3).
  8. 종료 조건을 만족하거나 임대 상한에 걸리면 임대를 반납하고 일반 대화(UC-1)로 돌아간다. 발견 기록은 작업과 연결해 저장한다.
- 대안·실패 흐름
  - 사용자가 턴 중에 Helm을 끔: 다음 단계 경계에서 Helm 핸들러가 디스패치에서 빠지고 임대 반납이 기록된다. 진행 중인 `loop.turn`은 끊지 않고 정착까지 진행한 뒤 임대가 반납 상태가 되며, 정리는 Cordis dispose로 실행된다(`X.primitives.spec` §4.5.3 끄기 순서).
  - 서브에이전트 일부 실패: 실패한 렌즈는 결과에 실패로 남고 나머지 결과로 커밋한다. [가정] 부분 결과 허용 여부는 `L3.helm.spec`이 정한다.
  - 임대 상한 도달: drive 루프를 끝내고 임대를 반납한다. 상한 도달 사실을 사용자에게 표시한다.
  - 프로세스 강제 종료: 재개하면 drive 함수가 마지막 커밋 상태로 다시 호출된다. 커밋 전 서브에이전트 결과는 다시 수집한다.
  - first 핸들러가 예외를 냄: 거부로 처리한다(fold 실패 정책).
- 관여 층과 패키지
  - F `contracts`(extensions), X `ext-host`, L0 `platform-store`
  - L1 `core-loop`, `core-tools`, `core-agents`
  - L2 `cap-web`, `cap-knowledge`, `cap-work`, L3 `group-kit`, `group-helm`, L4 `apps/cli`, `apps/desktop`
- 수용 기준
  - 첫 동작 마일스톤은 M3다(`product.scope.spec` §4.5, `review.m2-plan` §9 D-a).
  - 쓰기 도구는 파일을 바꿀 수 있는 도구 전부다. `write`, `edit`이 없는 마일스톤에서는 `bash`다.
  - Helm이 확산 단계일 때 쓰기 도구 호출은 실행되지 않고 거부 사유가 모델에 돌아가며, 같은 호출은 Helm을 끈 다음 턴에서 실행된다.
  - 렌즈 N개로 탐구하면 서브에이전트 N개가 시작되고, 결과 커밋 이벤트 뒤에 적용 턴이 정확히 한 번 실행된다.

### UC-3 학습

세션이 쌓이면 학습 그룹이 스킬 md와 메타인지 피드백을 제안한다. 반복 작업 스크립트 제안은 2차 확장이다(layer-plan-v2.json L3-c 단계 '2차', `product.scope.spec` 4.5). 근거는 decisions-log 2026-10-19, 2026-10-21 계획 v2, layer-plan-v2-notes.md "Hermes 학습 루프를 별도 그룹으로"다.

- 행위자: 학습 그룹, 백그라운드 서브에이전트(검토 포크), 사용자
- 사전 조건
  - 학습 그룹이 켜져 있다. Helm과 동시에 켜져 있어도 된다. 학습 그룹은 drive를 쓰지 않기 때문이다.
  - L2 지식 능력(`cap-knowledge`)의 저장소(스킬, 메모리, 세션 검색, 변경 원장)가 열려 있다.
- 주 흐름
  1. 학습 그룹의 tap 핸들러가 턴과 세션 경계에서 카운터를 갱신한다(학습 트리거).
  2. 카운터가 임계에 이르면 검토 포크를 L1-g 백그라운드 위임(`core-agents`)으로 실행한다. 주 대화의 턴은 막히지 않는다.
  3. 검토 포크가 최근 세션을 읽고 후보를 만든다. 첫 동작(M3)의 후보는 스킬 md 초안과 메타인지 피드백이다. 반복 작업 스크립트 후보는 2차에 더한다.
  4. 후보는 승인 대기열에 들어간다. [제안] 사용자 승인 전에는 스킬, 메모리, 스크립트 파일을 바꾸지 않는다(안전 기본값).
  5. 사용자가 대기열에서 승인, 수정, 거절한다.
  6. 승인한 후보만 L2-d 저장소에 쓰고 변경 원장에 기록한다. Helm 같은 다른 그룹은 학습 결과를 L2-d 검색으로 읽는다. 학습 그룹을 직접 참조하지 않는다.
- 대안·실패 흐름
  - 검토 포크 실패나 취소: 후보를 만들지 않고 실패를 기록한다. 카운터는 다음 임계에서 다시 시도한다.
  - 후보가 기존 스킬과 충돌: 대기열에 diff로 표시한다. [가정] 병합 규칙은 `L3.learning.spec`이 정한다.
  - 쓰기 스캔 실패(비밀 포함 등): L2-d 쓰기 승인과 스캔이 거부하고 후보를 거절 상태로 둔다.
  - 승인한 변경을 되돌림: 변경 원장으로 롤백한다.
- 관여 층과 패키지
  - F `contracts`(records, extensions), X `ext-host`, L0 `platform-store`
  - L1 `core-agents`, `core-persistence`, L2 `cap-knowledge`
  - L3 `group-kit`, `group-learning`, L4 `apps/desktop`(승인 대기열), `apps/cli`
- 수용 기준
  - 카운터 임계를 넘는 테이프 세션을 실행하면 검토 포크가 백그라운드로 한 번 실행되고 후보가 대기열에 들어가며, 승인 전에는 스킬 디렉터리와 메모리 파일의 내용이 바뀌지 않는다.
  - Helm이 drive 임대를 가진 상태에서도 학습 그룹의 트리거와 검토 포크가 동작한다.

### UC-4 예약

반복·예약 작업과 백그라운드 실행이다. 근거는 foundation-plan.md §1 결정 2, process.md §1.3, §6.2 단계 2~3, l2e.md §6이다.

- 행위자: 사용자, 서비스 프로세스(`xeon service`), 모델
- 사전 조건
  - 앱을 닫아도 계속 실행되어야 하는 작업이면 공유 서비스 모드가 켜져 있다. [결정: decisions-log 2026-10-21 3차, foundation-plan.md §1 결정 2] 공유 서비스 모드는 1차 범위이고 자동 기동과 유휴 종료를 한다.
- 실행 형태 구분

  | 형태 | 예 | 공유 서비스 모드 | 근거 |
  |---|---|---|---|
  | 앱 실행 중 반복 | 루프와 웨이크업(세션이 열려 있는 동안 반복) | 불필요 | l2e.md §6 D2(상주 수준 1) |
  | 앱을 닫아도 계속 | 백그라운드 작업 분리, 예약 실행 | 필요 | l2e.md §6 D1, D3(상주 수준 2) |
  | 재부팅 뒤 자동 시작 | 로그인 직후 예약 실행 | OS 서비스 등록 필요(2차) | process.md §6.2 단계 3 |

- 주 흐름(예약 실행)
  1. 사용자가 대화나 명령으로 예약을 만든다(시각 또는 주기, 프롬프트, 대상 세션).
  2. 예약이 DB의 예약 테이블에 저장된다.
  3. 클라이언트가 서비스를 찾고, 없으면 `xeon service`를 기동한다(ensure).
  4. 서비스가 틱마다 만기 예약을 꺼내 세션 실행을 시작한다. 세션 잠금은 서비스가 쥔다.
  5. 사용자가 앱을 닫아도 서비스는 계속 실행된다. 유휴 종료는 연결 0, live task 0, 대기 예약 0일 때만 일어난다(process.md §6.4).
  6. 실행 결과는 이벤트로 저장되고 알림이 나간다. 다음에 앱을 열면 결과를 본다.
- 대안·실패 흐름
  - 서비스 모드가 꺼져 있음: 앱을 닫아도 계속되어야 하는 예약을 만들면 서비스 자동 기동(ensure)을 시도한다. 기동에 성공하면 주 흐름 3번부터 이어진다. 실패하면 예약을 만들지 않고 조치 안내(서비스 모드 켜기, 실패 원인)와 함께 거부한다. 설정 `l2.schedule.timers.whenServiceOff`의 기본값은 `autoStart`다 [결정: review.decisions-2 U-23]. 앱 실행 중 반복은 서비스 모드와 무관하게 동작한다.
  - 기기가 꺼져 있어 예약 시각을 놓침: [미결] 놓친 실행을 따라잡을지 건너뛸지. `L2.schedule.spec`이 정한다.
  - 서비스 버전 불일치: 서비스가 한가하면 재기동하고 아니면 경고한다.
  - 서비스 크래시: DB와 복구 표식이 남고 다음 ensure에서 재개 후보로 제시한다. 자동 재개는 `l1.persistence.autoResume`으로 켜고, [제안] 기본값은 꺼짐이다(기본값은 ADR-0006 §6 [미결]).
  - 다른 클라이언트가 같은 세션을 실행 중: 클라이언트는 서비스에 입력을 위임한다.
- 관여 층과 패키지
  - F `contracts`(wire-settings), L0 `platform-process`, `platform-store`, `platform-os`(알림)
  - L1 `core-tasks`, `core-agents`, `core-persistence`, L2 `cap-schedule`, L4 `apps/host`, `apps/cli`, `apps/desktop`
- 수용 기준
  - 서비스가 꺼진 상태에서 예약을 만들면 서비스가 기동되고 예약이 저장된다. 서비스 기동을 실패하게 만든 환경에서는 예약이 저장되지 않고 거부 응답에 조치 안내가 들어간다.
  - 서비스 모드에서 1분 뒤 예약을 만들고 클라이언트를 모두 종료해도, 예약 시각에 실행 이벤트가 기록되고 실행이 끝난 뒤 유휴 유예가 지나면 서비스가 종료된다.
  - 대기 예약이 남아 있는 동안에는 연결과 live task가 0이어도 서비스가 종료되지 않는다.

### UC-5 원격

폰이나 다른 기기에서 세션에 접속하고 알림을 받는다. 근거는 process.md §1.3 원격·알림 행, §6.2 단계 3, §6.4 인증 항목이다.

- 행위자: 사용자(원격 기기), 원격 클라이언트, 서비스 프로세스
- 사전 조건
  - 공유 서비스 모드가 실행 중이다(UC-4와 같은 서비스).
  - [결정: decisions-log 2026-10-21 3차] 원격 접속은 범위에 포함된다. OS 서비스 등록(launchd, systemd)은 2차다. 그래서 서비스가 떠 있지 않은 동안에는 원격 접속을 받을 수 없다.
  - [결정: review.decisions-2 U-11] 원격 사용의 첫 마일스톤은 M3다(`product.scope.spec` I13). 1차 원격은 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 방식이다. 내장 TLS + 토큰 WebSocket 전송은 2차다.
  - 원격 기기에서 서비스 호스트로 SSH 접속이나 사설망 연결이 가능하다.
- 주 흐름
  1. 로컬 클라이언트는 Unix 소켓과 파일 권한으로 서비스에 접속한다.
  2. 원격 기기의 사용자가 SSH 터널(소켓 포워딩)이나 사설망으로 서비스 호스트의 소켓에 연결한다. 인증은 SSH·사설망이 맡고 서비스는 비루프백 리스너를 열지 않는다.
  3. 원격 클라이언트가 연결된 소켓으로 호스트 계약의 초기화를 한다. 이후 메시지는 로컬 service 전송과 같다.
  4. 원격 클라이언트는 세션 목록을 보고, 세션에 입력하고, 승인·질문 요청에 답한다. 입력은 서비스가 쥔 세션의 입력 큐로 들어간다.
  5. 완료, 승인 대기, 질문 대기, 오류가 생기면 알림이 나간다.
- 대안·실패 흐름
  - 비루프백 주소에 바인드하려는 설정: 1차에는 비루프백 리스너가 없으므로 서비스가 기동을 거부한다. 2차 내장 원격 전송에서도 비루프백 무인증 접속은 금지다.
  - SSH·사설망 연결 실패: 원격 클라이언트는 접속하지 못하고 서비스에는 기록이 남지 않는다. 2차 내장 원격 전송에서는 토큰 불일치나 만료 시 초기화 전에 연결을 끊고 거부를 기록한다.
  - 서비스가 유휴 종료됨: 원격 클라이언트는 접속하지 못한다. 2차의 OS 서비스 등록이 이 경우를 다룬다.
  - 원격 클라이언트 형태는 M3에서 CLI·데스크톱뿐이다. 웹 클라이언트는 M4다 [결정: 2026-10-28 사용자]. 전용 앱, 릴레이 경유, 모바일 푸시 경로의 단계는 [미결]이다(`L4.host-service.spec`이 정한다).
- 관여 층과 패키지
  - F `contracts`(wire-settings), L0 `platform-process`, `platform-os`(알림), `platform-secrets`(2차 내장 원격 전송의 토큰)
  - L1 `core-tools`(승인 프로토콜), L2 `cap-dialog`(알림, 질문), L4 `apps/host`, settings-ui
- 수용 기준
  - SSH 소켓 포워딩으로 연결한 클라이언트가 세션 목록을 받고, 비루프백 주소 바인드 설정으로는 서비스가 기동하지 않는다.
  - 터널로 접속한 원격 클라이언트가 승인 요청에 `approval.respond`로 답하면 대기 중인 도구 호출이 실행된다.

### UC-6 비밀 사용

사용자는 키체인이나 Bitwarden처럼 비밀을 관리하고, 에이전트는 값을 모른 채 참조만 쓴다. 근거는 decisions-log 2026-10-21 2차, secrets.md §6이다.

- 행위자: 사용자, 모델, 도구 실행 파이프라인
- 사전 조건
  - [결정: decisions-log 2026-10-21 2차] 기본 provider는 SOPS(age)다. age 키는 `SOPS_AGE_KEY_CMD`로 OS 키체인에서 받는다(foundation-plan.md §2 비밀 행).
- 주 흐름(사용자 관리)
  1. 목록: 사용자가 비밀 목록을 연다. 이름, provider, 설명, 허용 호스트, 마지막 사용, 만료가 보이고 값 열은 없다.
  2. 등록: 이름과 메타를 입력하고 값은 가린 입력란이나 stdin으로 넣는다. 명령 인자로 값을 받지 않는다.
  3. 열람: 사용자가 재인증한 뒤 값을 한 번 보고, 값은 자동으로 다시 가려진다. 열람은 감사 이벤트로 남는다. 에이전트 경로에는 열람이 없다. 경로는 M2 CLI `xeon secret reveal`(OS 인증 재확인이 가능한 곳은 재확인)과 M3 데스크톱 설정 화면 둘이다 [결정: review.decisions-2 U-20].
  4. 삭제: 참조하는 정책과 세션을 보여 준 뒤 확인을 받는다.
- 주 흐름(에이전트 사용)
  1. 모델은 도구 인자에 `secret://github-token` 같은 참조만 쓴다. 참조는 값이 아니므로 대화와 이벤트에 남아도 된다.
  2. 도구 실행 직전, 정책 검사 뒤에 참조가 해석된다. 값은 부모 엔진 프로세스 메모리의 lease에만 있다.
  3. 런타임 HTTP 도구는 전송 직전에 헤더와 본문에서 치환한다(`runtime-http` 모드). HTTPS 토큰 CLI는 sentinel 치환을 쓴다(`sentinel` 모드).
     - M1 검증은 `env` 주입 모드(bash 도구, 실행마다 승인)로 한다 [결정: review.decisions-2 U-19].
     - 주입 모드 이름은 `env`, `sentinel`, `runtime-http`, `browser-input`으로 쓴다. `_research/secrets.md` §6.2 표의 M1, M2, M3, M4에 차례로 대응한다. 이 문서의 M0~M3은 마일스톤만 뜻한다.
  4. 사용은 값 없는 감사 이벤트로 남는다.
- 대안·실패 흐름(마스킹 포함)
  - 도구 출력에 값이 나타남: 이벤트 저장 전에 마스킹되고 마스킹 이벤트가 남는다. 모델 컨텍스트에는 가려진 결과만 들어간다.
  - 사용자가 대화에 값을 붙여 넣음: 입력 단계에서 알려진 값과 일치하면 저장 전에 가린다.
  - 허용 호스트 밖으로 주입하려 함: 주입이 실패하고 거부 이벤트가 남는다.
  - 값이 분할되거나 재인코딩되어 출력됨: 마스킹이 잡지 못한다. 이 경로는 값이 모델 경로에 들어오지 않는 `sentinel`·`runtime-http` 모드로 막고, 승인 없는 `env` 모드 주입은 금지한다(secrets.md §6.3 한계).
  - 사용 중인 비밀을 삭제하려 함: 거부한다.
  - SOPS 복호화 실패(키체인 잠김 등): 도구 호출이 실패로 끝나고 값 없는 오류 코드만 남는다.
- 관여 층과 패키지
  - F `contracts`(records), L0 `platform-secrets`, `platform-exec`, `platform-store`
  - L1 `core-tools`, `core-context`(모델 투영 마스킹), L2 `cap-web`(HTTP 치환), L4 `apps/cli`, settings-ui
- 수용 기준
  - 테스트 비밀을 참조하는 도구 호출을 모델 테이프로 실행하면 실제 값이 이벤트 DB, 로그, 모델 요청 본문 어디에도 나타나지 않는다.
  - 도구 출력에 등록된 값(원문, base64 형태)이 포함되면 저장된 이벤트에는 가린 문자열과 마스킹 이벤트만 남는다.

## 5. 보조 유즈케이스와 공통 실패

### 5.1 보조 유즈케이스

| 이름 | 내용 | 관여 패키지 | 근거 |
|---|---|---|---|
| 질문·계획 승인 | 모델의 사용자 질문과 계획 승인을 L1-d 승인 프로토콜 하나로 처리한다. 요청은 내구 이벤트 `approval.requested`, 응답은 호스트 메서드 `approval.respond`다 [결정: review.decisions-2 U-02]. 원격 승인(UC-5)도 같은 경로를 쓴다. | `core-tools`, `cap-dialog`, `cap-work` | [결정: decisions-log 2026-10-21 3차, foundation-plan.md §1 결정 5] |
| 목표 지속 | 완료 조건을 걸면 턴이 끝날 때마다 별도 판정 모델이 판정하고, 미충족이면 다음 턴을 시작한다. 판정 실행 횟수 상한(`l1.agents.judge.maxRuns`)에서 멈춘다. | `cap-work`, `core-loop`, `core-models` | [결정: decisions-log 2026-10-21 3차, foundation-plan.md §1 결정 4] |
| 재개 | 크래시 뒤 다시 열면 복구 표식이 남은 세션을 "이어서 실행" 후보로 제시한다. 자동 재개(`l1.persistence.autoResume`)는 기본 꺼짐이다(기본값은 ADR-0006 §6 [미결]). 재개 시도 상한은 `l1.persistence.maxResumeAttempts`다. 결과 불명 도구 호출 가운데 `replay` 선언이 `unsafe`(기본값)이거나 선언이 없는 도구는 다시 실행하지 않고 "중단됨" 결과로 합성한다. 저장된 정책과 현재 선언이 모두 `safe`인 도구만 다시 실행한다(ADR-0004 §3.2 3번). | `core-persistence`, `platform-store` | [제안: process.md §6.3 5~6] 후보 제시와 자동 재개 기본값 / [결정: ADR-0004] 결과 불명 처리 |
| 무료 웹 검색 | 모델용은 provider 내장 검색, 서비스 API `web.search`는 내장 검색 래퍼, SearXNG를 감지하면 우선, 무료 크레딧 API는 플러그인으로 권장한다. | `cap-web` | [결정: decisions-log 2026-10-21 3차, foundation-plan.md §1 결정 6, ADR-0005] |

### 5.2 공통 실패 규칙

- 모든 UC에서 확장 핸들러 실패는 fold별 정책을 따른다. tap은 기록 후 계속, first는 거부, chain은 그 핸들러만 건너뛴다(layer-plan-v2-notes.md 확장 지점 4연산).
- 모든 UC에서 결과 불명 도구 호출은 기본적으로 재개 때 다시 실행하지 않고 "중단됨" 결과로 합성한다. `replay` 선언이 `unsafe`(기본값)이거나 선언이 없는 도구가 여기에 해당한다. 예외로, 저장된 정책과 현재 선언이 모두 `safe`인 도구만 다시 실행한다(ADR-0004 §3.2 3번).

## 6. 설정 노출

유즈케이스가 쓰는 설정 탭만 적는다. 키 이름은 `F.wire-settings.spec`이, 화면 배치는 `L4.settings-ui.spec`이 정한다.

| UC | 설정 탭(layer-plan-v2-notes.md L4 설정 화면 구성안) |
|---|---|
| UC-1 | 모델, 권한과 샌드박스, 실행과 서비스(큐 기본 모드) |
| UC-2, UC-3 | 플러그인과 그룹(그룹 토글, drive 임대 상한) |
| UC-4, UC-5 | 실행과 서비스(공유 서비스 모드, 알림) |
| UC-6 | 비밀 |

## 7. 확장 지점

| UC | on(tap) | on(first) | on(chain) | post | drive | scope |
|---|---|---|---|---|---|---|
| UC-1 | 선택 | 선택 | 선택 | 사용자 입력 큐 모드(`steer`, `followUp`, `next`) | 없음 | 없음 |
| UC-2 | 탐구 신호 기록 | 확산 단계 쓰기 거부 | 단계별 시스템 프롬프트 | 선택 | 병렬 탐구와 적용 턴 | `helm` |
| UC-3 | 학습 카운터 | 없음 | 없음 | 제안 알림 | 쓰지 않음 | 학습 그룹 |
| UC-4 | 없음 | 없음 | 없음 | 예약 실행 입력 | 없음 | 없음 |
| UC-5 | 없음 | 없음 | 없음 | 원격 입력 | 없음 | 없음 |
| UC-6 | 없음 | [가정] 비밀 정책 거부는 정책 엔진에서 처리한다 | 없음 | 없음 | 없음 | 없음 |

## 8. 다른 문서와의 인터페이스

### 8.1 유즈케이스 x 층 매트릭스

셀은 핵심 패키지다. 이름은 `_routing/routes.yaml` layout과 `architecture.layers.spec`의 패키지 지도와 같다.

| UC | F | X | L0 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|---|---|---|
| UC-1 대화 | `contracts` | `ext-host` | `platform-exec`, `platform-sandbox`, `platform-store` | `core-tasks`, `core-loop`, `core-models`, `core-tools`, `core-context`, `core-persistence` | `cap-workspace` | 없음 | `apps/cli`, `apps/desktop`, `apps/host` |
| UC-2 탐구 | `contracts` | `ext-host` | `platform-store` | `core-loop`, `core-tools`, `core-agents` | `cap-web`, `cap-knowledge`, `cap-work` | `group-kit`, `group-helm` | `apps/cli`, `apps/desktop` |
| UC-3 학습 | `contracts` | `ext-host` | `platform-store` | `core-agents`, `core-persistence` | `cap-knowledge` | `group-kit`, `group-learning` | `apps/desktop`, `apps/cli` |
| UC-4 예약 | `contracts` | 없음 | `platform-process`, `platform-store`, `platform-os` | `core-tasks`, `core-agents`, `core-persistence` | `cap-schedule` | 없음 | `apps/host`, `apps/cli`, `apps/desktop` |
| UC-5 원격 | `contracts` | 없음 | `platform-process`, `platform-os`, `platform-secrets` | `core-tools` | `cap-dialog` | 없음 | `apps/host`, settings-ui |
| UC-6 비밀 | `contracts` | 없음 | `platform-secrets`, `platform-exec`, `platform-store` | `core-tools`, `core-context` | `cap-web` | 없음 | `apps/cli`, settings-ui |

### 8.2 제공과 요구

| 문서 id | 관계 |
|---|---|
| `product.scope.spec` | UC별 첫 동작 마일스톤을 정한다. UC-4·UC-5의 공유 서비스 모드 의존은 scope의 M3 배치와 맞춘다. |
| `architecture.runtime-flow.design` | UC-1~UC-6 번호로 흐름을 인용한다. |
| `architecture.layers.spec` | 8.1 매트릭스의 패키지 이름을 대조한다. |
| `L3.helm.spec`, `L3.learning.spec` | UC-2, UC-3의 내부 설계를 정한다. |
| `L0.secrets.spec` | UC-6의 참조 형식, 주입 모드, 마스킹 계층을 정한다. |
| `L4.host-service.spec`, `L2.schedule.spec` | UC-4, UC-5의 서비스 수명과 예약 규칙을 정한다. |

## 9. 수용 기준

- UC-1~UC-6이 각각 테스트로 확인할 수 있는 수용 기준을 하나 이상 갖는다(4절).
- UC-4, UC-5는 공유 서비스 모드에 의존하며, 이 의존은 `product.scope.spec`에서 두 UC와 서비스 모드를 같은 마일스톤(M3)에 둔 배치와 모순되지 않는다.
- 8.1 매트릭스의 모든 패키지 이름이 `_routing/routes.yaml` layout의 경로와 일치한다.

## 10. 미결 사항

| # | 항목 | 관련 UC | 확인 대상 |
|---|---|---|---|
| 1 | Helm 내부 설계(단계 이름, 렌즈 목록, 종료 판정, 부분 결과 허용) | UC-2 | `L3.helm.spec`, 사용자 |
| 2 | 놓친 예약 실행을 따라잡을지 건너뛸지. ADR-0006 §3.5도 이 항목을 `L2.schedule.spec`에 넘긴다. | UC-4 | `L2.schedule.spec` |
| 3 | 원격 클라이언트 형태와 모바일 푸시 경로. 1차 연결 방식(SSH 터널·사설망)은 U-11로 정했다. | UC-5 | `L4.host-service.spec`, 사용자 |
| 4 | 학습 후보와 기존 스킬이 충돌할 때 병합 규칙 | UC-3 | `L3.learning.spec` |
| 5 | layer-plan-v2.json의 단계 표기(예약 실행·원격 제어 '보류', 공유 서비스 모드·사용자 알림 '2차')가 decisions-log 2026-10-21 3차 이전 값이다. 이 문서는 3차 결정을 따른다. | UC-4, UC-5 | 사용자, `product.scope.spec` |
| 6 | `post.when = next`가 요청을 스스로 시작하는지. UC-1의 `next` 수용 기준은 이 결정 뒤에 쓴다. | UC-1 | ADR-0007 §6, 사용자 |

- 7번(턴 경계 해석)은 `review.decisions-2` U-01로 정해 지웠다.
