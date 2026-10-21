---
id: X.loading-trust.plan
layer: X
domain: loading-trust
kind: plan
status: draft
depends_on: [X.loading-trust.spec, X.primitives.plan, X.operations.plan, F.extensions.plan, F.extensions.spec, F.wire-settings.spec, eng.transactions.design, eng.dependency-rules.guide, adr.0006]
binds: [xeon/packages/ext-host/src/loading-trust/**]
---

# X 로딩과 신뢰 구현 계획

대상 스펙: X.loading-trust.spec. 패키지: `@xeon/ext-host`(층 X), 디렉터리 `src/loading-trust/`. 테스트는 `xeon/packages/ext-host/test/loading-trust/`에 둔다(`xeon/AGENTS.md` "테스트는 패키지의 `test/*.test.ts`").

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 소비자 |
|---|---|---|
| M0 | 내장 패키지 `manifest` 상수 로딩, `validateManifest`·`validateManifestSet`·`validateUsage` 연결, 같은 프로세스 로딩(`ExtHost.install` 위임, `InstallResult` → 진단 변환), tier 등록(`policy.admit`), 실패 격리(한 확장 실패가 시작을 막지 않음, 내장 필수 예외), 로드 순서, 진단 레코드, 신뢰 등급 상수(`TRUST_MATRIX`) | L4.host-service 조립 3단계, X.primitives(`ExtHost.install`) |
| M1 | 걷는 골격 연결: 테스트용 그룹 하나를 로드해 `xeon chat`에서 on/post/drive가 돈다(`_research/foundation-plan.md` §5 P4 M1). 예약 키 `ext.<name>.enabled` 반영(5a단계, `ensureLoaded`), `settingsFromManifest`·`buildCatalog` 연결과 `foreignNamespace` 거부, 능력 요구 충족(6단계, 연쇄 실패) | L4.host-service 조립 5단계, 테스트 그룹 |
| M2 이후 | 외부 확장 탐색(`.xeon-plugin/plugin.json`, 관리·사용자·프로젝트 위치), 프로젝트 신뢰 포크(pi `trust-manager.ts`·`project-trust.ts`)와 `project_trust` 발화, 제거 흐름(확인 2단계), 안전 모드·`--disable-ext`(5a단계), pi 어댑터 1차(`on`, `post`, `registerTool`, `registerCommand`, `appendEntry`)와 가상 모듈, 프로세스 격리(2차), 핫 리로드(개발용) | L4.cli·L4.desktop(신뢰 프롬프트), L0.os(파일·경로 포트), L0.process(격리) |

- [제안] 신뢰 판정은 프로젝트 확장이 처음 생기는 시점(M2)에 맞춘다. M0·M1에는 내장 확장만 있으므로 판정 대상이 없다. 다만 `TRUST_MATRIX`와 `TrustLevel`은 M0에 두어 X.primitives가 연산 허용 검사에 쓸 수 있게 한다.
- M2 안의 순서: 외부 탐색 → 신뢰 → pi 어댑터 → 격리 → 핫 리로드. 격리와 핫 리로드는 다른 작업과 독립이라 뒤로 미뤄도 앞 작업이 막히지 않는다.

## 2. 패키지와 파일 배치

[제안] 배치 지시의 파일 구성을 따르고 스펙 §3의 파일 이름을 맞췄다.

```
xeon/packages/ext-host/
  package.json                     # dependencies에 vscode-jsonrpc 9.0.3(M2 격리 작업 때) 추가
  src/loading-trust/
    index.ts                       # ExtensionLoader 구현(createExtensionLoader), LoadOptions, LoadReport,
                                   # LoadAbortError, LoaderDeps, 공개 재export
    discover.ts                    # BuiltinExtensionModule, ExtensionCandidate, discover(), F LoaderFs·LoaderPaths 재export
    load-order.ts                  # BUILTIN_LAYER_ORDER, SOURCE_ORDER, OrderKey, compareLoadOrder, orderManifests
    pipeline.ts                    # LoadState, LoadStage, LoadDiagnosticCode, LoadDiagnostic(+Schema),
                                   # LoadedExtensionInfo, 단계 1~9 실행기, 실패 격리
    entry-loader.ts                # 엔트리 import(Bun import, 가상 모듈 등록 후), ExtensionUnit 생성,
                                   # ExtHost.install 호출, InstallResult → 진단 변환(스펙 §4.4.3 표)
    remove.ts                      # M2. previewRemoval, remove(uninstall → forget → dropExtension)
    settings-keys.ts               # RESERVED_EXT_KEYS, reservedExtensionSettings, loadingTrustSettings,
                                   # settingsFromManifest 연결, 카탈로그 재조립
    trust/
      levels.ts                    # TrustLevel, TRUST_LEVELS, trustRank, InstallSource, SOURCE_TRUST,
                                   # TrustPermissions, TRUST_MATRIX
      store.ts                     # (포크) ProjectTrustStore, TrustFileSchema, TrustLookup, TrustStoreCorruptError,
                                   # trustOptions. F TrustStoreBackend·TrustUpdate·TrustOption 재export
      resolve.ts                   # (포크) resolveProjectTrust, ResolveProjectTrustInput, ProjectTrustResult.
                                   # F TrustPrompter·TrustPromptRequest·TrustChoice·TrustChoiceKind 재export
      resources.ts                 # (포크) TRUST_REQUIRING_PROJECT_RESOURCES, findTrustRequiringResources
    isolation/
      rpc.ts                       # IsoMethods, Iso*Params/Result 스키마, 연결 생성(vscode-jsonrpc)
      proxy.ts                     # 프록시 확장, isolatablePoints, 취소·시간 예산·재시작 정책
      outbox-agent.ts              # OutboxAgent: 격리 확장의 post/commit/record 대리
      child-main.ts                # 자식 프로세스 진입점(엔트리 실행, scope 스텁)
    pi-adapter/
      factory.ts                   # 공장 함수 실행, PiExtensionApiShim, 기록, synthesizeManifest, piExtensionName
      api-map.ts                   # 지점별 결과 변환표, sendMessage/sendUserMessage → post, piPostKey,
                                   # registerTool/Command 대응, ctx 부분 구현
      compat-report.ts             # PiSupport, PiCompatRow, PI_COMPAT_TABLE, PiCompatReport
      virtual-modules.ts           # VirtualModuleRegistry, Bun.plugin 등록, 차단 모듈, pi-coding-agent shim
  test/loading-trust/
    levels.test.ts  load-order.test.ts  pipeline.test.ts  entry-loader.test.ts  settings-keys.test.ts
    discover.test.ts  remove.test.ts  trust-store.test.ts  trust-resolve.test.ts  trust-resources.test.ts
    pi-adapter.test.ts  pi-compat-table.test.ts  isolation-proxy.test.ts  isolation-rpc.test.ts
    docs-consistency.test.ts
    integration/project-trust.int.test.ts
    fixtures/
      builtin/                     # 내장 모듈 가짜(정상, throw, 선언 밖 on, 필수)
      ext-root/                    # .xeon-plugin/plugin.json 가진 외부 확장 디렉터리 여러 개
      project/.xeon/extensions/    # 프로젝트 확장(import 기록기 내장)
      pi/                          # pi 샘플: tool_call 차단형, pi-tui import형, input 수정형
      trust/                       # 정상·손상·pi v0 형식 trust.json
```

- import 방향(파일 사이): `trust/levels` ← `load-order` ← `pipeline` ← `index`. `discover`, `entry-loader`, `settings-keys`, `trust/*`는 `pipeline`이 부른다. `isolation/*`와 `pi-adapter/*`는 `entry-loader`의 다른 실행 경로로 꽂히고 `pipeline`을 import하지 않는다(순환 방지, DR-06).
- `src/loading-trust/` 밖(같은 패키지의 `src/primitives/`, `src/operations/`)은 이 계획의 binds 밖이다. `ExtHost`, 디스패처, 리소스 등록 API는 X.primitives.plan이, `OperationsPolicy`와 `ExtStorageAdmin`은 X.operations.plan이 만든 것을 타입으로 import한다(`import type`).
- `src/loading-trust/`는 `@xeon/vendor-cordis`를 import하지 않는다. Cordis import는 `src/primitives/cordis-bridge.ts` 한 파일이다(X.primitives.plan §2).

## 3. 작업 분해

선행 표기: `F.E*`는 F.extensions.plan 작업, `P-*`는 X.primitives.plan 작업, `O-*`는 X.operations.plan 작업이다.

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| L-01 | 스파이크(저장소 안 고정 파일만 사용, 내려받은 코드 실행 없음): (a) `bun build --compile` 바이너리에서 외부 `.ts` 동적 `import()`, (b) `Bun.plugin` `build.module(..., { loader: "object" })` 가상 모듈, (c) 질의 접미 캐시 회피, (d) 같은 지정자를 Xeon 패키지와 가상 모듈이 함께 쓸 때 모듈 인스턴스 동일성. 결과로 스펙 §4.4.1 A안 확정 또는 B안(jiti) 전환 보고 | 없음 | S | M0 |
| L-02 | `trust/levels.ts`: `TrustLevel`, `TRUST_LEVELS`, `trustRank`, `InstallSource`, `SOURCE_TRUST`, `TrustPermissions`, `TRUST_MATRIX`(스펙 §4.6.2 표) | F.E7(`TrustRequestSchema`) | S | M0 |
| L-03 | `load-order.ts`: `compareLoadOrder`, `orderManifests`. 순수 함수, 코드 포인트 비교 | L-02 | S | M0 |
| L-04 | `pipeline.ts` 타입: `LoadState`, `LoadStage`, `LoadDiagnosticCode`, `LoadDiagnostic`, `LoadDiagnosticSchema`, `LoadedExtensionInfo`. 진단 수집기(확장별 목록, 세대 번호) | L-02 | S | M0 |
| L-05 | `discover.ts` 내장 부분: `BuiltinExtensionModule` 목록 → 후보. `layer` 값으로 층 순서 index 계산 | L-03, F.E7 | S | M0 |
| L-06 | `entry-loader.ts` 내장 경로: `BuiltinExtensionModule` → `ExtensionUnit`, 6a단계 `policy.admit`(`tier_rejected`), `ExtHost.install` 호출, `InstallResult` → 진단 변환(스펙 §4.4.3 표: `entry_threw`, `setup_threw`, `setup_timeout`, `setup_action`, `usage_invalid`, `usage_warning`), 실패 시 `uninstall`·`forget` | L-04, P-13(`install`, `InstallResult`), O-03(`admit`, `forget`), F.E6(`ExtensionEntry`) | M | M0 |
| L-07 | `pipeline.ts` 단계 실행기(내장): 2(`validateManifest`), 3(`validateManifestSet`), 4(내장은 `builtin` 고정), 6a·7(L-06), 8(`InstallResult` 사용 대조 결과 반영), 9(활성화). 확장별 `try`로 실패 격리, `essential` 확장 실패 시 `LoadAbortError` | L-05, L-06, F.E9 | M | M0 |
| L-08 | `index.ts`: `createExtensionLoader(deps)`, `loadAll`(내장만), `list`, `diagnostics`, `dispose`(역순 scope 정리). `LoaderDeps` 필수 항목(`host`, `policy`, `fs`, `paths`, `trustBackend`) 확인(없으면 시작 실패). 로더 포트 타입은 F `ports.ts` 이름을 다시 export하고 자기 정의를 두지 않는다 | L-07, F.E10(로더 포트) | S | M0 |
| L-09 | `settings-keys.ts`: `reservedExtensionSettings`(`enabled`, `isolation`), `loadingTrustSettings`(`defineSettings("x.loading-trust", …)`), 5단계(`settingsFromManifest` 결과 이슈 → `rejected`), userConfig 예약 이름 충돌(`settings_reserved_key`), `LoadReport.settingGroups`와 재조립 | L-07, F.wire-settings.plan(`defineSettings`, `settingsFromManifest`, `buildCatalog`) | M | M1 |
| L-10 | 5a단계: `ext.<name>.enabled` 유효 값 확인(거짓이면 엔트리 미실행 `disabled`), 필수 userConfig(`config_required`). 실행 중 값 변경 구독 → `ensureLoaded` 또는 scope 끄기 요청. 안전 모드·`--disable-ext`는 L-29(M2) | L-09, P-09(scope 켜기·끄기), L1.persistence 설정 변경 통지 [가정] | M | M1 |
| L-11 | 6단계: 능력 요구 충족 판정(매니페스트 `provides` + 코어 능력 레지스트리, 범위 비교), 9단계 뒤 provider 실패 연쇄(`capability_provider_failed`) | L-07, F.capabilities.plan(범위 비교 함수), P-17(능력 바인딩) | M | M1 |
| L-12 | 걷는 골격 연결: 조립 루트(L4 host)의 `extraPlugins`로 테스트 그룹 모듈을 넘겨 로드, `host.status`용 진단 노출. 이 문서 binds 밖 파일 변경은 L4.host-service.plan 작업자와 조율 | L-08, L-10, L-11, L4.host-service.plan | S | M1 |
| L-13 | `discover.ts` 외부 부분: 관리·사용자·`x.loading-trust.paths` 위치의 `.xeon-plugin/plugin.json` 한 단계 탐색, 심볼릭 링크 정규화, 위치 우선순위와 `name_conflict`, `manifest_missing`·`manifest_parse` | L-05, L0.os 포트 구현 [가정] | M | M2 |
| L-14 | `entry-loader.ts` 외부 경로: 엔트리 절대 경로 계산, `realpath`가 확장 루트 안인지 확인, `import()`(L-01 결과 방식), `default`·`extension` export 판별, `ExtensionUnit`으로 `install`(L-06 경로) | L-01, L-06, L-13 | M | M2 |
| L-15 | `trust/store.ts` 포크: `ProjectTrustStore`(`lookup`, `setMany`), `TrustFileSchema`, 손상 → `corrupt`, 손상 시 쓰기 거부, pi 형식(v0) 읽기 변환, `trustOptions` | L-02 | M | M2 |
| L-16 | `trust/resources.ts` 포크: `TRUST_REQUIRING_PROJECT_RESOURCES`, `findTrustRequiringResources`(상위 `.agents/skills` 탐색, 홈 제외) | L-13 | S | M2 |
| L-17 | `trust/resolve.ts` 포크: 판정 순서 1~8, `project_trust` 발화(디스패처 래퍼, 예외 → 불신), `sessionMemory`, headless 불신, 프롬프트 결과 저장 | L-15, L-16, P-06(디스패처) | M | M2 |
| L-18 | 시작 순서 통합: 1차 집합(내장·관리·사용자) → 신뢰 판정 → 프로젝트 탐색과 2차 집합 검사 → `resources_discover` 발화. 프로젝트 확장 신뢰 전 미import 보장, 신뢰 전 적용 제외 규칙을 설정 계층 쪽에 넘기는 훅 [가정: L1.persistence API] | L-13, L-14, L-17 | M | M2 |
| L-19 | `pi-adapter/factory.ts`·`api-map.ts` 1차: pi 디렉터리 탐색 규칙, 기록용 `PiExtensionApiShim`(`on`, `sendMessage`, `sendUserMessage`, `registerTool`, `registerCommand`, `appendEntry`), 비지원 멤버 예외, `synthesizeManifest`, `piExtensionName`, `piPostKey`, 지점별 결과 변환(`tool_call` block → 거부, `project_trust` undecided → undefined), `event.input` 변경 감지 → 거부, `registerShortcut`·`registerFlag`·`getFlag` → `hostOf(g)` 대응 | L-14, L-18, P-24(리소스 등록) | L | M2 |
| L-20 | `pi-adapter/virtual-modules.ts`: `VirtualModuleRegistry`, typebox 계열 등록, 차단 모듈(`pi-tui`, `pi-ai/oauth`), `pi-coding-agent` shim(유틸·상수 12종). core-models·core-loop 쪽 등록 호출은 L1 plan 작업자에게 요청 | L-01, L-19 | M | M2 |
| L-21 | `pi-adapter/compat-report.ts`: `PI_COMPAT_TABLE`(스펙 §4.10.4 표), 확장별 `PiCompatReport`, 지원률 재집계 보고(고정 예제 사본에 대한 정적 분석만) | L-19 | S | M2 |
| L-22 | `isolation/rpc.ts`·`child-main.ts`: vscode-jsonrpc 연결(`StreamMessageReader`/`Writer`), `IsoMethods`, 스키마 검사, `init` 왕복, 자식 쪽 scope 스텁과 취소 전달 | L-14, P-30(`ProcessPortKey`), L0.process 포트 구현 [가정] | L | M2(2차) |
| L-23 | `isolation/proxy.ts`: 선언 지점에만 프록시 핸들러 등록, 디스패치 직렬화, 결과 스키마 검사, 시간 예산 초과 → 예외(fold 규칙), 취소 → `killGraceMs` 뒤 `SIGKILL`, `isolatablePoints`, 격리 불가 지점·drive 거부, 도구 프록시 | L-22, P-06(디스패처), O-05(시간 예산) | L | M2(2차) |
| L-24 | `isolation/outbox-agent.ts`: 자식의 `post`·`commit`·`record`를 확장 scope로 실행, 자식 `requestId` 그대로 사용 | L-22, P-09(ScopeRuntime), P-12(상태 커밋) | M | M2(2차) |
| L-25 | 격리 수명: 비정상 종료 감지, 재시작 정책(`maxRestarts`, `restartWindowSec`, 지수 대기), 한도 초과 → `error` + scope 끄기 요청, `dispose`와 서비스 모드 유휴 종료 경로 | L-23 | M | M2(2차) |
| L-26 | 핫 리로드(개발용): `reload(name)`, 세대 증가, 질의 접미 재import, 격리 확장은 재시작 | L-14, L-25 | M | M2 이후 |
| L-27 | 문서 대조 검사: 스펙 §4.6.2 표 ↔ `TRUST_MATRIX`, 스펙 §4.10.4 표 ↔ `PI_COMPAT_TABLE`(항목·등급) | L-02, L-21 | S | M0(신뢰 표), M2(pi 표) |
| L-28 | `remove.ts` 제거 흐름(스펙 §4.4.5): `previewRemoval`(`dropExtension(name, false)`), `remove`(`ExtHost.uninstall` → `policy.forget` → `dropTables`면 `dropExtension(name, true)`), 내장 확장 제거 거부. `storageAdmin`은 가짜로 먼저 테스트하고 O-25에서 실제 구현과 연결 | L-08, P-13(`uninstall`), O-03(`forget`) | S | M2 |
| L-29 | 5a단계 시작 옵션: `LoadOptions.startup`을 `policy.startupFilter`에 넘겨 빠진 확장을 `disabled`(`safe_mode`, `disabled_flag`)로 두기. 외부 확장은 import 생략, 내장 확장은 install 생략 | L-10, O-20(`startupFilter`, `OperationsPolicy.startupFilter`) | S | M2 |

- 가장 큰 작업은 L-19, L-22, L-23이다. L-19는 지점별 결과 변환표를 지점 종류(input, request, tool, boundary, session) 단위로 나눠 PR을 쪼갤 수 있다.
- M0에 필요한 X.primitives 산출물은 `ExtHost.install`·`uninstall`과 `InstallResult`(P-13)다. 늦으면 L-06은 같은 인터페이스의 가짜 `ExtHost`로 먼저 끝내고 연결만 나중에 한다. `policy.admit`(O-03)도 같다.

## 4. 채택 코드

| 대상 | 버전·원본 | 쓰는 방식 | 라이선스 |
|---|---|---|---|
| Cordis | vendored `xeon/vendor/cordis`, 4.0.0-rc.11, 커밋 `df4431e` | 이 도메인은 직접 쓰지 않는다. fiber 생성과 해제는 `ExtHost.install`·`uninstall`을 거쳐 `src/primitives/cordis-bridge.ts`가 한다(X.primitives.plan §2) | MIT |
| `@cordisjs/plugin-loader` | - | 쓰지 않는다. vendored에 없고(`UPSTREAM.json` `notCopied`), 설정 파일 기반 로딩은 이 패키지가 직접 구현한다(adr.0002 §4.2) | - |
| `typebox` | 1.4.2(워크스페이스 catalog, 1.4.x) | 그대로. `TrustFileSchema`, `LoadDiagnosticSchema`, 격리 RPC 스키마, `Value.Check` | MIT |
| `vscode-jsonrpc` | 9.0.3 정확 고정(의존 0) | 그대로. `vscode-jsonrpc/node`의 `createMessageConnection`, `StreamMessageReader`, `StreamMessageWriter`, 취소 토큰. M2 격리 작업(L-22)에서 `package.json`에 더한다. eng.dependency-rules.guide DR-07 표에 `vscode-jsonrpc` → `ext-host` 행 추가를 함께 요청한다 | MIT |
| pi `trust-manager.ts` | `~/projects/_ref/pi-src/packages/coding-agent/src/core/trust-manager.ts`, 246줄, pi 소스 1.1.0, 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc` | 포크 → `trust/store.ts`, `trust/resources.ts` | MIT(`pi-src/LICENSE`, Copyright (c) 2025 Mario Zechner) |
| pi `project-trust.ts` | 같은 디렉터리 `project-trust.ts`, 97줄, 같은 커밋 | 포크 → `trust/resolve.ts` | MIT |
| pi `loader.ts`, `virtual-modules.ts` | 같은 패키지 `core/extensions/loader.ts`(876줄), `virtual-modules.ts`(38줄) | 참고만. 탐색 규칙(736-826), 실패 시 `discard`(542-549), 가상 모듈 키 20개. 코드는 옮기지 않는다 | MIT |
| jiti | - | 쓰지 않는다(스펙 §4.4.1 A안). L-01 스파이크가 A안 불가로 나오면 그때 정확 버전을 정해 들인다 | - |
| proper-lockfile | - | 쓰지 않는다. 잠금은 `TrustStoreBackend` 구현(L0) 몫이다 | - |

포크에서 바꿀 점(스펙 §4.7.1 표의 구현 목록):

1. `proper-lockfile` import와 `acquireTrustLockSync`·`withTrustFileLock`(138-177) 삭제. `TrustStoreBackend.update` 한 번으로 읽기-수정-쓰기를 한다.
2. `../config.ts`의 `CONFIG_DIR_NAME` → 로컬 상수 `XEON_DIR = ".xeon"`. `APP_NAME` 문자열 프롬프트(`formatProjectTrustPrompt`) 삭제(표시는 L4).
3. `node:fs` 동기 함수 → `LoaderFs`(`exists`, `realpath`)와 `TrustStoreBackend`(`read`, `update`) 비동기 호출. 함수 시그니처가 모두 `async`가 된다.
4. `node:os` `homedir()`·`process.env.HOME` → `LoaderPaths.homeDir` 주입.
5. `../utils/paths.ts`(`canonicalizePath`, `resolvePath`) → 생성자 인자 `normalize`. `../utils/text.ts`(`stripBom`) → 로컬 함수.
6. `ProjectTrustDecision = boolean | null` → 로컬 타입 `TrustVerdict`(`"allow" | "deny" | "undecided"`). `ProjectTrustStoreEntry`, `ProjectTrustUpdate`, `ProjectTrustOption` → `TrustLookup`, `TrustUpdate`, `TrustOption`.
7. `readTrustFile`의 예외 → `TrustLookup { kind: "corrupt" }`. `writeTrustFile` 정렬 규칙(키 사전순)은 유지한다.
8. `./extensions/runner.ts`의 `emitProjectTrustEvent`, `./extensions/types.ts`의 `LoadExtensionsResult`·`ProjectTrustContext`, `./settings-defaults.ts`, `./settings-manager.ts` import 삭제. 각각 `emitProjectTrust` 함수 인자, `TrustPrompter`, 설정 키 `x.loading-trust.defaultProjectTrust` 값으로 바꾼다.
9. `AppMode` → `LoaderMode`. `hasUI` 판정 → `prompter` 유무와 `mode`.
10. 포크 파일 첫 줄 주석 형식(라이선스 표기 위치) [제안]:

```ts
// Forked from earendil-works/pi packages/coding-agent/src/core/trust-manager.ts
// at cdaf6c227d4718a72b59ccd02152c9614df44cfc (pi 1.1.0). MIT License, Copyright (c) 2025 Mario Zechner.
// Changes: see docs/xeon/X/loading-trust/spec.md §4.7.1.
```

- 라이선스 전문은 `xeon/packages/ext-host/THIRD_PARTY_NOTICES.md`에 둔다 [제안]. 이 파일은 binds 밖이므로 경로 확정은 eng.toolchain.guide 작업자와 조율한다.

## 5. 단위 테스트 목록

모든 테스트는 가짜 포트(`LoaderFs` 메모리 구현, `TrustStoreBackend` 메모리 구현, 기록형 `TrustPrompter`, 가짜 `IsolationProcessPort`)와 주입 시계를 쓴다(eng.testing.guide). 모델 테이프는 필요 없다.

| 파일 | 테스트 | 확인할 동작 | 스펙 |
|---|---|---|---|
| `pipeline.test.ts` | `undeclared point fails load` | `points: ["tool_call"]`인 확장이 setup에서 `turn_end`에 `on`하면 `error`, `usage_invalid`, issues에 `point_undeclared`, 남은 등록 0 | §9-1 |
| | `one throwing extension does not block others` | 확장 셋 중 가운데가 throw해도 나머지 둘 `active`, `loadAll` 성공 | §9-2 |
| | `essential failure aborts start` | `essential: true` 확장이 throw하면 `LoadAbortError`, 진단 `essential_failed` | §9-3 |
| | `manifest parse error rejected` | 잘못된 JSON 매니페스트는 `rejected`(`manifest_parse`), 다른 확장 계속 | §5 |
| | `unknown key warning kept` | 최상위 미지 키는 경고 진단만 남고 `active` | §4.3.1 |
| | `post during setup rejected` | scope setup 중 `post`는 `PrimitiveError("no_thread")`이고 로더 진단은 `setup_action`, 확장 `error` | §4.4.3 |
| | `late registration after timeout dropped` | 시간 예산 초과 뒤 끝난 setup의 등록은 scope 세대가 닫혀 버려진다(`setup_timeout`) | §4.4.3-5 |
| | `runtime undeclared on rejected only` | 활성 뒤 핸들러 안의 선언 밖 `on`은 그 호출만 `PrimitiveError("point_undeclared")`, 확장은 `active` 유지 | §4.4.3-6 |
| | `install delegation and error mapping` | 가짜 `ExtHost`로 `InstallResult`의 `entryError`·`setups[].failure`·`issues`가 스펙 §4.4.3 표의 진단 코드로 바뀐다. 로더 파일에 Cordis import 0건 | §9-19 |
| | `admit rejection skips install` | `policy.admit`이 `TierError`면 `install` 호출 0회, 진단 `tier_rejected` | §9-20 |
| `load-order.test.ts` | `deterministic order` | 같은 후보 집합을 무작위로 섞은 100가지 입력에서 결과와 `loadIndex`가 같다 | §9-10 |
| | `source and layer precedence` | builtin L1 < builtin L3 < managed < user < project, 같은 위치는 이름 코드 포인트 순 | §4.2.3 |
| `levels.test.ts` | `trust exceeds source rejected` | 사용자 위치 매니페스트의 `trust.level: "builtin"`은 `trust_exceeds_source` | §9-15 |
| | `effective level is min` | `project` 위치 + 요청 `user` → `project`, `user` 위치 + 요청 `project` → `project` | §4.6.1 |
| `settings-keys.test.ts` | `enabled false skips setup` | `ext.x.enabled=false`면 엔트리 호출 0회, `disabled` | §9-6 |
| | `enable at runtime loads once` | 세션 범위에서 `true`로 바꾸면 `ensureLoaded`가 엔트리를 한 번 부른다 | §9-6 |
| | `foreign namespace rejects load` | userConfig `setting: "l1.loop.maxSteps"` → `rejected`(`settings_rejected`), `settingGroups`에 없음 | §9-12 |
| | `reserved key in userConfig` | userConfig 키 `enabled` → `settings_reserved_key` | §4.5.1 |
| | `reserved defs shape` | `ext.<name>.enabled`·`isolation`의 타입, 기본값, `allowedScopes`, `runtimeChange`가 스펙 §6 표와 같고 `checkSettingDef`를 통과한다. 내장 확장에는 `isolation` 정의가 없다 | §4.5.2 |
| `pipeline.test.ts`(능력) | `missing capability provider diagnosed` | `requires web.search ^1.0.0`, provider 없음 → 엔트리 미실행, `capability_missing`, 진단에 능력 ID | §9-9 |
| | `provider failure cascades` | provider 확장이 9단계에서 실패하면 소비 확장도 `capability_provider_failed` | §4.3.2 |
| `discover.test.ts` | `name conflict precedence` | 사용자·프로젝트 같은 이름 → 사용자 `active`, 프로젝트 `rejected`(`name_conflict`) | §9-13 |
| | `one level only and symlink dedupe` | 두 단계 아래 매니페스트는 무시, 같은 실제 경로 심볼릭 링크는 후보 하나 | §4.2.1 |
| `trust-store.test.ts` | `corrupt store treated as untrusted` | JSON이 아닌 파일 → `lookup`이 `corrupt`, `setMany`가 `TrustStoreCorruptError`, 파일 바이트 불변 | §9-11 |
| | `nearest ancestor wins` | `/a` allow, `/a/b` deny → `/a/b/c` 조회는 deny, `/a/x`는 allow | §4.7.3 |
| | `pi v0 format migrates` | `{ "/a": true }` 파일을 allow로 읽고 다음 쓰기에서 `version: 1` | §4.7.5 |
| | `parent choice updates` | 상위 폴더 선택 → 상위 allow 저장, 프로젝트 루트 항목 삭제 | §4.7.3 |
| `trust-resolve.test.ts` | `headless untrusted by default` | headless, 저장 없음, `ask` → 불신, `via: "headless"`, 프롬프트 호출 0, 저장 0 | §9-5 |
| | `point exception denies` | `project_trust` 핸들러 throw → 불신, 저장 0 | §4.7.3-4 |
| | `point remember saves` | 핸들러 `{ trusted: "yes", remember: true }` → 신뢰, 저장 `via: "point"` | §4.7.3-4 |
| | `session only not persisted` | "이번 세션만 신뢰" → 신뢰, 저장 0, 같은 로더의 두 번째 판정은 `sessionMemory` | §4.7.3 |
| | `override wins` | `trustOverride: false`면 저장소에 allow가 있어도 불신 | §4.7.3-1 |
| `remove.test.ts` | `remove previews then drops` | `previewRemoval`은 변화 없음, `remove`는 `uninstall` → `forget` → `dropExtension(true)` 순서, `dropTables: false`면 테이블 남음, 내장 확장 제거 거부 | §9-21 |
| `pipeline.test.ts`(시작 옵션) | `safe mode and disable flag skip entry` | `startup.disabled`의 외부 확장은 import 0회, 내장 확장은 install 0회, 진단 `disabled_flag`·`safe_mode` | §9-22 |
| `trust-resources.test.ts` | `bare dir needs no trust` | 빈 `.xeon`은 판정 불필요, `.xeon/extensions/` 있으면 필요, 홈의 `.agents/skills`는 제외 | §4.7.2 |
| `pi-adapter.test.ts` | `tool_call blocking sample works` | pi 샘플(`tool_call`에서 `{ block: true, reason }`)을 로드하면 합성 `points`가 `["tool_call"]`, 디스패치 결정이 거부 | §9-8 |
| | `pi-tui import unsupported` | `@earendil-works/pi-tui` import 샘플은 `pi_unsupported_module`, 다른 pi 확장 계속 | §9-16 |
| | `input mutation denied` | `event.input` 수정 샘플 → 그 호출 거부, `pi_input_mutation` 진단 | §4.10.4 |
| | `post key deterministic` | `piPostKey` 같은 입력 같은 값, ordinal만 다르면 다른 값, 길이 ≤ 64 | §9-17 |
| | `sendMessage maps when` | `deliverAs` `steer`/`followUp`/`nextTurn` → `steer`/`followUp`/`next`, `customType` → `x.<name>.pi.<이름>` | §4.10.3 |
| | `command-only control unsupported` | 명령 핸들러의 `ctx.newSession()` 호출은 `PiCompatUnsupportedError` | §4.10.4 |
| | `appendEntry records` | `appendEntry("note", {a:1})` → `x.<name>.pi.entry` 레코드, 합성 `recordKinds`에 선언 | §4.10.3 |
| `pi-compat-table.test.ts` | `each supported row has mapping` | `PI_COMPAT_TABLE`의 `supported`·`partial` 행마다 어댑터에 대응 구현이 있고, `unsupported` 행 멤버 호출은 예외 | §4.10.4 |
| `isolation-proxy.test.ts` | `first timeout applies FIRST_DENY` | 가짜 자식이 응답하지 않으면 `tool_call` 결정이 `FIRST_DENY.tool_call`, 취소 메시지 전송, 유예 뒤 `SIGKILL` | §9-7 |
| | `connection drop handled` | 디스패치 중 자식 stdout 종료 → 진행 중 요청 예외 처리(tap 계속, chain 생략), 재시작 1회 | §4.9.7 |
| | `restart limit disables` | 창 안에서 `maxRestarts + 1`번 종료 → `isolation_restart_limit`, scope 끄기 요청 | §9-18 |
| | `undeclared point not proxied` | `init` 결과 `usage.on`에 선언 밖 지점 → 등록 거부 | §4.9.2 |
| | `non-isolatable point rejected` | `points`에 `provider_stream_event` → `isolation_point_unsupported` | §4.9.4 |
| | `drive with isolation rejected` | `usesDrive: true` + `process` → `isolation_drive_unsupported` | §4.9.5 |
| `isolation-rpc.test.ts` | `outbox agent forwards requestId` | 자식 `post`의 `requestId`가 대리인 `post`에 그대로 전달, 같은 키 재전송은 `duplicate: true` | §4.9.6 |
| | `child env allowlist` | `IsolationSpawnSpec.env` 키가 허용 목록뿐이고 DB 경로가 없다 | §4.9.6 |
| `docs-consistency.test.ts` | `trust table matches TRUST_MATRIX` | 스펙 §4.6.2 표(행 4, 열 8)를 파싱한 값과 `TRUST_MATRIX`가 같다 | §9-14 |
| | `pi table matches PI_COMPAT_TABLE` | 스펙 §4.10.4 표의 항목·등급과 상수가 같다 | §4.10.4 |

- 표의 테스트는 53개다. M0·M1 몫은 22개이고 나머지는 M2 이후 신뢰·제거·시작 옵션·pi·격리 몫이다. 수용 기준 §9-1~22가 모두 하나 이상의 테스트에 대응한다. 필수로 정한 항목(신뢰 저장 파일 손상, 로드 순서 결정성, pi 지원 표 각 행, 프록시 연결 끊김)은 `trust-store`, `load-order`, `pi-compat-table`, `isolation-proxy` 파일에 있다.
- 마일스톤별 필수: M0는 `pipeline`(능력 제외), `load-order`, `levels`, `docs-consistency`의 신뢰 표. M1은 `settings-keys`, 능력 테스트. 나머지는 M2 이후.

통합 테스트 1개:

| 파일 | 테스트 | 확인할 동작 |
|---|---|---|
| `integration/project-trust.int.test.ts` | `project extension not executed before trust` | 임시 디렉터리에 프로젝트(`.xeon/extensions/probe/`, 엔트리가 모듈 최상위에서 표식 파일을 쓰는 확장)를 만들고, 실제 파일 시스템 `LoaderFs`와 메모리 `TrustStoreBackend`로 `loadAll`(headless)을 실행한다. 표식 파일이 생기지 않고 `probe`는 `rejected`(`trust_undecided`)다. 같은 설정에 `trustOverride: true`로 다시 실행하면 표식 파일이 한 번 생긴다. 모델 테이프와 네트워크는 쓰지 않는다 |

## 6. 완료 기준

1. 위 단위 테스트 중 해당 마일스톤 몫과 통합 테스트 1개가 `bun test`로 통과한다(M2 완료 시 전부).
2. X.loading-trust.spec §9 수용 기준 1~22가 §5 표의 테스트로 모두 확인된다.
3. `just check-layers`와 `just depcruise`가 통과한다. `src/loading-trust/**`에서 `@xeon/platform-*`, `@xeon/core-*`, `@xeon/cap-*`, `@xeon/group-*`, `@earendil-works/*` import가 0건이다(X→L0 이상 import 없음). `node:child_process`, `Bun.spawn` 사용이 0건이다(DR-07). `@xeon/vendor-cordis` import도 0건이다(X.primitives.plan §6 4번).
4. 문서 대조: 스펙 §4.6.2 신뢰 등급 표와 `TRUST_MATRIX`, 스펙 §4.10.4 지원 표와 `PI_COMPAT_TABLE`이 `docs-consistency.test.ts`에서 차이 0건이다.
5. `just verify`가 종료코드 0이다(oxfmt, oxlint type-aware, `tsc -b`, knip 포함). default export와 `any`가 없다.
6. 포크 파일 2개(`trust/store.ts`·`trust/resources.ts`의 trust-manager 부분, `trust/resolve.ts`) 머리에 원본 경로, 커밋, MIT 표기가 있다.
7. 정합성 검토 입력으로 다음 교차 확인 항목을 남긴다.
   - F.extensions.spec `TrustRequestSchema` 값 집합과 `TRUST_LEVELS`가 같은지.
   - L4.host-service.spec `HostPluginModule`이 `BuiltinExtensionModule`을 가리키는지.
   - eng.context-map.design `xh_*` 행과 신뢰 저장 위치(스펙 §10 미결 11).
   - L4.settings-ui.spec의 `x.loading-trust.*` 안전 모드 표기(스펙 §6).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| pi `trust-manager.ts`의 설정·잠금 결합이 예상보다 깊다 | 포크가 커지고 pi 갱신을 따라가기 어렵다 | 결합 지점은 import 8줄(proper-lockfile, config, utils 2개, runner, types, settings 2개)로 확인했다(스펙 §4.7.1). 포크는 공개 함수 단위로 옮기고, 동작 비교 테스트(`trust-store`, `trust-resolve`)를 pi 동작 기준으로 먼저 쓴다. 결합이 더 나오면 해당 함수는 포크하지 않고 새로 쓴다 |
| Bun에서 TS 엔트리 동적 import와 캐시 무효화(핫 리로드) | 컴파일 바이너리에서 외부 확장을 못 불러오거나 리로드가 이전 모듈을 쓴다 | L-01 스파이크를 M0 첫 작업으로 둔다. A안 불가면 B안(jiti)으로 바꾼다. 핫 리로드는 개발용(M2 이후)으로 한정하고, 실패하면 "호스트 재시작" 안내로 대체한다. 격리 확장은 프로세스 재시작이라 영향이 없다 |
| JSON 직렬화가 안 되는 페이로드가 지점에 있다 | 격리 확장이 일부 지점을 쓸 수 없거나 직렬화 오류가 실행 중에 난다 | `isolatablePoints()`를 `POINTS` 스키마에서 계산해 로드 시점(격리 확장 검사)에 거부한다. 고빈도 휘발 지점 3개는 고정 제외. F.extensions.plan M2의 페이로드 정확화 때 목록을 다시 계산하는 테스트를 둔다 |
| pi 어댑터 범위 팽창 | 지원 요청이 늘면서 어댑터가 pi coding-agent 재구현이 된다 | 스펙 §4.10.4 지원 표를 범위 고정선으로 쓴다. 표에 없는 멤버는 비지원이고, 범위를 늘리려면 스펙 표를 먼저 고친다. `pi-compat-table.test.ts`가 표와 구현의 차이를 잡는다. TUI 계열과 명령 전용 제어는 비지원으로 고정한다 |
| 격리 프로세스 수명이 서비스 모드와 충돌 | 유휴 종료가 자식 프로세스를 남기거나, 자식이 남아 있어 유휴 판정이 계속 거짓이 된다 | 자식 기동·종료는 platform-process 서비스로만 한다. `dispose`는 `xeon/iso.dispose` → 유예 → `SIGKILL` 순서를 지킨다. 격리 자식은 유휴 판정의 live 작업으로 세지 않는다 [제안]. adr.0006 §3.7 체크리스트 작업자와 판정 규칙을 맞춘다 |
| `Bun.plugin` 가상 모듈이 프로세스 전역이다 | Xeon 패키지가 같은 지정자를 import할 때 다른 모듈 인스턴스를 받을 수 있다 | L-01 (d)에서 인스턴스 동일성을 확인한다. 실체를 소유 패키지가 등록하므로 같은 인스턴스를 넘긴다. 다르면 pi 확장 import에만 적용되는 해석 경로(B안)로 바꾼다 |
| X.primitives의 `ExtHost.install`(P-13)이나 X.operations의 `admit`(O-03)이 늦는다 | M0의 L-06, L-07이 막힌다 | 스펙 §4.4.3 표를 기준으로 가짜 `ExtHost`·가짜 정책으로 구현을 끝낸다. 연결은 두 산출물이 나온 뒤 한다 |
| 프로젝트 설정 적용 제외 규칙(스펙 §4.7.4)을 L1.persistence가 구현하지 않는다 | 신뢰 전 프로젝트 `ext.*` 값이 적용되어 확장이 켜지거나 꺼진다 | 로더가 유효 값을 읽을 때 프로젝트·로컬 범위를 빼는 필터를 자기 쪽에도 둔다(이중 방어). 통합 테스트에 프로젝트 설정 파일을 넣어 확인한다 |
