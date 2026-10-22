---
id: L4.host-service.spec
layer: L4
domain: host-service
kind: spec
status: draft
depends_on: [F.wire-settings.spec, F.records.spec, F.extensions.spec, X.loading-trust.spec, adr.0004, adr.0006, adr.0008, eng.dependency-rules.guide, eng.events.design, eng.transactions.design, L0.process.spec, L0.os.spec, L0.store.spec, L1.persistence.spec, L1.tasks.spec, L1.loop.spec, L1.tools.spec, L2.schedule.spec]
binds: [xeon/apps/host/**]
---

# L4 호스트와 서비스 (host-service)

`xeon/apps/host`(패키지 `@xeon/host`)의 스펙이다. 이 패키지는 두 가지 일을 한다.

- 엔진 조립: F~L3의 플러그인을 Cordis 루트 컨텍스트(ext-host 경유)에 등록해 엔진 하나를 만든다. 저장소 전체에서 조립 루트는 이 패키지 하나다.
- 호스트 계약의 서버 쪽: `F.wire-settings.spec`이 정한 메서드·알림을 처리하는 `WireHandlers` 표를 만들고, 세 전송(in-process, stdio, socket)에 같은 표를 건다. 서비스 모드 `xeon service`의 수명도 이 패키지가 정한다.

## 1. 목적과 범위

### 1.1 정하는 것

- 조립 코드(`assemble`)의 위치. `eng.dependency-rules.guide` DR-10의 같은 층 예외(`DR-10/cli-host`)를 이 문서의 안으로 정했다(§3.1, review.decisions-2 U-15).
- 배포 바이너리 이름과 진입 서브커맨드(§3.2).
- 공개 API의 TypeScript 시그니처: `assemble`, `startInProcessHost`, `startStdioHost`, `startService`, 클라이언트 쪽 `createHostConnection`(§3.3).
- 메서드별 처리기, 호출하는 아래 층 서비스, 돌려주는 오류 kind(§3.4).
- 연결 수명, 요청 처리 순서, 구독 재전송 구현, 휘발 스트림, 취소, 예외 정제(§4.1~§4.6).
- 단일 소유: `thread.open`과 세션 잠금, `thread.locked`의 대안 셋, `sys_leases` 행의 소유자 표시(§4.7).
- in-process·stdio 호스트의 종료 절차(§4.8).
- 서비스 모드: 등록 파일 스키마, `ensure`, 이중 기동 방지, 버전 불일치, 유휴 종료, 종료 협조, 인증, 부모-자식 수명. ADR-0006 §3.7 체크리스트 8항을 규칙 SV-01~SV-08로 옮긴다(§4.9).
- 서비스 프로세스의 예약 틱 호스팅과 알림 라우팅(§4.10).
- `l4.host-service.*` 설정 키와 설정 파일 JSON Schema 출력 명령(§6).

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| 메시지 모양, 메서드·알림 레지스트리, 오류 표, 커서, `Transport`·`HostConnection` 인터페이스 | `F.wire-settings.spec` |
| 명령줄 파싱, TUI, `xeon chat`의 화면 | `L4.cli.spec` |
| Tauri 셸, 사이드카 spawn, WebView 쪽 연결 | `L4.desktop.spec` |
| 설정 화면 | `L4.settings-ui.spec` |
| 세션 잠금 구현(OS 잠금 + `sys_leases` epoch 펜싱, review.decisions-2 U-09) | `L0.process.spec`, `L0.store.spec` |
| 경로(데이터, 상태, 런타임, 로그 디렉터리), OS 알림 표시 | `L0.os.spec` |
| 프로세스 spawn·신호 | `L0.process.spec`(DR-13: `Bun.spawn`은 L0 안에만 둔다) |
| 이벤트 저장, 투영, 열 때 복구, 재개 횟수 상한 | `L1.persistence.spec` |
| 입력 큐, 턴 실행, 안전 경계 | `L1.tasks.spec`, `L1.loop.spec` |
| 승인 프로토콜과 승인 이벤트 payload | `L1.tools.spec` |
| 예약 테이블, 놓친 예약 처리 | `L2.schedule.spec` |
| OS 서비스 등록(`xeon service install`) | 2차. 이 문서 범위 밖(ADR-0006 §3.4) |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 엔진 | `assemble`이 만든 객체. Cordis 루트 컨텍스트, 로드된 플러그인, 열린 저장소, 설정 카탈로그를 담는다. 프로세스 정책을 포함하지 않는다(ADR-0006 §3.1) |
| 호스트 | 엔진 하나와 전송을 묶어 계약의 서버 쪽을 맡는 실행 단위. 모드는 `in-process`, `stdio`, `service` 셋이다 |
| 호스트 모드 | `host.status` 결과의 `mode` 값. 전송 종류(`TransportKind`)와 다른 값 집합이다. 서비스 모드의 연결 전송은 `socket`이다 |
| 조립 루트 | 모든 층의 구현 패키지를 import해도 되는 유일한 패키지(DR-14 예외 2). `apps/host`다 |
| 연결 허브 | 한 호스트 프로세스 안의 모든 연결, 구독, 진행 중 요청을 담는 표. 처리기가 `connectionId`로 연결 상태를 찾는다 |
| 쓰기 소유 | 세션(thread) 하나의 실행을 맡는 권리. 호스트 프로세스 단위로 정하고, 같은 프로세스의 연결은 그 소유를 함께 쓴다(HS-23) |
| 등록 파일 | 서비스 프로세스가 쓰는 JSON 파일. 소켓 경로, pid, 버전, 시작 시각, 토큰을 담는다 |
| `ensure` | 클라이언트가 서비스에 접속하기 전에 부르는 절차. 서비스가 없거나 버전이 다르면 기동한다 |
| live 작업 | 진행 중 turn, 백그라운드 task, 서브에이전트처럼 엔진 안에서 아직 끝나지 않은 일 |
| 대기 예약 | `L2.schedule`의 예약 가운데 아직 실행 시각이 오지 않았거나 실행되지 않은 것 |

ADR-0006 §3.3의 표기 정정 [제안: 코드 식별자는 F 문서의 이름을 따른다는 `_templates/README.md` 문체 규칙과 `F.wire-settings.spec` §3.1 `TransportKind`]: ADR-0006의 `HostTransport`는 F의 `Transport`로, 전송 종류 `"service"`는 F의 `"socket"`으로 읽는다. `"service"`는 `host.status`의 `mode` 값으로만 쓴다. ADR-0006 §3.3의 `HostMessage`는 F의 `JsonRpcMessage`, `TransportCloseReason`은 F의 `CloseInfo.reason`이다.

## 3. 인터페이스

### 3.1 조립 코드의 위치 (DR-10 해소)

CLI는 엔진을 in-process로 쓴다(ADR-0006 §3.3). 그래서 CLI 프로세스 안에서 엔진을 조립하는 코드가 필요하다. 이 코드의 위치는 DR-10의 같은 층 예외로 정한다.

| 안 | 내용 | 층 순위와의 관계 | 결과 | 판정 |
|---|---|---|---|---|
| 1 | `apps/host`를 L4의 "층 기반 패키지"로 두고 `apps/cli`가 `@xeon/host`를 import한다(`architecture.layers.spec` §3.2) | L4 안의 같은 층 간선 하나(`cli → host`)를 허용 목록으로 연다. 한 방향만이고 `host`는 다른 앱을 import하지 않는다 | 조립 코드가 한 곳에 있다. CLI와 서비스·사이드카가 같은 `assemble`을 쓴다 | 채택 [결정: review.decisions-2 U-15] |
| 2 | 조립 코드를 L4 아래 층 패키지로 내린다(DR-10 셋째 항목) | 조립 코드는 L3 그룹(`group-helm`, `group-learning`, 순위 5), L2, L1, L0, X를 모두 import한다. L3에 두면 L3 그룹끼리 import(DR-02)가 생기고, L2 이하에 두면 상향 import(DR-01)가 생긴다. 순위 5 이하 어느 자리에서도 성립하지 않는다 | 새 순위(예: L3와 L4 사이)를 만들어야 한다. 층 순위 변경이라 ADR이 필요하다(`eng.dependency-rules.guide` §4 1번) | 불가 |
| 3 | CLI도 항상 서비스를 거친다 | 같은 층 import가 없다 | CLI 한 번 실행에 서비스 기동이 필요하다. ADR-0006 §5가 탈락시킨 "서비스 모드만 단독" 안과 같고, CLI 기본 전송 in-process [결정]과 충돌한다 | 불가 |

[결정: review.decisions-2 U-15] 안 1을 채택한다. 규칙 문구 수정안은 다음과 같다. `eng.dependency-rules.guide`와 허용 목록 파일은 같은 커밋에서 고친다(같은 문서 §4 절차). eng 문서 반영은 그 문서 쪽 수정이다.

1. 허용 목록 항목(`xeon/scripts/dependency-allowlist.json`). `architecture.layers.spec` §3.2는 "`check-layers.ts`에 목록으로 둔다"고 적었지만, `eng.dependency-rules.guide` §4 2번이 import 한 쌍의 예외를 허용 목록 파일 한 곳에만 두라고 정하므로 그 형식을 따른다. `check-layers.ts`는 이 항목을 읽어 DR-02·DR-10 위반에서 뺀다.

   ```json
   {
     "id": "DR-10/cli-host",
     "rule": "DR-10",
     "from": "apps/cli",
     "to": "@xeon/host",
     "entries": [".", "./client"],
     "reason": "CLI runs the engine in-process; apps/host is the single L4 assembly root (L4.host-service.spec 3.1).",
     "approvedBy": "L4.host-service.spec"
   }
   ```

2. DR-10 본문 둘째·셋째 항목 수정안.
   - 현행: "`apps/cli`는 엔진 라이브러리를 in-process로 쓴다. 이때 엔진 조립 코드는 L4 아래 층의 공개 진입점에서 가져온다. 다른 앱을 import하지 않는다." / "두 앱이 같은 조립 코드를 필요로 하면 그 코드를 아래 층 패키지로 내린다 [미결]."
   - 수정안: "`apps/cli`는 엔진을 `@xeon/host`의 공개 진입점(`.`, `./client`)으로만 만든다. 이 한 방향 간선은 허용 목록 `DR-10/cli-host`로 연다. `apps/host`는 다른 앱을 import하지 않는다. `apps/desktop`은 `@xeon/host`를 import하지 않는다."
3. DR-14 예외 2 수정안.
   - 현행: "조립 루트 `apps/host`는 플러그인을 등록하려고 모든 패키지를 import한다. `apps/cli`가 쓰는 엔진 조립 코드의 위치는 DR-10 [미결]이고, 정해지면 그 위치를 조립 루트에 더한다."
   - 수정안: "조립 루트는 `apps/host` 하나다. 플러그인을 등록하려고 모든 패키지를 import한다. `apps/cli`는 조립 루트가 아니다. `apps/cli`는 F(`@xeon/contracts`)와 `@xeon/host`의 공개 진입점 외의 워크스페이스 패키지를 import하지 않는다."
4. `eng.dependency-rules.guide` §6 마지막 [미결] 항목과 `architecture.layers.spec` §10의 같은 층 예외 항목 가운데 L4 부분을 닫는다. L3 `group-kit` 부분은 `L3.group-kit.spec` 소관으로 남는다.

### 3.2 바이너리와 진입

[제안] 배포 바이너리는 `xeon` 하나다(`bun build --compile`). 진입 파일은 `apps/cli/src/main.ts`이고, 서브커맨드가 호스트 기능을 부른다.

| 서브커맨드 | 동작 | 호출하는 `@xeon/host` API | 단계 |
|---|---|---|---|
| `xeon chat` | 대화. 기본 in-process, 서비스 사용 설정이 켜져 있으면 `ensure` 뒤 socket | `startInProcessHost` 또는 `ensureService` + `connectServiceTransport` | M1(in-process), M3(socket) |
| `xeon host --stdio` | 데스크톱 사이드카. stdin/stdout으로 계약을 처리한다 | `runHostCommand({ kind: "host-stdio" })` → `startStdioHost` | M1(개발 진입, H5), M2(컴파일 바이너리 서브커맨드) |
| `xeon service start` / `status` / `stop` | 서비스 기동·조회·정지 | `runHostCommand({ kind: "service-start" \| "service-status" \| "service-stop" })` | M3 |
| `xeon service ensure --json` | `ensure`만 하고 소켓 경로를 JSON 한 줄로 출력한다. 데스크톱 셸이 쓴다(HS-38) | `runHostCommand({ kind: "service-ensure" })` | M3 |
| `xeon service launch-mode --json` | 엔진 없이 `l0.process.service.enabled`를 읽어 `{ "mode": "in-process" \| "service" }` 한 줄을 쓰고 종료코드 0으로 끝난다. 데스크톱 셸이 사이드카와 서비스 중 어느 쪽으로 갈지 정할 때 쓴다(HS-38, `L4.desktop.spec` §4.2). 사용자 문서에는 싣지 않는다 | `runHostCommand({ kind: "service-launch-mode" })` → `resolveLaunchMode` | M3 |
| `xeon service run` | 서비스 본체를 전경에서 실행한다. `service start`와 `ensure`가 이 인자로 자기 바이너리를 detached 실행한다. 사용자 문서에는 싣지 않는다 | `runHostCommand({ kind: "service-run" })` → `startService` | M3 |
| `xeon config schema --scope <scope>` | 설정 파일 JSON Schema 출력(§6.2) | `runHostCommand({ kind: "config-schema" })` | M1 |

명령줄 파싱과 도움말은 `L4.cli.spec`(§3.1, §3.2)이 정한다. 이 문서는 서브커맨드 이름과 호출 API만 정한다.

M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다.

두 안의 비교:

| 항목 | 단일 `xeon` [제안] | `apps/host` 단독 사이드카 + `apps/cli` 바이너리(현행 `apps/desktop/README.md`, `eng.toolchain.guide` TC-10 문구) |
|---|---|---|
| 빌드 산출물 | 대상(triple)마다 1개 | 대상마다 2개. 둘 다 Bun 런타임을 포함한다 |
| 디스크 크기 | Bun 런타임 1벌. CLI 전용 코드(TUI, pi-tui의 선택 `.node` 애드온 약 146 KB, `_research/notes/L4-1.md` §5.4)가 사이드카에도 들어간다 | CLI 설치본과 데스크톱 번들에 Bun 런타임이 따로 들어간다. 한 기기에 둘 다 있으면 런타임 2벌이다. Bun 문서는 단일 바이너리 크기를 "still way too big"이라고만 적고 수치는 없다(ADR-0008 §4.2) |
| 서비스 재기동 | `service start`와 `ensure`가 `process.execPath`로 자기 자신을 실행한다. 클라이언트와 서비스의 버전이 항상 같다 | CLI가 host 바이너리 경로를 찾아야 한다. 설치 위치가 다르면 버전이 어긋날 수 있다 |
| 데스크톱 사이드카 인자 | `xeon host --stdio`(ADR-0008 §3.2 제안과 같다) | `xeon-host --stdio` |
| 엔진 진입 코드 | 하나 | 둘. 같은 `assemble`을 부르지만 시작 경로가 둘이다 |
| 위험 | 컴파일 바이너리의 `process.execPath` 값이 [미확인]이다(`_research/notes/L4-1.md` §5.2). TUI 모듈을 `host --stdio`에서 불러오지 않도록 `chat` 경로만 동적 import한다 | 위 위험 중 self-exec 부분은 없다. 대신 경로 탐색 코드가 생긴다 |

- [제안] 근거: ADR-0008 §3.2 제안("사이드카 이름은 `xeon`, CLI와 같은 바이너리를 `host --stdio`로 실행"), `_research/process.md` §6.1 "같은 엔진 바이너리를 CLI도 쓴다".
- 수정 요청 [미결 3]: `eng.toolchain.guide` TC-10 "배포 바이너리: `apps/cli`(CLI), `apps/host`(데스크톱 사이드카, 서비스 모드)를 `bun build --compile`로 만든다"를 "배포 바이너리는 `apps/cli/src/main.ts`를 진입점으로 하는 `xeon` 하나다. 데스크톱 사이드카와 서비스 모드는 같은 바이너리의 `host --stdio`, `service` 서브커맨드다"로 고친다. 같은 문서 §2 바이너리 행(`apps/cli`, `apps/host`(사이드카))도 맞춘다. `xeon/apps/desktop/README.md`의 "엔진은 `apps/host`를 `bun build --compile`로 묶은 사이드카"는 "엔진은 `xeon` 바이너리를 `host --stdio`로 실행한 사이드카"로 고친다.
- 개발과 테스트에서는 컴파일하지 않고 `bun xeon/apps/host/src/main.ts host --stdio`처럼 실행한다. `main.ts`는 `import.meta.main`일 때 `process.argv`를 `HostCommand`로 바꿔 `runHostCommand`를 부른다. 이 경로는 테스트 전용이고 배포 진입점이 아니다.
- 자기 실행 명령(§4.9.2): 컴파일 바이너리이면 `[process.execPath]`, 아니면 `[process.execPath, Bun.main]`이다. 판별은 `Bun.main`이 `/$bunfs/` 아래인지로 한다 [가정: 컴파일 바이너리의 `Bun.main` 경로 형식은 미확인. H15 spike에서 확인].

### 3.3 공개 API

패키지 `@xeon/host`의 진입점은 둘이다.

| 진입점 | 파일 | 내용 | 소비자 |
|---|---|---|---|
| `.` | `src/index.ts` | `assemble`, `startInProcessHost`, `startStdioHost`, `startService`, `ensureService`, `runHostCommand`, `renderSettingsSchema`, 타입 | `apps/cli` |
| `./client` | `src/client.ts` | `createHostConnection`, `connectServiceTransport`. 엔진 패키지를 import하지 않는다 | `apps/cli`, (선택) `apps/desktop`(§10 미결 5) |

F에서 가져오는 이름은 `F.wire-settings.spec` 그대로다: `Transport`, `TransportKind`, `CloseInfo`, `Unsubscribe`, `HostConnection`, `WireHandlers`, `WireHandler`, `WireRequestContext`, `StdioTransportOptions`, `SocketTransportOptions`, `WireMethodName`, `WireParams`, `WireResult`, `JsonRpcMessage`, `RpcId`, `StreamPosition`, `StoreId`, `Seq`, `EventFilter`, `WIRE_METHODS`, `WIRE_ERRORS`, `WIRE_LIMITS`, `WIRE_PROTOCOL_VERSION`, `isCompatible`, `checkEnvelope`, `toEventWire`, `toVolatileEventWire`, `SettingCatalog`, `SettingScope`, `ScopeStack`, `buildCatalog`, `CatalogIssue`, `resolveSetting`, `checkSettingWrite`, `settingsJsonSchema`, `defineSettings`. 새 공용 이름은 만들지 않는다. 아래 이름은 `@xeon/host` 안의 이름이다.

#### 3.3.1 조립

```ts
// src/assemble.ts
import type { StoreId, WireResult } from "@xeon/contracts/wire";
import type { SettingCatalog, CatalogIssue, SettingDefInput, SettingGroup, SettingNamespace } from "@xeon/contracts/settings";
import type { Clock, IdFactory } from "@xeon/contracts";            // F 루트 주입 인터페이스. 구현은 platform-os(review.decisions-2 U-03)

/** host.status.mode와 같은 값 집합: "in-process" | "stdio" | "service" */
export type HostMode = WireResult<"host.status">["mode"];

/** ext-host가 받는 플러그인 모듈. 이름 정본은 X.loading-trust.spec이다 [가정]. */
export type HostPluginModule = import("@xeon/ext-host").PluginModule;

export interface AssembleOptions {
  readonly mode: HostMode;
  readonly dataDir?: string;                              // 없으면 L0.os의 기본 데이터 디렉터리
  readonly extraPlugins?: readonly HostPluginModule[];    // 테스트용 그룹, 모델 테이프 provider
  readonly defaultGroups?: boolean;                       // 기본 true. false면 Helm·학습 그룹을 싣지 않는다
  readonly settingGroups?: readonly SettingGroup<SettingNamespace, Readonly<Record<string, SettingDefInput>>>[];
                                                          // 조립 루트가 import할 수 없는 앱의 설정(예: l4.cli.*, L4.cli.spec §6)
  readonly devChecks?: boolean;                           // 결과 스키마 검사, in-process JSON 왕복. 개발 빌드만 true
  readonly clock?: Clock;                                 // 테스트 주입(eng.testing.guide TS-03)
  readonly ids?: IdFactory;
}

export interface Engine {
  readonly mode: HostMode;
  readonly storeId: StoreId;
  readonly catalog: SettingCatalog;
  readonly startedAt: number;                             // ms. host.status.startedAt의 원천
  readonly ports: EnginePorts;                            // §3.3.2
  close(): Promise<void>;                                 // task 결과를 쓰지 않는다(ADR-0006 §3.1)
}

export type AssembleIssue =
  | { readonly code: "catalog"; readonly issues: readonly CatalogIssue[] }
  | { readonly code: "store"; readonly message: string }
  | { readonly code: "missingService"; readonly service: string };

/** 조립 결함. 선언 결함은 Result 대신 예외로 알린다(eng.typescript.guide TY-11). */
export declare class AssembleError extends Error {
  readonly issues: readonly AssembleIssue[];
}

/** 엔진 하나를 만든다. 실패하면 AssembleError를 던지고, 그때까지 연 자원을 닫는다. */
export declare function assemble(options: AssembleOptions): Promise<Engine>;
```

#### 3.3.2 엔진 포트

처리기는 Cordis 서비스를 직접 다루지 않고 아래 포트만 쓴다. 포트 구현(어댑터)은 `assemble.ts` 한 곳에 두고, F에 정의된 서비스 타입으로 주입받은 L0~L2 서비스를 감싼다. 포트는 `@xeon/host` 내부 타입이다. 아래 층 서비스의 이름과 메서드는 각 spec이 정한다. 대응은 [가정]이다.

```ts
// src/assemble.ts (계속)
import type { ThreadId, TurnId, ItemId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, VolatileEventEnvelope } from "@xeon/contracts/records";
import type { LeaseToken } from "@xeon/contracts/records";       // F records lease.ts(L0.store.spec FR-S2) [가정]
import type { EventFilter, StreamPosition, TurnStartInput, Unsubscribe, WireParams, WireResult } from "@xeon/contracts/wire";
import type { ScopeStack, SettingKey, SettingScope } from "@xeon/contracts/settings";

export interface EnginePorts {
  readonly threads: ThreadPort;        // L1.persistence
  readonly turns: TurnPort;            // L1.tasks, L1.loop
  readonly feed: EventFeedPort;        // L1.persistence(L0.store 읽기 API와 커밋 후 알림)
  readonly locks: SessionLockPort;     // L0.process(OS 잠금), L0.store(sys_leases epoch 펜싱과 소유 표시)
  readonly settings: SettingsStorePort;// L1.persistence(설정 파일 범위와 세션 범위)
  readonly approvals: ApprovalPort;    // L1.tools
  readonly activity: ActivityPort;     // L1.tasks, L1.tools, L2.schedule
  readonly notify: UserNotifyPort;     // L0.os
  readonly log: HostLogPort;           // L0.os
}

export interface ThreadPort {
  create(input: { readonly workspace?: string; readonly title?: string }): Promise<{ readonly threadId: ThreadId; readonly position: StreamPosition }>;
  exists(threadId: ThreadId): boolean;
  list(params: WireParams<"thread.list">): Promise<WireResult<"thread.list">>;
  fork(threadId: ThreadId, at: ItemId | undefined): Promise<{ readonly threadId: ThreadId; readonly position: StreamPosition }>;
  revert(threadId: ThreadId, to: ItemId): Promise<{ readonly position: StreamPosition }>;
  remove(threadId: ThreadId): Promise<void>;
  position(threadId: ThreadId): StreamPosition;
}

export type SubmitOutcome =
  | { readonly ok: true; readonly turnId: TurnId }                 // 같은 requestId 재제출이면 처음 turnId
  | { readonly ok: false; readonly reason: "busy"; readonly turnId: TurnId };

export interface TurnPort {
  submit(threadId: ThreadId, input: TurnStartInput, requestId: string | undefined): Promise<SubmitOutcome>;
  interrupt(threadId: ThreadId, turnId: TurnId | undefined): Promise<boolean>;
  /** 진행 중 turn을 다음 안전 경계에서 멈추고 체크포인트를 커밋한다. 시한 안에 끝나면 true. */
  stopAtSafeBoundary(deadlineMs: number): Promise<boolean>;
}

export interface CommitBatch {
  readonly firstSeq: number;           // (firstSeq - 1, lastSeq] 구간
  readonly lastSeq: number;
  readonly events: readonly DurableEventEnvelope[];
}

export interface EventFeedPort {
  headSeq(): number;
  oldestReplayableSeq(): number;
  /** seq > after AND seq ≤ upto, 필터 적용. 행이 limit만큼 차면 거기서 멈추고, 아니면 scanLimit 행까지 훑는다. */
  read(after: number, upto: number, filter: EventFilter | undefined, limit: number, scanLimit: number):
    { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number };
  /** 커밋 직후 같은 JS 턴에서 동기로 부른다(eng.transactions.design §7, TX-09). */
  onCommit(listener: (batch: CommitBatch) => void): Unsubscribe;
  onVolatile(listener: (event: VolatileEventEnvelope) => void): Unsubscribe;
}

export type OwnerKind = "cli" | "app" | "service";       // L0.store LeaseKind = sys_leases.kind(표시용)

export type LockOutcome =
  /** token은 L0.store LeaseToken(resource "session:<threadId>", holderId, epoch). L1.persistence 쓰기마다 대조한다 */
  | { readonly ok: true; readonly token: LeaseToken; release(): Promise<void> }
  | { readonly ok: false; readonly ownerKind: OwnerKind | null };   // sys_leases 행의 kind. 표시값이라 틀릴 수 있다

export interface SessionLockPort {
  tryAcquire(threadId: ThreadId, kind: OwnerKind): Promise<LockOutcome>;
  holds(threadId: ThreadId): boolean;
}

export interface SettingsStorePort {
  layers(threadId: ThreadId | undefined): ScopeStack;
  write(scope: SettingScope, key: SettingKey, value: unknown, threadId: ThreadId | undefined): Promise<void>;
  reset(scope: SettingScope, key: SettingKey, threadId: ThreadId | undefined): Promise<void>;
  onChange(listener: () => void): Unsubscribe;
}

export interface ApprovalPort {
  respond(params: WireParams<"approval.respond">): Promise<WireResult<"approval.respond">>;
}

export interface ActivitySnapshot {
  readonly liveTurns: number;
  readonly liveTasks: number;          // liveTurns 포함, 백그라운드 task와 서브에이전트 포함
  readonly waitingApprovals: number;
  readonly pendingSchedules: number;
}
export interface ActivityPort {
  snapshot(): ActivitySnapshot;
  onChange(listener: () => void): Unsubscribe;
}

export interface UserNotifyPort {
  show(input: { readonly title: string; readonly body: string; readonly threadId?: ThreadId }): Promise<void>;
}

export interface HostLogPort {
  error(message: string, fields: Readonly<Record<string, unknown>>): void;
  info(message: string, fields: Readonly<Record<string, unknown>>): void;
}
```

#### 3.3.3 처리기 표와 연결

```ts
// src/connection.ts
import type { CloseInfo, Transport, TransportKind, WireHandlers } from "@xeon/contracts/wire";

export interface HostLimits {
  readonly maxReplayEvents: number;              // l4.host-service.maxReplayEvents
  readonly maxSubscriptionsPerConnection: number;// l4.host-service.maxSubscriptionsPerConnection
  readonly replayBatchMaxEvents: number;         // 상수 500 (F wire §3.4.3)
  readonly scanLimit: number;                    // 상수 10,000
  readonly sendLowWaterBytes: number;            // 상수 1 MiB
}

export interface ServeOptions {
  readonly limits: HostLimits;
  readonly devChecks: boolean;                   // 결과 스키마 검사(F wire §4.3 7단계), in-process JSON 왕복 검사
}

export interface ServedConnection {
  readonly id: string;                           // WireRequestContext.connectionId
  readonly transportKind: TransportKind;
  readonly closed: Promise<CloseInfo>;
  close(reason?: string): Promise<void>;
}

/** 한 호스트 프로세스의 연결 표. 처리기와 수명 관리가 같은 허브를 본다. */
export interface ConnectionHub {
  readonly size: number;                         // 열린 연결 수(host.status.connections, 유휴 판정)
  serve(transport: Transport, options: ServeOptions): ServedConnection;
  onSizeChange(listener: (size: number) => void): Unsubscribe;
  closeAll(reason: string): Promise<void>;
}

export declare function createConnectionHub(engine: Engine, handlers: WireHandlers): ConnectionHub;

// src/handlers/index.ts
export interface HostInfo {
  readonly serverName: "xeon";
  readonly serverVersion: string;                // 엔진 빌드 버전. 등록 파일 version과 같은 값
  readonly pid: number;
}
/** 전송과 무관한 처리기 표 하나. in-process, stdio, socket이 같은 표를 쓴다. */
export declare function createWireHandlers(engine: Engine, hub: () => ConnectionHub, info: HostInfo): WireHandlers;
```

- `WireHandlers`는 모든 `WireMethodName`에 처리기를 요구한다(`F.wire-settings.spec` §3.1). 아직 구현하지 않은 메서드는 `notImplemented(method)` 처리기로 채운다. 이 처리기는 `-32601`(`jsonrpc.methodNotFound`)을 돌려주고, 그 메서드는 `host.hello`의 `features`에서 빠진다 [제안]. 그래서 M1 호스트도 타입상 완전한 표를 갖는다.

#### 3.3.4 호스트 시작 함수

```ts
// src/main.ts
import type { StdioTransportOptions, Transport } from "@xeon/contracts/wire";

export interface InProcessHost {
  readonly client: Transport;                    // kind "in-process". createHostConnection에 넘긴다
  readonly engine: Engine;
  close(): Promise<void>;                        // 종료 절차(§4.8)를 거쳐 엔진을 닫는다
}
export declare function startInProcessHost(options?: Omit<AssembleOptions, "mode">): Promise<InProcessHost>;

export interface HostExit {
  readonly code: 0 | 1;                          // 0 정상 종료, 1 시작 거부(AssembleError 등)
  readonly reason: "eof" | "signal" | "idle" | "stop" | "startup";
}

export interface StdioHostOptions extends StdioTransportOptions {
  readonly assemble?: Omit<AssembleOptions, "mode">;
}
/** stdio 호스트 하나를 실행하고 끝날 때 resolve한다. 프로세스 종료(exit)는 호출자가 한다. */
export declare function startStdioHost(options: StdioHostOptions): Promise<HostExit>;

export type HostCommand =
  | { readonly kind: "host-stdio" }
  | { readonly kind: "service-run" }
  | { readonly kind: "service-start" }
  | { readonly kind: "service-status"; readonly json: boolean }
  | { readonly kind: "service-stop" }
  | { readonly kind: "service-ensure" }
  | { readonly kind: "service-launch-mode" }
  | { readonly kind: "config-schema"; readonly scope: "managed" | "user" | "project" | "local"; readonly out?: string; readonly coreOnly: boolean };

export interface CommandIo {
  readonly stdout: WritableStream<Uint8Array>;   // host-stdio에서는 계약 전용. 다른 출력을 쓰지 않는다
  readonly stderr: WritableStream<Uint8Array>;
  readonly stdin: ReadableStream<Uint8Array>;
}
/** 종료코드를 돌려준다. 0 성공, 1 실패(시작 거부, 서비스 없음 등), 2 사용 오류. */
export declare function runHostCommand(command: HostCommand, io: CommandIo): Promise<0 | 1 | 2>;
```

```ts
// src/service/lifetime.ts
export interface ServiceOptions {
  readonly assemble?: Omit<AssembleOptions, "mode">;
  readonly registrationPath?: string;            // 없으면 L0.os 상태 디렉터리의 service.json
  readonly socketPath?: string;                  // 없으면 L0.os 런타임 디렉터리의 xeon.sock
  readonly startupGraceMs?: number;              // 기본 SERVICE_STARTUP_GRACE_MS
}
export declare const SERVICE_STARTUP_GRACE_MS: 10_000;

export interface ServiceHandle {
  readonly registration: ServiceRegistration;
  readonly exited: Promise<HostExit>;
  shutdown(reason: "signal" | "idle" | "stop"): Promise<void>;
}
export type ServiceStart =
  | { readonly started: true; readonly handle: ServiceHandle }
  | { readonly started: false; readonly existing: ServiceRegistration };   // 소켓 선점에 진 경우(SV-02)

export declare function startService(options?: ServiceOptions): Promise<ServiceStart>;
```

```ts
// src/service/ensure.ts
export interface EnsureOptions {
  readonly registrationPath?: string;
  readonly ownVersion: string;
  readonly spawnTimeoutMs?: number;              // 기본 5,000
}
export type EnsureResult =
  | { readonly ok: true; readonly registration: ServiceRegistration; readonly action: "connected" | "spawned" | "restarted" | "versionWarning" }
  | { readonly ok: false; readonly reason: "spawnTimeout" | "protocolUnsupported" | "registrationInvalid" };

export declare function ensureService(options: EnsureOptions): Promise<EnsureResult>;
```

```ts
// src/client.ts  ("./client". 엔진 패키지를 import하지 않는다)
import type { HostConnection, SocketTransportFactory, Transport } from "@xeon/contracts/wire";

export interface HostConnectionOptions {
  readonly defaultTimeoutMs?: number;            // 없으면 시한 없음
}
/** F의 HostConnection 구현. 요청 id는 연결마다 r1, r2, … 를 쓴다(F wire §3.1). */
export declare function createHostConnection(transport: Transport, options?: HostConnectionOptions): HostConnection;

/** F의 SocketTransportFactory 구현(Bun.connect, unix). */
export declare const connectServiceTransport: SocketTransportFactory;
```

전송 구현(서버 쪽)은 F의 팩토리 타입을 그대로 구현한다.

| 파일 | F 타입 | 구현 |
|---|---|---|
| `src/transport/in-process.ts` | `InProcessTransportFactory` | 메모리 큐 쌍. 전달은 `queueMicrotask`로 보낸 순서대로 한다. `devChecks`이면 `JSON.parse(JSON.stringify(m))` 왕복 |
| `src/transport/stdio.ts` | `StdioTransportFactory` | JSON Lines. `maxFrameBytes` 초과 줄은 끝까지 읽고 버린다(F wire §5). 읽기 끝(EOF)에서 `onClose({ reason: "eof" })` |
| `src/transport/socket.ts` | `SocketTransportFactory`(클라이언트), 서버 리스너는 아래 | `Bun.listen({ unix })`, `Bun.connect({ unix })`. 연결마다 JSON Lines |

```ts
// src/transport/socket.ts (서버 쪽 리스너. F 타입이 없어 host 안에 둔다)
export interface SocketListener {
  readonly path: string;
  onConnection(handler: (transport: Transport) => void): Unsubscribe;
  close(): Promise<void>;
}
export type ListenOutcome =
  | { readonly ok: true; readonly listener: SocketListener }
  | { readonly ok: false; readonly reason: "inUse" };   // 살아 있는 다른 서비스가 경로를 쥐고 있다
export declare function listenServiceSocket(path: string, maxFrameBytes?: number): Promise<ListenOutcome>;
```

#### 3.3.5 `L4.cli.spec` §3.3 요구 모양과의 대응

`L4.cli.spec` §3.3은 CLI 안의 연결 이름(`connectEngine`, `EngineHandle`, `EngineStartError`)을 아래 API의 조합으로 정한다. [제안] 이 문서는 `EngineConnector`, `StdioHostRunner`, `ServiceControl` 같은 CLI 쪽 이름을 `@xeon/host`에 두지 않는다. 이름이 CLI 안에만 있으면 데스크톱과 서비스가 쓰지 않는 CLI 전용 개념(작업 폴더 옵션, CLI 상태 파일, 오류 문구)이 조립 루트에 들어오지 않는다.

| CLI 이름(`L4.cli.spec` §3.3) | `@xeon/host` API | 차이 |
|---|---|---|
| `connectEngine({ preference: "auto" })` | `resolveLaunchMode()` → `"in-process"`면 `startInProcessHost({ settingGroups, devChecks })` + `createHostConnection(host.client)`, `"service"`면 `ensureService` + `connectServiceTransport` + `createHostConnection` | `host.hello`는 CLI가 보낸다 |
| `EngineConnectOptions.settingGroups` | `AssembleOptions.settingGroups` | 같다 |
| `EngineConnectOptions.devWireRoundTrip` | `AssembleOptions.devChecks` | 이름만 다르다 |
| `EngineConnectOptions.observe` | 없음. CLI가 `Transport`를 감싸 `send`·`onMessage`를 탭한다 | 호스트는 관여하지 않는다 |
| `EngineStartError.kind` | `AssembleError.issues[].code`(`catalog`, `store`, `missingService`), `EnsureResult.reason` | CLI가 자기 kind로 바꾼다. `store`는 `message`로 `fts5Missing`·`dataDirPermission`·`storeUnavailable`을 구별한다 [가정: L0.store 오류 모양에 따름]. `catalog` → `catalogConflict`, `missingService` → `missingService`이고 둘 다 CLI 종료코드 1이다. 나머지 kind는 3이다(`L4.cli.spec` §4.10) |
| `EngineHandle.shutdown(reason)` | in-process: `InProcessHost.close()`(HS-31, 시한은 `l0.process.shutdown.timeoutMs`). socket: `HostConnection.close()` | 시한 인자 없이 설정 키 값을 쓴다 |
| `xeon host --stdio`(`CliHostCommand`) | `runHostCommand({ kind: "host-stdio" }, io)` | 같은 일. 설정 그룹을 넘길 때는 `startStdioHost`의 `assemble.settingGroups` |
| `xeon service *`, `xeon config schema` | `runHostCommand({ kind: "service-…" \| "config-schema" }, io)` | 결과는 종료코드와 stderr 문구. 구조화 결과가 필요하면 CLI가 `ensureService`, `readRegistration`을 직접 쓴다 |

- 종료코드 관계: `runHostCommand`의 0·1·2는 CLI가 바꾸지 않고 그대로 `xeon`의 종료코드로 쓴다(`L4.cli.spec` §3.6의 0 정상, 1 일반 오류, 2 사용법 오류와 같은 뜻). 이 경로의 시작 거부(`AssembleError`, SV-05 권한 검사)는 1이다. CLI가 in-process로 `assemble`할 때의 `EngineStartError`만 `L4.cli.spec` §4.10 표로 1 또는 3이 된다.

#### 3.3.6 상태 디렉터리 API [결정: review.decisions-2 B-07]

CLI는 경로를 계산하지 않는다(DR-13, `L4.cli.spec` §10 1번). 그래서 `@xeon/host`가 L0.os의 `OsDirs.state`에서 CLI 상태 파일 위치를 만들어 준다.

```ts
export interface HostStatePaths {
  /** OsDirs.state. 로그, 복구 표식처럼 기기에 남는 상태 */
  readonly stateDir: string;
  /** <stateDir>/cli/state.json. L4.cli.spec §3.7 CliStateSchema 파일 */
  readonly cliStateFile: string;
}
export type HostStatePathError =
  | { readonly kind: "dirs_unavailable"; readonly message: string }     // OsDirs를 정할 수 없음(홈 없음 등)
  | { readonly kind: "permission"; readonly path: string };            // 디렉터리를 만들거나 쓸 수 없음
/** 디렉터리를 만들고(0700) 경로를 돌려준다. 예상 가능한 실패는 Result로 돌려준다 */
export declare function resolveHostStatePaths(options?: {
  /** 테스트 격리용 덮어쓰기. 값이 있으면 cliStateFile로 그대로 쓴다. 운영 경로는 이 값을 넘기지 않는다 */
  readonly cliStateFileOverride?: string;
}): Promise<Result<HostStatePaths, HostStatePathError>>;
```

- `connectEngine`은 이 함수의 결과로 `EngineHandle.paths.cliStateFile`을 채운다. 서비스 모드에서도 CLI 프로세스 쪽에서 부른다. 상태 파일은 CLI 프로세스의 파일이기 때문이다.
- 환경 변수 `XEON_CLI_STATE_FILE`은 테스트 격리용 덮어쓰기로만 남긴다. CLI가 이 값을 읽어 `cliStateFileOverride`로 넘기고, 값이 없으면 기본 경로를 쓴다. M1 코드처럼 환경 변수가 없을 때 상태 파일을 쓰지 않는 동작은 없앤다.

### 3.4 처리기 표

"서비스"는 처리기가 부르는 포트와 그 뒤의 아래 층 문서다. "오류"는 처리기가 던지는 `WireError`의 kind이고 code는 `WIRE_ERRORS`(F wire §3.5.2)의 값이다. 모든 메서드에 공통으로 `-32602`(params), `-32603`(정제된 내부 오류), `5001 request.cancelled`, `5002 host.shuttingDown`이 올 수 있으므로 표에서 생략한다. `host.hello` 외의 모든 메서드는 hello 전이면 `1001 host.helloRequired`다.

M1:

| 메서드 | 처리 | 서비스 | 오류 |
|---|---|---|---|
| `host.hello` | `isCompatible(params.protocolVersion, WIRE_PROTOCOL_VERSION)` 검사, opt-in 실험 기능 기록, 연결을 ready로 바꾼다. 결과의 `features`는 구현한 메서드·알림의 `WIRE_METHODS` 항목(status, since)이다 | 엔진 `storeId`, 연결 허브 | 1002 `host.helloDuplicate`, 1003 `protocol.unsupported` |
| `thread.create` | thread를 만들고 쓰기 소유를 함께 얻는다(F wire §3.3.1 제안: M1에서는 create가 소유를 얻는다) | `ThreadPort.create`(L1.persistence), `SessionLockPort.tryAcquire`(L0.process) | 3002 `thread.locked`(새 thread라 정상 경로에서는 없다. 잠금 서비스 실패 시) |
| `turn.start` | 쓰기 소유를 확인하고 없으면 암묵 획득(HS-28)한 뒤 입력을 제출한다. `requestId`가 같으면 처음 `turnId` | `SessionLockPort.holds`·`tryAcquire`, `TurnPort.submit`(L1.tasks) | 3001 `thread.notFound`, 3002 `thread.locked`, 3003 `turn.busy` |
| `events.subscribe` | §4.4 재전송 알고리즘 | `EventFeedPort`(L1.persistence, L0.store) | 2001 `replay.outOfRange`, 2003 `events.subscriptionLimit`, 2004 `events.filterInvalid` |
| `settings.get` | `keys`가 없으면 카탈로그 전체. 키마다 `resolveSetting(def, layers(threadId))` | 카탈로그, `SettingsStorePort.layers`(L1.persistence) | 3101 `settings.unknownKey`, 3001 `thread.notFound`(`threadId`가 있을 때) |

M1 알림:

| 알림 | 방향 | 처리 |
|---|---|---|
| `events.batch` | 서버 → 클라이언트 | 구독마다 §4.4 규칙으로 보낸다. 이벤트는 `toEventWire(event, redact)`로 바꾼다 |
| `stream.chunk` | 서버 → 클라이언트 | §4.5. `toVolatileEventWire`로 바꾸고 `n`, `afterSeq`를 채운다 |
| `$/cancelRequest` | 클라이언트 → 서버 | §4.6. hello 전이면 무시한다 |

M2:

| 메서드 | 처리 | 서비스 | 오류 |
|---|---|---|---|
| `thread.open` | `mode: "write"`이면 세션 잠금을 얻는다. 실패하면 `thread.locked`에 대안(§4.7). `mode: "observe"`이면 잠금 없이 연다 | `SessionLockPort`(L0.process), `ThreadPort.position`(L1.persistence) | 3001, 3002 |
| `thread.close` | 그 연결의 열기 기록을 지운다. §4.7 해제 조건이 맞으면 잠금을 푼다 | `SessionLockPort` | 3001 |
| `thread.list` | 투영 목록을 돌려준다 | `ThreadPort.list`(L1.persistence) | - |
| `thread.fork` | `parentId` 분기로 새 thread를 만들고 쓰기 소유를 얻는다 | `ThreadPort.fork`, `SessionLockPort` | 3001 |
| `thread.revert` | 쓰기 소유자만. 진행 중 turn이 있으면 거부 | `ThreadPort.revert`(L1.persistence) | 3001, 3002, 3003 |
| `thread.delete` | 쓰기 소유자만. 잠금을 얻을 수 없으면 거부 | `ThreadPort.remove`, `SessionLockPort` | 3001, 3002 |
| `turn.interrupt` | 쓰기 소유자만 | `TurnPort.interrupt`(L1.loop) | 3001, 3002 |
| `events.unsubscribe` | 구독을 지운다 | 연결 허브 | 2002 `events.subscriptionNotFound` |
| `approval.respond` | [가정: F wire §4.6 A안] 승인 응답을 L1.tools에 넘긴다. 이미 해결됐거나 모르는 `approvalId`이면 `applied: false` | `ApprovalPort.respond`(L1.tools) | 3002(그 승인의 thread를 이 프로세스가 소유하지 않을 때) |
| `settings.set` | `checkSettingWrite(catalog, layers, key, scope, value)` 통과 뒤 저장, 결과는 `resolveSetting`. `project`·`local` 범위는 `threadId`의 workspace가 있어야 한다. 없으면 3103에 `details.reason: "workspaceRequired"` [제안] | `SettingsStorePort.write`(L1.persistence) | 3101, 3102, 3103, 3104, 3105 |
| `settings.reset` | 범위·잠금 검사 뒤 그 범위 값을 지운다 | `SettingsStorePort.reset` | 3101, 3103, 3104 |
| `settings.list` | 카탈로그를 `SettingDefWire`로 바꿔 돌려준다. `type`은 `toJsonSchema(def.type)`이고 `range`는 따로 싣는다 | 카탈로그 | - |
| `host.status` | 모드, pid, 시작 시각, 연결 수, `liveTurns`, 유휴 종료 예정 시각(서비스만, 아니면 `null`) | 연결 허브, `ActivityPort`, 수명 관리 | - |

- `settings.set`의 `details`에는 값이 비밀이면 그 값을 넣지 않는다(F wire §4.9 비밀 값 비표시 규칙 4).
- `settings.set`·`settings.reset`이 `session` 범위를 바꾸면 L1.persistence가 그 thread에 `settings.changed` 내구 이벤트를 커밋한다 [가정: `L1.persistence.spec`]. 파일 범위(`user`, `project`, `local`) 변경은 thread에 속하지 않아 같은 이벤트로 알릴 곳이 없다. 다른 클라이언트의 설정 화면이 이 변경을 알 수단은 §10 미결 17이다.
- `settings.list`의 `type`에 `range`를 합쳐 실을지는 `_research/notes/L4-3.md` §1의 제안(병합 함수를 F에 공통으로 둔다)과 함께 F가 정한다(§10 미결 11). 이 문서는 F wire §3.8.2 모양 그대로 싣는다.

### 3.5 서비스 등록 파일

[결정: ADR-0006 §3.4] 등록 파일은 권한 0600이고 소켓 주소, pid, 버전, 시작 시각 지문, 무작위 토큰을 담는다. 스키마에 없는 필드를 보존한다.

```ts
// src/service/registration.ts
import { Type, type TObject, type TString, type TInteger } from "typebox";

export type ServiceRegistration = {
  readonly version: string;            // 엔진 빌드 버전(HostInfo.serverVersion). 불일치 판정
  readonly socket: string;             // Unix 소켓 절대 경로
  readonly pid: number;
  readonly startedAt: string;          // ISO 8601 UTC. pid 재사용 구별 지문. host.status.startedAt과 같다
  readonly token: string;              // 32자 이상 무작위. Unix 소켓 접속에는 쓰지 않는다(SV-05)
  readonly [field: string]: unknown;   // 모르는 필드
};
export const ServiceRegistrationSchema: TObject<{
  version: TString; socket: TString; pid: TInteger; startedAt: TString; token: TString;
}> = Type.Object(
  {
    version: Type.String({ minLength: 1, maxLength: 64 }),
    socket: Type.String({ minLength: 1, maxLength: 1024 }),
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.String({ format: "date-time", maxLength: 32 }),
    token: Type.String({ minLength: 32, maxLength: 256 }),
  },
  { additionalProperties: true },
);

export type RegistrationRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "ok"; readonly value: ServiceRegistration };

