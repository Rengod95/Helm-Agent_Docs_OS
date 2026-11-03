---
id: eng.operations.glossary
layer: eng
domain: operations
kind: guide
status: draft
depends_on: [architecture.overview.spec, architecture.layers.spec, architecture.security.spec, F.conversation.spec, F.records.spec, F.capabilities.spec, F.extensions.spec, F.wire-settings.spec, X.primitives.spec, X.loading-trust.spec, X.operations.spec, L0.store.spec, L0.secrets.spec, L0.os.spec, L0.process.spec, L0.exec.spec, L0.sandbox.spec, L1.persistence.spec, L1.loop.spec, L1.tasks.spec, L1.tools.spec, L1.agents.spec, L1.models.spec, L1.context.spec, L2.schedule.spec, L2.dialog.spec, L2.work.spec, L2.knowledge.spec, L2.artifacts.spec, L2.web.spec, L3.group-sdk.spec, L4.host-service.spec, L4.cli.spec, adr.0004, adr.0006, adr.0007, adr.0017, adr.0018, adr.0019]
binds: []
---

# 용어집

이 문서는 Fresnel 문서와 소스에서 자주 쓰는 용어의 뜻을 한곳에 모읍니다. 뜻은 "정본 문서"가 정한 정의를 옮긴 것입니다. 정의가 여러 문서에 있으면 처음 정한 문서를 적었습니다. 정의가 문서마다 다르면 뜻 칸에 그 차이를 적었습니다.

## 1. 읽는 법

- 이 문서는 두 절로 나뉩니다. §2는 플랫폼(Fresnel) 용어 표, §3은 용어 원본(`packages/client/src/i18n/terms.json`)에서 생성하는 화면 라벨 표, §4는 이름 변경 대응입니다. Helm과 학습 같은 플러그인 그룹 안의 말(렌즈 등)은 그 그룹 화면 안에서만 씁니다.

- 항목은 한글 가나다 순입니다. 영문 식별자 항목은 뒤에 둡니다.
- 뜻 칸의 백틱 문자열은 코드 이름, 설정 키, 명령, 파일 이름입니다.
- 정본 문서 칸은 문서 id입니다. `§`는 그 문서의 절입니다.
- 같은 말이 두 뜻으로 쓰이는 경우가 있습니다. `루프`(L1 core-loop)와 예약 정의의 `루프`(L2.schedule)가 그렇습니다. 확장 등록 묶음은 `Registration`으로 불러 설정 범위의 `scope`와 겹치지 않게 했습니다. 항목을 따로 두었습니다.
- 정의가 문서에 없는 말은 항목으로 두지 않았습니다.

## 2. 용어 표

