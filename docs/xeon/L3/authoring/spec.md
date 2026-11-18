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
- Plugin Builder가 쓰는 기능: 뼈대 만들기, 구성 검사, Test run, 개발 모드 재생, 패키징, 검토함 제출(M5c §4.9)
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

- 제작 흐름은 플러그인 그룹의 모양 그대로입니다. 모델 도구로 작업하고, 작업 단계를 상태로 커밋하고, 위험한 단계(패키징) 앞에서 사람 확인을 받고(검토함 제출은 확인을 묻지 않는다: 승인은 검토함에서 사용자가 한다, M5c §4.9), 제작 중 쓰기 범위를 `on`(first) 가드로 막아야 합니다. 이 강제는 스킬 문서로는 할 수 없습니다(`L3.readme` §1 "모델의 행동을 코드로 막거나 구동해야 할 때만 그룹").
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
| 기본 켜짐 | 켜짐. 도구 열한 개가 모두 지연 노출(`exposure: "deferred"`)이라 켜 두어도 "hi" 턴의 문맥은 늘지 않고 모델은 `tool_search`로 찾습니다 [결정: 2026-11-13 사용자, 2026-11-01 결정을 대체]. 안전 모드와 `defaultGroups: false`에서는 싣지 않고, 사용자가 `ext.authoring.enabled`를 명시적으로 끈 설정은 존중합니다 |
| drive | 씀. 제작 대화 단계 머신(§4.1)을 주도 단계 함수로 돌립니다. 사람 확인은 `ask` 명령(X-17, drive-isolation.md §1.1)을 씁니다 |
| 훅 | `tool.call.before`(first, 쓰기 범위 가드), `thread.start`(tap, 대화 복원) |
| 화면 기여 | 선언형 `page` "제작"(대화 단계, 검사, 시험 결과), `well` "제작"(요약), `card` `authoring/result`(검사·시험 결과), `command` 둘 |
| 구성요소 | 스킬 `authoring-guide`(종류 고르기, 모드 고르기, 보안 규칙), 명령 `/author` |

### 3.2 모델 도구

[제안] 그룹이 등록하는 도구입니다(`GroupApi.registerTool`). 이름은 `authoring_` 접두입니다.

| 도구 | 입력 | 결과 | 위험 |
|---|---|---|---|
| `authoring_kinds` | `{ layer?, query? }` | 카탈로그 항목 요약(종류 id, 설명, 상태, 필요한 결정) | 읽기 |
| `authoring_start` | `{ kind, name, dir, displayName? }` | 제작 대화 id, 이름 검사 결과. 주도 시작 요청(`g.startDrive`)을 먼저 내고, 거부되면 `drive_unavailable`로 대화를 열지 않는다 | 읽기 |
| `authoring_compose` | `{ sessionId, composition }` | 구성 초안 저장, `validateComposition` 결과 | 상태만 |
| `authoring_scaffold` | `{ sessionId, views?: { slot, mode }[] }` | 만든 파일 목록과 패치 | 쓰기(대상 폴더 안) |
| `authoring_validate` | `{ sessionId }` | `ManifestIssue[]`와 `AU-NNN` 결과 | 읽기 |
| `authoring_trial` | `{ sessionId, profile?, prompt }` | Test run id, 진행 위치 | Test run 생성 |
| `authoring_replay` | `{ sessionId, maxCommits? }` | `ReplayDriveReport`(개발 모드만) | 실행 |
| `authoring_package` | `{ sessionId, out? }` | 패키지 경로, 내용 목록, 해시 | 쓰기 + 사람 확인 |
| `authoring_submit` | `{ sessionId, purpose?, turnId? }` | 검토함에 올린 `{ draftId, itemId }`와 "검토함에서 승인해야 쓸 수 있다" 한 줄 | 검토 항목 생성(설치 없음, 확인 없음) |
| `authoring_stop` | `{ sessionId? }` | 열린 제작 대화를 닫고(`idle`) 만든 파일 목록을 돌려줌 | 읽기 |

