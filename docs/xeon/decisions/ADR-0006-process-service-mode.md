---
id: adr.0006
layer: adr
domain: process
kind: adr
status: accepted
depends_on: [adr.0004]
binds: [xeon/packages/platform-process/**, xeon/apps/host/**, xeon/apps/cli/**]
---

# ADR-0006 프로세스 구조와 서비스 모드: 엔진 라이브러리, 호스트 계약 하나, 전송 교체

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] 공유 서비스 모드 `xeon service`(자동 기동, 유휴 종료)를 1차로 둔다. OS 서비스 등록은 2차다(`_research/foundation-plan.md §1` 결정표 2번).
- [결정] 예약·원격·알림을 제품 범위에 넣고 데몬을 허용한다(`_research/decisions-log.md` 2026-10-21 결정(3차)).
- [결정] 프로세스 구조는 "엔진 라이브러리 + 단일 호스트 계약 + 전송 교체(CLI in-process, 데스크톱 자식 엔진)"다(`_research/decisions-log.md` 2026-10-21 "계획 v2"). 계획 v2는 공유 서비스 모드를 2차로 두었으나 3차 결정이 1차로 올렸다.
- 표기: `_research/process.md`의 `helm service`는 이 문서에서 `xeon service`로 바꿔 쓴다.
- 개정: 2026-10-21 `review.decisions-2` U-09(§3.6 1·4번 쓰기 소유 펜싱과 소유 표시), U-11(§3.3·§3.5 원격 사용 단계). 결정을 뒤집지 않고 미결과 세부를 정한 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4). 두 항목은 사용자 확인을 거친 [결정]이다(2026-10-22). U-09 세부 정정은 `review.decisions-2` U-09 행을 따른다.
- 개정: 2026-10-26 `review.m3-design-inputs` D-M3-13 행 1·2·5(§3.5 단계 1.5, §3.6 규칙 5, §3.7 체크리스트 4번, §6), D-M3-16 c(서비스 소켓 인증: Unix 소켓은 파일 권한, TCP로 열 때만 토큰), D-M3-17(원격 형태 두 가지: 자체 호스트 서버에 켜 둔 호스트에 다른 기기의 데스크톱·CLI가 접속, 자기 컴퓨터에서 클라이언트가 호스트를 켬). 미결을 정한 보충이다.

## 2. 맥락

### 2.1 데몬이 필요한 기능

- pi durable의 지속성(크래시 뒤 체크포인트 재개, 분기, 승인 대기 복구)은 데몬 없이 얻는다. durable에는 상주 워커가 없고 저장소를 다시 열 때 재개한다(`_research/process.md §0` 1번, `§1.1`). `Harness.open`은 `running` task를 `pending`으로 되돌리고 아무것도 실행하지 않는다(`§1.1`).
- 데몬이 필요한 기능은 "계속 실행"이다. 지속성은 저장소 설계로 얻고 계속 실행은 프로세스 설계로 얻는다(`_research/process.md §0` 2번, `§1.3` 끝 문단). 계속 실행에 속하는 기능은 다음과 같다(`_research/layer-plan-v2-notes.md` "질문에 대한 답" 데몬 항목).
  - 앱과 터미널을 닫아도 도는 백그라운드 작업
  - 예약 실행
  - 앱과 CLI가 같은 세션에 동시에 쓰기
  - 폰이나 원격에서 접속
  - 알림(`_research/process.md §1.3` 알림 행)
- pi 실험 서버는 coordinator, server, 세션별 worker 세 겹이고 "연결 0 + 워커 0이면 1초 뒤 퇴장"한다(`_research/process.md §1.2`). 상시 데몬 없이 필요할 때 뜨는 프로세스의 선례다.

### 2.2 다른 제품의 패턴

`_research/process.md §3`의 다섯 패턴을 요약한다.

| 패턴 | 사례 | 장점 | 단점 |
|---|---|---|---|
| P1 앱이 엔진을 자식으로 띄우고 stdio JSON-RPC | Codex app-server, Hermes TUI·데스크톱, Claude Agent SDK | 포트·인증 불필요, 부모 종료 시 자식 종료 | 클라이언트마다 엔진이 따로 뜬다. 앱을 닫으면 작업이 끝난다 |
| P2 자동 기동 공유 로컬 서비스 + 등록 파일 | opencode v2, Claude Code 감독자, pi 실험 서버 | 앱·CLI·원격이 같은 세션을 본다. 앱을 닫아도 작업이 이어진다 | 수명, 버전 불일치, 이중 기동, 인증을 직접 설계해야 한다 |
| P3 in-process 직접 호출 | 대부분 CLI 기본, omp, 이전 Goose CLI | 가장 빠르고 의존이 없다 | 데스크톱과 경로가 다르면 기능을 두 번 만든다 |
| P4 상시 OS 서비스 | Hermes 게이트웨이 | 재부팅 뒤에도 예약·메신저 수신 | 설치·권한·업데이트·보안 부담이 가장 크다 |
| P5 원격 실행 | Codex cloud, Claude 클라우드 세션 | 기기를 꺼도 이어진다 | 인프라와 계정 의존 |

- 성숙한 제품은 한 패턴만 쓰지 않는다. 공통점은 클라이언트가 쓰는 계약이 전송과 무관하게 하나라는 점이다(`_research/process.md §3` 관찰 문단).
- Goose는 CLI가 에이전트를 in-process로 쓰고 데스크톱이 `goosed`를 거치는 구조에서 "Every new feature ... had to be wired up in both places"라고 공개했다. 해법은 모든 클라이언트가 쓰는 단일 프로토콜이었다(`_research/process.md §0` 3번, `§2.2` Goose).

## 3. 결정

### 3.1 엔진은 라이브러리

[결정] 엔진은 프로세스 정책을 포함하지 않는 라이브러리다(`_research/foundation-plan.md §3` `apps/host` 주석, `_research/process.md §6.1`).

- 엔진 진입점은 DB 경로를 받아 런타임을 여는 함수 하나다. 데몬 여부, 전송 종류, 유휴 종료는 엔진 밖의 호스트(`xeon/apps/host`)가 정한다.
- 엔진은 열 때 재개하고 닫을 때 task 결과를 쓰지 않는다. pi durable의 `open`/`close` 규칙과 같다(`_research/process.md §1.1`).
- 세션 저장은 ADR-0004(`./ADR-0004-session-storage.md`)의 단일 SQLite DB다. 스트리밍 토큰은 휘발 이벤트이고 완성된 파트만 DB 이벤트로 저장한다(`_research/process.md §6.1` 넷째 항목). 그래서 다른 프로세스는 데몬 없이 DB를 읽어 완성된 기록을 따라갈 수 있다.

### 3.2 호스트 계약 하나

[결정] UI(CLI TUI, 데스크톱)는 엔진 객체를 직접 다루지 않고 항상 호스트 계약만 쓴다(`_research/process.md §6.1` 둘째 항목).

- 계약은 JSON-RPC 계열 메시지다.
- 스키마는 단일 원천(F `wire-settings`, `xeon/packages/contracts/src/wire-settings`)에 TypeBox로 둔다. 이 원천에서 TS 타입과 JSON Schema를 생성하고, CI가 생성물과 커밋본의 diff를 검사한다(`_research/process.md §6.1`, Hermes `scripts/gen_gateway_contracts.py` 선례).
- 연결마다 `initialize`를 먼저 주고받는다. 서비스 전송에서는 인증을 `initialize` 전에 끝낸다(`_research/process.md §2.2` Codex, `§6.4` 인증 항목).

### 3.3 전송 세 가지

[결정] 전송만 교체한다(`_research/foundation-plan.md §1` 2·3번, `_research/process.md §6.1` 그림).

| 전송 | 쓰는 곳 | 매체 | 엔진 프로세스 소유 | 단계 |
|---|---|---|---|---|
| in-process | CLI 기본 | 메모리 채널 | CLI 프로세스 | 1차 |
| stdio | 데스크톱(자식 엔진) | 자식 프로세스 stdin/stdout, 줄 단위 JSON | 데스크톱 앱(ADR-0008 `./ADR-0008-desktop-tauri.md`) | 1차 |
| service | `xeon service`에 접속하는 CLI·데스크톱 | 로컬 Unix 소켓 | 서비스 프로세스 | 1차(OS 등록은 2차) |

- [결정: review.decisions-2 U-11] 원격 사용은 1차(M3)에 넣는다. 다른 기기의 클라이언트는 service 전송의 로컬 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결해 쓴다. 전송 종류와 호스트 계약은 service와 같고, 인증은 SSH·사설망 인증과 소켓 파일 권한이 맡는다. 내장 TLS + 토큰 WebSocket 전송은 2차다. 인증서 관리와 외부 노출 위험이 큰 내장 서버 없이 원격 사용을 얻기 위해서다.
- [결정: review.m3-design-inputs D-M3-17] M3 원격 사용 형태는 둘이다. (1) 자체 호스트 서버에서 `xeon` 호스트를 켜 두고 다른 기기의 데스크톱 앱과 CLI가 접속해 개발한다. (2) 자기 컴퓨터에서 데스크톱이나 CLI가 호스트를 켜서 쓴다. 웹 클라이언트는 M3에 넣지 않는다. 웹 UI는 M4다 [결정: 2026-10-28 사용자]. 웹·모바일 알림은 후순위다.

[제안] 호스트 쪽 전송 인터페이스는 다음 형태로 둔다. 메시지 타입 `HostMessage`는 F `wire-settings`가 정한다.

```ts
export type TransportKind = "in-process" | "stdio" | "service";

export interface HostTransport {
  readonly kind: TransportKind;
  send(message: HostMessage): void;
  onMessage(listener: (message: HostMessage) => void): () => void;
  /** 상대가 끊기면(stdin EOF, 소켓 종료) 한 번 호출된다. */
  onClose(listener: (reason: TransportCloseReason) => void): () => void;
  close(): Promise<void>;
}