| 용어 | 뜻 | 정본 문서 |
|---|---|---|
| 가드레일 훅 | 모델 요청 직전, 도구 호출 직전, 출력 표시·실행 직전에 발화하는 훅입니다. fold는 `first`이고 실패 정책은 fail-closed입니다. 결정은 통과 또는 차단뿐입니다 (M3-REQ-107) | adr.0017 |
| 기본 플러그인 | 릴리즈에 들어 있고 첫 실행 때 사용자 확장 위치에 복사되는 외부 확장 형식의 플러그인입니다. Helm이 여기에 듭니다 | X.loading-trust.spec §2 |
| 내구 이벤트 | DB에 커밋되고 `seq`를 받는 이벤트입니다. 재생의 원본입니다 | F.records.spec §2 |
| 단계 경계 | step이 끝나고 다음 step이 시작되기 전 시점입니다. 체크포인트 커밋, drive lock 교대, Registration 켜기·끄기 적용이 이 시점에 일어납니다 | F.conversation.spec §2 |
| 대화형 실행 | 사람이 승인 요청에 답할 수 있는 실행입니다. 예약 실행과 헤드리스 실행은 비대화형입니다 | L1.tools.spec §2 |
| 도구 (tool) | 모델에게 광고되는 도구 하나입니다. 서비스 메서드 하나와 대응합니다 | F.capabilities.spec §2 |
| 등록 파일 | 서비스 프로세스가 쓰는 JSON 파일(`0600`)입니다. 소켓 경로, pid, 버전, 토큰을 담습니다. 소스에서는 `runtime/service.json`입니다 | L0.process.spec §2, L4.host-service.spec §3.5 |
| 루프 (core-loop) | `runTurn(entry)`이 turn 하나를 실행하는 L1 내부 모듈입니다. pi-agent-core 루프를 포크해 다시 설계했습니다. 예약 정의의 "루프"(L2.schedule)와 다른 뜻입니다 | L1.loop.spec §2 |
| 리뷰 (review) | 파일 변경 묶음 하나에 대한 승인 절차입니다. 변경 묶음은 `changeset` 산출물로 함께 등록합니다 | L2.artifacts.spec §2 |
| 마스킹 (redaction) | 시크릿 값이 로그, 이벤트, 모델 입력, 외부 전송에 남지 않게 가리는 일입니다. 다섯 계층(사람 입력, 도구 결과, 외부 전송, 모델 투영, 운영 로그)에서 부릅니다 | L0.secrets.spec §4.4 |
| 매니페스트 | 확장 하나의 설치 메타 파일(`manifest.ts`)입니다. Claude Code의 `plugin.json` 레이아웃을 따르고 Fresnel 필드를 더합니다. 확장이 담는 플러그인 목록(`plugins[]`)과 선택적 `group` 선언을 적습니다 | F.extensions.spec §3.1 |
| 메타 파일 (시크릿) | 시크릿 이름과 제공자 참조를 잇고 사용 정책을 담는 평문 파일입니다. 값은 없습니다 | L0.secrets.spec §3.2 |
| 모델 역할 (ModelRole) | 모델을 고르는 용도 이름입니다. `main`, `review`, `summary`, `subagent`, `judge`, `search` 여섯 가지입니다 | L1.models.spec §2 |
| 목표 (goal) | 완료 조건 문장과 판정 방식입니다. thread마다 활성 목표는 하나입니다 | L2.work.spec §2 |
| 미결 (`[미결]`) | 사용자 확인이 필요한 항목입니다. 문서 끝 "미결 사항"에도 모읍니다 | fresnel.templates §문체 규칙 |
| 번들 바이너리 | 앱과 함께 배포되는 실행 파일입니다(예: 번들 `rg`). 시스템 바이너리는 사용자가 OS에 설치해 `PATH`에서 찾습니다 | L0.os.spec §2 |
| 범위 (설정 scope) | 설정 값이 저장되는 계층입니다. 순위는 `managed`(관리 정책, 잠금), `launch`(이번 실행만), `local`(프로젝트 개인 파일), `project`(프로젝트 공유 파일), `user`(사용자 홈 파일), `default`(코드 기본값) 순입니다 | F.wire-settings.spec §2 |
| 보호 경로 | 샌드박스 쓰기 루트 안에 있어도 쓰기를 거부하는 경로입니다. 설정으로 더할 수만 있습니다 | L0.sandbox.spec §2 |
| 블롭 (blob) | 내용 주소(SHA-256) 파일입니다. 이벤트에는 `BlobRef`만 남습니다. 참조가 없고 유예 시간이 지난 블롭은 GC 대상입니다 | L0.store.spec §2, §4.9 |
| 시크릿 (secret) | 모델 키, API 키처럼 값이 노출되면 안 되는 자격 증명입니다. 값은 제공자(기본 SOPS)에 있고, 이벤트·설정·로그에는 참조만 남습니다 | L0.secrets.spec §1, adr.0019 |
| 시크릿 참조 (`secret://`) | `secret://<이름>` 문자열입니다. 값이 아니므로 대화, 이벤트, 로그, 설정에 남아도 됩니다. F 타입은 `SecretRef`입니다 | L0.secrets.spec §2 |
| 사용 모드 (시크릿) | 값이 실제로 쓰이는 경로입니다. M1 env, M2 sentinel, M3 런타임 HTTP, M4 브라우저 입력이 있습니다 | L0.secrets.spec §2 |
| 샌드박스 | 셸 명령을 쓰기 루트와 네트워크 정책 안에서 실행하는 격리 계층입니다. Linux는 bubblewrap과 socat, macOS는 Seatbelt를 쓰고, 공통 래퍼는 srt(`@anthropic-ai/sandbox-runtime`)입니다 | L0.sandbox.spec §2, architecture.security.spec §3.2 |
| 서비스 모드 | `fresnel service`로 뜬 공유 엔진 프로세스가 socket 전송으로 여러 클라이언트를 받는 모드입니다. 자동으로 뜨고 유휴 상태에서 끝납니다. OS 서비스 등록은 2차입니다 | adr.0006, L4.host-service.spec §2 |
| 서브에이전트 | 정의(이름, 프롬프트, 도구, 모델, 권한)를 따라 자식 대화에서 도는 에이전트입니다 | L1.agents.spec §2 |
| `세션` | 옛 이름입니다. 이제 코드·문서는 Thread, 화면은 "대화"입니다(`thread` 하나). 남은 "세션"은 pi 원문 인용과 아직 정리하지 않은 문장입니다 | L4.cli.spec §2, F.wire-settings.spec §2 |
| 스킬 | `SKILL.md` 하나와 지원 파일(`references/`, `templates/`, `scripts/`, `assets/`)을 담은 디렉터리입니다. Agent Skills 규격입니다 | L2.knowledge.spec §2 |
| 스텝 (step) | 모델 응답 한 번과 그 응답이 부른 도구 결과 묶음입니다. 체크포인트 단위입니다 | F.conversation.spec §2 |
| 승인 (approval) | 사람의 응답을 기다리는 단일 대기 레코드입니다. 종류는 도구(`tool`), 계획(`plan`), 질문(`question`), 검토(`review`)입니다. 한 프로토콜로 처리합니다 | adr.0018, L1.tools.spec §2 |
| 신뢰 (trust) | 프로젝트 폴더의 확장과 프로젝트 자원을 쓸지 정하는 판정입니다. 신뢰 등급은 `builtin`, `user`, `project`, `untrusted` 넷이고 확장이 할 수 있는 일을 정합니다 | X.loading-trust.spec §4.6, §4.7 |
| `실행권` (Scheduler leader) | 옛 이름입니다. `sys_leases`의 `scheduler` 자원을 쥔 프로세스 하나, 곧 Scheduler leader가 예약 틱을 돌립니다. 아직 아무도 잡지 않습니다 | L2.schedule.spec §2, L4.host-service.spec HS-102 |
| 아이템 (item) | 입출력 단위입니다. 사용자 메시지, 어시스턴트 메시지, 시스템 메시지, 도구 호출, 도구 결과, 확장 커스텀 메시지가 있습니다 | F.conversation.spec §2 |
| 안전 모드 | 외부 확장(`user`·`project` 등급), 외부 훅, L3 내장 플러그인 그룹을 싣지 않고 시작하는 모드입니다 | X.operations.spec §2, §4.6.2 |
| 알림 (notice) | 사용자 주의가 필요한 상태를 분류한 신호입니다 | L2.dialog.spec §2 |
| 엔진 | Cordis 호스트, 루프, SQLite를 묶은 라이브러리입니다. 데몬 여부, 전송, 유휴 종료 같은 프로세스 정책은 갖지 않습니다 | architecture.overview.spec §2, L0.process.spec §2 |
| 예약 (`timer`) | cron 또는 at으로 정한 예약입니다. 기한마다 새 대화를 만들어 실행합니다 | L2.schedule.spec §2 |
| 원장 | 스킬과 메모리의 모든 변경 기록입니다. 전후 내용을 blob으로 가집니다 | L2.knowledge.spec §2 |
| 웹 provider | 웹 기능(검색, 가져오기, 브라우즈)을 실제로 수행하는 구현입니다. 내장(`builtin-wrapper`, `local`, `playwright-local`, `native`)과 플러그인(`plugin:<확장 이름>`)이 있습니다. SearXNG provider는 2026-11-04 사용자 B15 결정으로 없어졌습니다. 쓰려면 검색 플러그인으로 직접 등록합니다 | L2.web.spec §2 |
| 입력 큐 | thread별 내구 대기열입니다. 이벤트 `input.*`와 투영 `p_inputs`로 이루어집니다 | L1.tasks.spec §2 |
| 자동 끄기 | 실패 기준을 넘은 확장의 Registration을 다음 단계 경계에서 끄는 동작입니다 | X.operations.spec §2 |
| 자식 대화 | 서브에이전트 실행마다 새로 여는 thread입니다. 부모 대화와 소유자를 기록합니다 | L1.agents.spec §2 |
| 프로세스 락 (Process lock, 옛 이름 `자원 임대`, `sys_leases`) | `sys_leases`의 행 하나, 곧 Process lock입니다. 저장 이름 `sys_leases`는 그대로입니다. 자원 이름은 `thread:<threadId>`, `scheduler`, `service` 셋입니다. 소유자 정보와 `epoch`를 담습니다. `epoch`는 자원의 소유자가 바뀔 때마다 1 오르는 펜싱 토큰입니다 | L0.store.spec §2 |
| 플러그인 그룹 | 여러 층의 플러그인을 묶어 한 번에 켜고 끄는 확장입니다. 매니페스트에 `group` 선언이 있으면 플러그인 그룹이고, 없으면 일반 확장입니다. Helm과 학습은 L3 기본 플러그인 그룹입니다 | F.extensions.spec §2, §3.1, L3.group-sdk.spec §2 |
| 플러그인 | 매니페스트 `plugins[]`의 항목 하나입니다. 한 층에 속하는 단일 기능 단위이고, 엔진에 등록하면 Registration 하나가 됩니다. `drive`는 정책이 허용할 때만 씁니다 | F.extensions.spec §2, §3.1 |
| 훅 (hook, 옛 이름 `지점`) | 확장이 `on`으로 핸들러를 거는 이름 붙은 런타임 생애주기 위치입니다. 훅마다 fold가 정해져 있습니다. 코드 이름은 `HookName` 등입니다 | F.extensions.spec §2 |
| 층 | 의존 순위가 같은 패키지 묶음입니다. F, X, L0, L1, L2, L3, L4 순서입니다 | architecture.layers.spec §2 |
| 제안 대기열 | 사람의 결정을 기다리는 에이전트 쓰기 요청 목록입니다. 학습 그룹 대기열과 지식 쓰기 대기열 둘이 있습니다 | L2.knowledge.spec §2 |
| 컴팩션 머리 | 가지 위의 마지막 `thread.compacted`입니다. 조립할 때 `firstKeptEventId` 앞 내용을 요약으로 바꿉니다 | L1.context.spec §2 |
| 커밋 | `SessionService.commit` 한 번입니다. SQL 트랜잭션 하나입니다 | L1.persistence.spec §2 |
| 커밋 키 (`requestId`) | `requests` 테이블의 키 `(thread, requestId)`입니다. 같은 키의 재시도인지 지문으로 판정합니다 | L1.persistence.spec §2 |
| 턴 (turn) | 사용자 입력 하나(예약·원격 입력 하나 포함)에 대한 한 번의 작업입니다. 첫 모델 호출부터 루프 종료까지입니다 | F.conversation.spec §2 |
| 투영 (projection) | 이벤트에서 만든 조회용 테이블(메시지, 파트 등)입니다. 같은 트랜잭션에서 갱신합니다 | architecture.overview.spec §2, F.records.spec §2 |
| 투영기 (projector) | 내구 이벤트를 받아 자기 소유 테이블을 갱신하는 순수 함수 묶음입니다 | L1.persistence.spec §2 |
| 전송 | Runtime API를 실어 나르는 수단입니다. in-process, stdio, service 셋이 있습니다 | architecture.overview.spec §2, L4.host-service.spec §2 |
| 호스트 | 엔진을 소유하고 전송을 열어 계약의 서버 쪽을 맡는 L4 실행 단위(`apps/host`)입니다 | architecture.overview.spec §2 |
| Runtime API (wire) | UI와 엔진 사이의 JSON-RPC 계약입니다. 스키마는 F에 하나만 둡니다 | architecture.overview.spec §2, F.wire-settings.spec §1 |
| 기능 (cap) | 서비스 API와 모델 도구를 한 쌍으로 묶은 L2 단위입니다. 정의는 F에 있고 구현은 `cap-*` 패키지에 있습니다 | architecture.overview.spec §2, F.capabilities.spec §2 |
| 효과 (effect) | 부작용이 있을 수 있는 도구 실행 하나입니다. `effect.intent`는 있는데 `effect.result`가 없으면 열린 효과입니다 | F.records.spec §2, L1.persistence.spec §2 |
| 이벤트 소싱 | 변경을 불변 이벤트로 쌓고, 조회용 투영을 같은 트랜잭션에서 그 이벤트로 갱신하는 저장 방식입니다. 대화 저장은 SQLite 한 파일입니다 | adr.0004 |
| 휘발 이벤트 | 저장하지 않고 연결된 구독자에게만 보내는 이벤트입니다. 토큰 델타가 대표 예입니다 | F.records.spec §2 |
| 활성 가지 | thread의 현재 leaf에서 `parentId`를 따라 처음 이벤트까지 올라간 사슬입니다 | L1.persistence.spec §2 |
| 핸들러 시간 예산 | 핸들러 호출 한 번이 쓸 수 있는 실행 시간(ms)입니다. 사용자 응답을 기다린 시간은 뺍니다 | X.operations.spec §2 |
| `drive` | 루프를 구동할 drive lock을 받는 연산입니다. 한 thread에 drive lock은 하나뿐이고, `drives: true`를 선언한 플러그인만 씁니다. 상한 `{maxTurns, maxSpawns, maxTokens}`가 붙습니다 | adr.0007, F.extensions.spec §4.6, X.primitives.spec §2 |
| `drive lock` / `Driver` | 한 thread에서 진행을 맡을 배타 권한입니다. 한 번에 Registration 하나만 가집니다. 가진 쪽을 `Driver`라고 부르며 화면 라벨은 "주도"입니다(§3). 옛 이름은 `drive 임대`(`lease`)입니다. 저장 문자열 `lease.acquired`·`lease.released`·`lease.rejected`·`leaseId`·`leaseEpoch`는 그대로입니다 | F.extensions.spec §2, §4.6 |
| `fold` | 한 훅에 걸린 핸들러 결과를 합치는 규칙입니다. `tap`(관찰), `first`(차단), `chain`(형성)이 있고 훅 선언이 정합니다. ADR-0017이 `collect`를 더합니다 | F.extensions.spec §2, adr.0017 |
| `on` | 훅에 핸들러를 거는 연산입니다. 훅의 fold에 따라 관찰, 차단, 형성이 됩니다 | adr.0007 |
| `OsDirs` | OS별 디렉터리 값 묶음입니다. data, config, cache, state, runtime, resource를 담습니다 | L0.os.spec §3.2 |
| `post` | 입력을 입력 큐에 넣는 연산입니다. `when`은 `steer`, `followUp`, `next` 중 하나입니다 | adr.0007 |
| `Registration` | 플러그인 하나가 엔진에 등록한 것 전체입니다. 상태 문서, 정리 동작, 켜기·끄기 상태를 가집니다. 엔진 내부 용어라 화면에 쓰지 않습니다. 이전 이름은 `scope`(확장 등록 묶음)이고, 저장 문자열 `scope.changed`·`scopeId`는 그대로입니다. 설정 범위(`scope`)와는 다른 뜻입니다 | F.extensions.spec §2, §3.2 |
| `SOPS`, `age` | 기본 시크릿 제공자 `sops`와 그 암호화 도구 `age`입니다. 개인 키는 OS 키체인이나 파일 폴백에 둡니다 | adr.0019, L0.secrets.spec §4.6~§4.7 |
| `FRESNEL_HOME` | 환경 변수입니다. 값이 있으면 data, config, cache, state, runtime을 그 아래 폴더로 모읍니다 `[제안]` | L0.os.spec §3.2 |