- [결정: M5c §4.9, §7.7 2026-11-18] `authoring_install`은 폐기했다. 빌더의 산출 경로는 `authoring_submit`이다: 테스트의 턴 하나를 증거(`EvidenceRef` `{kind:"turn"}`)로 받아 `fresnel.devkit.submit`(포트 `PluginSubmitPort`)으로 초안과 검토 항목을 만든다. 시험을 돌리지 않았으면 `no_evidence`로 거절하고 `authoring_trial`을 먼저 돌리라고 안내한다. 증거 턴 id는 빌더 상태에 없어 `turnId` 입력으로 받는다([미결]: 테스트 대화의 턴 id를 빌더가 읽는 길은 `authoring_context`(B-4, 엔진 설계 E1)가 준다). `authoring_package`는 `ext.package`가 남아 있으니 한 파일 묶음을 사용자가 보관하는 단독 도구로 남긴다(제출에는 필요 없다). `authoring_compose`와 묶음(`plugin-group`) 구성 검사는 남긴다([미결]: 묶음 템플릿과 카탈로그 적합성 시험이 group-sdk에 묶여 있어 이번 변경에서 빼지 않았다).
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
  submit(input: PluginSubmitRequest): Promise<Result<PluginSubmitResult, DevkitError>>; // 검토함에 올린다(M5c §3.5). 설치하지 않는다
}
```

- `validate`는 F `validateManifest`, `validateUsage`, `validateComposition`, group-sdk `scanDriveSource`, ADR-0021 화면 규칙, 카탈로그 항목의 필수 검사를 차례로 돌린 결과입니다.
- `trial`은 Test run을 만듭니다(`thread.create { trial: true }`, W-34). Test run은 대상 확장을 `launch` 범위로 켜고, 학습 그룹 리뷰에서 빠지며(X-14), 단계 경계 멈춤(W-48)을 쓸 수 있습니다.
- `pack`은 확장 폴더를 설치 가능한 묶음(폴더 사본 또는 tar)으로 만들고 파일 목록과 SHA-256을 돌려줍니다. 원본 폴더 밖 파일, 시크릿처럼 보이는 파일(`.env`, 키 파일 이름 패턴)을 넣지 않습니다.
- [결정: M4 T-AUTH] 구현은 `xeon/packages/plugin-builder`의 함수(`scaffoldExtension`, `validateExtensionDir`, `validateCompositionReport`, `packExtension`, `runInstalledReplay`)이고 `apps/host`의 `assembly/m4/devkit-port.ts`가 wire에 연결합니다.
- [결정: M4 T-AUTH] `pack`은 엔트리를 한 파일 `dist/index.js`로 번들하고 묶음 매니페스트의 `entry`를 `./dist/index.js`로 바꿉니다. 호스트가 같은 인스턴스를 주는 SDK 모듈(`SDK_MODULE_SPECIFIERS`)은 번들에 넣지 않고 외부 import로 둡니다. `ext.reload`는 한 파일 번들 엔트리만 완전히 다시 읽기 때문입니다(여러 파일 소스는 옛 상대 import가 모듈 캐시에 남습니다). `link`는 `.js`·`.mjs` 엔트리만 받고 `.ts` 소스 폴더는 `invalid_input`으로 돌려 먼저 `pack`하게 합니다. 번들이 한 파일이 아니면 `pack`이 실패합니다. 그룹 템플릿은 `defineGroup`이 만든 모듈 객체를 default로 내므로(`GroupModule.entry`가 함수), 묶을 때 가상 진입 파일이 엔트리의 `extension`이나 default를 함수로 맞춰 `extension`과 default로 다시 냅니다(함수면 그대로). 이 맞춤이 없으면 외부 로더가 `entry_not_function`으로 거절합니다. 시험 `authoring.drive-bundle`이 drive 그룹 하나를 묶어 외부 로더로 불러 drive가 도는 것까지 봅니다.
- [결정: M4 T-AUTH] `pack` 출력은 기본 `<dir>/dist/package`(다시 만들면 비우고 씁니다)이고, 지정한 `out`은 없거나 비어 있어야 합니다(`exists`). 묶음 형식은 폴더 사본이고 `sha256`은 정렬한 `경로 NUL 파일해시` 줄들의 해시입니다(§10 4번은 그대로 미결). 묶음 최상위의 `src`, `test`, `node_modules`, `dist`, `package.json`, `tsconfig.json`과 시크릿 이름(`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_*`, `credentials*`)은 넣지 않습니다.
- [폐기: M5c §7.7] `link`(사용자 확장 위치에 복사), `remove`(폴더 지우기), `previewInstall`(설치 미리 보기, `install.ts`), `release.ts`의 설치 확인(`installConfirmation`)과 `LinkInput.expectedSha256`을 지웠다. 설치는 없다. 플러그인은 검토함에서 승인해야 쓸 수 있다(§4.6, M5c 검토 흐름). 제출 입력 검사는 `validateExtensionDir`가 맡는다(플러그인 파일이 없으면 `no_manifest`, 폴더가 없으면 `not_found`).
- [폐기: M5c §7.7] 2026-11-04 Q9의 앱 안 설치 미리 보기와 그 사유 목록(`not_absolute`, `folder_missing`, `unknown_key` 등 설치 거절 사유)은 설치 경로와 함께 지웠다. 제출 경로의 검사 사유는 호스트 `PluginSubmitError`를 `DevkitError.reasons`로 옮긴다(`apps/host/src/assembly/m4/devkit-port.ts`).
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

#### 3.4.1 Plugin App의 셸 기능 다리 API [결정: 2026-11-06 사용자]

`view.frame` 뼈대의 다리 래퍼는 호스트 API 아홉과 셸 기능 여덟을 요청 `{ v: 1, id, op, args }`로 보냅니다(ADR-0021 §3.4, §3.4.3). 셸 기능은 매니페스트 `ui.items[].app.capabilities`에 권한을 적어야 합니다. 적지 않은 권한의 op는 `not_declared`로 돌아옵니다.

| op | 권한 | args | 값 |
|---|---|---|---|
| `pickFile` | `files` | 없음 | `{ name, path, size, encoding, content }` 또는 `null`(취소). 64 MiB 이하. 글이면 `encoding: "utf8"`과 문자열, 아니면 `"base64"` |
| `pickFolder` | `files` | 없음 | `{ name, path, folder }` 또는 `null`. `folder`는 이 화면에서 폴더 안을 볼 핸들 id |
| `listFolder` | `files` | `{ folder, path?, recursive? }` `path`는 고른 폴더 기준 상대 경로 | `{ entries: [{ path, name, kind, size? }], truncated }`. 한 번에 10000개, 깊이 16 |
| `readFolderFile` | `files` | `{ folder, path }` | `pickFile`과 같은 모양. 64 MiB 이하 |
| `saveFile` | `files` | `{ suggestedName, content }` 내용 64 MiB 이하 | `{ saved, path }`(취소면 `path`는 `null`) |
| `notify` | `notify` | `{ title, body? }` 제목 40자, 본문 400자 | `{ shown }`. 분당 30개 |
| `writeSetting` | `settingsWrite` | `{ key, value }` 자기 접두의 선언한 시크릿이 아닌 키 | `null` |
| `registerSecret` | `secrets` | `{ name, value }` 이름은 소문자·숫자·하이픈 24자 이하, `--` 없음 | `null`. 저장 이름은 `ext--<확장>--<name>`. 처음 등록할 때만 확인이 뜸 |

- 창을 여는 op(`pickFile`, `pickFolder`, `saveFile`)와 `registerSecret`의 확인 창은 한 번에 하나입니다. 열려 있는 동안 다시 부르면 `rate_limited`입니다. `writeSetting`은 분당 120번입니다.
- `listFolder`와 `readFolderFile`은 그 화면이 `pickFolder`로 고른 폴더 안만 봅니다. `path`의 `..`, 절대 경로, 밖으로 나가는 링크와 고르지 않은 폴더는 `args_invalid` 또는 `denied`입니다.
- `registerSecret`은 그 확장이 그 이름을 처음 등록할 때만 사용자 확인이 뜨고, 사용자가 거절하면 `denied`(`not_confirmed`)입니다. 이미 등록한 이름의 갱신은 묻지 않습니다.
- 외부 링크는 `navigate`의 `{ target: { kind: "external", url } }`입니다. 확인 줄 뒤 OS 브라우저가 엽니다.
- 재인증, 엔진 재시작·대상 변경·DB 복원, 엔진 직접 연결은 다리에 없습니다.

### 3.5 제작 검사(`AU-NNN`)

[제안] F 검사 결과(`ManifestIssueCode`)는 그대로 보이고, 아래는 Plugin Builder가 더하는 검사입니다. 번호는 지우지 않고 `deprecated`로만 바꿉니다.

| id | 검사 | 수준 |
|---|---|---|
| AU-001 | 이름 규칙과 예약 이름, 설치된 이름과의 충돌 | 오류 |
| AU-002 | 요청 신뢰 등급이 `builtin`이면 거부(외부 제작물은 `user`나 `project`) | 오류 |
| AU-003 | `composition`이 매니페스트 `plugins[]`의 `hooks`, `drives`, `usesPost`, `requires`, `optional`과 맞음 | 오류 |
| AU-004 | drive 블록 둘(`drive_duplicate`), on 핸들러의 기능 호출(`on_capability_call`), 필수 기능의 제공자 없음(`capability_missing`) | 오류, 오류, 경고 |
| AU-005 | 화면: `frame`은 `page`·`well`만, `frame.reason` 있음, `widgets`·`bridge` 범위가 지금 앱과 맞음 | 오류 |
| AU-006 | 화면: 요청 등급 `project`인데 `frame` 사용 | 경고(설치 환경의 `x.ui.allowProjectApps`에 따름) |
| AU-007 | 화면: 프레임 화면에 `fallback`도 `cli.command`도 없음 | 경고 |
| AU-008 | 화면: 위젯 카탈로그로 그릴 수 있는 모양을 프레임으로 냄(트리 후보가 있음) | 정보 |
| AU-009 | 시크릿: 설정에 시크릿처럼 보이는 키가 `secret: true` 없이 있음, 소스에 시크릿 리터럴 패턴 | 오류 |
| AU-010 | 사람 확인이 필요한 단계(외부 쓰기, 비용)에 `loop.ask`·`{ do: "ask" }` 명령 또는 `approval: true`가 없음 | 경고 |
| AU-011 | 상태 스키마 `version`과 마이그레이션 훅(`L3.group-sdk.spec` §4.7) | 경고 |
| AU-012 | 재생 규율: `scanDriveSource` 위반 | 오류(검사기를 넘긴 호출). 릴리즈 바이너리에는 파서가 없어(`@swc/core`는 바이너리에 들어가면 안 됨) 검사가 돌지 않았다는 경고 |

- [결정: M4 T-AUTH] 구현한 규칙: AU-001(이름 규칙과 예약 이름, 설치된 이름과 충돌), AU-002, AU-003(`validateManifest`·`validateComposition`의 구성 검사가 담당), AU-006, AU-007, AU-009(소스의 시크릿 리터럴 패턴), AU-012(`scanDriveSource`). 릴리즈 바이너리에는 파서가 없다(`@swc/core`는 바이너리에 들어가면 안 된다). 그래서 그 바이너리는 검사기를 넘기지 않고, AU-012는 검사가 돌지 않았다는 경고 하나만 낸다. 검사기를 넘긴 호출만 오류 규칙을 받는다. AU-005는 F `validateUi`의 `ui_mode_not_allowed`·`ui_reason_empty`가 담당합니다. AU-004(`drive_duplicate`·`on_capability_call`은 F 구성 검사 결과를 `AU-004`로도 보이고, `capability_missing`은 `validateExtensionDir(dir, { providers })`로 제공자 목록을 받을 때만 경고한다. 호스트는 아직 목록을 주지 않는다), AU-008(Plugin App 화면에 같은 모양을 그린 `fallback` 트리가 있으면 정보. 트리 후보 판정을 그 하나로 둔다), AU-010(소스에 `loop.spawn(`·`.delegate(`·`{ do: "spawn" }`이 있거나 단계 선언에 `spawn` 노드가 있는데 `.ask(`·`{ do: "ask" }`, `human` 노드, 메서드 `approval: true`가 모두 없으면 경고), AU-011(`g.commit(`·`g.state(`나 `{ do: "commit" }`을 쓰는데 `state: { … version: N }` 선언이 없거나 N이 2 이상인데 `migrations`가 없으면 경고). AU-010과 AU-011은 소스 글자 휴리스틱이다. 아직 없는 규칙: AU-005의 `widgets`·`bridge` 범위 대조(T-VIEW 뒤).

## 4. 동작 규칙

### 4.1 제작 대화 단계

[제안] drive 단계 머신입니다. 주도 단계 함수(drive-isolation.md §1.1)로 구현합니다. 엔진이 단계마다 `last`를 주고 명령 하나를 받습니다. 모든 전이는 단계 경계에서 커밋됩니다(`commit` 명령 또는 `g.commit`).

```text
idle → intent → compose → scaffold → validate ⇄ fix → trial → (replay: 개발 모드만) → package → done
                                     ↑___________________|
```

| 단계 | 하는 일 | 사람 확인 |
|---|---|---|
| intent | 사용자 요구를 종류 하나와 결정 목록으로 정리. 스킬 `authoring-guide`의 판정 기준(그룹으로 만들지, `L3.slots.spec` §3.1.1)을 씀 | 종류와 이름 확인(`ask` 명령) |
| compose | 구성 초안을 만들거나 구성기에서 받은 초안을 읽음 | 없음 |
| scaffold | 템플릿 복사, 치환, 구성 초안에서 매니페스트 필드와 `setup` 등록 줄 패치 | 없음(대상 폴더 안) |
| validate, fix | 검사, 고치기 반복. 같은 오류가 3번 남으면 멈추고 사용자에게 물음 | 반복 한도 도달 때 |
| trial | Test run에서 대상을 켜고 프롬프트를 보냄. 결과를 대화에 요약 | 시험 시작 전(비용) |
| replay | 개발 모드면 `replayDrive`. 배포 앱은 건너뛰고 "개발 모드에서 확인 필요" 표시 | 없음 |
| package | 묶음 만들기, 사용자 위치 연결 | 묶기 전, 연결 전(`ask` 명령) |

- 사람 확인을 기다리는 동안 drive 프레임은 질문 대기(`asking`)로 스택에 남습니다. 반납이 아니라 프레임 상태만 바뀝니다(drive-isolation.md 2.1, X-17, `L4.desktop-ux.spec` §12.4 C-8). 답이 오면 단계 함수가 `last=null`로 다시 불리고, 같은 `ask`(같은 requestId)가 기록된 답을 돌려주므로 같은 단계에서 이어 갑니다.
- 단계 함수의 규칙(drive-isolation.md §1.1, §2.4): 사용자 메시지(`last.kind === "user"`)는 `turn`으로 그 메시지를 입력으로 처리합니다. 열린 제작 대화에서 할 일이 없으면 `yield`로 상주하고, 제작 대화가 닫혀 있고 확인도 없으면 `done`으로 물러납니다(스택에 다시 오르려면 시작 요청이 필요합니다. 중재가 없어 상태가 바뀌어도 저절로 오르지 않습니다). 명령은 `state`와 `last`만 보고 정하므로 같은 입력에는 같은 명령이 나옵니다(재시작 안전, 시험 `authoring.drive-steps`).
- 확인의 답이 `yes`가 아니면(거절, 취소, 만료, 무인 실행) `pack`, `testRun`을 부르지 않습니다. 검토함 제출(`submit`)은 확인을 묻지 않습니다(아무것도 실행하지 않고, 승인은 검토함이 한다). 답을 기다리는 동안에는 같은 `ask`를 다시 냅니다.
- [미결] [근거: packages/ext-host/src/primitives/lease.ts, packages/core-loop/src/service.ts] 열린 제작 대화에서 사용자 메시지를 두 번째로 받으면 턴의 요청 id가 첫 턴과 같아져, 코어 루프가 기록된 결과로 재생하고 그 메시지를 처리하지 않습니다. 엔진의 기본 요청 id가 호출마다 0부터 세기 때문입니다(`lease.ts`의 `invocation.i`). 빌더 쪽 우회(상태 문서에 턴 수를 더하고 버전을 올림)는 하지 않았습니다. 엔진을 고친 뒤 다시 봅니다.
- 맡겨졌을 때(drive-isolation.md 2.2, 2.6; `packages/plugin-builder/src/group-drive.ts`의 `handoffStep`). 다른 플러그인이 `handoff`로 부르면 프레임의 `calledBy`가 맡긴 쪽 이름이고, 첫 단계(`last`가 없음)에서 상주하지 않고 답한다. 입력은 `{ purpose, id? }`로 읽는다(`id`는 맡긴 쪽의 요청 id).
  - 제작 대화가 열려 있으면 받지 않는다: `done({ accepted: false, reason: "session_open" })`, 알림은 내지 않는다.
  - 입력을 읽지 못하면(목적 문자열이 빠짐, 재시작 뒤 입력이 비어 있음) `done({ accepted: false, reason: "bad_input" })`.
  - 그 밖이면 알림 `[authoring] <calledBy>가 플러그인 제작을 맡겼다: <purpose>`를 `post`하고 `done({ accepted: true, purpose })`를 돌려준다. 알림 requestId는 `authoring:handoff:<id>`다(`id`가 없으면 목적). 같은 단계가 재시작 뒤 다시 와도 알림이 한 번만 난다.
  - 이 단계는 목적을 알리고 돌려주는 데까지다. 제작 대화를 열지 않는다. 제작은 사용자가 `authoring_start`로 이어 간다. [미결] 맡겨진 목적으로 제작 대화를 자동으로 여는 일은 정하지 않았다. [근거: packages/plugin-builder/src/group-drive.ts, packages/group-helm/src/drive.ts]
- 단계와 상관없이 사용자는 `/author stop`으로 대화를 멈출 수 있습니다. 만든 파일은 지우지 않습니다.

### 4.2 쓰기 범위 가드

- [제안] 제작 대화가 열려 있는 동안 `tool.call.before`(first)는 쓰기 도구(`write`, `edit`, 셸 실행의 쓰기)를 대상 폴더 안으로 제한합니다. 밖이면 거부하고 이유를 돌려줍니다.
- 사용자 확장 위치, 관리 위치, 앱 자원 폴더에 직접 쓰지 않습니다. 빌더는 설치하지 않고 `fresnel.devkit.submit`(검토함)으로만 나갑니다.
- 가드는 대화가 끝나면 풀립니다. Plugin Builder가 꺼져도 풀립니다.

- [결정: M4 T-AUTH] 가드 판정은 함수 `authoringWriteGuard`(`guard.ts`)다. `write` 위험 등급 도구는 입력의 `path`·`file_path`·`filePath`가 대상 폴더 안이어야 하고, `exec`(셸)는 `cwd`·`workdir`가 안쪽이어야 한다. 경로를 읽을 수 없는 `write`와 작업 폴더가 없는 `exec`는 막는다. 한계 [미결]: 셸 명령 문자열 속 절대 경로는 보지 않는다.
- [결정: M4 T-AUTH] 묶기 앞 사람 확인의 카드와 요청 id는 `packConfirmation`(`confirm.ts`)이 만들고, drive가 `ask` 명령으로 냅니다. 답이 `yes`인지는 `confirmedYes`가 읽는다. 질문 `confirm`의 선택지 `yes`·`no`, `requestId`는 `authoring:package:<경로 sha256 앞 12자>:<번호>`·`authoring:install:<…>:<번호>`(64자 이하)이고, `yes`가 아니면 `pack`·`link`를 부르지 않는다. 번호는 거절 뒤 다시 묻는 질문을 가른다(같은 `requestId`는 기록된 답을 돌려주므로). replay는 `replayInDevMode`가 개발 모드가 아니면 `dev_mode_required`를 돌려준다.
- [결정: M4 T-AUTH] 그룹 `authoring`은 `createAuthoringGroup({ devkit, guide?, devMode?, fixLoopLimit?, workspaceOf? })`(`group.ts`)이다. `fresnel.devkit` 서비스(`DevkitService`)를 주입받고, 매니페스트는 내장(`trust.level: "builtin"`)·`defaultEnabled: true`([결정: 2026-11-13 사용자])·루트 L3 플러그인 `drives: true`, `usesPost: true`, 훅 `tool.call.before`·`thread.start`다. 상태 문서(`group-state.ts`, version 2)는 단계(`idle`·`intent`·`compose`·`scaffold`·`validate`·`fix`·`trial`·`replay`·`package`·`done`), 대상 폴더, 구성 초안, 검사 오류 지문, 사람 확인을 기다리는 요청(`pending`), 시험·묶음·제출 결과(`submitted`: 초안 id와 검토 항목 id)를 가진다.
- [결정: 상태 문서 판 2, L3.group-sdk §4.7] 판 1 문서(`installed: {name, version, location}`이 있던 모양)는 `authoringStateMigrations[1]`(`group-state.ts`의 `v1ToV2`)이 옮긴다. `installed`는 버리고 `submitted`는 null로 둔다. 설치 결과에는 검토 항목 id가 없어 `submitted`로 옮길 수 없다([제안] 가장 가까운 유효 상태). 설치로 끝난 대화는 단계 `done`이 그대로 남는다. 설치 요청이던 `pending`과 `denied`의 `install`은 null이다. 이미 판 2 모양인 문서는 그대로 둔다. 모양이 아닌 입력은 스키마가 `Result` 오류로 거른다(던지지 않는다).
- [결정: M4 T-AUTH] 도구 열(`group-tools.ts`)은 `authoring_` 접두이고 입력 검사, 상태 커밋, 결과 요약만 한다. 사람 확인이 필요한 단계(시험, 묶기, 고치기 한도)는 도구가 `pending`만 커밋하고 `status: "awaiting_confirmation"`을 돌려주며, drive가 `ask` 명령으로 확인한 뒤 서비스를 부르고 결과를 커밋한다(A-4: 확인 전에는 파일을 쓰지 않고 기다리는 동안 drive 프레임은 질문 대기(`asking`)로 스택에 남는다. 확인 질문을 여는 도구는 `startDrive`로 주도를 다시 요청한다(엔진이 두 번 연속 효과 없이 `yield`한 프레임을 `idle`로 내리기 때문, E3)). 거절하면 `denied`가 상태에 남고 같은 도구를 다시 부르면 한 번 거절을 알린 뒤 그다음 호출이 다시 묻는다. `authoring_start`는 종류·이름 확인(`ask` 명령) 전에는 다른 도구가 `awaiting_confirmation`으로 거절하게 한다. `authoring_replay`는 `replayInDevMode`로 판정하고(A-5) 배포 형태면 상태에 `dev_mode_required`를 남긴다. `authoring_trial`은 서비스 `testRun`을 부르고, 호스트는 그 포트로 Test run 대화를 연다(HS-112). 같은 검사 오류가 `fixLoopLimit`(기본 3)번 남으면 `pending: "fix_limit"`로 사용자에게 계속할지 묻는다.
- [결정: 오케스트레이터 기본값, scI] `authoring_start`의 `dir`은 절대 경로로 정한다(`target-dir.ts`의 `resolveTargetDir`). 절대 경로는 그대로 쓰고, 상대 경로는 그 대화의 작업 폴더(`thread.started.workspace`) 안으로만 푼다(밖으로 나가면 `outside_workspace`). 작업 폴더가 없는 대화가 상대 경로를 주면 제작 대화를 열지 않고 `needs_folder`를 돌려주며, 모델은 사용자에게 폴더를 묻는다(앱은 크래프트 "새로 만들기"가 폴더 고르기 창 `pickFolder` 길로 작업 폴더를 정한 대화를 열고, CLI는 경로를 묻는다). 숨은 기본 출력 위치는 두지 않는다. 사용자 결정 목록에 "제작물 기본 출력 위치"로 올린다. 호스트는 `AuthoringWiring.workspaceOf`로 작업 폴더를 준다.
- [결정: 오케스트레이터 기본값, scI] 열린 제작 대화는 도구 `authoring_stop`으로 닫는다(상태를 `idle`로 되돌리고 가드를 풀며 만든 파일은 지우지 않는다). 다른 폴더로 다시 열려면 닫은 뒤 `authoring_start`를 다시 부른다. 열린 대화가 있을 때 `authoring_start`는 `session_open`으로 거절하고 `authoring_stop`을 먼저 부르라고 알린다. `sessionId`를 주면 열린 대화와 같아야 한다(`unknown_session`). 앱의 닫기 단추는 화면 기여(T-VIEW) 때 더한다 [미결].
- [결정: 오케스트레이터 기본값, scI] 사람이 확인에 답하면(종류·이름, 고치기 한도, 시험, 묶기의 yes와 no 모두) drive는 답의 결과를 알리는 `followUp` post를 하나 더한다(`display: false`, `requestId` 끝 `:r`). `g.post`는 상태를 커밋하는 `commit` 명령보다 먼저 나간다. `next`는 유휴 대화에서 턴을 열지 않으므로(`L1.tasks` §4.9) 이것이 없으면 답 뒤에 턴이 끊겨 사용자가 "계속"을 쳐야 했다. 같은 단계 흐름이 사용자 입력 없이 이어진다. 도구 승인(쓰기 위험도)은 그대로 따로 뜬다.
- [결정: 오케스트레이터 기본값, scI] 제작 대화의 확인 카드는 한국어다: 카드 제목은 확장 표시 이름(`displayName` "Plugin Builder", 앱은 확장 이름표로 "플러그인 빌더"를 보인다 [미결: 승인 카드 제목에 이름표 적용]), 질문은 "플러그인 \"이름\"을 <폴더>에 만들까요?" 같은 문장, 선택지는 "예"·"아니요"다(`group-drive.ts`, `release.ts`). `authoring_*` 도구 행의 사람 말 요약(단계 이름, "파일 3개를 만들었어요", "오류 2개가 남아 있어요" 등)은 `apps/desktop/src/views/authoring-row-model.ts`의 `authoringRowOf`가 만들고 키는 `desktop.item.authoring.*`다. 대화 행(`item-view.tsx`)에 이 함수를 잇는 일은 그 파일을 맡은 트랙이 한다 [미결].
- [결정: M4 T-AUTH] 쓰기 범위 가드는 `tool.call.before`가 `authoringWriteGuard`를 부르고, 제작 대화가 열려 있는 동안(`idle`·`done`이 아닌 단계)에만 켜진다. 이 그룹의 도구(`authoring_*`)는 가드에서 뺀다. `thread.start`는 열린 대화가 있으면 알림을 하나 낸다(대화 복원). 화면 기여(`page`, `well`, `card`, `command`)와 `authoring_scaffold`의 `views` 인자, A-6은 T-VIEW 뒤로 미룬다. 설정 `l3.authoring.fixLoopLimit`는 만들지 않고 값은 주입한다. `l3.authoring.devMode`는 카탈로그에 있고(§6) 호스트가 그 값을 읽어 준다.
- [결정: M4 T-AUTH] 호스트는 `assembly/authoring.ts`의 `authoringUnit`으로 그룹을 내장 단위로 싣는다(기본 그룹을 끄거나 안전 모드면 싣지 않고, 기본 켜짐, [결정: 2026-11-13 사용자]). 서비스는 wire 제작 포트(`m4.devkit`)를 어댑터(`devkitServiceOf`)로 감싼 것이라 에이전트와 화면이 같은 검사와 뼈대를 얻는다. 포트는 엔진 포트가 만들어진 뒤에야 있어 쓸 때 읽고, 없으면 `io` 오류다. 개발 모드 판정은 호스트가 한 곳에서 주며 `l3.authoring.devMode` 설정의 현재 값을 도구를 부를 때마다 읽는다(기본 거짓). 거짓이면 `authoring_replay`는 `dev_mode_required`다. 참이면 서비스 `replay`는 호스트의 `ext.test.run`(replay)을 불러 보고를 돌려준다(HS-112). 재생기는 `@fresnel/plugin-builder`의 `runInstalledReplay`이고, 호스트의 기본 실행기가 설치 폴더를 넘긴다 [결정: 2026-11-04 사용자 지시에 따른 기본값] [근거: HS-112 (8), packages/plugin-builder/src/replay.ts]. `testRun`은 호스트 포트가 Test run 대화를 열고 기록한다(HS-112).

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
- [결정: 오케스트레이터 기본값, scI] 모델 없는 모드는 `fresnel author scaffold|validate|pack|install|remove|ls`로 구현했습니다(`apps/cli/src/commands/author.ts`). 엔진 wire(`ext.*`)를 부르므로 엔진이 같은 프로세스에 서고, 설치는 `previewInstall` 결과를 보인 뒤 사람 확인(`--yes` 또는 터미널 y)을 받습니다. 제작 대화를 여는 `fresnel author`(하위 명령 없이)는 아직 없습니다 [근거: `apps/cli/src/cli/command.ts`의 `parseAuthor`]. 명령 표는 `L4.cli.spec` §3.1입니다.

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
| `l3.authoring.devMode` | `false` | managed, user | 개발 모드 동작(replay, benchmark) 허용. 배포 앱에서는 저장소 경로가 있어야 켜짐 |
| `l3.authoring.fixLoopLimit` | `3` | user, launch | 같은 검사 오류가 남는 고치기 반복 한도 |
| `l3.authoring.localCatalog` | `true` | user | 사용자 로컬 카탈로그 읽기 |

## 7. 훅

| 훅 | fold | 쓰임 |
|---|---|---|
| `tool.call.before` | first | 쓰기 범위 가드(§4.2) |
| `thread.start` | tap | 대화 복원 |
| drive | | 제작 대화 주도 단계 함수. 사람 확인은 `ask` 명령(X-17) |

## 8. 다른 문서와의 인터페이스

| 문서 | 관계 |
|---|---|
| `F.extensions.spec` | 요구: `composition` 필드와 `validateComposition`(X-16), `views` 두 모드(ADR-0021), 서비스 `fresnel.devkit` 계약 |
| `X.primitives.spec` | 요구: `ask` 명령과 질문 대기 프레임 상태 `asking`(X-17. 반납 사유 `waiting`은 쓰지 않는다, E3), Test run 단계 경계 멈춤(X-19) |
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
- A-4. `authoring_package`는 사람 확인 없이는 파일을 쓰지 않고, `authoring_submit`은 확인 없이 검토 항목만 만든다(실행하지 않는다). 확인을 기다리는 동안 그 대화의 drive 프레임은 `asking`으로 스택에 남습니다(drive 락을 반납하지 않는다, E3).
- A-5. 배포 앱 형태에서 `authoring_replay`가 `dev_mode_required`를 돌려줍니다.
- A-6. 화면 기여가 있는 시험 플러그인 하나(선언형 `well` + 프레임 `page`)를 만들면 AU-005가 통과하고, 프레임 금지 설정에서 `fallback`이 그려집니다.
- A-7. F 훅 하나의 이름을 바꾸는 가짜 변경에서 카탈로그 적합성 시험이 실패합니다.

## 10. 미결 사항

1. (결정) `L3/README.md` 도메인 표에 `authoring`을 더했다 [결정: 2026-11-04 사용자 B20].
2. [미결] 서비스 `fresnel.devkit`의 정본 위치(F `services/devkit.ts` [제안])와 L4 구현 위치(`apps/host`).
3. [결정: 2026-11-13 사용자] Plugin Builder는 기본 켜짐이고 도구는 모두 지연 노출입니다(2026-11-01 결정 "기본 꺼짐"을 대체). 중재가 없으므로 켜져 있어도 스택에 오르는 것은 시작 요청뿐입니다(drive-isolation.md 2.2, E3). 모델이 `authoring_start`를 부르면 도구가 `g.startDrive()`를 내고, 다음 경계에 스택에 올라 확인 질문을 엽니다. 제작 대화가 열려 있는 동안은 `yield`로 머물고, 닫혀 있고 확인도 없으면 `done`으로 물러납니다. `wants`는 없습니다(drive-isolation.md §1.1). 엔진이 두 번 연속 효과 없이 `yield`한 프레임은 `idle`로 내려가므로, 확인 질문이 필요해질 때마다 도구(`authoring_package`, `authoring_install`, `authoring_trial`, `authoring_validate`의 고치기 한도)가 `startDrive`를 다시 냅니다. 같은 scope의 요청은 엔진이 버리므로 살아 있는 주도에는 무해합니다. 시작 요청이 거부되면(`drive_unavailable`, 예: 하위 대화) `authoring_start`는 대화를 열지 않습니다. [미결] 도구의 시작 요청은 사용자 명령 계기와 같은 trigger라서 다른 그룹(예: Helm)의 주도를 전환시킬 수 있습니다. drive-isolation.md 2.2는 모델이 부르는 시작을 맨 위 프레임의 맡기기로 본다. 어느 쪽으로 할지 정해야 합니다. [근거: E3 구현(packages/group-sdk/src/service.ts), drive-isolation.md 2.2]
4. [미결] 묶음 형식(폴더 사본, tar, 서명). 서명은 릴리즈 서명(`L4.release.spec`)과 함께 정합니다.
5. [결정: 2026-11-04 사용자, 결정 목록 R16] 로컬 카탈로그 공유와 묶음 서명은 M4 밖입니다(`review.m4-plan` §1.2). 로컬 카탈로그 경로는 구현 세부로 남깁니다.
6. [결정: 2026-11-04 사용자, 결정 목록 R16] replay·benchmark·코어 변경 검사는 개발 모드에서만 돕니다(`L4.desktop-ux.spec` §12.3 U-4, m4-decisions Desktop UX 4). 배포 앱에서 개발 모드를 켜는 조건은 M4 밖입니다. 켬/끔 비교(Test run 묶음 실행)는 배포 앱에도 엽니다(2026-11-03 결정).
7. [결정: 2026-11-04 사용자 지시에 따른 기본값] 개발 모드 설정 `l3.authoring.devMode`가 카탈로그에 있습니다(소유 `plugin-builder`, 기본 `false`, 범위 managed·user). 기본은 꺼짐이라 배포 앱의 replay와 benchmark는 열리지 않습니다.
- [결정: 2026-11-13 사용자] 도구 `authoring_guide`(지연, read)는 Fresnel 가이드(`L3.guide.spec`)의 주제 목록과 본문·참조 파일을 돌려줍니다. 원본은 `xeon/packages/group-guide/skills/` 한 벌이고, 호스트가 `AuthoringDeps.guide`로 같은 폴더를 읽는 구현을 넘깁니다. 그래서 가이드 그룹이 꺼져 있어도 읽힙니다(내용 복제 없음). 폴더가 없으면 `guide_unavailable`입니다. 도구 설명 첫머리는 `Plugin authoring:`로 시작해 `tool_search`가 "plugin", "extension", "authoring", "build" 질의로 찾게 합니다.