export declare function readRegistration(path: string): Promise<RegistrationRead>;
/** 임시 파일(0600)에 쓰고 rename한다. 기존 파일의 모르는 필드를 보존한다. */
export declare function writeRegistration(path: string, value: ServiceRegistration): Promise<void>;
/** 자기 pid·startedAt과 같을 때만 지운다. */
export declare function removeRegistration(path: string, own: Pick<ServiceRegistration, "pid" | "startedAt">): Promise<void>;
```

- 위치 [제안]: L0.os가 주는 사용자 상태 디렉터리 아래 `service.json`. 소켓은 L0.os가 주는 런타임 디렉터리(권한 0700) 아래 `xeon.sock`. 경로 결정은 `L0.os.spec`이 한다. macOS의 Unix 소켓 경로 길이 한도(`sun_path` 104바이트)를 넘지 않는 위치여야 한다 [가정: 한도 값은 플랫폼 헤더 기준이고 실측하지 않았다].
- `L0.process.spec`이 등록 파일 형식을 따로 정하지 않는다면 이 절이 정본이다. ADR-0006 §3.4는 최종 형태를 이 문서와 `L0.process.spec`에 맡겼다. 두 문서가 어긋나면 이 문서의 스키마를 고친다(§10 미결 7).

### 3.6 설정 파일 JSON Schema 출력

```ts
// src/settings.ts
import type { TInteger } from "typebox";
import type { SettingCatalog, SettingDefInput, SettingGroup } from "@xeon/contracts/settings";