## 3. 화면 라벨 (생성)

`just terms gen`이 아래 표를 만듭니다. 손으로 고치지 않습니다. 화면 라벨은 사용자가 검토 중이라 모두 `proposed`입니다. 작업대의 문서 용어는 LightCraft, 화면 ko는 크래프트이고 코드 id는 `workbench`입니다.

<!-- terms:begin -->
| 문서 용어 | 화면 라벨 ko | 화면 라벨 en | 기계 id | 상태 |
|---|---|---|---|---|
| Background service | 이 컴퓨터(백그라운드) | This computer (background) | — | proposed |
| Benchmark | 성능 측정 | Benchmark | `benchmark` | proposed |
| Capability | 기능 | Capability | `CapabilityId` | proposed |
| Display name | 디스플레이 네임 | Display name | `displayName` | proposed |
| Drive limits | 주도 한도 | Lead limits | `driveLimits`, `driveDefaultLimits` | proposed |
| Driver / drive lock | 주도 | Lead | `drive`, `lease.acquired`, `lease.released`, `lease.rejected` | proposed |
| Embedded | 이 컴퓨터(앱 안) | This computer (in app) | — | proposed |
| Extension | 확장 | Extension | `ExtensionManifest` | proposed |
| fold | 보기·막기·고치기·모으기 | Observe·Block·Modify·Collect | `tap`, `first`, `chain`, `collect` | proposed |
| Group SDK | 그룹 SDK | Group SDK | `group-sdk`, `defineGroup` | proposed |
| Hook(런타임 생애주기 훅) | 훅 | Hook | `HookName`, `HookDecl`, `HookKind`, `HOOKS`, `HOOK_NAMES` | proposed |
| Hook handler | 핸들러 | Handler | — | proposed |
| Injection mode | 주입 방식 | Injection mode | `InjectionMode` | proposed |
| Input Queue | 대기 중인 메시지 | Queued messages | — | proposed |
| Item | 항목 | Item | `ItemKind` | proposed |
| launch(이번 실행) | 이번 실행 | This launch | `SettingScope`, `launch` | proposed |
| Agent Core | 에이전트 코어 | Agent Core | `L1` | proposed |
| Apps | 앱 | Apps | `L4` | proposed |
| Capabilities | 기능 | Capabilities | `L2` | proposed |
| Contracts | 계약 | Contracts | `F` | proposed |
| Extension Runtime | 확장 런타임 | Extension Runtime | `X` | proposed |
| Orchestration | 오케스트레이션 | Orchestration | `L3` | proposed |
| System | 시스템 | System | `L0` | proposed |
| Native UI | 기본 UI | Native UI | `declarative`, `native`, `ViewNode` | proposed |
| Placement | 전체 화면·옆 패널·대화 카드·상태 표시줄·명령·설정 | Page·Side panel·Card·Status bar·Command·Settings | `page`, `well`, `card`, `status`, `command`, `settings` | proposed |
| Plugin | 플러그인 | Plugin | — | proposed |
| Plugin App | 플러그인 앱 | Plugin app | `frame`, `app`, `FrameDecl`, `AppDecl` | proposed |
| Plugin Builder | 플러그인 빌더 | Plugin Builder | `plugin-builder` | proposed |
| Plugin Group | 플러그인 그룹 | Plugin group | — | proposed |
| Plugin UI | 플러그인 UI | Plugin UI | `views`, `ui`, `ViewContribution`, `UiContribution` | proposed |
| post | 입력 넣기: 바로·끝난 뒤·다음 요청에 | Post: Now·After·Next request | `steer`, `followUp`, `next` | proposed |
| Process lock | — | — | `sys_leases` | proposed |
| Fresnel | 프레넬 | Fresnel | — | proposed |
| Profile | 프로필 | Profile | `Profile` | proposed |
| Provider | 제공자 | Provider | — | proposed |
| Question | 질문 | Question | `loop.ask`, `question` | proposed |
| Replay test | 재실행 검사 | Replay test | `replayDrive` | proposed |
| Runtime API | — | — | — | proposed |
| Runtime Server | 런타임 서버 | Runtime server | `apps/host`, `host.*` | proposed |
| Schedule(once / recurring) | 예약: 한 번·반복 | Schedule: Once·Recurring | `once`, `repeat`, `TriggerSpec` | proposed |
| Scheduler leader | — | — | — | proposed |
| Secret | 시크릿 | Secret | — | proposed |
| Secret ref | 시크릿 참조 | Secret ref | `secret://` | proposed |
| Secret registry | 시크릿 목록 | Secret registry | — | proposed |
| Stages | 단계 자리: 트리거·펼치기·모으기·적용 | Trigger·Fan-out·Fan-in·Apply | `trigger`, `fanOut`, `fanIn`, `apply` | proposed |
| Step | 단계 | Step | `StepId`, `boundary.step.*` | proposed |
| Step boundary | 단계가 끝나면 | After this step | — | proposed |
| Task Queue | 작업 큐 | Tasks | — | proposed |
| Test run | 테스트 | Test | `trial`, `testRun` | proposed |
| Thread | 대화 | Conversation | `thread`, `ThreadId` | proposed |
| Trace | 트레이스 | Trace | `trace.turn` | proposed |
| Trust | 신뢰 | Trust | — | proposed |
| Turn | 턴 | Turn | `TurnId`, `turn.start`, `loop.turn`, `boundary.turn.*`, `trace.turn` | proposed |
| LightCraft | 크래프트 | LightCraft | `workbench` | proposed |
<!-- terms:end -->

