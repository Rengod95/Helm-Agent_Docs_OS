---
id: L0.process.plan
layer: L0
domain: process
kind: plan
status: draft
depends_on: [L0.process.spec, L0.store.spec, adr.0006, eng.testing.guide]
binds: [xeon/packages/platform-process/**]
---

# L0 프로세스 구현 계획 (process)

대상 스펙: `L0.process.spec`. 패키지: `xeon/packages/platform-process`(`@xeon/platform-process`, 서브패스 `./testing`).

## 1. 목표와 마일스톤 배치

[결정] 공유 서비스 모드 `xeon service`는 제품 1차 범위다(`_research/foundation-plan.md §1` 결정 2, adr.0006 §1). 계획 v2 표가 '2차'로 적은 것은 이 결정으로 올라갔다. 구현은 M2 이후다(`L0.readme` §2.2). OS 서비스 등록은 2차다(review.decisions-2 S-01). 원격 사용은 1차(M3)이고 로컬 서비스 소켓을 SSH 터널이나 사설망으로 연결하는 방식이다. 내장 TLS + 토큰 WebSocket은 2차다 [결정(잠정): review.decisions-2 U-11].

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M1 | in-process 전송 쌍과 envelope 검사 연결, 백그라운드 프로세스 레지스트리, 종료 협조 골격(`ProcessShutdown`), `xeon chat` 단계 0(자식 엔진 없음, adr.0006 §3.5) | PR-01, PR-06, PR-07, PR-08 |
| M2 | 줄 단위 프레이밍과 stdio JSONL 전송, 전송 적합성 스위트(`F.wire-settings.spec` §9 A10), 자식 엔진 수명 임대(stdin EOF + `host.shutdown`), 잠금 실패 정책, 복구 표식 제시, X 포트 `ProcessPort.run`(외부 훅) | PR-02~PR-05, PR-15, PR-16, PR-21 |
| M2 이후(제품 1차 범위) | 공유 서비스 모드: 등록 파일, `ensure`, 이중 기동 방지, 버전 불일치, 유휴 종료, 토큰 인증, 소켓 전송, 감독 | PR-09~PR-14 |
| M3(제품 1차 범위) | 원격 사용: 로컬 서비스 소켓을 SSH 터널(Unix 소켓 전달)이나 사설망으로 연결해 같은 socket 전송·인증 규칙으로 접속 | PR-20 |
| 2차 | launchd·systemd 등록, 내장 원격 전송(TLS + 토큰 WebSocket), Windows 전송 대안, `ProcessPort.spawn`(격리 확장 자식) | PR-17~PR-19, PR-22 |

- M1 스모크(`xeon chat` 강제 종료 뒤 재개, `_research/foundation-plan.md §6`)는 in-process 전송(PR-01)을 쓴다. 강제 종료 뒤 재개 자체는 `L0.store.plan` ST-12·ST-13과 `L1.persistence.plan`이 맡는다.
- F 선행 조건: `L0.process.spec` §8.1 FR-P7(`ProcessService` 타입, `F.capabilities.plan` P9)과 `ProcessPort`(`F.extensions.plan` E10)는 M1 착수 조건이다. M1에서 `run`·`spawn`은 타입을 맞춘 거부 구현만 둔다. 매니페스트 `hooks`가 M1에 없기 때문이다(review.decisions-2 U-07). FR-P1(`host.shutdown`)은 PR-05, FR-P2(hello 토큰)와 FR-P3(`ServiceRegistration`)은 PR-09·PR-13 착수 조건이다. `LockBusy`는 `L0.store.spec` FR-S2에 기댄다(PR-15). `RecoveryMarker`는 `L1.persistence.spec` §8.3 FR-P1에 기댄다(PR-16).

## 2. 패키지와 파일 배치

```
xeon/packages/platform-process/
  package.json                    # exports ".", "./testing". xeon.layer L0, domain process
  bunfig.toml
  src/
    index.ts                      # 공개 API 재수출, processPlugin
    transport/
      in-process.ts               # createInProcessPair (개발 빌드 JSON 왕복)
      framing.ts                  # JSON Lines 분할·결합, maxFrameBytes, -32600/-32700 응답 생성
      stdio.ts                    # createStdioTransport
      socket.ts                   # listenSocket, connectSocket (Bun.listen/Bun.connect unix)
      index.ts
    lease/
      child-lease.ts              # watchChildLease (stdin EOF)
      shutdown.ts                 # createProcessShutdown (참여자, 시한, exit 주입)
    registry.ts                   # BackgroundRegistry (메모리)
    port/
      hook-run.ts                 # ProcessPort.run: 셸 없는 실행, 출력 상한, signal 중단 시 트리 종료 (PR-21)
      isolation.ts                # ProcessPort.spawn: 격리 확장 자식 기동과 레지스트리 등록 (PR-22, 2차)
    service/
      registration.ts             # ServiceRegistrationSchema, RegistrationStore (0600, 임시 파일 + rename, 미지 필드 보존)
      ensure.ts                   # ensureService
      idle.ts                     # createIdleMonitor
      auth.ts                     # verifyToken, newServiceToken
      supervisor.ts               # 서비스 쪽: 바인드 경합, stale 소켓 처리(service 임대), 등록 파일 수명
    lock-fallback.ts              # LockFallbackPolicy
    resume-offer.ts               # buildResumeOffers
    registrar/                    # 2차
      provider.ts                 # OsServiceRegistrar
      launchd.ts
      systemd.ts
      none.ts
    select.ts                     # OS provider 선택 지점 하나 (registrar, 소켓 경로 한도, 분리 옵션)
    settings.ts                   # defineSettings("l0.process", …)
    service.ts                    # ProcessService 조립, Cordis 플러그인 (xeon.process)
    testing/
      index.ts                    # 가짜 자식 엔진 실행기, 전송 적합성 하네스 연결
      fake-engine.ts              # 자식 프로세스 진입점: stdio 전송 + watchChildLease + 지연 가능한 참여자
      idle-clock.ts               # 수동 시계 연동 유휴 타이머 도우미
  test/
    transport-conformance.int.test.ts
    stdio.int.test.ts
    child-lease.int.test.ts
    shutdown.test.ts
    registry.int.test.ts
    hook-run.int.test.ts
    registration.int.test.ts
    ensure.int.test.ts
    idle.test.ts
    auth.test.ts
    socket.int.test.ts
    lock-fallback.test.ts
    resume-offer.test.ts
    service-loss.int.test.ts
    fixtures/                     # 자식 진입 스크립트(parent-of-engine.ts, tree.ts)
```

- 파일 이름 접미사는 `eng.testing.guide` TS-01을 따른다. 실제 자식 프로세스·소켓·파일을 쓰면 `.int`다. 순수 함수 테스트는 소스 옆 `*.test.ts`에 둔다.
- `node:child_process`, `Bun.spawn`, `Bun.listen`, `Bun.connect`는 이 패키지가 소유한다(DR-07). OS 분기는 `select.ts`만 쓴다(DR-13).
- 다른 `@xeon/platform-*`를 import하지 않는다(DR-02). `xeon.store`·`xeon.os`·`xeon.exec`는 Cordis 서비스와 F 타입으로만 쓴다.

## 3. 작업 분해

규모: S(하루 이내), M(2~3일), L(4일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| PR-01 | `transport/in-process.ts`: 쌍 생성, `queueMicrotask` 전달, 개발 빌드 JSON 왕복과 운영 빌드 얕은 freeze, 양쪽 `onClose`. `HostConnection`(F)과 공통 envelope 검사 경로 연결 확인 | F wire `Transport` | S | M1 |
| PR-02 | `transport/framing.ts`: 줄 단위 분할·결합(`TextDecoder` stream), `\r` 제거, 빈 줄 무시, `maxFrameBytes` 초과 프레임 버림과 `-32600` 생성, `-32700` 생성 | - | S | M2 |
| PR-03 | `transport/stdio.ts`: `createStdioTransport`, 백프레셔, EOF → `onClose("eof")`, 송신 직렬화 | PR-02 | M | M2 |
| PR-04 | 전송 적합성 스위트 연결: `F.wire-settings.plan`의 적합성 케이스를 in-process와 stdio(자식 프로세스) 양쪽에 돌리는 `transport-conformance.int.test.ts` | PR-01, PR-03 | M | M2 |
| PR-05 | 자식 엔진 임대와 shutdown 협조: `watchChildLease`, `host.shutdown` 처리 연결(L4 처리기에서 부를 함수), 시한 뒤 강제 종료, `testing/fake-engine.ts` 사이드카 시뮬레이터 | PR-03, PR-07, FR-P1 | M | M2 |
| PR-06 | `registry.ts`: `register`·`list`·`get`·`stop`·`stopOwnedBy`·`onChange`, graceful → force, 끝난 항목 보관 시간, 종료 참여자 등록. 프로세스 트리 정리 통합 테스트(등록자 쪽 `BackgroundStopper`를 프로세스 그룹 kill로 구현한 테스트 도우미. L0 패키지끼리 import하지 않으므로(DR-02) 실제 `startBackground` 핸들과의 결합은 L1 tools 통합 시험이 확인한다) | FR-P7, PR-07 | M | M1 |
| PR-07 | `lease/shutdown.ts`: `createProcessShutdown`(신호, 참여자 역순 호출, 시한, `exit` 주입, 중복 요청 합치기) | FR-P7 | S | M1 |
| PR-08 | `service.ts`, `settings.ts`: `ProcessService` 조립과 `xeon.process` 등록, `l0.process.*` 선언 | PR-06, PR-07 | S | M1 |
| PR-09 | `service/registration.ts`: `ServiceRegistrationSchema`, 0600 임시 파일 + fsync + rename, 미지 필드 병합 보존, 모드 검사, `removeIfOwned` | FR-P3 | S | M2 이후 |
| PR-10 | `service/ensure.ts`와 `service/supervisor.ts`: `ensureService` 알고리즘, bind-first-wins, stale 소켓은 `service` 임대를 얻은 쪽만 unlink, 등록 전 접속 대기열, detached + unref 기동 | PR-09, PR-13 | L | M2 이후 |
| PR-11 | 버전 불일치 처리: 한가하면 `host.shutdown(version_replace)` 후 재기동, 바쁘면 `version_mismatch_busy`, 주 버전 다르면 접속 거부 | PR-10, FR-P1 | M | M2 이후 |
| PR-12 | `service/idle.ts`: 유휴 종료 판정기(수동 시계), 시작 유예, 승인 대기 live 계산, `idleShutdownAt` | PR-07 | S | M2 이후 |
| PR-13 | `service/auth.ts`와 `transport/socket.ts`: 토큰 생성·상수 시간 비교, `host.hello` 전 인증 연결, Unix 소켓 리스너(0600, 경로 길이 검사, 소켓 상대 경로 24바이트 상한). runtime 경로 폴백은 `xeon.os`가 한다(`L0.os.spec` §3.2) | PR-02, FR-P2 | M | M2 이후 |
| PR-14 | 서비스 소실 처리: 클라이언트 정지 상태, 재접속 안 함, 다음 `ensure`의 재개 후보 제시 통합 테스트 | PR-10, PR-16 | S | M2 이후 |
| PR-15 | `lock-fallback.ts`: `LockFallbackPolicy.decide` 규칙 네 가지, `thread.locked` details 생성 도우미 | FR-S2 | S | M2 |
| PR-16 | `resume-offer.ts`: `buildResumeOffers`(입력 `ResumeCandidate[]`, 자동 재개 꺼짐 기본, 서비스 모드 한정, 상한, `heldBy`) | L1.persistence FR-P1(`RecoveryMarker`) | S | M2 |
| PR-17 | `registrar/launchd.ts`, `registrar/systemd.ts`, `none.ts`: 동의 인자 필수, 파일 쓰기와 명령 실행, 실패 시 되돌리기, 종료코드 78 규칙 | PR-10 | M | 2차 |
| PR-18 | 내장 원격 전송(TLS + 토큰 WebSocket), 비루프백 무인증 기동 금지 | PR-13 | L | 2차 |
| PR-19 | Windows 전송 대안 실측과 구현(미결 P-6). 결과에 따라 F `TransportKind` 추가 요청 | PR-13 | L | 2차 |
| PR-21 | `port/hook-run.ts`: `ProcessPort.run`(spec §4.8 규칙 1~5). 부모 env 미상속, stdin 쓰기 뒤 닫기, stdout·stderr 상한과 `stdoutTruncated`, `signal` 중단 시 graceful → force 트리 종료와 `timedOut`, 기동 실패는 `spawnError`. `service.ts`의 `ProcessService`에 연결 | PR-08, F.extensions.plan E10 | M | M2 |
| PR-22 | `port/isolation.ts`: `ProcessPort.spawn`(spec §4.8). Bun 자식 기동, `owner.ref = label`로 레지스트리 등록, 트리 kill. M1~M2는 거부 구현만 둔다 | PR-06, PR-08 | M | 2차 |
| PR-20 | 원격 사용 확인: 소켓 중계(SSH Unix 소켓 전달을 흉내 내는 테스트 중계)를 거친 클라이언트가 `connectSocket`, `host.hello` 토큰 검사, 서비스 소실 처리를 로컬과 같은 결과로 통과하는 int 테스트. 원격 연결 안내 문구(`ssh -L`, 사설망 주소)는 `L4.host-service.spec`이 쓴다 | PR-13, PR-14 | S | M3 |

## 4. 채택 코드

| 대상 | 버전 | 방식 | 비고 |
|---|---|---|---|
| `Bun.listen`, `Bun.connect`(unix) | Bun 1.4.3 내장 | 그대로 쓴다 | 선언 `bun.d.ts:7401-7406`. 파일 소켓 실측(`_research/notes/L0-2.md §2.4`). 추상 소켓은 쓰지 않는다 |
| `node:net` | Bun 1.4.3 node 호환 | `Bun.listen`이 맞지 않을 때의 대안 | - |
| `node:child_process` | Bun 1.4.3 node 호환 | 서비스 detached 기동(`spawn` + `unref`), 테스트 자식 프로세스 | DR-07 소유 패키지 |
| `typebox` | 1.4.2(catalog) | `ServiceRegistrationSchema`, 설정 스키마 | - |
| 외부 npm 패키지 | - | 없음 | - |

참고 구현(코드는 가져오지 않는다, 읽기 자료만):

| 출처 | 위치 | 참고하는 것 |
|---|---|---|
| opencode | `packages/cli/src/services/standalone.ts:23-27` | stdin EOF를 소유 임대의 끝으로 보는 규칙 |
| opencode | `packages/desktop/src/main/service/background-service.ts:49-52` | 고정 주소 contender 방식 이중 기동 방지 |
| opencode | `packages/cli/src/server-process.ts:60-64`, `:90-95` | 서비스 cwd를 홈으로, 무작위 비밀번호 |
| pi(실험 서버) | `PX/server.ts:154`(`ServerLifetime`), `:200`(`acquireServerActivation`), `PX/process.ts:40-70` | 연결 0 + 작업 0 유휴 종료와 유예, 기동 경합, detached 분리 |
| Claude Code | `CC/agent-view.md:819`, `:848`(`roster.json` 규칙) | 승인 대기를 실행 중으로 보는 규칙, 상태 파일의 모르는 필드 보존 |
| Hermes | `gateway-internals.md:613`, `:684` | 종료코드 78로 재시작 반복 중단, PID + 시작 시각 지문 |

경로 약칭은 `_research/process.md` 머리말을 따른다.

## 5. 단위 테스트 목록

| 테스트 | 파일 | 확인할 동작 |
|---|---|---|
| `frames split across chunks are joined` | `src/transport/framing.test.ts` | 한 메시지를 1바이트씩 넣어도, 한 청크에 세 메시지를 넣어도 같은 메시지열. 다바이트 UTF-8 문자가 청크 경계에서 깨지지 않음 |
| `oversized frame is dropped with -32600` | `src/transport/framing.test.ts` | `maxFrameBytes + 1` 프레임은 버려지고 `-32600`(`issue: frame_too_large`) 응답 하나, 다음 프레임 정상 |
| `invalid json yields -32700 and keeps the connection` | `src/transport/framing.test.ts` | 깨진 줄 다음 정상 줄이 처리됨 |
| `in-process and stdio pass the same conformance cases` | `transport-conformance.int.test.ts` | A10 케이스 전부가 두 전송에서 같은 결과 |
| `in-process rejects non-serializable values in dev builds` | `transport-conformance.int.test.ts` | `undefined` 필드·`Date`·함수가 JSON 왕복으로 사라지거나 바뀌어 params 검사에서 걸림 |
| `stdin EOF triggers safe shutdown` | `child-lease.int.test.ts` | `fake-engine` 자식의 stdin을 닫으면 참여자가 불리고 종료코드 0, 표식 미삭제 기록 |
| `shutdown request is answered before exit` | `child-lease.int.test.ts` | `host.shutdown` 응답이 온 뒤 프로세스 종료 |
| `shutdown timeout forces exit` | `shutdown.test.ts` | 끝나지 않는 참여자가 있으면 시한 뒤 `exit(1)`(수동 시계, 주입한 `exit`) |
| `duplicate shutdown requests share one run` | `shutdown.test.ts` | EOF와 `host.shutdown`이 겹쳐도 참여자는 한 번씩 불림 |
| `parent kill -9 terminates the child engine` | `child-lease.int.test.ts` | `fixtures/parent-of-engine.ts`를 SIGKILL하면 손자인 엔진이 `timeoutMs + 1000` 안에 사라짐 |
| `registration file is 0600, atomic, and keeps unknown fields` | `registration.int.test.ts` | 모드 0600, 미지 필드 보존, 임시 파일 단계에서 중단해도 기존 파일 온전, 0644 파일은 `insecure_mode` |
| `concurrent ensure leaves one service` | `ensure.int.test.ts` | 두 `ensureService` 동시 호출(소켓 경로·runtimeDir 주입)에서 서비스 하나, 두 결과의 `pid` 동일 |
| `stale socket is replaced only by the service lease holder` | `ensure.int.test.ts` | SIGKILL로 남은 소켓 파일을 경합자 둘이 처리할 때 unlink는 한 번 |
| `version mismatch restarts an idle service` | `ensure.int.test.ts` | 한가한 구버전은 종료되고 새 버전 기동 |
| `version mismatch warns on a busy service` | `ensure.int.test.ts` | live task 1인 구버전에는 `version_mismatch_busy`, 구버전 유지 |
| `idle shutdown requires all conditions` | `idle.test.ts` | 연결·live task·예약·유예 조합 다섯 행(spec §4.4.4 표), 시작 유예 동안 판정 없음 |
| `approval wait counts as live` | `idle.test.ts` | 승인 대기 세션 1개면 유휴 아님 |
| `token mismatch is rejected before hello` | `auth.test.ts`, `socket.int.test.ts` | 틀린 토큰의 `host.hello` 거부와 연결 종료, 상수 시간 비교 함수가 길이 다른 입력에도 거짓 |
| `socket path length is checked` | `socket.int.test.ts` | 한도 초과 경로는 `path_too_long`. 소켓 상대 경로(`xeon.sock`, `d<8 hex>/xeon.sock`)가 `SOCKET_RELATIVE_PATH_MAX_BYTES`(24) 이하. 폴백 경로 계산은 이 패키지에 없다 |
| `client stops when the service is lost` | `service-loss.int.test.ts` | 서비스 SIGKILL 뒤 클라이언트 정지 상태, 쓰기 미전송, 다음 `ensure`가 재개 후보 반환 |
| `pid reuse is detected by fingerprint` | `registration.int.test.ts` | 등록 파일의 `pid`가 살아 있지만 `startedAt`이 다르면 `removeIfOwned`가 거짓, `ensure`는 접속 실패로 판정 |
| `registry stops the whole process tree` | `registry.int.test.ts` | `fixtures/tree.ts`(자식 + 손자) 등록 뒤 `stopOwnedBy`로 모두 종료, graceful 무시 프로세스는 force로 종료, 상태 `killed` |
| `registry stops everything on shutdown` | `registry.int.test.ts` | 종료 협조 때 모든 항목이 정지 |
| `process service satisfies ProcessPort` | `src/service.test.ts` | `ProcessService` 구현 객체가 `ProcessPort`에 대입된다(타입 테스트, spec §9 14) |
| `hook run reports spawn errors without rejecting` | `hook-run.int.test.ts` | 없는 실행 파일 → `exitCode: null`, `spawnError: "ENOENT"`, Promise 이행 |
| `hook run truncates output and stops on abort` | `hook-run.int.test.ts` | 상한보다 긴 stdout은 잘리고 `stdoutTruncated: true`. `signal` 중단 뒤 자식·손자가 남지 않고 `timedOut: true` |
| `hook run does not inherit parent env` | `hook-run.int.test.ts` | 부모에만 있는 `XEON_TEST_PARENT_ONLY`가 훅 env에 없다(spec §9 15) |
| `lock fallback chooses delegate, observe, fork` | `lock-fallback.test.ts` | 서비스 소유 → `act(delegate)`, 대화형 → `ask[observe, fork]`, 비대화 + 기본 `fork` → `act(fork)`, 명시 `delegate`인데 서비스 없음 → `ask` |
| `auto resume is off by default and bounded` | `resume-offer.test.ts` | 기본값 `offer`, 서비스 모드 + 켬 → `auto_resume`, 시도 수 상한 도달 → `exhausted`, 다른 프로세스 보유 → `heldBy` 채움 |
| `settings definitions pass checkSettingDef` | `src/settings.test.ts` | `l0.process.*` 일곱 키 통과 |

## 6. 완료 기준

- `cd xeon && just verify`가 종료코드 0이다.
- M1 스모크(`apps/cli/test/chat.scenario.test.ts`, 강제 종료 뒤 재개)가 이 패키지의 in-process 전송을 쓰고 통과한다.
- M2: stdio 사이드카 시뮬레이터(`testing/fake-engine.ts`)로 임대 시나리오(stdin EOF 종료, `host.shutdown` 응답 뒤 종료, 시한 초과 강제 종료, 부모 kill -9 뒤 자식 종료)가 통과한다. 전송 적합성 스위트가 in-process와 stdio에서 통과한다. `hook-run.int.test.ts`가 통과한다(spec §9 14·15).
- 서비스 모드: adr.0006 §3.7 체크리스트 8항이 `L0.process.spec` §4.4.7 표의 문장마다 §5의 테스트 하나 이상에 대응하고 모두 통과한다.
- M3: PR-20 원격 중계 시험이 통과한다(review.decisions-2 U-11).
- `platform-process`의 import 목록에 다른 `@xeon/platform-*`가 없다(check-layers, DR-02).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| Windows에 Unix 소켓·SIGTERM 협조가 없다 | 서비스 전송과 종료 협조가 다르게 동작 | 협조 종료는 `host.shutdown` 메시지 하나로 통일한다. 전송은 대안(named pipe, loopback TCP + 토큰)으로 후퇴하며, 그러면 F `TransportKind` 추가가 필요하다(PR-19, 미결 P-6) |
| Tauri가 자식에 SIGKILL만 보낸다 | 체크포인트 없이 엔진 종료 | `host.shutdown` 메시지를 신호보다 먼저 보낸다(adr.0008 §3.3). 놓쳐도 stdin EOF 임대와 복구 표식이 다음 실행에서 재개 후보를 만든다 |
| 서비스 단일 장애점 | 서비스 크래시 때 모든 클라이언트 정지 | DB와 복구 표식이 남으므로 다음 `ensure`가 재개 후보를 보인다(체크리스트 8번). 클라이언트는 쓰기를 보내지 않고 정지한다 |
| 버전 불일치 재기동 중 진행 작업 손실 | 사용자 작업 중단 | 한가할 때만 재기동한다. 바쁘면 경고 후 구버전에 접속한다 |
| 이중 기동 경합의 비결정 재현 | 경합 버그가 CI에서 드물게만 보임 | 수동 시계, 소켓 경로·runtimeDir 주입, 기동 함수 주입으로 두 경합자의 순서를 테스트가 고정한다. stale 소켓 처리는 `service` 임대로 직렬화한다 |
| 비협조 확장 코드가 종료를 막음 | 이벤트 루프 정지로 시한 타이머도 돌지 않음 | 프로세스 안에서는 막을 수 없다. 부모(데스크톱, `xeon service stop`)의 시한 뒤 SIGKILL만 정리한다(adr.0006 §4.2) |
| Bun의 `detached`·`unref`, `Bun.listen` unix 동작 차이(macOS 미실측) | 서비스가 부모와 함께 종료되거나 바인드 실패 | PR-10·PR-13에서 macOS CI job으로 확인한다. 실패하면 `node:net`·다른 spawn 옵션으로 바꾼다 |
| 장수명 stdio 파이프의 버퍼링 | 대용량 이벤트 배치에서 지연 | 송신 백프레셔를 따른다. 문제가 확인되면 adr.0008 §6 미결대로 로컬 소켓 전환을 검토한다 |
