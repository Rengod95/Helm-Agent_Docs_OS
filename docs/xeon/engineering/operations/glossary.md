---
id: eng.operations.glossary
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [architecture.overview.spec, architecture.layers.spec, architecture.security.spec, F.conversation.spec, F.records.spec, F.capabilities.spec, F.extensions.spec, F.wire-settings.spec, X.primitives.spec, X.loading-trust.spec, X.operations.spec, L0.store.spec, L0.secrets.spec, L0.os.spec, L0.process.spec, L0.exec.spec, L0.sandbox.spec, L1.persistence.spec, L1.loop.spec, L1.tasks.spec, L1.tools.spec, L1.agents.spec, L1.models.spec, L1.context.spec, L2.schedule.spec, L2.dialog.spec, L2.work.spec, L2.knowledge.spec, L2.artifacts.spec, L2.web.spec, L3.group-kit.spec, L4.host-service.spec, L4.cli.spec, adr.0004, adr.0006, adr.0007, adr.0017, adr.0018, adr.0019]
binds: []
---

# 용어집

이 문서는 Xeon 문서와 소스에서 자주 쓰는 용어의 뜻을 한곳에 모읍니다. 뜻은 "정본 문서"가 정한 정의를 옮긴 것입니다. 정의가 여러 문서에 있으면 처음 정한 문서를 적었습니다. 정의가 문서마다 다르면 뜻 칸에 그 차이를 적었습니다.

## 1. 읽는 법

- 항목은 한글 가나다 순입니다. 영문 식별자 항목은 뒤에 둡니다.
- 뜻 칸의 백틱 문자열은 코드 이름, 설정 키, 명령, 파일 이름입니다.
- 정본 문서 칸은 문서 id입니다. `§`는 그 문서의 절입니다.
- 같은 말이 두 뜻으로 쓰이는 경우가 있습니다. `루프`(L1 core-loop)와 예약 정의의 `루프`(L2.schedule), `scope`(확장 등록 묶음)와 `scope`(설정 범위)가 그렇습니다. 항목을 따로 두었습니다.
- 정의가 문서에 없는 말은 항목으로 두지 않았습니다.

## 2. 용어 표