## 4. 이름 변경 대응 (ADR-0022)

| 옛 이름 | 새 이름 | 비고 |
|---|---|---|
| `지점` (`Point*`, `PointName`, `POINTS`) | 훅 (`Hook*`, `HookName`, `HOOKS`) | 훅 이름 `session.*`는 `thread.*`입니다 |
| `세션` (`SettingScope` `session`, 락 키 `session:<threadId>`) | `launch`, `thread:<threadId>` | 화면 용어는 "대화"입니다. 저장 문자열 `turn.*`·`scope.changed`·`lease.*`·`trn_`·`sys_leases`는 그대로입니다 |
| `비밀`, `비밀 핸들` | 시크릿, 시크릿 참조 | `SecretUseMode`는 `InjectionMode`입니다 |
| `능력` | 기능 (Capability) | 코드 이름 `CapabilityId`는 그대로입니다 |
| `의도 그룹` | 플러그인 그룹 | 매니페스트 모양 변경은 ADR-0022 §3.2 트랙입니다 |
| `scope` (확장 등록 묶음) | `Registration`(`host.register`, `RegistrationId`) | 설정 범위 `scope`는 그대로입니다. 저장 문자열 `scope.changed`·`scopeId`는 그대로입니다 |
| `drive 임대` (`DriveLease`, lease) | `drive lock`(`DriveLock`), 가진 쪽은 `Driver` | 저장 문자열 `lease.*` 이벤트와 `leaseId`·`leaseEpoch`는 그대로입니다 |
| 구동 그룹 설정 `x.primitives.activeDriveGroup` | `x.primitives.activeDriver`(화면: 주도 플러그인) | 옛 키는 읽지 않습니다. 새 키 `x.primitives.driveRequiresGroup`(기본 켜짐)이 더해집니다 |
| 매니페스트 `kind`, `usesDrive`, `points` | `plugins[]`(`layer`, `hooks`, `drives`)와 `group` 선언 유무 | 스키마 2입니다. 옛 형식은 읽지 않습니다 |
| group-kit | group-sdk | 패키지 이름 |
| 예약 종류 `loop` | `repeat` | 예약 상태 파일은 version 2입니다 |
| bench (측정) | benchmark | `just benchmark`, `just benchmark-gate` |
| 작업대 표시 이름 | LightCraft (화면 ko 크래프트) | 코드 id `workbench`는 그대로입니다 |
| `Xeon` / `xeon` | Fresnel / fresnel | 패키지 범위 `@fresnel/*`, 서비스 이름 `fresnel.*`, 환경 변수 `FRESNEL_*`, 프로젝트 폴더 `.fresnel/` |

## 5. 미결 사항

1. `루프`라는 말이 L1 core-loop(`L1.loop.spec`)와 예약 정의(`L2.schedule.spec`)에서 다른 뜻으로 쓰입니다. 한쪽의 이름을 바꿀지 정합니다.
2. `FRESNEL_HOME`은 L0.os 스펙에서 `[제안]`입니다. 정본으로 확정할지 정합니다.
3. 용어 표에 없는 말이 문서마다 따로 쓰이는 경우가 있습니다. 예를 들어 `루프`처럼 같은 말이 둘인 경우가 더 있는지 문서 전체를 대조해야 합니다.
