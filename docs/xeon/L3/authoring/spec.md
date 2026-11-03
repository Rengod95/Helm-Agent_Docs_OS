---
id: L3.authoring.spec
layer: L3
domain: authoring
kind: spec
status: draft
depends_on: [L3.group-sdk.spec, L3.slots.spec, F.extensions.spec, F.wire-settings.spec, X.loading-trust.spec, X.primitives.spec, X.operations.spec, adr.0018, adr.0021, L4.desktop-ux.spec, architecture.security.spec]
binds: [xeon/packages/plugin-builder/**]
---

# L3 플러그인 Plugin Builder (authoring)

에이전트가 층별 플러그인과 플러그인 그룹을 만들 때 쓰는 Plugin Builder입니다. 뼈대 만들기, 구성 검사, 시험, 재생, 패키징을 한 흐름으로 묶습니다. 고정된 템플릿 묶음 대신, 구현과 보안 항목이 바뀔 때마다 갱신되는 "종류 카탈로그"를 둡니다.

- [결정: 2026-10-31 사용자] 템플릿 묶음을 고정하지 않습니다. 구현과 보안 항목이 들어올 때마다 계속 갱신합니다. 정적 템플릿보다 "플러그인을 만드는 플러그인"(에이전트가 뼈대, 검사, 시험에 쓰는 Plugin Builder나 그룹)을 우선합니다(`L4.desktop-ux.spec` §12.3 U-8).
- [결정: 2026-10-31 사용자] 플러그인 화면 모드(선언형, 격리 프레임)는 플러그인을 만드는 에이전트가 고릅니다(ADR-0021 §3.5).
- 이 문서는 M4 착수용 초안입니다. 이름과 경계는 대부분 [제안]이고 정본 이름은 F와 X가 정합니다.

## 1. 목적과 범위

### 1.1 정하는 것

- Plugin Builder의 역할과 형태(L3 플러그인 그룹 하나, 이름 `authoring`)
- Plugin Builder가 쓰는 기능: 뼈대 만들기, 구성 검사, Test run, 개발 모드 재생, 패키징, 설치 연결
- 종류 카탈로그(kind catalog)의 모양, 갱신 규칙, 열린 확장 방식
- 데스크톱 구성기(`L4.desktop-ux.spec` P-21)와 플러그인 화면 모드(ADR-0021)와의 관계
- 제작 중 안전 규칙(쓰기 범위, 사람 확인, 등급)

### 1.2 다루지 않는 것

- 매니페스트 스키마, `validateManifest`·`validateUsage`·`validateComposition` 함수의 정의: `F.extensions.spec`
- `defineGroup`, `replayDrive`, `scanDriveSource`: `L3.group-sdk.spec`
- 기존 그룹 템플릿 세 종류의 파일 내용: `L3.slots.spec` §3.3. 이 문서는 그 템플릿을 카탈로그의 첫 항목으로 씁니다.
- 화면(구성기, 시험 실행)의 모양: `L4.desktop-ux.spec` §6.26, §6.28
- `fresnel group new` 명령: `L4.cli.spec`. Plugin Builder가 생기면 이 명령은 같은 서비스를 부르는 얇은 진입점이 됩니다(§4.5).

### 1.3 이 도메인을 L3에 두는 이유

- 제작 흐름은 플러그인 그룹의 모양 그대로입니다. 모델 도구로 작업하고, 작업 단계를 상태로 커밋하고, 위험한 단계(설치, 패키징) 앞에서 사람 확인을 받고, 제작 중 쓰기 범위를 `on`(first) 가드로 막아야 합니다. 이 강제는 스킬 문서로는 할 수 없습니다(`L3.readme` §1 "모델의 행동을 코드로 막거나 구동해야 할 때만 그룹").
- 데스크톱 화면 안의 기능으로만 두면 CLI와 서비스 모드에서 에이전트가 같은 흐름을 쓸 수 없습니다. Plugin Builder는 런타임 부품이고 화면은 그 위의 보기입니다.
- 별도 도메인 문서(spec, plan)와 `routes.yaml` layout 항목이 있어야 구현 작업자가 `docs-route`로 이 문서를 받습니다. `L3.slots.spec`(코드 없음, 템플릿 규칙)과 겹치지 않게, slots는 템플릿 내용 규칙을, 이 문서는 템플릿을 고르고 채우고 검사하고 시험하는 흐름을 맡습니다.
- `L3/README.md` 도메인 표에 이 도메인을 더하는 일은 README 수정 금지라 사용자 몫으로 남깁니다(§10 미결 1).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| Plugin Builder | 이 문서의 L3 그룹 `authoring`. 사용자 화면에서는 "제작"이라 부릅니다 |
| 제작 대화 | 플러그인 하나를 만드는 동안의 상태(대상 폴더, 종류, 구성 초안, 검사 결과, 시험 기록). 대화 하나에 묶입니다 |
| 종류(kind) | 만들 수 있는 플러그인 모양 하나. 예: 플러그인 그룹 drive, 정책 플러그인, L2 provider, 선언형 화면, 프레임 화면. 확장 수준의 구분은 `group` 선언 유무로 한다. wire `ext.kinds`는 `single-plugin`과 `plugin-group`을 돌려주며 스키마는 T-F가 정한다 [미결] |
| 종류 카탈로그 | 종류 항목의 목록과 각 항목의 템플릿, 필수 검사, 보안 메모, 지원 범위 |
| 구성 초안 | 매니페스트 `composition`(`L4.desktop-ux.spec` §10.3 X-16)과 같은 모양의 블록 목록. 구성기와 Plugin Builder가 같은 형식을 씁니다 |
| 제작 검사 | `AU-NNN` 번호를 가진 검사 규칙. F 검사 함수 결과에 제작 전용 규칙을 더합니다 |
| 개발 모드 | 저장소 스크립트와 시험 하니스를 쓸 수 있는 실행 형태. replay, benchmark, 코어 변경 검사는 개발 모드에서만 돕니다(`L4.desktop-ux.spec` §12.3 U-4) |

## 3. 인터페이스

### 3.1 형태

[제안] Plugin Builder는 내장 L3 플러그인 그룹입니다.

| 항목 | 값 |
|---|---|
| 이름 | `authoring`(예약 이름과 겹치지 않음, `RESERVED_GROUP_NAMES`) |
| 패키지 | `xeon/packages/plugin-builder` |
| 층과 선언 | 루트 플러그인 `plugins[0].layer: "L3"`, `group: {}` 선언(플러그인 그룹) |
| 신뢰 | `builtin`(앱에 듦). 학습 그룹과 같은 배포 방식 |
| 기본 켜짐 | 꺼짐. LightCraft 구성의 "새 그룹", 슬래시 명령 `/author`, 모델 도구 첫 사용 안내로 켭니다 |
| drive | 씀. 제작 대화 단계 머신(§4.1)을 drive로 돌립니다. 사람 확인은 drive 원시 `loop.ask`(X-17)를 씁니다 |
| 훅 | `tool.call.before`(first, 쓰기 범위 가드), `thread.start`(tap, 대화 복원) |
| 화면 기여 | 선언형 `page` "제작"(대화 단계, 검사, 시험 결과), `well` "제작"(요약), `card` `authoring/result`(검사·시험 결과), `command` 둘 |
| 구성요소 | 스킬 `authoring-guide`(종류 고르기, 모드 고르기, 보안 규칙), 명령 `/author` |

### 3.2 모델 도구

[제안] 그룹이 등록하는 도구입니다(`GroupApi.registerTool`). 이름은 `authoring_` 접두입니다.

| 도구 | 입력 | 결과 | 위험 |
|---|---|---|---|
| `authoring_kinds` | `{ layer?, query? }` | 카탈로그 항목 요약(종류 id, 설명, 상태, 필요한 결정) | 읽기 |
| `authoring_start` | `{ kind, name, dir, displayName? }` | 제작 대화 id, 이름 검사 결과 | 읽기 |
| `authoring_compose` | `{ sessionId, composition }` | 구성 초안 저장, `validateComposition` 결과 | 상태만 |
| `authoring_scaffold` | `{ sessionId, views?: { slot, mode }[] }` | 만든 파일 목록과 패치 | 쓰기(대상 폴더 안) |
| `authoring_validate` | `{ sessionId }` | `ManifestIssue[]`와 `AU-NNN` 결과 | 읽기 |
| `authoring_trial` | `{ sessionId, profile?, prompt }` | Test run id, 진행 위치 | Test run 생성 |
| `authoring_replay` | `{ sessionId, maxCommits? }` | `ReplayDriveReport`(개발 모드만) | 실행 |
| `authoring_package` | `{ sessionId, out? }` | 패키지 경로, 내용 목록, 해시 | 쓰기 + 사람 확인 |
| `authoring_install` | `{ sessionId, scope: "user" }` | 설치 위치 연결 결과 | 사람 확인 |

- 모든 도구는 같은 서비스 `fresnel.devkit`(§3.3)을 부릅니다. 도구는 입력 검사, 대화 상태 커밋, 결과 요약만 합니다.
- 화면(구성기, 시험 실행)도 wire로 같은 서비스를 부릅니다(`L4.desktop-ux.spec` W-27, W-28, W-29, W-47, W-49). 그래서 에이전트와 사용자가 같은 검사와 같은 뼈대를 얻습니다.

### 3.3 서비스 `fresnel.devkit`

[제안] 제작에 필요한 특권 동작을 F 서비스 계약으로 둡니다. 구현은 `apps/host`(L4)가 하고 그룹에는 DI로 줍니다. L3가 L4를 import하지 않게 하는 방식이고, `ApprovalService`를 L2가 쓰는 방식과 같습니다.

```ts
// 개념 모양. 정본은 F.extensions.spec 또는 F services/devkit.ts [제안]
interface DevkitService {
  kinds(): Promise<readonly KindEntry[]>;
  scaffold(input: ScaffoldInput): Promise<Result<ScaffoldResult, DevkitError>>;
  validate(dir: string): Promise<Result<ValidationReport, DevkitError>>;
  validateComposition(composition: CompositionDecl): ValidationReport;
  trial(input: TrialInput): Promise<Result<TrialHandle, DevkitError>>;
  replay(input: ReplayInput): Promise<Result<ReplayDriveReport, DevkitError>>;   // 개발 모드가 아니면 err({ kind: "dev_mode_required" })
  pack(input: PackInput): Promise<Result<PackResult, DevkitError>>;
  link(input: LinkInput): Promise<Result<LinkResult, DevkitError>>;              // 사용자 확장 위치에 연결(W-32)
}
```

- `validate`는 F `validateManifest`, `validateUsage`, `validateComposition`, group-sdk `scanDriveSource`, ADR-0021 화면 규칙, 카탈로그 항목의 필수 검사를 차례로 돌린 결과입니다.
- `trial`은 Test run을 만듭니다(`thread.create { trial: true }`, W-34). Test run은 대상 확장을 `session` 범위로 켜고, 학습 그룹 리뷰에서 빠지며(X-14), 단계 경계 멈춤(W-48)을 쓸 수 있습니다.
- `pack`은 확장 폴더를 설치 가능한 묶음(폴더 사본 또는 tar)으로 만들고 파일 목록과 SHA-256을 돌려줍니다. 원본 폴더 밖 파일, 시크릿처럼 보이는 파일(`.env`, 키 파일 이름 패턴)을 넣지 않습니다.
- [결정: M4 T-AUTH] 구현은 `xeon/packages/plugin-builder`의 함수(`scaffoldExtension`, `validateExtensionDir`, `validateCompositionReport`, `packExtension`, `installExtension`, `removeExtension`)이고 `apps/host`의 `assembly/m4/devkit-port.ts`가 wire에 연결합니다.
- [결정: M4 T-AUTH] `pack`은 엔트리를 한 파일 `dist/index.js`로 번들하고 묶음 매니페스트의 `entry`를 `./dist/index.js`로 바꿉니다. 호스트가 같은 인스턴스를 주는 SDK 모듈(`SDK_MODULE_SPECIFIERS`)은 번들에 넣지 않고 외부 import로 둡니다. `ext.reload`는 한 파일 번들 엔트리만 완전히 다시 읽기 때문입니다(여러 파일 소스는 옛 상대 import가 모듈 캐시에 남습니다). `link`는 `.js`·`.mjs` 엔트리만 받고 `.ts` 소스 폴더는 `invalid_input`으로 돌려 먼저 `pack`하게 합니다. 번들이 한 파일이 아니면 `pack`이 실패합니다.
- [결정: M4 T-AUTH] `pack` 출력은 기본 `<dir>/dist/package`(다시 만들면 비우고 씁니다)이고, 지정한 `out`은 없거나 비어 있어야 합니다(`exists`). 묶음 형식은 폴더 사본이고 `sha256`은 정렬한 `경로 NUL 파일해시` 줄들의 해시입니다(§10 4번은 그대로 미결). 묶음 최상위의 `src`, `test`, `node_modules`, `dist`, `package.json`, `tsconfig.json`과 비밀 이름(`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_*`, `credentials*`)은 넣지 않습니다.
- [결정: M4 T-AUTH] `link`는 `<확장 위치>/<이름>`을 임시 폴더에 복사한 뒤 바꿔 놓습니다. 같은 이름이 있으면 바꾸고(`replaced`) 새 버전은 `ext.reload`가 단계 경계에서 적용합니다. `remove`는 폴더를 지웁니다.
- [결정: M4 T-AUTH] `scaffold`의 그룹 템플릿(drive, policy, observe)은 구성 초안으로 고릅니다: drive 블록이 있거나 초안이 없으면 drive, 모든 `on` 블록이 `tool.call.before`뿐이면 policy, 아니면 observe. 초안과 `ui`와 `group.members`는 매니페스트에 패치하고(루트 플러그인 `hooks`는 초안의 훅을 합치고 drive 블록이 있으면 `drives: true`), 패치할 것이 없으면 템플릿 글자 그대로 씁니다. 대상 폴더는 절대 경로이고 없거나 비어 있어야 하며 실패하면 파일을 쓰지 않습니다. 템플릿 위치는 `FRESNEL_GROUP_TEMPLATES_DIR`, 릴리즈 자원 폴더, 소스 저장소 순으로 찾습니다.

### 3.4 종류 카탈로그

[제안] 카탈로그는 데이터입니다. Plugin Builder 패키지의 `catalog/kinds/<종류 id>.json` 파일 하나가 항목 하나입니다.

```ts
// 개념 모양
interface KindEntry {
  readonly id: string;                         // 예 "group.drive", "plugin.l2-provider", "view.frame"
  readonly title: string;                      // 메시지 키
  readonly layer: "L1" | "L2" | "L3" | "plugin" | "X";
  readonly status: "stable" | "preview" | "blocked" | "deprecated";
  readonly since: string;                      // 카탈로그 버전
  readonly requires: { readonly contracts: string; readonly bridge?: string; readonly widgets?: string };  // SemVer 범위
  readonly template?: string;                  // 템플릿 폴더. group.* 는 group-sdk/templates 를 가리킴
  readonly checks: readonly string[];          // AU-NNN 목록
  readonly decisions: readonly string[];       // 에이전트가 정해야 할 것(예 "views.mode", "drives")
  readonly security: readonly string[];        // 보안 메모 키(예 "frame.reason", "trust.project.noFrame")
  readonly blockedReason?: string;             // status = blocked 일 때
}
```

- [결정: M4 T-AUTH] wire `ext.kinds`의 `KindEntry.id`는 T-F 계약이 `single-plugin`과 `plugin-group` 둘로 정했으므로, M4 카탈로그 항목은 그 둘이고 아래 표의 `group.drive`·`group.policy`·`group.observe`는 `plugin-group` 항목의 템플릿 선택지입니다. 카탈로그는 JSON 파일이 아니라 타입이 붙은 데이터(`catalog.ts`의 `KIND_CATALOG`)입니다. 화면 종류(`view.*`)와 `plugin.l2-provider`, `plugin.tool`, `x.hook` 항목은 계약이 종류 id를 늘릴 때(T-F) 더합니다. 적합성 시험은 `catalogConformance`입니다.

M4 첫 카탈로그 [제안]:

| 종류 id | 층 | 상태 | 템플릿 | 비고 |
|---|---|---|---|---|
| `group.drive` | L3 | stable | `group-sdk/templates` drive | 구성 초안의 단계 선언(`composition.phases`)을 채움 |
| `group.policy` | L3 | stable | policy | |
| `group.observe` | L3 | stable | observe | |
| `view.declarative` | 화면 | stable | 화면 트리 뼈대 | 다른 종류에 덧붙는 종류 |
| `view.frame` | 화면 | preview | 프레임 폴더 뼈대, 다리 래퍼 | ADR-0021 §6 미결 1 확인 전에는 blocked |
| `plugin.l2-provider` | L2 | preview | provider 뼈대 | 기능 계약(`F.capabilities.spec`)의 provider 등록 |
| `plugin.tool` | plugin | preview | 도구 등록 뼈대 | |
| `x.hook` | X | blocked | 없음 | 외부 훅 프로토콜(M4 N14) 확정 뒤 |

- 상태가 `blocked`인 항목은 `authoring_kinds`에 보이되 `authoring_start`가 거부하고 사유를 돌려줍니다. 화면에서는 "준비 중"으로 보입니다.
- 카탈로그에 없는 모양이 필요하면 에이전트는 가장 가까운 종류로 시작하고 차이를 대화 메모에 남깁니다. 사용자 로컬 카탈로그(§4.4)에 초안 항목을 더할 수도 있습니다.

### 3.5 제작 검사(`AU-NNN`)

[제안] F 검사 결과(`ManifestIssueCode`)는 그대로 보이고, 아래는 Plugin Builder가 더하는 검사입니다. 번호는 지우지 않고 `deprecated`로만 바꿉니다.

| id | 검사 | 수준 |
|---|---|---|
| AU-001 | 이름 규칙과 예약 이름, 설치된 이름과의 충돌 | 오류 |
| AU-002 | 요청 신뢰 등급이 `builtin`이면 거부(외부 제작물은 `user`나 `project`) | 오류 |
| AU-003 | `composition`이 매니페스트 `plugins[]`의 `hooks`, `drives`, `usesPost`, `requires`, `optional`과 맞음 | 오류 |
| AU-004 | drive 블록 둘(`drive_duplicate`), on 핸들러의 기능 호출(`on_capability_call`), 필수 기능의 제공자 없음(`capability_missing`) | 오류, 오류, 경고 |
| AU-005 | 화면: `frame`은 `page`·`well`만, `frame.reason` 있음, `widgets`·`bridge` 범위가 지금 앱과 맞음 | 오류 |
| AU-006 | 화면: 요청 등급 `project`인데 `frame` 사용 | 경고(설치 환경의 `x.views.allowProjectFrames`에 따름) |
| AU-007 | 화면: 프레임 화면에 `fallback`도 `cli.command`도 없음 | 경고 |
| AU-008 | 화면: 위젯 카탈로그로 그릴 수 있는 모양을 프레임으로 냄(트리 후보가 있음) | 정보 |
| AU-009 | 시크릿: 설정에 시크릿처럼 보이는 키가 `secret: true` 없이 있음, 소스에 시크릿 리터럴 패턴 | 오류 |
| AU-010 | 사람 확인이 필요한 단계(외부 쓰기, 비용)에 `loop.ask` 또는 `approval: true`가 없음 | 경고 |
| AU-011 | 상태 스키마 `version`과 마이그레이션 훅(`L3.group-sdk.spec` §4.7) | 경고 |
| AU-012 | 재생 규율: `scanDriveSource` 위반 | 오류 |

- [결정: M4 T-AUTH] 구현한 규칙: AU-001(이름 규칙과 예약 이름, 설치된 이름과 충돌), AU-002, AU-003(`validateManifest`·`validateComposition`의 구성 검사가 담당), AU-006, AU-007, AU-009(소스의 시크릿 리터럴 패턴), AU-012(`scanDriveSource`). AU-005는 F `validateUi`의 `ui_mode_not_allowed`·`ui_reason_empty`가 담당합니다. 아직 없는 규칙: AU-004 일부, AU-008, AU-010, AU-011.

## 4. 동작 규칙

### 4.1 제작 대화 단계

[제안] drive 단계 머신입니다. 모든 전이는 단계 경계에서 커밋됩니다.

```text
idle → intent → compose → scaffold → validate ⇄ fix → trial → (replay: 개발 모드만) → package → done
                                     ↑___________________|
```

| 단계 | 하는 일 | 사람 확인 |
|---|---|---|
| intent | 사용자 요구를 종류 하나와 결정 목록으로 정리. 스킬 `authoring-guide`의 판정 기준(그룹으로 만들지, `L3.slots.spec` §3.1.1)을 씀 | 종류와 이름 확인(`loop.ask`) |
| compose | 구성 초안을 만들거나 구성기에서 받은 초안을 읽음 | 없음 |
| scaffold | 템플릿 복사, 치환, 구성 초안에서 매니페스트 필드와 `setup` 등록 줄 패치 | 없음(대상 폴더 안) |
| validate, fix | 검사, 고치기 반복. 같은 오류가 3번 남으면 멈추고 사용자에게 물음 | 반복 한도 도달 때 |
| trial | Test run에서 대상을 켜고 프롬프트를 보냄. 결과를 대화에 요약 | 시험 시작 전(비용) |
| replay | 개발 모드면 `replayDrive`. 배포 앱은 건너뛰고 "개발 모드에서 확인 필요" 표시 | 없음 |
| package | 묶음 만들기, 사용자 위치 연결 | 묶기 전, 연결 전(`loop.ask`) |

- 사람 확인을 기다리는 동안 drive 락을 반납합니다(X-17, `L4.desktop-ux.spec` §12.4 C-8). 답이 오면 다시 후보가 되어 같은 단계에서 이어 갑니다.
- 단계와 상관없이 사용자는 `/author stop`으로 대화를 멈출 수 있습니다. 만든 파일은 지우지 않습니다.

### 4.2 쓰기 범위 가드

- [제안] 제작 대화가 열려 있는 동안 `tool.call.before`(first)는 쓰기 도구(`write`, `edit`, 셸 실행의 쓰기)를 대상 폴더 안으로 제한합니다. 밖이면 거부하고 이유를 돌려줍니다.
- 사용자 확장 위치, 관리 위치, 앱 자원 폴더에 직접 쓰지 않습니다. 설치는 `fresnel.devkit.link`(사람 확인 뒤)만 합니다.
- 가드는 대화가 끝나면 풀립니다. Plugin Builder가 꺼져도 풀립니다.

### 4.3 구성기와 화면 모드와의 관계

- 구성기(`L4.desktop-ux.spec` §6.28)는 구성 초안을 편집하고 `ext.validateComposition`(W-47)으로 검사합니다. "새 그룹"은 구성기에서 초안을 만든 뒤 "제작 확장으로 만들기"를 누르면 제작 대화를 열어 그 초안을 넘깁니다(`authoring_compose`). 반대로 에이전트가 만든 초안은 구성기에서 읽기 전용으로 열 수 있습니다.
- 구성기는 구조를 편집하는 유일한 화면입니다. 런타임 캔버스는 운영(켜기, 끄기, 덮어쓰기)만 합니다(`L4.desktop-ux.spec` §12.4 C-2).
- 화면 기여가 있는 플러그인은 `authoring_scaffold`의 `views` 인자로 slot과 모드를 받습니다. 에이전트는 ADR-0021 §3.5 표로 모드를 고르고, 프레임이면 `frame.reason`을 씁니다. AU-005~AU-008이 그 선택을 검사합니다.

### 4.4 카탈로그 갱신과 열린 확장

[결정: 2026-10-31 사용자] 템플릿 묶음은 고정하지 않고 구현·보안 변경에 맞춰 갱신합니다. 갱신 규칙 [제안]:

1. 카탈로그는 Plugin Builder 패키지와 같은 버전으로 배포합니다. `catalogVersion`이 화면 머리와 `authoring_kinds` 결과에 보입니다.
2. 적합성 시험: 카탈로그 시험은 모든 항목을 실제로 뼈대로 만들고 `validate`를 통과하는지 봅니다. F 훅 표(`HOOKS`), 매니페스트 스키마, 위젯 카탈로그, 다리 버전이 바뀌어 항목이 깨지면 시험이 실패합니다. F·X·L4 트랙은 이 시험을 끝 시험에 넣습니다.
3. 보안 항목이 들어오면(`architecture.security.spec` §4의 새 T 행, X 등급 규칙 변경) 같은 커밋에서 `AU-NNN` 규칙이나 항목의 `security` 메모를 더합니다. 검토 담당은 T 행마다 대응 AU 규칙이 있는지 확인합니다.
4. 지원 범위가 바뀐 항목은 상태를 `preview` → `stable`, `stable` → `deprecated`로 옮기고 `since`를 갱신합니다. 지우지 않습니다.
5. 사용자 로컬 카탈로그: `~/.fresnel/authoring/kinds/*.json`(경로는 `L0.os.spec` 데이터 폴더 규칙) [제안]. 에이전트가 새 모양을 만들면 여기에 `status: "preview"`, `origin: "local"` 항목을 더할 수 있습니다. 로컬 항목은 내장 항목을 가리지 못하고, 같은 id면 내장이 이깁니다.
6. 프레임 화면 모양이 여러 제작물에서 되풀이되면(AU-008 정보 수집) 위젯 카탈로그 후보 목록 `catalog/widget-candidates.json`에 기록합니다. 이 목록은 caustic 간극(`L4.desktop-ux.spec` §9)과 위젯 카탈로그 확장의 입력입니다.

### 4.5 CLI와의 관계

- `fresnel group new`는 `fresnel.devkit.scaffold`를 부르는 진입점이 됩니다(엔진이 떠 있으면 wire, 아니면 같은 F 함수와 템플릿 파일로 로컬 실행). 결과 파일은 지금과 같아야 합니다(`L3.slots.spec` §3.3.6 R1~R6).
- `fresnel author <명령>` [제안]은 제작 대화를 CLI에서 엽니다. 모델 없이 `scaffold`, `validate`, `pack`만 쓰는 모드도 둡니다.

## 5. 실패와 경계 사례

| 경우 | 동작 |
|---|---|
| 대상 폴더가 비어 있지 않음 | `scaffold` 거부(`dir_not_empty`). 기존 제작물을 고치려면 `authoring_start { dir }`가 매니페스트를 읽어 대화를 이어 감 |
| 검사 실패 상태로 패키징 요청 | 거부. 경고만 있으면 사람 확인에 경고 목록을 보임 |
| 배포 앱에서 replay 요청 | `dev_mode_required`. 대화에 "개발 모드 확인 필요" 표시 |
| Test run에서 대상이 자동 꺼짐 | 시험을 멈추고 실패 장부를 대화에 붙임. 고친 뒤 `ext.reenable`(W-21)로 다시 시험 |
| 카탈로그 항목이 `blocked` | `authoring_start` 거부와 `blockedReason` |
| 엔진 재시작 | 대화 상태는 그룹 상태 문서에 있어 `thread.start`에서 복원. 진행 중 Test run은 그대로 남음 |
| 안전 모드 | Plugin Builder는 내장 L3 플러그인 그룹이라 빠짐. `fresnel group new`와 `fresnel author scaffold`(모델 없음)는 동작 |

## 6. 설정 노출

| 키 | 기본 | 범위 | 뜻 |
|---|---|---|---|
| `l3.authoring.enabled` | `false` | user, project, launch | Plugin Builder 켜기(일반 `ext.<id>.enabled` 규칙과 같음) [제안] |
| `l3.authoring.devMode` | 앱 형태에 따름 | managed, user | 개발 모드 동작(replay, benchmark) 허용. 배포 앱에서는 저장소 경로가 있어야 켜짐 |
| `l3.authoring.fixLoopLimit` | `3` | user, launch | 같은 검사 오류가 남는 고치기 반복 한도 |
| `l3.authoring.localCatalog` | `true` | user | 사용자 로컬 카탈로그 읽기 |

## 7. 훅

| 훅 | fold | 쓰임 |
|---|---|---|
| `tool.call.before` | first | 쓰기 범위 가드(§4.2) |
| `thread.start` | tap | 대화 복원 |
| drive | | 제작 대화 단계 머신. 사람 확인은 `loop.ask`(X-17) |

## 8. 다른 문서와의 인터페이스

| 문서 | 관계 |
|---|---|
| `F.extensions.spec` | 요구: `composition` 필드와 `validateComposition`(X-16), `views` 두 모드(ADR-0021), 서비스 `fresnel.devkit` 계약 |
| `X.primitives.spec` | 요구: `loop.ask`와 반납 사유 `waiting`(X-17), Test run 단계 경계 멈춤(X-19) |
| `L3.group-sdk.spec` | 받음: `defineGroup`, `replayDrive`, `scanDriveSource`, 템플릿 폴더. 요구: `defineGroup({ composition })` 채움 |
| `L3.slots.spec` | 받음: 템플릿 세 종류와 이름 규칙. 카탈로그 첫 항목 |
| `L4.desktop-ux.spec` | 제공: 구성기 "새 그룹"의 실행 흐름, 시험 실행의 제작 시험. 요구: W-27~W-29, W-34, W-47~W-49 |
| `L4.cli.spec` | 제공: `fresnel group new`가 부를 서비스 |
| ADR-0021 | 받음: 모드 고르기 기준과 등급표. 제공: AU-005~AU-008 검사 |
| `architecture.security.spec` | 받음: T 행. 갱신 규칙 §4.4 3번 |

## 9. 수용 기준

- A-1. 카탈로그의 `stable`·`preview` 항목마다 뼈대를 만들면 `validate`가 오류 0으로 통과합니다(카탈로그 적합성 시험).
- A-2. `group.drive`·`group.policy`·`group.observe`로 만든 파일이 `fresnel group new`의 결과와 같고 `core-diff-check`에서 보호 경로 변경 0줄입니다.
- A-3. 제작 대화에서 대상 폴더 밖 쓰기 도구 호출이 거부됩니다.
- A-4. `authoring_package`와 `authoring_install`은 사람 확인 없이는 파일을 쓰지 않고, 확인을 기다리는 동안 그 대화의 drive 락이 반납된 상태입니다.
- A-5. 배포 앱 형태에서 `authoring_replay`가 `dev_mode_required`를 돌려줍니다.
- A-6. 화면 기여가 있는 시험 플러그인 하나(선언형 `well` + 프레임 `page`)를 만들면 AU-005가 통과하고, 프레임 금지 설정에서 `fallback`이 그려집니다.
- A-7. F 훅 하나의 이름을 바꾸는 가짜 변경에서 카탈로그 적합성 시험이 실패합니다.

## 10. 미결 사항

1. [미결] `L3/README.md` 도메인 표에 `authoring`을 더하는 일(README 수정 금지라 사용자 몫).
2. [미결] 서비스 `fresnel.devkit`의 정본 위치(F `services/devkit.ts` [제안])와 L4 구현 위치(`apps/host`).
3. [미결] Plugin Builder를 기본 켬으로 둘지. 이 문서는 꺼짐을 기본값으로 둡니다.
4. [미결] 묶음 형식(폴더 사본, tar, 서명). 서명은 릴리즈 서명(`L4.release.spec`)과 함께 정합니다.
5. [미결] 사용자 로컬 카탈로그 경로와, 로컬 항목을 다른 기기와 나눌지.
6. [미결] 배포 앱에서 개발 모드를 켜는 조건(저장소 경로 설정, 시험 하니스 번들 여부). `L4.desktop-ux.spec` §12.3 U-4는 "개발 모드에서만"입니다.