| 용어 | 뜻 | 정본 문서 |
|---|---|---|
| 가드레일 지점 | 모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전에 발화하는 확장 지점입니다. fold는 `first`이고 실패 정책은 fail-closed입니다. 결정은 통과 또는 차단뿐입니다 (M3-REQ-107) | adr.0017 |
| 그룹 | `scope` 하나로 묶여 단계 경계에서 켜고 끄는 L3 플러그인 단위입니다(`kind: "group"`, `layer: "L3"`). Helm과 학습 그룹이 기본 그룹입니다 | architecture.overview.spec §2, L3.group-kit.spec §2 |
| 기본 플러그인 | 릴리즈에 들어 있고 첫 실행 때 사용자 확장 위치에 복사되는 외부 확장 형식의 플러그인입니다. Helm이 여기에 듭니다 | X.loading-trust.spec §2 |
| 내구 이벤트 | DB에 커밋되고 `seq`를 받는 이벤트입니다. 재생의 원본입니다 | F.records.spec §2 |
| 단계 경계 | step이 끝나고 다음 step이 시작되기 전 시점입니다. 체크포인트 커밋, drive 임대 교대, scope 켜기·끄기 적용이 이 시점에 일어납니다 | F.conversation.spec §2 |
| 대화형 실행 | 사람이 승인 요청에 답할 수 있는 실행입니다. 예약 실행과 헤드리스 실행은 비대화형입니다 | L1.tools.spec §2 |
| 도구 (tool) | 모델에게 광고되는 도구 하나입니다. 서비스 메서드 하나와 대응합니다 | F.capabilities.spec §2 |
| 등록 파일 | 서비스 프로세스가 쓰는 JSON 파일(`0600`)입니다. 소켓 경로, pid, 버전, 토큰을 담습니다. 소스에서는 `runtime/service.json`입니다 | L0.process.spec §2, L4.host-service.spec §3.5 |
| 루프 (core-loop) | `runTurn(entry)`이 turn 하나를 실행하는 L1 내부 모듈입니다. pi-agent-core 루프를 포크해 다시 설계했습니다. 예약 정의의 "루프"(L2.schedule)와 다른 뜻입니다 | L1.loop.spec §2 |
| 리뷰 (review) | 파일 변경 묶음 하나에 대한 승인 절차입니다. 변경 묶음은 `changeset` 산출물로 함께 등록합니다 | L2.artifacts.spec §2 |
| 마스킹 (redaction) | 비밀 값이 로그, 이벤트, 모델 입력, 외부 전송에 남지 않게 가리는 일입니다. 다섯 계층(사람 입력, 도구 결과, 외부 전송, 모델 투영, 운영 로그)에서 부릅니다 | L0.secrets.spec §4.4 |
| 매니페스트 | 확장 하나의 설치 메타 파일(`manifest.ts`)입니다. Claude Code의 `plugin.json` 레이아웃을 따르고 Xeon 필드를 더합니다 | F.extensions.spec §3.1 |
| 메타 파일 (비밀) | 비밀 이름과 제공자 참조를 잇고 사용 정책을 담는 평문 파일입니다. 값은 없습니다 | L0.secrets.spec §3.2 |
| 모델 역할 (ModelRole) | 모델을 고르는 용도 이름입니다. `main`, `review`, `summary`, `subagent`, `judge`, `search` 여섯 가지입니다 | L1.models.spec §2 |
| 목표 (goal) | 완료 조건 문장과 판정 방식입니다. thread마다 활성 목표는 하나입니다 | L2.work.spec §2 |
| 미결 (`[미결]`) | 사용자 확인이 필요한 항목입니다. 문서 끝 "미결 사항"에도 모읍니다 | xeon.templates §문체 규칙 |
| 번들 바이너리 | 앱과 함께 배포되는 실행 파일입니다(예: 번들 `rg`). 시스템 바이너리는 사용자가 OS에 설치해 `PATH`에서 찾습니다 | L0.os.spec §2 |
| 범위 (설정 scope) | 설정 값이 저장되는 계층입니다. 순위는 `managed`(관리 정책, 잠금), `session`(이번 시작만), `local`(프로젝트 개인 파일), `project`(프로젝트 공유 파일), `user`(사용자 홈 파일), `default`(코드 기본값) 순입니다 | F.wire-settings.spec §2 |
| 보호 경로 | 샌드박스 쓰기 루트 안에 있어도 쓰기를 거부하는 경로입니다. 설정으로 더할 수만 있습니다 | L0.sandbox.spec §2 |
| 블롭 (blob) | 내용 주소(SHA-256) 파일입니다. 이벤트에는 `BlobRef`만 남습니다. 참조가 없고 유예 시간이 지난 블롭은 GC 대상입니다 | L0.store.spec §2, §4.9 |
| 비밀 (secret) | 모델 키, API 키처럼 값이 노출되면 안 되는 자격 증명입니다. 값은 제공자(기본 SOPS)에 있고, 이벤트·설정·로그에는 참조만 남습니다 | L0.secrets.spec §1, adr.0019 |
| 비밀 핸들 (`secret://`) | `secret://<이름>` 문자열입니다. 값이 아니므로 대화, 이벤트, 로그, 설정에 남아도 됩니다. F 타입은 `SecretRef`입니다 | L0.secrets.spec §2 |
| 사용 모드 (비밀) | 값이 실제로 쓰이는 경로입니다. M1 env, M2 sentinel, M3 런타임 HTTP, M4 브라우저 입력이 있습니다 | L0.secrets.spec §2 |
| 샌드박스 | 셸 명령을 쓰기 루트와 네트워크 정책 안에서 실행하는 격리 계층입니다. Linux는 bubblewrap과 socat, macOS는 Seatbelt를 쓰고, 공통 래퍼는 srt(`@anthropic-ai/sandbox-runtime`)입니다 | L0.sandbox.spec §2, architecture.security.spec §3.2 |
| 서비스 모드 | `xeon service`로 뜬 공유 엔진 프로세스가 socket 전송으로 여러 클라이언트를 받는 모드입니다. 자동으로 뜨고 유휴 상태에서 끝납니다. OS 서비스 등록은 2차입니다 | adr.0006, L4.host-service.spec §2 |
| 서브에이전트 | 정의(이름, 프롬프트, 도구, 모델, 권한)를 따라 자식 대화에서 도는 에이전트입니다 | L1.agents.spec §2 |
| 세션 | 사용자에게 보이는 이름입니다. wire의 thread 하나입니다. 1:1 대응은 `[가정]`입니다 | L4.cli.spec §2, F.wire-settings.spec §2 |
| 스킬 | `SKILL.md` 하나와 지원 파일(`references/`, `templates/`, `scripts/`, `assets/`)을 담은 디렉터리입니다. Agent Skills 규격입니다 | L2.knowledge.spec §2 |
| 스텝 (step) | 모델 응답 한 번과 그 응답이 부른 도구 결과 묶음입니다. 체크포인트 단위입니다 | F.conversation.spec §2 |
| 승인 (approval) | 사람의 응답을 기다리는 단일 대기 레코드입니다. 종류는 도구(`tool`), 계획(`plan`), 질문(`question`), 검토(`review`)입니다. 한 프로토콜로 처리합니다 | adr.0018, L1.tools.spec §2 |
| 신뢰 (trust) | 프로젝트 폴더의 확장과 프로젝트 자원을 쓸지 정하는 판정입니다. 신뢰 등급은 `builtin`, `user`, `project`, `untrusted` 넷이고 확장이 할 수 있는 일을 정합니다 | X.loading-trust.spec §4.6, §4.7 |
| 실행권 (scheduler 임대) | `sys_leases`의 `scheduler` 자원 임대입니다. 쥔 프로세스 하나만 예약 틱을 돌립니다. 아직 아무도 잡지 않습니다 | L2.schedule.spec §2, L4.host-service.spec HS-102 |
| 아이템 (item) | 입출력 단위입니다. 사용자 메시지, 어시스턴트 메시지, 시스템 메시지, 도구 호출, 도구 결과, 확장 커스텀 메시지가 있습니다 | F.conversation.spec §2 |
| 안전 모드 | 외부 확장(`user`·`project` 등급), 외부 훅, L3 내장 그룹을 싣지 않고 시작하는 모드입니다 | X.operations.spec §2, §4.6.2 |
| 알림 (notice) | 사용자 주의가 필요한 상태를 분류한 신호입니다 | L2.dialog.spec §2 |
| 엔진 | Cordis 호스트, 루프, SQLite를 묶은 라이브러리입니다. 데몬 여부, 전송, 유휴 종료 같은 프로세스 정책은 갖지 않습니다 | architecture.overview.spec §2, L0.process.spec §2 |
| 예약 (timer) | cron 또는 at으로 정한 예약입니다. 기한마다 새 세션을 만들어 실행합니다 | L2.schedule.spec §2 |
| 원장 | 스킬과 메모리의 모든 변경 기록입니다. 전후 내용을 blob으로 가집니다 | L2.knowledge.spec §2 |
| 웹 provider | 웹 능력(검색, 가져오기, 브라우즈)을 실제로 수행하는 구현입니다. 내장(`builtin-wrapper`, `searxng`, `local`, `playwright-local`, `native`)과 플러그인(`plugin:<확장 이름>`)이 있습니다 | L2.web.spec §2 |
| 입력 큐 | thread별 내구 대기열입니다. 이벤트 `input.*`와 투영 `p_inputs`로 이루어집니다 | L1.tasks.spec §2 |
| 자동 끄기 | 실패 기준을 넘은 확장의 scope를 다음 단계 경계에서 끄는 동작입니다 | X.operations.spec §2 |
| 자식 대화 | 서브에이전트 실행마다 새로 여는 thread입니다. 부모 대화와 소유자를 기록합니다 | L1.agents.spec §2 |
| 자원 임대 (sys_leases) | `sys_leases`의 행 하나입니다. 자원 이름은 `session:<threadId>`, `scheduler`, `service` 셋입니다. 소유자 정보와 `epoch`를 담습니다. `epoch`는 자원의 소유자가 바뀔 때마다 1 오르는 펜싱 토큰입니다 | L0.store.spec §2 |
| 지점 (point) | 확장이 `on`으로 핸들러를 거는 이름 붙은 위치입니다. 지점마다 fold가 정해져 있습니다 | F.extensions.spec §2 |
| 층 | 의존 순위가 같은 패키지 묶음입니다. F, X, L0, L1, L2, L3, L4 순서입니다 | architecture.layers.spec §2 |
| 제안 대기열 | 사람의 결정을 기다리는 에이전트 쓰기 요청 목록입니다. 학습 그룹 대기열과 지식 쓰기 대기열 둘이 있습니다 | L2.knowledge.spec §2 |
| 컴팩션 머리 | 가지 위의 마지막 `thread.compacted`입니다. 조립할 때 `firstKeptEventId` 앞 내용을 요약으로 바꿉니다 | L1.context.spec §2 |
| 커밋 | `SessionService.commit` 한 번입니다. SQL 트랜잭션 하나입니다 | L1.persistence.spec §2 |
| 커밋 키 (`requestId`) | `requests` 테이블의 키 `(thread, requestId)`입니다. 같은 키의 재시도인지 지문으로 판정합니다 | L1.persistence.spec §2 |
| 턴 (turn) | 사용자 입력 하나(예약·원격 입력 하나 포함)에 대한 한 번의 작업입니다. 첫 모델 호출부터 루프 종료까지입니다 | F.conversation.spec §2 |
| 투영 (projection) | 이벤트에서 만든 조회용 테이블(메시지, 파트 등)입니다. 같은 트랜잭션에서 갱신합니다 | architecture.overview.spec §2, F.records.spec §2 |
| 투영기 (projector) | 내구 이벤트를 받아 자기 소유 테이블을 갱신하는 순수 함수 묶음입니다 | L1.persistence.spec §2 |
| 전송 | 호스트 계약을 실어 나르는 수단입니다. in-process, stdio, service 셋이 있습니다 | architecture.overview.spec §2, L4.host-service.spec §2 |
| 호스트 | 엔진을 소유하고 전송을 열어 계약의 서버 쪽을 맡는 L4 실행 단위(`apps/host`)입니다 | architecture.overview.spec §2 |
| 호스트 계약 (wire) | UI와 엔진 사이의 JSON-RPC 계약입니다. 스키마는 F에 하나만 둡니다 | architecture.overview.spec §2, F.wire-settings.spec §1 |
| 능력 (cap) | 서비스 API와 모델 도구를 한 쌍으로 묶은 L2 단위입니다. 정의는 F에 있고 구현은 `cap-*` 패키지에 있습니다 | architecture.overview.spec §2, F.capabilities.spec §2 |
| 효과 (effect) | 부작용이 있을 수 있는 도구 실행 하나입니다. `effect.intent`는 있는데 `effect.result`가 없으면 열린 효과입니다 | F.records.spec §2, L1.persistence.spec §2 |
| 이벤트 소싱 | 변경을 불변 이벤트로 쌓고, 조회용 투영을 같은 트랜잭션에서 그 이벤트로 갱신하는 저장 방식입니다. 세션 저장은 SQLite 한 파일입니다 | adr.0004 |
| 휘발 이벤트 | 저장하지 않고 연결된 구독자에게만 보내는 이벤트입니다. 토큰 델타가 대표 예입니다 | F.records.spec §2 |
| 활성 가지 | thread의 현재 leaf에서 `parentId`를 따라 처음 이벤트까지 올라간 사슬입니다 | L1.persistence.spec §2 |
| 핸들러 시간 예산 | 핸들러 호출 한 번이 쓸 수 있는 실행 시간(ms)입니다. 사용자 응답을 기다린 시간은 뺍니다 | X.operations.spec §2 |
| `drive` | 루프를 구동하는 배타 임대 연산입니다. 그룹당 한 슬롯이고 상한 `{maxTurns, maxSpawns, maxTokens}`가 붙습니다 | adr.0007, X.primitives.spec §2 |
| `fold` | 한 지점에 걸린 핸들러 결과를 합치는 규칙입니다. `tap`(관찰), `first`(차단), `chain`(형성)이 있고 지점 선언이 정합니다. ADR-0017이 `collect`를 더합니다 | F.extensions.spec §2, adr.0017 |
| `on` | 지점에 핸들러를 거는 연산입니다. 지점의 fold에 따라 관찰, 차단, 형성이 됩니다 | adr.0007 |
| `OsDirs` | OS별 디렉터리 값 묶음입니다. data, config, cache, state, runtime, resource를 담습니다 | L0.os.spec §3.2 |
| `post` | 입력을 입력 큐에 넣는 연산입니다. `when`은 `steer`, `followUp`, `next` 중 하나입니다 | adr.0007 |
| `scope` (확장) | 한 확장의 등록 묶음입니다. 상태 문서, 정리 동작, 켜기·끄기 상태를 가집니다. 설정 범위와 다른 뜻입니다 | adr.0007, F.extensions.spec §2 |
| `SOPS`, `age` | 기본 비밀 제공자 `sops`와 그 암호화 도구 `age`입니다. 개인 키는 OS 키체인이나 파일 폴백에 둡니다 | adr.0019, L0.secrets.spec §4.6~§4.7 |
| `XEON_HOME` | 환경 변수입니다. 값이 있으면 data, config, cache, state, runtime을 그 아래 폴더로 모읍니다 `[제안]` | L0.os.spec §3.2 |

## 3. 미결 사항

1. `루프`라는 말이 L1 core-loop(`L1.loop.spec`)와 예약 정의(`L2.schedule.spec`)에서 다른 뜻으로 쓰입니다. 한쪽의 이름을 바꿀지 정합니다.
2. `XEON_HOME`은 L0.os 스펙에서 `[제안]`입니다. 정본으로 확정할지 정합니다.
3. 용어 표에 없는 말이 문서마다 따로 쓰이는 경우가 있습니다. 예를 들어 `루프`처럼 같은 말이 둘인 경우가 더 있는지 문서 전체를 대조해야 합니다.