/** settingsJsonSchema 결과를 2칸 들여쓰기 JSON과 끝 줄바꿈 하나로 직렬화한다. 같은 입력이면 바이트가 같다. */
export declare function renderSettingsSchema(catalog: SettingCatalog, scope: "managed" | "user" | "project" | "local"): string;

/** 이 패키지의 설정 그룹(§6.1). defineSettings("l4.host-service", {...})로 선언하고 assemble이 카탈로그에 넣는다. */
export type HostSettingInputs = {
  readonly maxReplayEvents: SettingDefInput<TInteger>;
  readonly maxSubscriptionsPerConnection: SettingDefInput<TInteger>;
};
export declare const hostSettings: SettingGroup<"l4.host-service", HostSettingInputs>;

/** 엔진 없이 사용자·관리 설정 파일만 읽어 l0.process.service.enabled를 해석한다(HS-37). 키 정의는 L0.process.spec §6이 소유한다. */
export declare function resolveLaunchMode(options?: { readonly dataDir?: string }): Promise<"in-process" | "service">;
```

## 4. 동작 규칙

### 4.1 조립 순서

`assemble`은 아래 순서를 지킨다. 한 단계라도 실패하면 이미 연 자원을 역순으로 닫고 `AssembleError`를 던진다.

1. 경로: `dataDir`가 없으면 L0.os에서 기본 데이터 디렉터리를 받는다.
2. 루트 컨텍스트: ext-host가 제공하는 루트 생성 API로 Cordis 루트 컨텍스트를 만든다. `apps/host`는 Cordis를 직접 import하지 않는다(DR-11). L4는 Cordis 서비스를 제공하지 않는다(`architecture.layers.spec` §4.4).
3. 플러그인 등록: 층 순위 순서(L0 → L1 → L2 → L3)로 기본 플러그인을 싣고, 이어서 `extraPlugins`를 싣는다. `defaultGroups`가 `false`면 L3 기본 그룹(Helm, 학습 그룹)을 빼고 싣는다. 그룹의 켜기·끄기는 각 그룹 설정(`l3.helm.*`, `l3.learning.*`)이 정한다. 외부 확장 로딩과 신뢰 판정은 X(`X.loading-trust.spec`)가 한다.
4. 서비스 확인: 포트가 요구하는 서비스(§3.3.2)가 모두 주입됐는지 확인한다. 없으면 `missingService`.
5. 카탈로그: 모든 패키지의 설정 그룹과 확장 매니페스트에서 나온 정의를 `buildCatalog`에 넣는다. 결과가 `{ ok: false }`이면 기동을 거부한다(`catalog`). 단, F wire §5 규칙대로 확장 키 문제(`foreignNamespace`, 확장 사이 `duplicateKey`)는 X 로더가 그 확장의 설정을 빼고 다시 조립하므로 여기까지 오는 문제는 코어 키 문제다 [가정: 재조립 절차는 `X.loading-trust.spec`이 정한다].
6. 설정 범위: `SettingsStorePort.layers(undefined)`로 파일 범위를 읽는다. 값 검사 실패는 진단으로 남기고 시작을 막지 않는다(F wire §4.8).
7. 열 때 복구: L1.persistence가 표식(`running_since`, `resume_attempts`)을 확인하고 결과 불명 도구 호출을 정리한다(`architecture.runtime-flow.design` §4.4). 실행은 시작하지 않는다(ADR-0006 §3.1, durable `Harness.open`과 같다).
8. 자동 재개: `mode === "service"`이고 `l1.persistence.autoResume`이 `true`일 때만 표식이 남은 thread를 재개한다. 키와 재개 횟수 상한(`l1.persistence.maxResumeAttempts`)은 L1.persistence가 소유한다(`L1.persistence.spec` §6).

`Engine.close()`는 역순으로 닫는다: 예약 틱 정지, 플러그인 dispose, 저장소 닫기. task 결과를 쓰지 않는다.

### 4.2 연결 수명

규칙 HS-01~HS-04는 F wire §4.1을 구현한다.

- HS-01. 연결은 `awaitingHello` → `ready` → `closed` 세 상태를 가진다. `awaitingHello`에서 `host.hello` 외 요청은 1001, `$/cancelRequest`는 무시한다.
- HS-02. `host.hello`에서 `isCompatible`이 거짓이면 1003(`details: { serverVersion, clientVersion }`)을 돌려주고 연결은 `awaitingHello`에 남긴다. 닫기는 클라이언트가 한다. 두 번째 hello는 1002다.
- HS-03. hello 결과:
  - `protocolVersion`: `WIRE_PROTOCOL_VERSION`.
  - `server`: `{ name: "xeon", version: HostInfo.serverVersion }`.
  - `storeId`: `Engine.storeId`.
  - `transport`: 그 연결의 `Transport.kind`.
  - `features`: `notImplemented`가 아닌 메서드와 알림의 `FeatureInfo`.
  - `experimental`: 클라이언트가 요청한 이름 가운데 서버에 있는 `experimental` 기능.
- HS-04. 연결이 닫히면 그 연결의 구독을 지우고, 진행 중 요청의 `signal`을 중단한다. 진행 중 turn은 멈추지 않는다. 그 연결이 연 thread의 열기 기록을 지우고 §4.7 해제 조건을 다시 본다.
- HS-05. 한 연결 안에서 응답과 알림은 생성 순서대로 송신 큐에 들어간다. 송신 큐가 `sendLowWaterBytes`(1 MiB)를 넘으면 재전송 읽기를 멈추고(§4.4), 실시간 알림은 큐에 계속 쌓는다. 큐가 `WIRE_LIMITS.maxFrameBytes`의 64배(64 MiB)를 넘으면 그 연결을 `CloseInfo { reason: "error", message: "sendQueueOverflow" }`로 닫는다 [제안]. 클라이언트는 마지막 `to`부터 다시 구독한다.

### 4.3 요청 처리 순서와 예외 정제

F wire §4.3의 1~7단계를 그대로 구현한다. 1단계(프레임 크기)와 2단계(JSON 해석)는 전송이 하고, 3단계부터 연결 허브가 한다.

- HS-06. 3단계 `checkEnvelope` 실패는 `EnvelopeCheck.errorCode`로 응답한다. 진행 중 `id` 재사용은 `-32600`이다.
- HS-07. 4단계 메서드 조회: `WIRE_METHODS`에 없거나, `experimental`인데 opt-in하지 않았거나, `notImplemented`이면 `-32601`.
- HS-08. 6단계 처리기 실행 결과:
  - 처리기가 `WireError`를 던지면 그 kind의 `WIRE_ERRORS` 항목으로 code와 `retryable`을 채운다.
  - 그 밖의 예외는 `-32603`, `message: "Internal error"`, `data: { kind: "internal", retryable: true, traceId }`로 바꾼다. 원래 메시지와 스택은 `HostLogPort.error`에만 남기고 `traceId`로 연결한다. 응답 어디에도 원래 메시지를 싣지 않는다(F wire A12).
  - `traceId`는 엔진의 `IdFactory`로 만든다.
- HS-09. 7단계 결과 검사는 `devChecks`일 때만 한다. 실패하면 처리기 결함이므로 HS-08 둘째 항목처럼 정제해 응답하고 로그에 `resultSchema`를 남긴다.

### 4.4 구독과 재전송 구현

[제안] F wire §3.4.3 알고리즘을 `src/handlers/events.ts`와 연결 허브에 구현한다. 구현 규칙만 더 적는다.

- HS-10. 3단계(head 읽기와 구독 등록)는 `await` 없이 한 함수 안에서 끝낸다. `EventFeedPort.headSeq()`와 등록 사이에 커밋 알림이 끼어들지 않게 하기 위해서다. bun:sqlite가 동기 API이고 커밋 후 알림도 같은 JS 스레드에서 동기로 실행되므로 성립한다 [가정: F wire §3.4.3과 같은 가정. L0.store가 커밋을 다른 스레드로 옮기면 깨진다].
- HS-11. `replaying` 구독은 커밋 알림을 받으면 `pending`에 넣기만 한다. 재전송 읽기의 위치가 `upto`(등록 시점 head)와 같아진 뒤 `pending`을 커밋 순서대로 비운다. 그래서 재전송 중 커밋된 이벤트는 정확히 한 번 간다.
- HS-12. 재전송 읽기는 `EventFeedPort.read(sub.pos, upto, filter, replayBatchMaxEvents, scanLimit)`로 한다. 한 번에 한 묶음만 읽고, 송신 큐가 lowWater 아래로 내려간 뒤 다음 묶음을 읽는다. 묶음 사이에는 `await`(송신 대기)가 있으므로 그 사이 커밋은 HS-11로 처리된다.
- HS-13. 경계 검사 값: `storeId`는 `Engine.storeId`, `oldestReplayable`은 `EventFeedPort.oldestReplayableSeq()`, `maxReplayEvents`는 설정 키 값. 오류 details는 F wire §3.5.2의 `reason`, `storeId`, `headSeq`, `oldestReplayableSeq`를 모두 채운다.
- HS-14. 실시간 구독에서 필터에 맞는 이벤트가 없는 커밋은 같은 JS 턴에 보내지 않고, `queueMicrotask`로 모아 빈 `events.batch` 하나로 위치를 넘긴다. 한 턴에 커밋이 여럿이면 마지막 `to` 하나로 합친다 [제안].
- HS-15. 이벤트 변환은 `toEventWire(event, redact)`다. `redact`는 L1.persistence가 제공하는 가리기 규칙(2차 방어)을 쓴다. 1차 방어는 payload에 비밀 값을 넣지 않는 기록 규칙이다(F wire §3.4.5).
- HS-16. 관찰 모드의 다른 프로세스 커밋: 이 호스트 프로세스가 쓰기 소유자가 아닌 thread의 커밋은 같은 프로세스의 커밋 알림으로 오지 않는다. 그런 thread를 관찰하는 구독이 하나라도 있으면 호스트는 `OBSERVE_POLL_MS`(250ms) 간격으로 `headSeq()`를 읽고, 늘었으면 그 구간을 `CommitBatch`로 만들어 HS-11과 같은 경로로 처리한다 [제안]. 관찰 구독이 없으면 폴링하지 않는다.

### 4.5 휘발 스트림

- HS-17. `EventFeedPort.onVolatile`로 받은 휘발 이벤트는 그 thread를 이 프로세스가 소유하고, 그 thread를 `thread.create`·`thread.open`(write 또는 observe)으로 연 연결에 `stream.chunk`로 보낸다. 구독은 필요 없다(F wire §3.4.4 [제안]).
- HS-18. `n`은 `(threadId, turnId)`마다 0부터 센다. `afterSeq`는 보내는 시점의 `EventFeedPort.headSeq()`다.
- HS-19. 휘발 이벤트는 송신 큐가 lowWater를 넘으면 버린다. 재전송하지 않는다. 완성 기록은 `events.batch`로 다시 온다.
- HS-20. 다른 프로세스가 소유한 thread의 관찰자는 `stream.chunk`를 받지 못한다. 휘발 이벤트는 소유 프로세스의 메모리에만 있다. 관찰자에게 토큰 단위 표시가 필요하면 위임(서비스 경유)으로 접속해야 한다.

### 4.6 취소

- HS-21. `$/cancelRequest { id }`를 받으면 그 요청의 `AbortController`를 중단한다. 처리기가 `signal` 때문에 거부하면 5001 `request.cancelled`로 응답한다. 처리기가 취소와 무관하게 결과를 내면 그 결과를 보낸다. 이미 응답한 id, 모르는 id는 무시한다.
- HS-22. `turn.start`는 접수만 처리하므로 취소가 turn을 멈추지 않는다. 접수 뒤 취소가 오면 turn은 계속 돌고 응답만 5001일 수 있다. 클라이언트는 이벤트로 접수 여부를 확인한다(F wire §5 "응답 전에 연결이 닫힌다" 행과 같은 처리).

### 4.7 단일 소유

[결정: ADR-0006 §3.6] 쓰기 소유자는 세션마다 하나다. [결정: review.decisions-2 U-09] 판정은 OS 잠금(생존 판정)과 `sys_leases.epoch` 펜싱 둘로 한다. 별도 소유 표시 테이블은 두지 않고 `sys_leases` 행(`kind`, `pid`, `host`, `heartbeat_at`)이 표시를 겸한다(`L0.store.spec` §3.1 `LeaseService`). 호스트 코드는 `SessionLockPort` 뒤의 구현에 의존하지 않는다.

- HS-23. 쓰기 소유는 호스트 프로세스 단위다. 같은 호스트(예: 서비스)의 여러 연결이 같은 thread를 `write`로 열면 모두 `role: "owner"`이고 입력은 L1.tasks 입력 큐가 직렬화한다.
- HS-24. `thread.open { mode: "write" }`:
  1. thread가 없으면 3001.
  2. 이 프로세스가 이미 잠금을 쥐었으면 `owner`.
  3. 아니면 `SessionLockPort.tryAcquire(threadId, kind)`. `kind`는 호스트 모드에서 정한다: `in-process` → `cli`, `stdio` → `app`, `service` → `service`.
  4. 성공하면 받은 `LeaseToken`으로 L1.persistence `openForWrite(threadId, token)`를 부르고 `{ role: "owner", position }`. 소유 표시는 임대 획득 때 L0.store가 `sys_leases` 행에 쓴다.
  5. 실패하면 3002 `thread.locked`, `details: { ownerKind, options }`.
- HS-25. `options` 구성:
  - `"observe"`는 항상 넣는다.
  - `"fork"`는 항상 넣는다.
  - `"delegate"`는 등록 파일이 있고 그 서비스에 접속할 수 있으며 이 호스트 자신이 서비스가 아닐 때만 넣는다. 위임은 클라이언트가 서비스에 다시 접속해 같은 thread를 여는 것이다. 호스트 사이 중계는 하지 않는다.
  - 순서는 `["delegate", "observe", "fork"]`에서 해당하는 것만 남긴다. 단계 2 이후 기본이 위임이기 때문이다(ADR-0006 §3.6 3번).
- HS-26. `ownerKind`는 `LockBusy.owner`(`sys_leases` 행)의 `kind`다. 행이 없거나 반납·만료 상태면 `null`이다. 판정에 쓰지 않는다.
- HS-27. 잠금 해제: 그 thread를 `write`로 연 연결이 이 프로세스에 없고, 그 thread에 live 작업이 없을 때 푼다. 서비스 모드에서는 연결이 모두 떠나도 live 작업이 있으면 쥔다. in-process·stdio는 프로세스 종료 때 커널이 푼다.
- HS-28. `turn.start`는 이 프로세스가 그 thread의 잠금을 쥐고 있지 않으면 먼저 `tryAcquire`를 한 번 시도한다(암묵 획득) [제안]. 성공하면 HS-24 4단계처럼 토큰으로 쓰기를 열고 제출한다. 실패하면 3002와 HS-25의 `options`다. 그래서 M1에서도 기존 thread의 재개(`xeon chat --continue`, `L4.cli.spec` §4.3)가 `thread.open` 없이 동작한다. `turn.interrupt`, `thread.revert`, `thread.delete`는 암묵 획득을 하지 않고 `SessionLockPort.holds(threadId)`가 거짓이면 3002다.
- HS-29. `sys_leases.heartbeat_at` 갱신은 `LeaseService.keepAlive`가 한다. 갱신이 `lease_lost`로 실패하면 호스트는 그 thread의 쓰기를 멈추고 소유를 잃은 것으로 다룬다. 주기는 L0.store가 정한다.
- HS-30. 비정상 종료 표식의 "이어서 실행" 후보를 클라이언트에 알리는 wire 수단이 F에 없다(`thread.list`의 `ThreadSummary` 필드 미정, 전용 메서드 없음). F 변경 요청으로 §10 미결 8에 올린다. 그 전까지 후보는 `L1.persistence`의 투영에만 있다.

### 4.8 in-process·stdio 호스트의 종료

- HS-31. 종료 절차(공통). `HostExit.reason`이 정해지면:
  1. 새 요청을 받지 않는다. 진행 중이 아닌 새 요청은 5002 `host.shuttingDown`(`retryAfterMs` 1,000)으로 응답한다.
  2. `TurnPort.stopAtSafeBoundary(deadline)`로 진행 중 turn을 다음 안전 경계에서 멈추고 체크포인트를 커밋한다. `deadline`은 `l0.process.shutdown.timeoutMs`(ms)다.
  3. 연결을 모두 닫는다.
  4. `Engine.close()`.
- HS-32. stdio: 전송이 `onClose({ reason: "eof" })`를 내면 HS-31을 `reason: "eof"`로 실행한다. 이것이 stdin EOF 임대다(ADR-0008 §3.3). 부모가 어떻게 끝나든 OS가 파이프 쓰기 끝을 닫으므로 자식이 남지 않는다.
- HS-33. stdio 호스트는 stdout에 계약 메시지 외의 바이트를 쓰지 않는다. 로그는 stderr 또는 L0.os 로그 파일로 보낸다.
- HS-34. 데스크톱 종료 요청: Tauri 셸 플러그인은 SIGKILL만 보내므로 데스크톱은 종료 전에 stdin으로 `shutdown` 요청을 보내야 한다(ADR-0008 §3.3 제안 3번). F 메서드 표에 `host.shutdown`이 M2로 들어왔다(`F.wire-settings.spec` §4 host 행). M2 전까지 데스크톱은 stdin을 닫아 HS-32 경로로 종료를 요청한다. 이 경로도 체크포인트 뒤 종료하므로 같은 결과를 낸다. 차이는 응답을 받지 못한다는 점이다.
- HS-35. in-process: `InProcessHost.close()`가 HS-31을 실행한다. CLI 프로세스가 강제 종료되면 절차 없이 끝나고 다음 열기에서 복구한다(`architecture.runtime-flow.design` §4.6).
- HS-36. 신호: stdio와 in-process 호스트는 SIGTERM·SIGINT를 받으면 HS-31을 `reason: "signal"`로 실행한다. 신호 수신 등록은 L0.process의 신호 API로 한다 [가정: 이름은 `L0.process.spec`이 정한다].

### 4.9 서비스 모드

```mermaid
stateDiagram-v2
  [*] --> Binding: xeon service run
  Binding --> Exit0: 소켓 선점 실패, 기존 서비스 살아 있음 (SV-02)
  Binding --> Starting: 소켓 바인드 성공
  Starting --> Serving: assemble 완료, 등록 파일 기록 (SV-01)
  Starting --> Exit1: AssembleError
  Serving --> IdleCountdown: 연결 0, live 0, 대기 예약 0, 시작 유예 경과 (SV-04)
  IdleCountdown --> Serving: 조건 하나라도 깨짐
  IdleCountdown --> Draining: idleGraceMs 경과
  Serving --> Draining: SIGTERM 또는 service stop (SV-07)
  Draining --> Exit0: 체크포인트, 등록 파일 삭제, 소켓 닫기