export type TransportCloseReason = "peer-eof" | "local-close" | "error";
```

### 3.4 서비스 모드 `xeon service`

[결정] 서비스 모드는 다음 요소로 이루어진다(`_research/foundation-plan.md §1` 2번, `_research/process.md §6.2` 단계 2).

- 등록 파일: 권한 0600. 내용은 소켓 주소, pid, 버전, 시작 시각 지문, 무작위 토큰이다.
- `ensure`: 클라이언트가 등록 파일을 읽어 서비스가 없거나 버전이 다르면 기동한다.
- 이중 기동 방지: 고정 소켓 경로를 먼저 바인드한 프로세스가 이긴다.
- 유휴 종료: 연결 0 + live task 0 + 대기 예약 0이면 유예 시간 뒤 종료한다.

[제안] 등록 파일 스키마와 명령은 다음과 같다. 최종 형태는 `L4.host-service.spec`과 `L0.process.spec`이 정한다.

```ts
import { Type, type Static } from "typebox";

export const ServiceRegistration = Type.Object(
  {
    version: Type.String(),              // 엔진 버전. 불일치 판정에 쓴다
    socket: Type.String(),               // Unix 소켓 절대 경로
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.String({ format: "date-time" }), // pid 재사용을 구별하는 지문
    token: Type.String({ minLength: 32 }),           // TCP·WebSocket 전송용. Unix 소켓은 파일 권한으로 인증
  },
  { additionalProperties: true },        // 스키마에 없는 필드 보존(체크리스트 1번)
);
export type ServiceRegistration = Static<typeof ServiceRegistration>;
```

| 명령 [제안] | 동작 | 단계 |
|---|---|---|
| `xeon service start` | 서비스를 `detached`로 기동한다. 이미 있으면 아무것도 하지 않는다 | 1차 |
| `xeon service status` | 등록 파일, 도달 여부, pid, 버전, 연결 수, live task 수를 보여 준다 | 1차 |
| `xeon service stop` | 종료 협조 절차(체크리스트 7번)로 멈춘다 | 1차 |
| `xeon service install` / `uninstall` | launchd 사용자 에이전트 또는 systemd 사용자 유닛을 등록·해제한다. 명시 동의 뒤에만 실행한다 | 2차 |

- CLI와 데스크톱은 서비스 사용 설정이 켜져 있으면 시작할 때 `ensure`를 부르고 service 전송으로 접속한다. 꺼져 있으면 각자의 기본 전송(in-process, stdio)을 쓴다.
- 설정 노출: `L4.settings-ui.spec`의 "실행과 서비스" 탭에 공유 서비스 모드 켜기와 끄기를 둔다(`_research/layer-plan-v2-notes.md` "L4 설정 화면 구성안").

### 3.5 단계 표와 Xeon 배치

`_research/process.md §6.2`의 단계 0~3을 옮긴다. 마지막 열의 Xeon 배치는 [제안]이다.

| 단계 | 상태 | 추가되는 것 | 얻는 기능 | 아직 안 되는 것 | Xeon 배치 [제안] |
|---|---|---|---|---|---|
| 0 | 데몬 없음. CLI = in-process, 앱 = 자식 엔진 | 호스트 계약, 세션 소유 잠금, 열 때 복구(§3.6) | 크래시 재개, 분기, 승인 대기 복구, 이력 검색 | 앱을 닫고 계속 실행, 예약, 다중 클라이언트 쓰기 | M1(`xeon chat` in-process) |
| 1 | 단계 0 + 자식 엔진 수명 임대 | stdin EOF 임대(opencode standalone 방식), 앱 종료 시 진행 중 턴을 안전 경계에서 멈추고 체크포인트 | 앱이 비정상 종료돼도 자식이 남지 않음. 다음 실행 때 "이어서 실행" 제안 | 앱 종료 뒤 계속 실행 | M2(데스크톱 스캐폴드와 함께) |
| 2 | 선택 모드 `xeon service` | 등록 파일, `ensure`, 이중 기동 방지, 유휴 종료, 앱·CLI의 서비스 발견과 접속 | 앱을 닫아도 작업 지속, 앱·CLI 동시 접속, 입력 위임 | 재부팅 뒤 자동 시작, 예약, 원격 | 1차 |
| 3 | 선택 모드: OS 서비스 등록 + 원격 | `xeon service install`(명시 동의), 예약 작업 테이블과 틱, 알림, 원격 전송(TLS + 토큰 WebSocket, 비루프백 무인증 금지) | 예약 실행, 원격·폰, 알림 | 클라우드 실행(범위 밖) | OS 등록은 2차. 예약 틱과 알림은 1차 서비스 모드 안에서 동작. 원격 사용은 1차(M3)에 SSH 터널·사설망 연결로 두고, 내장 원격 전송(TLS + 토큰 WebSocket)은 2차 [결정: review.decisions-2 U-11] |

- [결정] 불변식: 호스트 계약과 DB 스키마는 단계가 바뀌어도 변하지 않는다. 단계 전환은 엔진 프로세스를 누가 소유하는지만 바꾼다(`_research/process.md §6.2` 끝 문단).
- [제안] 예약 틱은 서비스 프로세스 안에서 돈다. 대기 예약이 있으면 유휴 종료 조건이 성립하지 않으므로 서비스가 살아 있는 동안 예약이 실행된다. 재부팅 뒤에는 2차 OS 등록 전까지 사용자가 앱이나 CLI를 열어 `ensure`가 실행될 때 서비스가 다시 뜬다. 그 사이 놓친 예약을 따라잡을지 건너뛸지는 `L2.schedule.spec`이 정한다 [미결: L2.schedule.spec].
- [결정: review.m3-design-inputs D-M3-13 행 5] 단계 1.5(pi식 세션별 분리 워커)는 두지 않는다. foundation-plan이 서비스 모드로 바로 가기 때문이다.

### 3.6 단일 소유와 잠금 규칙

[결정] 단계 0부터 아래 여섯 규칙을 적용한다(`_research/process.md §6.3`). 규칙 5의 자동 재개 기본값은 꺼짐이고 서비스 모드에서 `l1.persistence.autoResume`으로 켠다 [결정: review.m3-design-inputs D-M3-13 행 1]. 두 문서가 어긋나면 ADR이 우선한다(`adr.readme` §5). 상태 전이와 순서의 상세는 `architecture.runtime-flow.design`이 정하되, 어긋남을 발견하면 이 ADR을 먼저 고치고(결정이 바뀌면 `adr.readme` §1.4 번복 절차) runtime-flow를 맞춘다.

1. 쓰기 소유자는 세션마다 하나다. 세션 실행을 시작하려는 프로세스는 세션 id를 키로 한 OS 잠금을 얻어야 한다. 경로 대신 id를 키로 쓰고, 프로세스가 죽으면 커널이 잠금을 푼다(omp 방식, `OMP/docs/session.md:538`). OS 잠금은 생존 판정에 쓰고, 쓰기 소유는 `sys_leases.epoch` 펜싱으로 커밋마다 확인한다. 잠금을 얻은 프로세스가 `sys_leases` 행의 epoch를 올려 `LeaseToken`을 받고, 커밋 트랜잭션 안에서 epoch가 다르면 롤백한다(ADR-0004 §3.4) [결정: review.decisions-2 U-09]. 멈춘 소유자(잠자기, SIGSTOP)는 잠금을 쥔 채라 깨어나거나 죽을 때까지 세션이 잠긴다. 이 한계는 받아들인다(`L0.store.spec` §4.7.1).
2. 읽기는 자유다. SQLite WAL은 읽기 여럿과 쓰기 하나를 허용한다. 잠금은 세션 실행 소유를 막는 장치이고 조회·검색·관찰 UI는 잠금 없이 연다.
3. 잠금을 얻지 못하면 세 가지 중 하나를 고르게 한다.
   - 위임: 서비스가 있으면 소유자에게 입력을 보내는 클라이언트가 된다(단계 2 이후 기본).
   - 관찰: 읽기 전용으로 열고 DB를 따라간다.
   - 분기: 현재 시점에서 `parentId`로 새 분기를 만들어 별도 세션으로 연다.
4. 소유 표시는 `sys_leases` 행(`holder_id`, `kind`, `pid`, `host`, `heartbeat_at`, `expires_at`)이 겸한다. `kind`는 `cli`, `app`, `service` 중 하나다. 별도 `session_owner` 테이블은 두지 않는다. 생존 판정은 OS 잠금이, 소유 판정은 epoch 대조가 하므로 표시 열이 틀려도 안전하다(`L0.store.spec` §3.3) [결정: review.decisions-2 U-09].
5. 비정상 종료 표식: 턴 시작 커밋(`turn.started`)이 `running_since`를 세우고 턴 종료 커밋(`turn.completed`)이 지운다. 표식은 `p_threads`의 `running_since`, `resume_attempts` 열이다(`L1.persistence.spec` §4.8). 열 때 표식이 남은 세션을 "이어서 실행" 후보로 보여 준다. 재개 횟수 상한은 `l1.persistence.maxResumeAttempts`다. 자동 재개 키는 `l1.persistence.autoResume`이고 기본값은 §6 [미결]이다. 작성자 제안은 기본 꺼짐이고 서비스 모드에서만 켜는 것이다 [제안].
6. 결과 불명 도구 호출은 기본적으로 재개 때 다시 실행하지 않고 "중단됨" 결과로 합성한다. 선언이 `unsafe`(기본값)이거나 선언이 없는 도구가 여기에 해당한다. 예외로, 저장된 정책과 현재 선언이 모두 `replay: safe`인 도구만 다시 실행한다(ADR-0004 §3.2 3번).

### 3.7 서비스 모드 체크리스트

[결정] 서비스 모드 구현은 아래 여덟 항목을 만족해야 한다(`_research/process.md §6.4`). 각 항목은 `L4.host-service.plan`의 테스트 목록으로 옮긴다.

| # | 항목 | 규칙 | 근거 |
|---|---|---|---|
| 1 | 등록 파일 | 권한 0600, 스키마에 없는 필드를 보존한다 | Claude Code `roster.json` 규칙(`CC/agent-view.md:848`) |
| 2 | 기동 경합 | 고정 소켓 경로를 먼저 바인드한 쪽이 이긴다. 진 쪽은 물러나 기존 서비스에 접속한다 | opencode contender, pi `acquireServerActivation` |
| 3 | 버전 불일치 | 서비스가 한가하면 자동 재기동, 작업 중이면 경고한다 | opencode `mismatch: replace`, Claude Code 경고 |
| 4 | 유휴 종료 조건 | 연결 0 + live task 0 + 대기 예약 0일 때만 종료한다. 시작 직후 유예를 둔다. 승인 대기 세션은 live로 본다 [결정: review.m3-design-inputs D-M3-13 행 2]. 근거는 작성자 제안과 같다(Claude Code는 권한 프롬프트에서 멈춘 세션을 계속 실행으로 본다, `CC/agent-view.md:819`) | pi 10초/1초 유예 |
| 5 | 인증 | 로컬은 Unix 소켓 + 파일 권한. 1차 원격 중 SSH 터널은 같은 소켓을 쓰므로 같은 규칙이다. 소켓을 사설망에 TCP로 열 때만 토큰(`host.hello` `auth`)이 필수다 [결정: review.m3-design-inputs D-M3-16 c]. 2차 TCP·WebSocket은 무작위 토큰 필수, `initialize` 전에 인증한다. 비루프백 리스너의 무인증 기동을 금지한다 | Codex app-server |
| 6 | 부모-자식 수명 | 자식 엔진은 stdin EOF 임대로 정리한다. 서비스는 `detached` + `unref`로 부모에서 분리한다 | opencode `standalone.ts:23-27`, pi `PX/process.ts:40-70` |
| 7 | 종료 협조 | 먼저 종료 요청을 보내고 안전 경계에서 체크포인트한 뒤 종료한다. 서비스는 SIGTERM으로 요청하고 시한 뒤 SIGKILL한다. 데스크톱 자식 엔진은 Tauri 셸 플러그인이 SIGKILL만 보내므로 stdin으로 `shutdown` 요청을 먼저 보낸다(ADR-0008) | opencode 3초, `_research/notes/arch-2.md §5` 1행 |
| 8 | 단일 장애점 | 서비스가 죽어도 DB와 복구 표식이 남으므로 다음 `ensure`가 재개 후보를 제시한다. 서비스 소실을 감지한 클라이언트는 안전하게 멈춘다 | Claude Code 감독자 소실 시 1분 뒤 정지 |

## 4. 결과

### 4.1 좋은 점

- CLI와 데스크톱이 같은 호스트 계약을 쓰므로 기능을 한 번만 만든다(Goose 교훈 회피).
- 서비스 모드로 백그라운드 작업, 예약, 앱·CLI 동시 접속이 가능하다. 원격은 1차에 같은 소켓을 터널로 연결해 얻고, 2차 내장 원격 전송도 같은 계약 위에 전송 하나를 더하는 일이다.
- 단계가 바뀌어도 호스트 계약과 DB 스키마가 같으므로 단계 0에서 만든 코드를 버리지 않는다.
- 잠금 규칙이 단계 0부터 적용되므로 서비스가 없을 때도 같은 세션에 두 프로세스가 섞여 쓰지 않는다.

### 4.2 감수할 점

- 서비스 수명, 버전 불일치, 이중 기동, 인증을 직접 설계하고 테스트해야 한다(`_research/process.md §4` P2 항목).
- 확장은 같은 프로세스에서 돌고 격리가 기본값이 아니다(`_research/layer-plan-v2-notes.md` "질문에 대한 답" 확장 프로세스 격리 항목). 비협조적인 확장 코드가 종료를 막을 수 있고, 프로세스 안에서 강제로 멈출 수 없다(durable `docs/spec.md:5096`, `5109-5123` 비목표).
- 서비스 프로세스가 단일 장애점이 된다. 체크리스트 8번으로 피해 범위를 줄이지만 없애지는 못한다.
- 2차 OS 등록 전에는 재부팅 뒤 예약 실행이 사용자가 앱이나 CLI를 열 때까지 밀린다.
- 세션 잠금 구현을 정하지 않았다. 네이티브 flock 바인딩과 `proper-lockfile`(크래시 뒤 수 초 대기)은 크래시 직후 대기 시간이 다르다(`_research/process.md §6.3` 1번).

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| 데몬 없음 | P3(CLI)와 P1(데스크톱)만 둔다 | 탈락 | 예약·원격·알림을 범위에 넣은 3차 결정을 만족하지 못한다. 앱을 닫으면 작업이 멈춘다(`process.md §4`) |
| 상시 OS 서비스 우선 | Hermes 게이트웨이처럼 launchd·systemd 상주를 기본으로 둔다 | 2차 선택으로 낮춤 | 설치·권한·업데이트·보안 부담이 가장 크고 명시 동의가 필요하다(`process.md §3` P4, `§4`). 메신저 연동 요구가 없으면 과하다(`§2.2` Hermes) |
| pi식 세션별 분리 워커(단계 1.5) | 세션 잠금을 쥔 `detached` 자식이 live task가 끝나면 스스로 종료한다 | 탈락 | pi가 coordinator·server·worker 세 겹으로 풀 만큼 코드가 복잡하다. 서비스 모드를 바로 만드는 편이 단순할 가능성이 있다(`process.md §6.2` 첫째 항목 [의견, 미검증]) |
| 서비스 모드만 단독 | CLI와 데스크톱 모두 항상 서비스에 접속한다 | 탈락 | 서비스가 없을 때도 CLI 한 번 실행에 서비스 기동이 필요해진다. in-process가 가장 빠르고 의존이 없다(`process.md §3` P3). 단일 계약 위에서는 in-process를 기본으로 두어도 이중 구현이 생기지 않는다 |
| 원격 실행 | Codex cloud처럼 작업마다 원격 작업 공간을 둔다 | 범위 밖 | 인프라와 계정에 의존한다(`process.md §3` P5, `§6.2` 단계 3 "아직 안 되는 것") |

## 6. 미결 사항

- [미결] 세션 잠금 구현: 네이티브 flock 바인딩과 `proper-lockfile` 중 선택(`_research/process.md §6.3` 1번, `§6.5` 4번). macOS·Linux·Windows의 OS 임대 방식(omp: Linux 추상 소켓, Windows named mutex, macOS flock 사이드카, `process.md §5`)을 L0에서 공통 인터페이스로 둘지 함께 정한다.
- 닫음: 자동 재개 기본값은 꺼짐, 서비스 모드에서 설정으로 켠다 [결정: review.m3-design-inputs D-M3-13 행 1]. 모델 요청 재전송 정책과 효과 재생 시험이 생긴 뒤 다시 본다.
- 닫음: 단계 1.5 생략을 [결정]으로 올렸다 [결정: review.m3-design-inputs D-M3-13 행 5].
- 닫음: 승인 대기 세션은 유휴 종료 판정에서 live다 [결정: review.m3-design-inputs D-M3-13 행 2].
- [가정] `process.md §7`의 한계를 전제로 둔다. Codex 데스크톱이 app-server를 띄우는 방식과 TUI in-process 전송, 클라이언트가 모두 끊겼을 때 진행 중 턴의 처리는 2차 출처이거나 미확인이다. Goose 이전 `goosed`의 세부와 2.0 ACP 서버 전송 방식도 미확인이다. opencode의 유휴 종료 부재와 pi의 서버 시작 시 자동 재개 부재는 검색 결과 부재에 근거한다.
