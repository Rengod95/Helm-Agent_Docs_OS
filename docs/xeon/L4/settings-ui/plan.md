---
id: L4.settings-ui.plan
layer: L4
domain: settings-ui
kind: plan
status: draft
depends_on: [L4.settings-ui.spec, L4.desktop.plan, L4.host-service.plan, F.wire-settings.plan, eng.testing.guide]
binds: [xeon/packages/client/src/settings/**]
---

# L4 설정 화면 구현 계획 (settings-ui)

`L4.settings-ui.spec`을 코드로 옮기는 계획이다. view-model은 `xeon/packages/client/src/settings/`(`@xeon/client/settings`, adr.0020)에 두고 렌더러는 `xeon/apps/desktop/src/views/`에 둔다. 화면 로직은 프레임워크와 DOM에 의존하지 않는 `model/`에 모으고, `views/`는 그 결과를 그리기만 한다.

## 1. 목표와 마일스톤 배치

근거 줄: `product.scope.spec` I14는 설정 화면을 M3에 두고, `F.wire-settings.plan` §1.4는 설정 화면이 F 계약을 소비하기 시작하는 단계를 M2로 적는다. 이 계획은 M2에 생성 로직의 기초를 두고 M3에 화면 전체를 마치는 배치를 [제안]한다. M2 배치는 I14의 M3 배정보다 앞서므로, M2 산출물은 "얇은 화면"이고 I14의 수용(M3 종료 조건 "설정 화면 항목, 설정 파일 키, 설정 명령이 같은 F5 스키마에서 생성된다")은 M3에서 확인한다.

### 1.1 M0

- 해당 작업 없음. 이 계획이 쓰는 F 타입(`SettingDefWire`, `EffectiveSetting`, `SettingsTab`, `SettingWidget`, `HostConnection`)은 `F.wire-settings.plan` W7~W12가 M0에 만든다.

### 1.2 M1

- 해당 작업 없음. M1 호스트에는 `settings.get`만 있고 `settings.list`·`settings.set`·`settings.reset` 처리기는 M2다(`L4.host-service.spec` §3.4 처리기 표, `F.wire-settings.spec` §3.3.1). 데스크톱도 M1에서는 스캐폴드와 전송 적합성까지만 만든다(`F.wire-settings.plan` §1.2).

### 1.3 M2: 얇은 화면

- 순수 view-model 모듈(`model/`) 전부: 탭 묶기와 정렬, 위젯 대응, 배지, 쓰기 흐름과 오류 변환, 클라이언트 검사, 변경 수신 상태.
- 일반 폼 렌더러(`views/SettingsShell`, `TabPage`, `Field`): 위젯 8종을 일반 부품으로 그린다.
- advanced 탭 파일 편집기의 키 단위 형태(`FileEditor`, spec §4.2.3 M2 행).
- 두 원천 합치기(spec §4.1.3): 엔진 `settings.*`와 데스크톱 로컬 저장소.
- 결과: `settings.list`·`settings.get`·`settings.set`·`settings.reset`이 실제 호스트와 함께 도는 화면. secrets 탭은 `xeon secret add` 명령 안내만 보인다(M2 최소 설정 화면의 키 등록은 `L4.desktop.spec` §4.14.1이 이미 제공한다).

### 1.4 M3: 화면 전체

- 12탭 전체에 실제 키 배치 확인, 탭별 전용 편집기(spec §4.2.4).
- 비밀 탭(`SecretsTab`): F·L0.secrets의 값 없는 메서드가 생긴 뒤(spec §10 미결 2, 3).
- 상태 게이지 자리(budgets, providers). 레이트 리밋(`l1.models.rateLimit`)과 계정 풀·회전(`l1.models.accounts`) 설정 항목은 M3에 넣는다(review.decisions-2 U-21).
- 첫 실행 권장 화면(spec §4.10, ADR-0005 ④).
- 접근성 점검(spec §4.8.1).
- F 변경 요청이 받아들여진 항목 반영: `settings.invalidated` 알림, 파일 단위 편집기(`settings.readFile`·`settings.writeFile`), F `toValueJsonSchema`.

### 1.5 M3 이후

- 사용량 wire가 생기면 게이지 채우기(spec §4.7, §10 미결 5).
- i18n(spec §10 미결 9), 확장 맞춤 패널(spec §10 미결 13), CLI와 view-model 공유(spec §10 미결 12).

## 2. 패키지와 파일 배치

```
xeon/packages/client/src/settings/          # settings-ui 소유 (binds, view-model)
  index.ts                 # createSettingsController, SettingsHostPort, SettingsController, SecretFlow* 타입
  connection.ts            # SettingsClient, createSettingsClient, SettingsChangeSignal (settings.* + events.subscribe)
  model/                   # 프레임워크·DOM 무관. bun test 대상
    types.ts               # FieldVM, TabVM, WidgetVM, ScopeBadge, RuntimeBadge, LockInfo, FieldError, SecretStatus 등
    group-by-tab.ts        # TAB_SPECS, groupByTab, buildSettingsView
    widget-map.ts          # resolveWidget
    badges.ts              # scopeBadge, runtimeBadge, lockInfo, deprecatedInfo, writableScopes, defaultWriteScope
    validate.ts            # toValueJsonSchema, checkClientValue, coerceInput
    write-flow.ts          # planWrite, toFieldError
    state.ts               # SettingsState, SettingsAction, reduceSettings, initialSettingsState
  views/                   # 프레임워크 결정 뒤 확장자 확정 [미결]
    SettingsShell.*        # 탭 목록, 재시작 띠, 진단 표시
    TabPage.*              # 탭 하나: 항목 목록, 게이지 자리, 빈 탭 문구
    Field.*                # 일반 항목: 라벨, 배지, 위젯 부품, 범위 선택, 오류
    SecretsTab.*           # 비밀 관리 패널 (M3)
    FileEditor.*           # advanced 탭 파일 편집기
    editors/               # 탭별 전용 편집기 (M3, U10)
  test/
    fixtures/catalog.ts    # U1: SettingDefWire + EffectiveSetting 샘플 카탈로그
    fixtures/fake-host.ts  # HostConnection 가짜(settings.* 표 응답, events.batch 발신)
    fixtures/fake-store.ts # DesktopSettingsStore 가짜
    *.test.ts              # model 단위 테스트 (unit)
    client-check.contract.test.ts   # 클라이언트 검사와 F validateSettingValue 대조 (contract)
```

- [제안] 테스트는 `xeon/packages/client/test/settings/`에 둔다. `binds`(`xeon/packages/client/src/settings/**`) 안에 있어 라우팅이 같은 문서를 고르고, `eng.testing.guide` TS-06의 "`src/**/*.test.ts` 또는 `test/**`" 위치 규칙에도 맞는다. desktop 패키지의 `knip.json` `entry`에 `src/**/*.test.ts`가 있어야 한다(TS-06 마지막 항목).
- [미결] `views/`의 확장자와 부품 형식(`.tsx` 함수 부품, 단일 파일 부품 등). 프런트엔드 프레임워크는 React 19 + Zustand 5로 정해졌다(adr.0010, `L4.desktop.spec` §10 미결 11 닫힘). 원칙: `model/`은 프레임워크 무관을 유지하고, 프레임워크가 바뀌어도 `views/`만 다시 쓴다.
- [제안] `model/**`의 DOM 무관을 검사로 강제한다. `.oxlintrc.json` override로 `src/settings/model/**`에 `no-restricted-globals`(`document`, `window`, `HTMLElement`, `navigator`)와 `no-restricted-imports`(`../views/**`, 프레임워크 패키지)를 건다. oxlint 파일 단위 override 문제(`eng.dependency-rules.guide` 3.2절)가 있으면 `check-layers.ts`의 desktop 앱 내부 규칙(W1~W7, `L4.desktop.spec` §4.9)에 같은 항목을 더하도록 desktop에 요청한다.
- `package.json`은 desktop의 것을 쓴다. 이 계획이 더하는 의존은 `@xeon/contracts`(workspace)와 `typebox`(`catalog:` 1.3.27)다. 추가는 desktop plan 담당자가 한다.

## 3. 작업 분해

규모: S(반나절 이하), M(1일), L(2~3일). 바깥 선행: `F.wire-settings.plan` W7~W12(M0), `L4.host-service.plan` H8(`settings.get`, M1)과 H17(`settings.set/reset/list`, M2), `L4.desktop.plan` D6(UI 셸: 화면 프레임워크, `HostConnection` 제공, `DesktopSettingsStore`, 탭 진입점).

| id | 내용 | 파일 | 선행 | 규모 | 단계 |
|---|---|---|---|---|---|
| U1 | fixture 카탈로그: `SettingDefWire` 샘플로 12탭 전부를 채우고, 위젯 8종, `ui` 없는 키, 잠금(managed), shadowed, deprecated(대체 키 있음·없음), secret(참조 있음·없음), `restart` 대기, 위젯 불일치, 모르는 탭 값을 넣는다. 각 정의에 맞는 `EffectiveSetting`. 가짜 호스트와 가짜 로컬 저장소 | `test/fixtures/*` | F W7~W12 | M | M2 |
| U2 | `TAB_SPECS`, `groupByTab`(정확히 한 곳 배치, `ui.order`·`key` 정렬, 모르는 탭), 두 원천 합치기(spec §4.1.3) | `model/group-by-tab.ts`, `model/types.ts` | U1 | S | M2 |
| U3 | `resolveWidget`: 위젯 8종 대응, `range`·`unit`·정수 판정, `table`의 `rows`·`record` 모양, 불일치·모르는 위젯 진단 | `model/widget-map.ts` | U1 | S | M2 |
| U4 | 배지 계산: `scopeBadge`, `runtimeBadge`(`pendingUntil`), `lockInfo`, `deprecatedInfo`, `writableScopes`, `defaultWriteScope` | `model/badges.ts` | U1 | S | M2 |
| U5 | 쓰기 흐름과 오류 변환: `toValueJsonSchema`, `checkClientValue`(`typebox/schema` `Check`), `coerceInput`, `planWrite`, `toFieldError`(`workspaceRequired` 포함), `SettingsClient`의 `list/get/set/reset` | `model/validate.ts`, `model/write-flow.ts`, `connection.ts` | U1, U3, H8(`settings.get`), H17(`settings.set/reset/list`) | M | M2 |
| U6 | `settings.changed` 반영: `reduceSettings` 전체, 키별 요청 번호, 원격 변경 표시, `SettingsClient.onChange`(events.subscribe 필터, `replay.outOfRange` 복구), 창 포커스 때 전체 재조회 | `model/state.ts`, `connection.ts`, `index.ts` | U2, U4, U5, H8(`settings.get`), H17(`settings.set/reset`이 남기는 `settings.changed`) | M | M2 |
| U7 | 일반 Field 렌더러와 셸: `SettingsShell`, `TabPage`, `Field`, 위젯 부품 8종, 범위 선택·"이번 대화에만 적용", 기본값 복귀, 재시작 띠, `createSettingsController` | `views/SettingsShell.*`, `views/TabPage.*`, `views/Field.*`, `index.ts` | U2~U6, D6 | M | M2 |
| U8 | `FileEditor`: M2는 키 단위 JSON 편집기(파일 전용 키, 위젯 불일치 키), 범위별 스키마 검사. M3는 F 변경(`settings.readFile`·`settings.writeFile`)이 받아들여지면 파일 단위 편집기 | `views/FileEditor.*`, `model/validate.ts` | U5, U7 | M(M2) + M(M3) | M2, M3 |
| U9 | `SecretsTab`: 목록, 추가, 값 보기, 메타 편집, 사용 이력, 정책 편집, 삭제(참조 표시). 값 입력·열람은 `openSecretFlow` 포트로만. M2는 명령 안내만 | `views/SecretsTab.*`, `index.ts` | U7, 비밀 입력 경로 미결 해소(spec §10 미결 2, 3), `L0.secrets.plan`의 관리 흐름 | L | M3 |
| U10 | 탭별 전용 편집기: 모델 역할 표, 폴백 체인, 권한 규칙 편집기, 샌드박스 경로·도메인 목록, 계정 풀(`_research/settings.md` §5 "UI 필요" 항목). 각 편집기는 일반 렌더러 위에 얹고 키 하나를 통째로 쓴다 | `views/editors/*` | U7, 소유 층의 키 정의(`L1.models.spec`, `L1.tools.spec`, `L0.sandbox.spec`) | L | M3 |
| U11 | 게이지 자리: budgets·providers 탭의 `GaugeSlotVM`(`unavailable`)과 문구 | `model/group-by-tab.ts`, `views/TabPage.*` | U7 | S | M3 |
| U13 | 첫 실행 권장 화면(spec §4.10): provider 상태, SearXNG 주소 입력, 권장 목록과 키 등록 버튼(C안). "다시 보지 않음"은 desktop 로컬 값 | `model/first-run.ts`, `views/FirstRun.*` | U7, U9(키 등록 경로), `L2.web.spec` provider 설정 키 | S | M3 |
| U12 | 접근성 점검: 탭 키보드 조작, 접근 이름(`ui.label`), 오류 설명 연결, 상태 영역, 대비 4.5:1·3:1, 잠긴 항목 읽기. 점검표를 완료 기준에 남긴다 | `views/**` | U7~U11 | M | M3 |

- 순서: U1 → (U2, U3, U4 병렬) → U5 → U6 → U7 → U8. M3에서 U9, U10, U11은 U7 뒤 병렬, U13은 U9 뒤, U12는 마지막이다.
- [제안] U10은 일반 렌더러로 같은 키를 먼저 편집할 수 있게 둔 뒤에 착수한다. 전용 편집기가 늦어도 값 편집은 막히지 않는다.

## 4. 채택 코드

| 대상 | 방식 | 버전·원본 | 바꿀 점 |
|---|---|---|---|
| `typebox`(`typebox/schema`의 `Check`) | 그대로 사용 | 1.3.27(`xeon/package.json` catalog). F와 같은 사본 | 없음. 클라이언트 번들에는 `typebox/schema` 서브패스만 넣는다(`_research/notes/L4-3.md` §4 P4). 1.3.27로 맞추는 결정(`F.wire-settings.spec` §10 미결 6)이 나면 catalog를 따른다 |
| `@xeon/contracts`(`wire`, `settings`, `conversation` 서브패스) | 그대로 사용 | workspace | 없음 |
| 화면 프레임워크 | `L4.desktop.plan` 결정에 따른다 | desktop plan이 정확 버전으로 고정한다(`adr.0010`: React 19 + Zustand 5) | 이 계획은 따로 고정하지 않는다 |
| omp 설정 정의 `register`와 `/settings` 패널 | 구조 참고만(포크 없음) | 커밋 `d1bffdfdcbf9ee36db8e5b4b72d24790dd00689f`, `docs/settings.md`(`_research/settings.md` S36) | 한 정의에서 패널·명령·파일을 만드는 구조만 참고한다 |
| pi `settings-selector.ts`(UI 항목 39개) | 구조 참고만(포크 없음) | `/home/user/projects/_ref/pi-src` 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`, `packages/coding-agent` 1.1.0, `src/modes/interactive/components/settings-selector.ts`(`_research/settings.md` S34) | 항목 목록 구성과 선택 UI 흐름만 참고한다 |
| Zed 에이전트 프로파일 화면의 파일-UI 동기화 | 구조 참고만 | https://zed.dev/docs/ai/agent-profiles.html(`_research/settings.md` §3, S29) | 파일과 화면이 같은 저장소를 보는 방식만 참고한다 |

- 검사 로직은 새로 만들지 않는다. 서버 `validateSettingValue`와 같은 스키마(type + range)를 같은 엔진으로 검사한다(spec §4.4.2 6번). settings-ui의 `toValueJsonSchema`는 F가 같은 함수를 내면 지운다(spec §10 미결 7).
- 참고 소스는 읽기만 한다. 내려받은 코드를 실행하지 않는다.

## 5. 단위 테스트 목록

모두 `model/` 순수 함수 대상이고 `unit` 태그다(`eng.testing.guide` TS-01). 입력은 U1 fixture다. 테스트 이름은 그대로 `test()` 이름으로 쓴다.

| 테스트 이름 | 확인할 동작 | 파일 |
|---|---|---|
| `every-def-in-exactly-one-tab` | fixture의 모든 정의가 `buildSettingsView` 결과에서 정확히 한 곳(한 탭의 `fields` 또는 `fileOnly`)에 있다. `tabs`는 12개이고 id 집합이 `SettingsTab`과 같다 | `test/group-by-tab.test.ts` |
| `def-without-ui-only-in-advanced` | `ui`가 없는 정의와 모르는 탭 값의 정의는 `fileOnly`에만 있고 어느 탭 `fields`에도 없다 | `test/group-by-tab.test.ts` |
| `order-sort-stable` | 입력 순서를 섞은 여러 경우에 탭 안 순서가 `ui.order` 오름차순, 같으면 `key` 오름차순으로 같다 | `test/group-by-tab.test.ts` |
| `widget-kinds-all-mapped` | 위젯 8종이 같은 `kind`의 `WidgetVM`으로 바뀌고 `number`는 `min`·`max`·`unit`·`integer`, `select`는 `range.enum`, `table`은 `rows`·`record` 모양을 담는다. 불일치는 `readonly`와 `widgetMismatch` | `test/widget-map.test.ts` |
| `scope-badge-from-source` | `source.scope` 6값(5범위 + default)이 각각 정해진 글자와 tone을 낸다 | `test/badges.test.ts` |
| `locked-disables-edit` | `locked: true`이면 `editable: false`, `writableScopes: []`, `canReset: false`이고 `planWrite`가 `blocked`(locked)를 돌려준다 | `test/badges.test.ts`, `test/write-flow.test.ts` |
| `shadowed-shown` | `shadowed` 원소가 우선순위 순서 그대로 `ShadowedVM`이 되고 값 필드가 없다 | `test/badges.test.ts` |
| `writable-scopes-from-allowedScopes` | 후보는 `allowedScopes`에서 managed를 뺀 부분집합이고, thread가 없으면 session이 없고, 기본은 user(없으면 project, local, session 순) | `test/badges.test.ts` |
| `runtimeChange-pending-badge` | `runtimeChange` 3값의 배지 글자, `pendingUntil`이 있을 때 대기 문구, `restart` 대기 개수가 재시작 띠 개수와 같다 | `test/badges.test.ts` |
| `secret-never-holds-value` | secret 정의에 참조 아닌 문자열(예: `sk-test-…`)을 `draftEdited`로 넣은 뒤 `JSON.stringify(state)`, `buildSettingsView` 결과, `toFieldError` 결과, 테스트용 로거 기록에 그 문자열이 없다 | `test/state.test.ts` |
| `set-error-code-to-field-message` | `data.kind` 5종, `settings.scopeNotAllowed`의 `details.reason: "workspaceRequired"`, 연결 오류가 spec §4.4.4 표의 `FieldError.kind`·`followUp`으로 바뀌고 서버 `message` 문자열이 결과에 없다 | `test/write-flow.test.ts` |
| `changed-event-updates-state` | 가짜 호스트가 `settings.changed` 이벤트를 보내면 그 키만 `settings.get`으로 다시 읽고 `FieldVM.value`가 바뀐다. `payload.value`는 상태에 없다. 초안이 있으면 초안을 지키고 `remoteChanged: true` | `test/state.test.ts` |
| `deprecated-badge-with-replacement` | 폐기 정의에 사용자 값이 있으면 `DeprecatedVM`에 대체 키와 그 라벨이 있고, 값이 기본값이면 항목이 없다 | `test/badges.test.ts` |
| `stale-response-dropped` | 같은 키에 두 요청을 보낸 뒤 앞 요청 응답이 늦게 와도 상태는 마지막 요청 결과다 | `test/state.test.ts` |
| `two-origins-routed` | `l4.desktop.*` 정의는 가짜 로컬 저장소로, 나머지는 가짜 호스트로 읽고 쓴다. 같은 키가 양쪽이면 desktop 정의와 `duplicateKey` 진단 | `test/state.test.ts` |
| `client-check-matches-server` | fixture 정의를 `defineSettings`로 만든 서버 정의와 `JSON.stringify`를 거친 `SettingDefWire`에 대해, 고정 시드 값 목록으로 `checkClientValue`와 F `validateSettingValue` 결과가 같다(`contract` 태그, TS-09 고정 시드) | `test/client-check.contract.test.ts` |

- [미결] 화면 부품 테스트(`ui` 태그)와 시각 회귀(`visual`)는 `eng.testing.guide` TS-01에서 보류다. 위젯 8종 렌더링과 비밀 키의 DOM 확인(spec AC4, AC6)을 어떤 형식으로 자동화할지는 desktop의 프레임워크 결정 뒤에 정한다. 그 전까지는 M3 완료 기준의 수동 확인 항목으로 둔다.
- 커버리지 임계는 desktop 패키지의 L4 값(lines 0.5, functions 0.5, TS-10)을 따른다. [제안] `model/`은 위 테스트로 줄 단위 0.9 이상을 목표로 한다. 패키지 단위 임계라 강제하지 않는다.

## 6. 완료 기준

M2:

- `cd xeon/apps/desktop && bun test`에서 §5의 model 테스트가 모두 통과한다(U1 fixture 기준).
- 실제 host(`L4.host-service.plan` H8 `settings.get`, H17 `settings.set/reset/list` 처리기)에 연결한 수동 확인에서 다음이 같다. `settings.get` 값과 화면 항목의 값·범위 배지·잠금·대기 표시가 같고, 화면에서 `settings.set`·`settings.reset`을 한 결과 `EffectiveSetting`과 화면 상태가 같다. 같은 호스트 연결에서 session 범위로 바꾼 값이 `settings.changed` 수신 뒤 화면에 반영된다. CLI처럼 다른 클라이언트의 변경 반영은 두 클라이언트가 한 호스트를 공유하는 서비스 모드(M3, `product.scope.spec` §4.3)에서 확인한다.
- `l4.desktop.*` 항목이 엔진 연결 없이 편집된다.
- advanced 탭에서 `ui` 없는 키를 키 단위 편집기로 바꿀 수 있고, 범위 밖 키는 그 범위 선택지에 없다.
- `cd xeon && just verify` 종료코드 0.

M3:

- 12탭 모두에 실제 키가 하나 이상 보인다. 비어 있는 탭은 `emptyText`로 이유를 보인다(예: 키 소유 층이 아직 키를 정하지 않음).
- 비밀 탭이 값 없이 동작한다. 목록·메타·정책·이력·삭제가 보이고, 값 입력·열람은 `openSecretFlow` 경로로만 일어나며, 그 사이 WebView DOM과 상태 직렬화와 앱 로그에 값이 없다(수동 확인 또는 미결 해소 뒤 `ui` 테스트).
- 전용 편집기 5종(U10)이 각 키를 일반 렌더러와 같은 결과로 저장한다.
- budgets·providers 탭에 게이지 자리와 문구가 보인다.
- U12 접근성 점검표의 항목이 모두 통과한다.
- `product.scope.spec` §4.4 M3 조건 중 "스키마 키 집합과 화면 항목 집합이 같다"를 `every-def-in-exactly-one-tab`을 실제 카탈로그(`settings.list` 결과)로 돌려 확인한다.
- `cd xeon && just verify` 종료코드 0.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 프런트엔드 프레임워크 미결(`L4.desktop.spec` §10 미결 11) | `views/` 재작업 | `model/`을 프레임워크 무관으로 분리하고 모든 판단을 `model/`에 둔다. `views/`는 `SettingsView`를 그리기만 한다 |
| F `SettingsTab`·`SettingUi` 변경 | 탭 표와 `TAB_SPECS` 수정 | `TAB_SPECS`를 `Record<SettingsTab, TabSpec>`로 두어 enum 변경이 컴파일 오류로 드러나게 한다. 모르는 탭 값은 advanced로 보내 화면이 깨지지 않게 한다 |
| 비밀 입력 wire 경로 미정(spec §10 미결 2, 3) | U9 착수 불가 | M2는 명령 안내로 대신한다. U9는 미결 해소 뒤 M3에 착수한다. 값을 받는 입력란은 어떤 경우에도 view-model 상태에 넣지 않는다 |
| 사용량 wire 부재(spec §10 미결 5) | 게이지를 채우지 못함 | M3는 자리만 둔다(U11). `product.scope.spec` §10 미결 5와 함께 정한다 |
| 탭별 전용 편집기 규모 증가 | M3 일정 | 일반 렌더러(U7)를 먼저 끝내 모든 키를 편집할 수 있게 한 뒤 U10을 얹는다. 전용 편집기는 키 소유 층의 키가 정해진 것부터 한다 |
| 클라이언트 즉시 검사와 서버 검사 불일치 | 화면은 통과인데 저장 실패, 또는 반대 | 서버 권위 원칙(spec §4.4.2 5번). 같은 스키마·같은 TypeBox 사본을 쓰고 `client-check-matches-server` 계약 테스트로 확인한다. 불일치가 나면 서버 결과를 보이고 테스트를 고친다 |
| `settings.changed`가 thread 범위 변경만 담음(spec §10 미결 1) | CLI의 user·project 변경이 화면에 늦게 보임 | 창 포커스 때 전체 재조회를 둔다. F 알림 `settings.invalidated`를 변경 요청한다 |
| 두 설정 원천(spec §4.1.3, `L4.desktop.spec` §10 미결 6) | 원천 결정이 바뀌면 라우팅 코드 수정 | 원천 분기를 `connection.ts`와 `reduceSettings`의 `origin` 한 곳에 둔다 |
| desktop 모듈 규칙 W3이 F import를 막음(spec §10 미결 17) | `check-layers.ts` 실패 | U5 착수 전에 desktop에 W3 허용 목록 추가를 요청한다 |