```

#### 4.9.1 시작

`xeon service run`이 `startService`를 부른다.

1. 소켓 선점(SV-02).
2. `assemble({ mode: "service" })`. 실패하면 소켓을 닫고 종료코드 1.
3. 처리기 표와 연결 허브를 만들고 리스너의 연결을 허브에 넘긴다.
4. 등록 파일 기록(SV-01). `startedAt`은 `Engine.startedAt`.
5. 예약 틱 시작(§4.10).
6. 유휴 감시 시작(SV-04).

#### 4.9.2 체크리스트 규칙

ADR-0006 §3.7의 여덟 항목을 순서대로 옮긴다. 각 규칙은 `L4.host-service.plan` §5의 테스트로 확인한다.

- SV-01 등록 파일 [결정: ADR-0006 §3.7 1번]
  - `writeRegistration`은 같은 디렉터리의 임시 파일을 모드 0600으로 만들고 내용을 쓴 뒤 rename한다. 권한은 생성 시점에 정한다. 쓴 뒤 chmod하지 않는다. 그래야 다른 사용자가 읽을 틈이 없다.
  - 기존 파일이 있으면 읽어서 `ServiceRegistrationSchema`에 없는 필드를 새 내용에 그대로 옮긴다. 새 버전 서비스가 더한 필드를 옛 버전이 지우지 않게 하기 위해서다.
  - 정상 종료 때 `removeRegistration`으로 자기 기록만 지운다(pid와 startedAt이 같을 때).
- SV-02 기동 경합 [결정: ADR-0006 §3.7 2번]
  - 고정 소켓 경로 바인드가 판정 지점이다. `listenServiceSocket(path)`의 절차:
    1. 경로에 접속을 시도한다. 접속되고 `host.hello`에 응답하면 `inUse`를 돌려준다.
    2. 접속이 거부되면(파일은 있으나 듣는 프로세스 없음) 낡은 소켓 파일이다. 낡은 파일 삭제와 바인드는 활성화 잠금을 쥔 동안에만 한다. 활성화 잠금은 `SessionLockPort`와 같은 L0.process 잠금 수단을 키 `service-activation`으로 쓴다 [제안]. 잠금을 못 얻은 쪽은 `inUse`로 본다.
    3. 바인드한다. `EADDRINUSE`이면 `inUse`.
  - `inUse`를 받은 `startService`는 `{ started: false, existing }`을 돌려주고, `service run`은 종료코드 0으로 끝난다. 그 프로세스를 띄운 `ensure`는 기존 서비스에 접속한다.
  - 두 프로세스가 같은 DB에 대해 서비스 둘을 여는 경우는 생기지 않는다. 포트 0처럼 늘 성공하는 바인드는 쓰지 않는다(opencode `background-service.ts:49-52`의 이유와 같다).
- SV-03 버전 불일치 [결정: ADR-0006 §3.7 3번]. `ensureService` 절차:
  1. `readRegistration`. `missing`이거나 `invalid`이면 기동(4번)으로 간다. `invalid`는 진단을 남긴다.
  2. 소켓에 접속해 `host.hello`, `host.status`를 부른다. 접속이 안 되거나 `status.startedAt`이 등록 파일과 다르면 낡은 등록이다. 기동으로 간다.
  3. `version`이 자기 버전과 다르면:
     - 서비스가 한가하면 재기동한다. 한가함은 `liveTurns == 0`이고 `connections == 1`(자기 연결뿐)이다. 재기동은 등록 파일의 pid로 SIGTERM을 보내고(L0.process), 등록 파일이 사라지거나 `l0.process.shutdown.timeoutMs` + 2000ms가 지나면 기동한다. 신호 전에 `host.status.pid`와 `startedAt`이 등록 파일과 같은지 확인한다. pid 재사용 오인을 막기 위해서다.
     - 한가하지 않으면 경고를 남기고 그대로 접속한다(`action: "versionWarning"`). hello가 1003이면 `{ ok: false, reason: "protocolUnsupported" }`이고, CLI는 `xeon service stop` 뒤 다시 시도하라고 안내한다.
  4. 기동: L0.process로 자기 실행 명령(§3.2)에 `service run`을 붙여 detached로 띄운다(SV-06). 소켓이 hello에 응답할 때까지 조건 대기(100ms 간격, 상한 `spawnTimeoutMs`)한다.
- SV-04 유휴 종료 [결정: ADR-0006 §3.7 4번]
  - 판정은 순수 함수 `decideIdle`로 한다.

    ```ts
    // src/service/lifetime.ts
    export interface IdleInputs {
      readonly connections: number;
      readonly activity: ActivitySnapshot;
      readonly sinceStartMs: number;
      readonly startupGraceMs: number;
      readonly countApprovalAsLive: boolean;      // 기본 true [제안]
    }
    export type IdleDecision =
      | { readonly idle: true }
      | { readonly idle: false; readonly reason: "startupGrace" | "connections" | "tasks" | "approvals" | "schedules" };
    export declare function decideIdle(inputs: IdleInputs): IdleDecision;
    ```

  - 유휴는 다섯 조건이 모두 성립할 때다: 연결 0, `liveTasks` 0, (`countApprovalAsLive`이면) `waitingApprovals` 0, `pendingSchedules` 0, 시작 뒤 `SERVICE_STARTUP_GRACE_MS`(10초) 경과.
  - 유휴가 되면 `l0.process.service.idleGraceMs` 타이머를 건다. 타이머가 끝나기 전에 조건이 하나라도 깨지면 타이머를 지운다. 끝나면 HS-31 절차를 `reason: "idle"`로 실행한다. 판정은 `ConnectionHub.onSizeChange`와 `ActivityPort.onChange`가 올 때마다 다시 한다. 시계는 엔진 `Clock`과 L0.os 타이머를 쓴다(테스트 주입).
  - `host.status.idleShutdownAt`은 타이머가 걸려 있으면 그 시각, 아니면 `null`이다.
  - 승인 대기 세션 [제안]: live로 센다(`countApprovalAsLive: true`). 승인 대기는 사용자의 답을 기다리는 진행 중 작업이고, 서비스가 내려가면 응답 경로(서비스 접속)가 사라진다. Claude Code도 권한 프롬프트에서 멈춘 세션을 실행 중으로 본다(`CC/agent-view.md:819`). 확정은 ADR-0006 §6 [미결]이다(§10 미결 6).
- SV-05 인증 [결정: ADR-0006 §3.7 5번]
  - 로컬은 Unix 소켓과 파일 권한으로 인증한다. 소켓은 권한 0700 디렉터리 안에 두고 소켓 파일 자체도 0600으로 만든다. 같은 사용자만 접속할 수 있다.
  - 시작할 때 소켓 디렉터리의 소유자가 현재 사용자가 아니거나 그룹·기타 권한이 열려 있으면 시작을 거부한다(종료코드 1). 권한을 대신 좁히지 않는다. 다른 사용자가 만든 디렉터리를 쓰지 않기 위해서다 [제안].
  - 등록 파일의 `token`은 TCP·WebSocket 전송용이다. Unix 소켓 접속에는 요구하지 않는다. 토큰을 `host.hello`에 실을지는 F wire §10 미결 4에 맞춘다(§10 미결 10). F가 정하기 전에는 토큰 필드를 계약에 더하지 않는다.
  - 비루프백 리스너는 만들지 않는다. 원격 전송이 생기면 토큰 없는 기동을 금지하고 인증을 `host.hello` 전에 끝낸다(ADR-0006 §3.2).
- SV-06 부모-자식 수명 [결정: ADR-0006 §3.7 6번]
  - 자식 엔진(stdio)은 stdin EOF 임대로 정리한다(HS-32).
  - 서비스는 L0.process의 detached spawn으로 띄운다. 요구 동작: 새 세션(setsid), stdin·stdout·stderr를 부모와 공유하지 않음(로그는 L0.os 로그 파일), 부모 이벤트 루프에서 `unref`. 부모(`ensure`를 부른 CLI)가 끝나도 서비스는 남는다(pi `PX/process.ts:40-70`).
- SV-07 종료 협조 [결정: ADR-0006 §3.7 7번]
  - 서비스는 SIGTERM을 받으면 HS-31 절차를 `reason: "signal"`로 실행하고, 등록 파일을 지우고, 소켓을 닫고, 종료코드 0으로 끝난다.
  - `xeon service stop`은 등록 파일을 읽고 `host.status`로 pid·startedAt을 확인한 뒤 SIGTERM을 보낸다. `l0.process.shutdown.timeoutMs` + 2000ms 안에 등록 파일이 사라지지 않으면 SIGKILL을 보낸다. SIGKILL 뒤 남은 등록 파일과 소켓 파일은 다음 `ensure`가 낡은 기록으로 처리한다.
  - 비협조 확장 코드는 안전 경계 도달을 막을 수 있다(ADR-0006 §4.2). 시한 뒤 SIGKILL이 마지막 수단이고, 진행 중 단계는 다음 열기에서 복구한다.
- SV-08 단일 장애점 [결정: ADR-0006 §3.7 8번]
  - 서비스가 죽어도 DB와 복구 표식은 남는다. 다음 `ensure`가 새 서비스를 띄우고, 그 서비스가 §4.1의 7·8단계(열 때 복구, 설정 시 자동 재개)를 한다.
  - socket 연결이 `reason: "eof"` 또는 `"error"`로 닫힌 클라이언트는 진행 중 요청을 실패로 끝내고, 새 요청을 보내지 않는다. 재접속은 `ensureService`를 다시 부르는 것으로만 한다. 자동 재접속 횟수와 화면 표시는 `L4.cli.spec`, `L4.desktop.spec`이 정한다.
  - 서비스는 소유한 thread의 세션 잠금을 프로세스 수명에 묶는다. 서비스가 죽으면 커널이 잠금을 풀고, 다른 프로세스가 `thread.open`으로 소유를 얻을 수 있다.

#### 4.9.3 클라이언트의 전송 선택

- HS-37. [제안] CLI는 시작할 때 `l0.process.service.enabled`를 사용자·관리 범위 파일에서 읽는다. `false`면 `startInProcessHost`, `true`면 `ensureService` 뒤 `connectServiceTransport`를 쓴다. 이 값을 읽는 함수는 엔진 없이 설정 파일만 읽는다(`resolveLaunchMode`, `src/settings.ts`).
- HS-38. 데스크톱은 서비스 사용 설정이 켜져 있으면 사이드카 엔진을 띄우지 않고, 셸(Rust)이 서비스 소켓 바이트를 WebView로 중계한다(`L4.desktop.spec` §4.8). 이를 위해 이 문서는 `xeon service ensure --json` 서브커맨드를 둔다 [제안]. 동작은 `ensureService`이고, stdout에 JSON 한 줄 `{ "ok": true, "socket": <경로>, "version": <버전>, "action": <EnsureResult.action> }` 또는 `{ "ok": false, "reason": <EnsureResult.reason> }`을 쓰고 끝난다. 종료코드는 성공 0, 실패 1이다. 셸은 이 명령을 짧게 실행해 소켓 경로를 얻는다. 셸은 엔진 카탈로그를 읽지 못하므로 서비스 경로로 갈지는 먼저 `xeon service launch-mode --json`(§3.2, `resolveLaunchMode`)으로 정한다 [제안]. 사이드카가 stdio와 소켓 사이를 중계하는 안은 쓰지 않는다. 엔진 프로세스가 하나 더 생기고, 데스크톱 쪽 소켓 중계(`EnginePipe`)가 이미 같은 일을 하기 때문이다.

### 4.10 예약과 알림

- HS-39. 예약 틱 [제안]: 서비스 프로세스가 L2.schedule의 틱을 호스팅한다. `startService`가 엔진 조립 뒤 틱 시작을 부르고 종료 절차에서 멈춘다. 틱 주기, 예약 테이블, 실행 입력 `post`(`timer:<timerId>:<dueAt>` 키, `eng.transactions.design` §8)는 `L2.schedule.spec`이 정한다.
- HS-40. 틱 실행권은 `sys_leases`의 `scheduler` 자원 하나로 판정한다(`eng.transactions.design` §8 [제안]). in-process·stdio 호스트는 `l0.process.service.enabled`가 `false`일 때만 틱을 켠다 [제안]. 앱 실행 중 반복(루프, 웨이크업)은 서비스가 없어도 동작해야 하기 때문이다(`product.scope.spec` §4.5 마지막 항목). 서비스가 켜져 있으면 실행권은 서비스가 쥔다.
- HS-41. 놓친 예약: 재부팅 뒤 `ensure`로 서비스가 다시 뜨기 전까지의 예약을 따라잡을지 건너뛸지는 `L2.schedule.spec`에 위임한다(ADR-0006 §3.5 [미결: L2.schedule.spec]).
- HS-42. 알림 라우팅 [제안]: 예약 실행 결과, 승인 요청, 장기 turn 종료처럼 사용자에게 알릴 사건이 생기면
  - 그 thread를 연 연결이 하나라도 있으면 OS 알림을 내지 않는다. 클라이언트는 내구 이벤트(`events.batch`)로 사건을 받아 표시한다.
  - 연결이 없으면 `UserNotifyPort.show`(L0.os)로 OS 알림을 낸다. 알림 본문에 비밀 값과 도구 출력 원문을 싣지 않는다.
  - 어떤 사건이 알림 대상인지는 사건을 낸 층(L1.tools, L2.schedule)의 이벤트 kind로 정하고, 호스트는 대상 kind 목록을 설정으로 받지 않는다 [가정].
- HS-43. wire에는 "사용자 알림" 전용 알림이 없다(F wire §3.3.2는 `events.batch`, `stream.chunk`뿐). 클라이언트가 알림 대상 사건을 이벤트 kind로 구별해야 한다. 전용 알림이나 표시 힌트 필드가 필요한지는 F 변경 요청으로 §10 미결 13에 올린다.

### 4.11 원격 전송

[결정: review.decisions-2 U-11] 원격 사용은 1차(M3)에 넣는다. 방식은 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 것이다. 호스트는 비루프백 리스너를 만들지 않고, 원격 클라이언트도 로컬 서비스 전송(`socket`)으로 붙는다. 내장 TLS + 토큰 WebSocket은 2차다. 2차 전송에 대한 불변식은 다음과 같다.

- 원격 전송도 F의 `Transport`를 구현하고 같은 `WireHandlers` 표를 쓴다.
- 비루프백 리스너는 토큰 없이 기동하지 않는다. 인증은 `host.hello` 전에 끝낸다. 실패한 연결은 hello 전에 닫는다(`product.scope.spec` §4.4 M3 조건).

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| `buildCatalog`가 코어 키 중복을 돌려준다 | `AssembleError { code: "catalog" }`. `xeon`은 문제 목록을 stderr에 쓰고 종료코드 1. CLI in-process 경로는 `catalogConflict`로 바꿔 같은 1이다(`L4.cli.spec` §4.10). 서비스면 등록 파일을 쓰지 않는다 |
| 포트가 요구하는 서비스가 없다(플러그인 누락) | `AssembleError { code: "missingService" }`. 종료코드 1. CLI in-process 경로는 `missingService`, 1이다 |
| DB를 열 수 없다(권한, 손상, FTS5 없음) | `AssembleError { code: "store" }`. FTS5 검사는 L0.store(TC-11) |
| 처리기가 알 수 없는 예외를 던진다 | `-32603 "Internal error"`, 원문은 로그에만(HS-08) |
| `host.hello` 전 `turn.start` | 1001(HS-01) |
| 재전송 중 커밋 | `pending`에 넣고 재전송 뒤 한 번만 보낸다(HS-11) |
| 재전송 중 연결 종료 | 읽기를 멈추고 구독을 지운다(HS-04). 클라이언트는 마지막 `to`부터 재구독한다 |
| 송신 큐 넘침 | 64 MiB에서 연결을 닫는다(HS-05) |
| `thread.open write`인데 다른 프로세스가 소유 | 3002, `options`(HS-25) |
| 소유 프로세스가 죽은 직후 `thread.open` | 커널이 잠금을 풀었으면 성공한다. DB 임대 행 방식이면 만료까지 3002가 올 수 있다(T-4) |
| stdio 상대가 EOF | 체크포인트 뒤 종료(HS-32) |
| stdio 줄이 1 MiB를 넘는다 | `-32600 frameTooLarge`, 줄 끝까지 버린다(F wire §5) |
| 서비스 두 개가 동시에 기동된다 | 소켓 선점에서 하나만 남는다. 진 쪽은 종료코드 0(SV-02) |
| 낡은 소켓 파일이 있다 | 활성화 잠금 안에서 지우고 바인드한다(SV-02) |
| 등록 파일 pid가 다른 프로세스에 재사용됐다 | `host.status.startedAt` 대조로 낡은 기록으로 판정한다. 신호를 보내지 않는다(SV-03, SV-07) |
| 서비스 버전이 다르고 작업 중이다 | 경고 후 접속. 프로토콜 비호환이면 1003으로 접속 실패(SV-03) |
| 서비스가 체크포인트 시한을 넘긴다 | `service stop`이 SIGKILL. 다음 열기에서 복구(SV-07) |
| 서비스가 죽었다 | 클라이언트는 요청을 실패로 끝내고 멈춘다. 다음 `ensure`가 재기동(SV-08) |
| 승인 대기만 남았다 | live로 세어 유휴 종료하지 않는다(SV-04 [제안]) |
| 대기 예약만 남았다 | 유휴 종료하지 않는다(SV-04) |
| `settings.set`에 평문 비밀 | 3105, details에 값 없음 |
| 설정 파일 값이 스키마에 맞지 않다 | 그 범위 값을 건너뛴다. 진단만 남긴다(F wire §4.8) |
| 컴파일 바이너리에서 `process.execPath`가 바이너리 경로가 아니다 | 자기 실행 실패. `ensure`가 `spawnTimeout`을 돌려준다. H15 spike로 미리 확인한다 |

## 6. 설정 노출

### 6.1 `l4.host-service.*` 키

[제안] F wire §6의 열 형식으로 쓴다. 모두 `layer: "L4"`, `since: "0.1.0"`, `secret: false`이고 `ui.tab`은 `"execution"`이다(`SettingsTab` 12값 중 하나). 프로젝트·로컬 범위를 허용하지 않는다. 저장소를 받는 것만으로 연결 한도가 바뀌지 않게 하기 위해서다(F wire §4.7 규칙 4).

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | secret | 뜻 |
|---|---|---|---|---|---|---|---|---|
| `l4.host-service.maxReplayEvents` | integer | `100000` | min 1,000, max 1,000,000 | `live` | `managed`, `user` | `execution` | false | 구독 한 번에 재전송할 수 있는 최대 이벤트 수. 넘으면 `replay.outOfRange { tooFar }`(HS-13) |
| `l4.host-service.maxSubscriptionsPerConnection` | integer | `16` | min 1, max 256 | `live` | `managed`, `user` | `execution` | false | 연결당 구독 한도. 넘으면 `events.subscriptionLimit`. 새 구독부터 적용 |

- `live` 키는 다음 판정·다음 구독부터 적용한다. 진행 중인 재전송은 시작 때 값을 쓴다.
- 기본값 근거: `maxReplayEvents` 100,000과 구독 16은 F wire §3.4.3 한도 기본값이다.
- 재전송 묶음 크기(500), `scanLimit`(10,000), 송신 lowWater(1 MiB), 시작 유예(10초), 관찰 폴링(250ms)은 상수로 두고 키로 열지 않는다 [제안].
- 같은 동작을 가리키는 키는 한 층만 정의한다 [제안]. 이 문서가 읽기만 하고 정의하지 않는 키는 아래와 같다.
  - 서비스 수명: `l0.process.service.enabled`(서비스 사용, HS-37·HS-38·HS-40), `l0.process.service.idleGraceMs`(유휴 유예, SV-04), `l0.process.service.startTimeoutMs`(기동 대기), `l0.process.shutdown.timeoutMs`(종료 체크포인트 시한, HS-31·SV-07). 단위는 ms다. 소유는 `L0.process.spec` §6이다.
  - 자동 재개: `l1.persistence.autoResume`(§4.1 8단계)과 재개 횟수 상한 `l1.persistence.maxResumeAttempts`. 소유는 `L1.persistence.spec` §6이다.
- 화면: `L4.settings-ui.spec`의 `execution` 탭("실행과 서비스", ADR-0006 §3.4). 명령: `xeon config get/set/reset l4.host-service.<이름>`(`L4.cli.spec`). 서비스 수명·자동 재개 키는 각 소유 층 이름으로 바꾼다. 파일: 사용자·관리 설정 파일.

### 6.2 설정 파일 JSON Schema 출력 명령

[제안] F wire §4.9 표가 이 문서에 맡긴 생성 명령이다.

- 명령: `xeon config schema --scope <managed|user|project|local> [--out <path>]`. `--out`이 없으면 stdout에 쓴다. `session`은 파일이 없으므로 받지 않는다(종료코드 2).
- 내용: `renderSettingsSchema(engine.catalog, scope)`. `settingsJsonSchema` 결과를 `JSON.stringify(value, null, 2) + "\n"`으로 쓴다. 키 정렬은 `settingsJsonSchema`가 보장하므로(F wire §4.10 9번) 같은 카탈로그와 범위면 바이트가 같다(F wire S10).
- 카탈로그는 `assemble({ defaultGroups: true })`의 결과다. 외부 확장은 사용자 환경에 따라 다르므로, 저장소에 커밋하는 스키마 파일은 외부 확장 없이 만든다. 명령은 외부 확장을 싣지 않는 옵션 `--core-only`를 둔다 [제안].
- 커밋본: `xeon/apps/host/schema/settings.<scope>.schema.json` 네 파일. 테스트가 `--core-only` 출력과 커밋본을 바이트 비교한다(plan §5 `settings-schema-committed`).
- 편집기 연결: 사용자 설정 파일의 `$schema`가 가리킬 경로는 `L0.os.spec`의 설정 디렉터리 규칙을 따른다 [가정].

## 7. 확장 지점

- 이 도메인은 `on`, `post`, `drive`, `scope` 지점을 선언하지 않는다. 지점 디스패치는 L1과 X가 한다(DR-12).
- 호스트는 확장을 직접 싣지 않는다. `assemble` 3단계에서 X 로더를 부를 뿐이다. 확장 켜기·끄기는 `ext.<name>.enabled`(X 소유)이고 적용 시점은 단계 경계다(`F.extensions.spec` §4.5).
- Helm과 학습 그룹은 L3 기본 그룹으로 `assemble`이 싣는다. 학습 그룹은 `drive`를 쓰지 않는다[결정: `_research/decisions-log.md` 2026-10-21 계획 v2]. 호스트는 drive 임대를 중재하지 않는다(ext-host 소관).
- 확장 wire 메서드(`ext.<id>.<동사>`)는 F wire §4.2에서 M2 이후이고 허용 여부가 F 미결 5다. 허용되면 `createWireHandlers`가 X가 넘긴 확장 메서드 표를 `WireHandlers`와 별도 표로 받아 같은 처리 순서(§4.3)로 실행한다. 그 전까지 확장은 내구 이벤트로만 클라이언트에 정보를 보낸다.

## 8. 다른 문서와의 인터페이스

| 방향 | 문서 | 내용 |
|---|---|---|
| 요구 | `F.wire-settings.spec` | `Transport`, `HostConnection`, `WireHandlers`, `WireRequestContext`, 팩토리 타입, `WIRE_METHODS`, `WIRE_ERRORS`, `WIRE_LIMITS`, `checkEnvelope`, `isCompatible`, `toEventWire`, 재전송 알고리즘, `WIRE_CONFORMANCE_CASES`, 설정 함수 전부 |
| 요구 | `F.records.spec` | `DurableEventEnvelope`, `VolatileEventEnvelope`, seq 규칙. A안이면 `approval.requested`/`approval.resolved` kind |
| 요구 | `F.extensions.spec` | 매니페스트 `userConfig` → 설정 정의, 확장 켜기 적용 시점 |
| 요구 | `L0.process.spec` | 세션 잠금(세션 id 키), 활성화 잠금 키 `service-activation`, detached spawn(setsid, stdio 분리, unref), 신호 송수신 |
| 요구 | `L0.os.spec` | 데이터·상태·런타임·로그 디렉터리, 소켓 경로 길이 제약, OS 알림 표시, 타이머 |
| 요구 | `L0.store.spec` | `StoreId` 발급, `headSeq`, 구간 읽기, 커밋 후 동기 알림, `LeaseService`(`sys_leases` epoch 펜싱, 소유 표시. review.decisions-2 U-09) |
| 요구 | `L1.persistence.spec` | thread 생성·목록·분기·되감기·삭제, 열 때 복구, 자동 재개와 상한, `LeaseToken` 대조 쓰기(`openForWrite`), 설정 범위 읽기·쓰기, `redact` 규칙 |
| 요구 | `L1.tasks.spec`, `L1.loop.spec` | 입력 제출(`requestId` 멱등), 중단, 안전 경계 정지, live task 수 |
| 요구 | `L1.tools.spec` | 승인 응답, 승인 대기 수 |
| 요구 | `L2.schedule.spec` | 틱 시작·정지, 대기 예약 수, 놓친 예약 정책 |
| 요구 | `X.loading-trust.spec` | 루트 컨텍스트 생성, 플러그인 모듈 타입, 확장 설정 재조립 |
| 요구 | `eng.dependency-rules.guide` | DR-10, DR-11, DR-13, DR-14. §3.1의 수정 요청 |
| 요구 | `eng.events.design`, `eng.transactions.design` | 커밋 뒤 방출, TX-07(세션 쓰기 단일 경로), TX-09, `scheduler` 임대 |
| 요구 | adr.0004, adr.0006, adr.0008 | 단일 DB, 프로세스 구조와 체크리스트, 사이드카 수명 |
| 제공 | `L4.cli.spec` | `startInProcessHost`, `startStdioHost`, `ensureService`, `createHostConnection`, `connectServiceTransport`, `runHostCommand`(`HostCommand`, `CommandIo`), `resolveLaunchMode`, 바이너리 서브커맨드 표(§3.2), §3.3.5 대응표와 종료코드 관계 |
| 제공 | `L4.desktop.spec` | 사이드카 인자 `host --stdio`, stdin EOF 종료와 시한 `l0.process.shutdown.timeoutMs`, 서비스 중계와 `xeon service ensure --json`(HS-38), `xeon service launch-mode --json`(§3.2), `shutdown` 부재와 대체 경로(HS-34) |
| 제공 | `L4.settings-ui.spec` | `l4.host-service.*` 키(§6.1), `settings.*` 처리기 |
| 제공 | `eng.testing.guide` | 전송 동등성 `contract` 테스트(TS-01 `conf` 행이 이 문서에 맡김) |
| 제공 | `eng.toolchain.guide` | TC-10 수정 요청(§3.2) |

## 9. 수용 기준

- AH-01. 같은 모델 테이프, 같은 고정 ID·시계 대역(`test/` 안, review.decisions-2 U-03), 같은 요청 열로 in-process 전송과 stdio 전송을 돌리면 클라이언트가 받는 메시지 열(응답과 알림, 정규화 후)이 같다(`product.scope.spec` §4.4 M2, F wire A10).
- AH-02. `WIRE_CONFORMANCE_CASES` 전부가 in-process와 stdio에서 통과한다.
- AH-03. `host.hello` 전의 요청은 1001, 두 번째 hello는 1002, 주 버전이 다른 hello는 1003이다.
- AH-04. 처리기가 `new Error("secret detail")`을 던지면 응답은 `-32603`, `message: "Internal error"`이고 응답 바이트에 `"secret detail"`이 없으며 로그에 같은 `traceId`와 원문이 있다.
- AH-05. `events.subscribe({ from: { storeId, seq: k } })` 재전송 도중 이벤트 N개를 커밋하면, 클라이언트가 받는 이벤트는 seq > k 전부이고 각 seq가 한 번씩이며 오름차순이다. 연속 알림의 `from`은 직전 `to`다.
- AH-06. 재구독 뒤 이전 `stream.chunk`가 다시 오지 않는다.
- AH-07. `$/cancelRequest`로 취소한 `events.subscribe` 재전송은 5001로 끝나고 그 구독은 남지 않는다.
- AH-08. 두 호스트 프로세스가 같은 DB에서 같은 thread를 `write`로 열면 하나만 `owner`이고 다른 하나는 3002와 `options`를 받는다. 서비스가 없으면 `options`에 `"delegate"`가 없다.
- AH-09. 모델 테이프로 turn을 진행하던 stdio 호스트 자식 프로세스를 SIGKILL한 뒤 같은 DB로 다시 열면 이전 이벤트 seq 뒤로 새 이벤트가 이어지고, 결과 불명 도구 호출은 "중단됨" 결과로 합성된다.
- AH-10. stdin을 닫으면 stdio 호스트는 진행 중 단계의 체크포인트를 커밋하고 `l0.process.shutdown.timeoutMs` 안에 종료코드 0으로 끝난다.
- AH-11. 서비스 체크리스트(SV-01~SV-08) 각각이 `L4.host-service.plan` §5의 테스트로 확인된다.
  - SV-01: 등록 파일 권한이 0600이고, 모르는 필드가 다시 쓴 뒤에도 남는다.
  - SV-02: 두 `service run`을 동시에 띄우면 하나만 소켓을 쥐고 다른 하나는 종료코드 0으로 끝나며, `ensure`는 남은 서비스에 접속한다.
  - SV-03: 버전이 다른 한가한 서비스는 재기동되고 작업 중인 서비스는 경고 뒤 접속된다.
  - SV-04: 연결·live task·대기 예약 중 하나라도 있으면 종료하지 않고, 모두 0이면 시작 유예와 `l0.process.service.idleGraceMs` 뒤 종료한다. 승인 대기만 있으면 종료하지 않는다.
  - SV-05: 소켓 파일과 디렉터리 권한이 소유자 전용이다.
  - SV-06: `ensure`를 부른 부모가 끝나도 서비스가 남는다. stdio 자식은 stdin EOF로 끝난다.
  - SV-07: SIGTERM을 받은 서비스는 체크포인트 뒤 종료하고, 시한을 넘긴 서비스는 `service stop`이 SIGKILL한다.
  - SV-08: 서비스를 SIGKILL하면 연결된 클라이언트의 진행 중 요청이 실패로 끝나고, 다음 `ensure`가 새 서비스를 띄우며 표식이 남은 thread가 재개 후보로 남는다.
- AH-12. `renderSettingsSchema`는 같은 카탈로그·범위에 바이트가 같은 문자열을 낸다. 커밋본 네 파일과 `--core-only` 출력이 같다.
- AH-13. `buildCatalog`가 코어 키 중복을 돌려주는 카탈로그로 `assemble`하면 `AssembleError { code: "catalog" }`이고 열린 DB 핸들이 남지 않는다.
- AH-14. `apps/cli`가 `@xeon/host`의 `.`, `./client` 외 진입점이나 다른 워크스페이스 구현 패키지를 import하면 `just check-layers`가 실패한다(허용 목록 반영 뒤).

## 10. 미결 사항

1. [결정: review.decisions-2 U-15] 조립 위치(DR-10)는 안 1이다(§3.1). 허용 목록 항목 `DR-10/cli-host`, DR-10·DR-14 문구 수정, `architecture.layers.spec` §3.2의 L4 부분은 각 문서 쪽에서 반영한다.
2. [미결] 바이너리 구성. 단일 `xeon`(제안)과 `apps/host` 단독 사이드카 중 선택(§3.2). 사용자 확인.
3. [미결] 문서 수정 요청: `eng.toolchain.guide` TC-10과 같은 문서 §2 바이너리 행, `xeon/apps/desktop/README.md`의 사이드카 문구(§3.2). 2번이 확정되면 작성자가 고친다.
4. [결정: review.decisions-2 U-11] 원격 사용은 M3이고 로컬 서비스 소켓을 SSH 터널·사설망으로 연결한다. 내장 TLS + 토큰 WebSocket은 2차다(§4.11).
5. [미결] 데스크톱 TS 코드가 `@xeon/host/client`(엔진 없는 클라이언트 구현)를 import할지. DR-10 예외를 하나 더 여는 일이다. 다른 안은 `createHostConnection`을 F 아래 층으로 옮기는 것이다. F는 타이머·상태를 쓰는 런타임 로직을 두지 않으므로(F.readme §1) F 변경이 필요하다. `L4.desktop.spec`과 함께 정한다.
6. [미결] 승인 대기 세션을 유휴 종료 판정에서 live로 볼지(ADR-0006 §6). 제안은 live(SV-04).
7. [미결] 등록 파일 스키마의 정본 위치. 이 문서(§3.5)와 `L0.process.spec` 중 하나로 정한다. 작성자 결정(L0.process 작성자와 조율).
8. [결정: review.decisions-2 U-04] F 변경 요청: 비정상 종료 표식(`running_since`, `resume_attempts`)의 "이어서 실행" 후보를 클라이언트에 알리는 수단. M1에 넣지 않고 M2 계획에서 정한다. 그때까지 F.wire-settings 미결로 둔다. 후보는 `ThreadSummary`에 재개 후보 필드를 두는 것 또는 전용 메서드다(HS-30).
9. (닫힘) 종료 협조용 메시지는 F `host.shutdown`(M2)이다(`F.wire-settings.spec` §4). M2 전까지 stdin 닫기로 대신한다(HS-34).
10. [미결] 서비스 인증: Unix 소켓 + 파일 권한만으로 충분한지, 토큰을 `host.hello`에 실을지(F wire §10 미결 4). 사용자 확인. 이 문서는 F 결정에 맞춘다(SV-05).
11. [미결] `settings.list`의 `SettingDefWire.type`에 `range`를 합쳐 실을지, 병합 함수를 F에 둘지(`_research/notes/L4-3.md` §1, §4). F 변경 요청.
12. 닫음: `xeon service ensure --json` 출력 형식(HS-38)을 `L4.desktop.spec` §4.8이 그대로 인용한다. 서비스 경로 진입 판정은 `xeon service launch-mode --json`(§3.2)으로 맞췄다.
13. [결정: review.decisions-2 U-04] F 변경 요청: 사용자 알림용 wire 알림 또는 표시 힌트 필드(HS-43). M1에 넣지 않고 M2 계획에서 정한다.
14. [결정: review.decisions-2 U-09] 세션 잠금 구현은 OS 잠금(생존) + `sys_leases.epoch` 펜싱이다. 호스트는 `SessionLockPort`로 감싸고 받은 `LeaseToken`을 L1.persistence에 넘긴다(§4.7).
15. (닫힘) `architecture.runtime-flow.design` §4.6 표의 service 열은 로컬 소켓과 원격 [미결]로 고쳐졌다(review.consistency-1 S-16). 원격은 U-11에 따라 로컬 소켓을 터널로 연결한다.
16. [결정: review.decisions-2 U-03] 적합성 실행기 위치: F에는 `./testing` 서브패스를 두지 않는다. 실행기는 `apps/host/test/contract/conformance-runner.ts`에 둔다. F plan W14의 틀을 다른 패키지 테스트가 함께 쓰는 방법은 F 문서 쪽에서 정한다.
17. [결정: review.decisions-2 U-04] F 변경 요청: 파일 범위 설정 변경을 접속 중인 다른 클라이언트에 알리는 수단(`settings.invalidated` 등). M1에 넣지 않고 M2 계획에서 정한다. `L4.settings-ui.spec` §10 미결 1과 같은 항목이다.
18. [미결] 패키지 도메인 이름: `package.json`의 `xeon.domain`은 `host`이고 routes.yaml 도메인은 `host-service`다(`architecture.layers.spec` §10 첫 항목). 작성자 결정 사항이며 이 문서는 디렉터리와 패키지 이름 `host`를 유지한다.
