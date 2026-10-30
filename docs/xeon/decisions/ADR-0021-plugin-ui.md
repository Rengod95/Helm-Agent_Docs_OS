---
id: adr.0021
layer: adr
domain: plugin-ui
kind: adr
status: draft
depends_on: [adr.0007, adr.0008, adr.0010, adr.0016, adr.0017, adr.0018, adr.0020, architecture.security.spec, F.extensions.spec, F.wire-settings.spec, X.loading-trust.spec, X.operations.spec, L3.group-kit.spec, L3.helm.spec, L4.desktop.spec, L4.desktop-ux.spec]
binds: [xeon/apps/desktop/src/views/**, xeon/packages/client/**, xeon/packages/contracts/src/extensions/**]
---

# ADR-0021 플러그인 화면 기여: 선언형 화면 스키마를 기본으로

## 1. 상태와 날짜

- 상태: draft
- 날짜: 2026-10-30
- [결정: 2026-10-30 사용자] Xeon은 층별 플러그인(F, X, L0~L3)을 조립하고 적응시키는 대화형 에이전트 런타임입니다. Helm 같은 의도 그룹(에이전트 안의 에이전트 시스템)이 핵심 단위입니다.
- [결정: 2026-10-30 사용자] 대화 화면과 런타임 작업이 둘 다 1급입니다. 사용자 원문: "핵심은 대화화면이라는 건 어쨋든 에이전트 런타임의 숙명이라고 봄. 그래서 둘다 1급인느낌."
- [결정: 2026-10-30 사용자] 플러그인마다 클라이언트 안에서 자기 화면을 구성할 수 있어야 합니다. 원문: "플러그인 별로 우리 클라이언트 안에서 자기만의 ui 화면을 구성할 수 있는 시스템을 지원했으면 해, 단순 특정 파일을 렌더링 한다기 보다는, 어떤 플러그인을 어댑팅 했을 때, 이 플러그인이 만약 l3고 자기만의 워크플로우나 에이전틱한 흐름에서 대화창이 아닌 커스텀한 화면을 요구한다면 이를 지원할 수 있어야 해."
- 아래 §3의 방식 선택(선언형 기본, 혼합)은 `[결정: 오케스트레이터 기본값]`입니다. 사용자가 확인하면 accepted로 바꿉니다.

## 2. 맥락

- 지금 확장이 클라이언트에 정보를 보내는 길은 내구 이벤트(`x.<확장id>.*`, `grp.<그룹>.*`)뿐입니다(`F.wire-settings.spec` §4.2). 데스크톱은 이 이벤트를 종류 이름과 요약만 있는 일반 item으로 그립니다. 확장별 화면은 범위 밖으로 두었습니다(`L4.desktop.spec` §4.13).
- 확장 wire 메서드 `ext.<확장id>.<동사>`는 이름 규칙만 예약했고 "M2 이후 연다"는 [제안] 상태입니다. params·result 스키마는 매니페스트에 선언한다고 적혀 있습니다(`F.wire-settings.spec` §4.2, §3.5.3 오류 코드 구간 10000~19999).
- Helm 탐구 화면(`L4.desktop-ux.spec` P-05)은 `command.run { text: "/helm status" }` 결과를 임시로 읽습니다(`[gap:W-04]`). 그룹마다 같은 간극이 생깁니다.
- [결정: review.decisions-2 U-07] 핸들러에 UI 포트(`HandlerContext.ui`)를 두지 않습니다(`X.operations.spec` §4.2.3). pi의 `ctx.ui.custom`처럼 확장이 TUI 컴포넌트를 돌려주는 방식은 원격·웹 클라이언트로 옮길 수 없습니다(`_research/refs/pi.md` 415행).
- 신뢰 등급은 `builtin`, `user`, `project`, `untrusted` 넷이고 `untrusted`는 import하지 않습니다(`X.loading-trust.spec` §4.6.2, §4.6.3). Helm은 기본 플러그인이지만 사용자 확장 위치에 설치되는 `user` 등급입니다(`L3.helm.spec` §3.1). 그래서 "내장 그룹만 앱 코드로 화면을 낸다"는 안은 Helm에도 맞지 않습니다.
- 데스크톱 WebView는 CSP `default-src 'self'`이고 셸은 바이트만 릴레이합니다(`architecture.security.spec` B-09, T-11). 신뢰하지 않은 스크립트가 WebView에서 돌면 wire 연결 전체(승인 응답 포함)를 쓸 수 있습니다.
- 디자인 시스템은 caustic이고 시각 원칙은 `L4.desktop-ux.spec` §13(DP-01~DP-17)입니다. 플러그인 화면이 이 원칙을 깨면 셸 전체가 달라 보입니다.
- 문구는 ICU 메시지 키와 ko·en 카탈로그를 씁니다(ADR-0016).

## 3. 결정

### 3.1 방식

1. [결정: 오케스트레이터 기본값] (d) 혼합안을 채택합니다. 구성은 다음 셋입니다.
   - 모든 플러그인(내장 그룹, 기본 플러그인 Helm, 외부 플러그인)의 화면은 (a) 선언형 화면 스키마로만 기여합니다. 앱은 스키마를 caustic 부품으로 그립니다.
   - (c) 앱 내장 React 코드는 앱 자신의 화면(대화, 작업대, 설정)과 스키마가 쓰는 부품 목록(위젯 카탈로그)의 구현에만 씁니다. 특정 플러그인 전용 React 모듈은 두지 않습니다.
   - (b) 격리 iframe은 2차 탈출구로 이름만 예약합니다. 설계와 허용 등급은 `[미결]`입니다(§6 미결 1).
2. [제안] Helm 탐구 화면을 기준 사례로 삼습니다. Helm 화면을 (a)로 그릴 수 없으면 위젯 카탈로그를 넓히고, 플러그인 전용 코드를 앱에 넣지 않습니다.

### 3.2 기여 지점(slot)

[제안] 플러그인은 여섯 곳에 화면을 기여합니다. 각 기여는 매니페스트의 화면 선언 하나입니다.

| slot | 위치(`L4.desktop-ux.spec`) | 크기와 규칙 | 기본 개수 상한 |
|---|---|---|---|
| `page` | 작업대의 플러그인 화면 호스트(P-18), 대화에서 링크로 열기 | 가운데 전체. 왼쪽 패널과 오른쪽 막대는 셸 것 | 확장당 4 |
| `well` | 대화 영역 오른쪽 떠 있는 막대의 탭 하나와 well | 폭 320~480, 열린 대화 하나의 맥락 | 확장당 1 |
| `card` | 대화 트랜스크립트 안 카드 | 자기 레코드 kind 하나에 묶임(`forKind`). 높이 상한 320, 넘으면 "더 보기"로 `page`나 `well`을 엶 | kind당 1 |
| `status` | 상태 표시줄 칸 하나 | 글자 24자, tone 하나, 누르면 `Popover`(작은 트리) | 확장당 1 |
| `command` | 명령 팔레트 묶음 "플러그인" | 라벨, 보조 설명, 동작 하나(§3.4) | 확장당 16 |
| `settings` | 설정 "플러그인과 그룹" 탭과 확장 상세(P-17) 설정 구역 | 스키마가 만든 설정 필드(X10)에 읽기 전용 부품을 더할 수만 있음. 입력 부품은 스키마 필드뿐 | 확장당 1 |

- `card`가 없는 확장 레코드는 지금처럼 일반 item으로 그립니다(`L4.desktop.spec` §4.13).
- `status`와 `well`은 열린 대화가 있을 때만 그립니다. `page`는 대화 맥락(§3.4 `host.thread`)이 없어도 그릴 수 있어야 합니다.
- 상한은 셸이 플러그인 수에 따라 무너지지 않게 두는 값입니다. 넘는 선언은 로더 진단 `view_limit`으로 버립니다 [제안].

### 3.3 매니페스트 모양(개념)

[제안] `ExtensionManifest`(`F.extensions.spec` §3.1)에 선택 필드 `views`를 더합니다. 아래는 개념 모양이고 타입 정본은 F가 정합니다(§6 미결 2).

```ts
// 개념 모양. 정본은 F.extensions.spec(views.ts [제안])
interface ViewContribution {
  readonly id: string;                 // 확장 안에서 유일. 전체 id는 "<확장이름>/<id>"
  readonly slot: "page" | "well" | "card" | "status" | "command" | "settings";
  readonly title: string;              // 메시지 키 또는 문자열(§3.7)
  readonly icon?: string;              // caustic 아이콘 어댑터 이름(DP-17)
  readonly file?: string;              // 화면 트리 JSON 경로. command는 없음
  readonly forKind?: string;           // card 전용. 자기 recordKinds 안의 kind
  readonly when?: { readonly thread?: "required" | "optional" };
  readonly cli?: { readonly command?: string };   // CLI 대체(§3.8)
}
interface ViewsDecl {
  readonly schemaVersion: 1;           // 화면 트리 스키마 버전
  readonly widgets: string;            // 위젯 카탈로그 범위. 예 "^1.0.0"
  readonly items: readonly ViewContribution[];
  readonly methods?: readonly ExtMethodDecl[];   // 화면이 부르는 ext.<id>.<동사> 선언
  readonly messages?: string;          // 카탈로그 폴더. 예 "./locales"
}
interface ExtMethodDecl {
  readonly verb: string;               // ext.<확장이름>.<verb>
  readonly params: unknown;            // JSON Schema
  readonly result: unknown;            // JSON Schema
  readonly readOnly: boolean;          // 참이면 사용자 조작 없이 부를 수 있음
  readonly approval?: boolean;         // 참이면 호출 전에 승인 카드(§3.4)
}
```

- `methods`는 `F.wire-settings.spec` §4.2의 "확장 메서드의 params·result 스키마를 매니페스트에 선언"을 채우는 필드입니다. 확장 코드는 엔진 쪽에서 같은 이름으로 처리기를 등록합니다. 등록 API는 X(`hostOf(g).registerMethod` [제안])와 group-kit(`g.registerMethod` [제안])가 정합니다(§6 미결 3).
- 화면 트리 파일(`*.view.json`)은 확장 패키지 안에 둡니다. 내장 패키지는 TS 상수로 같은 스키마를 export할 수 있습니다(매니페스트와 같은 규칙, `F.extensions.spec` §3.1).

### 3.4 화면 트리와 호스트 API

[제안] 화면 트리는 위젯 노드의 JSON 트리입니다.

- 노드: `{ type, props?, bind?, each?, when?, children? }`. `type`은 위젯 카탈로그 이름입니다. `props`는 caustic 부품의 `variant`, `tone`, `size` 같은 선택값과 글자만 받습니다(DP-08). 색, 크기 숫자, CSS, HTML은 받지 않습니다.
- 표현식: 데이터 경로(JSON Pointer)와 같음·있음·없음 비교, 배열 반복(`each`)만 둡니다. 스크립트, 함수 호출, 문자열 조립 연산은 두지 않습니다. 숫자·시간·바이트·상대 시각 서식은 호스트가 이름으로 제공합니다(`format: "duration"` 등).
- 위젯 카탈로그 v1(초안): 배치(`Stack`, `Row`, `Section`, `Tabs`, `Split`), 글(`Text`, `Heading`, `Markdown`(HTML 없는 부분 집합), `Code`), 자료(`List`, `Table`, `ListDescription`, `Badge`, `Chip`, `Progress`, `Meter`, `Stepper`, `ActivityTree`, `Timeline`, `Sparkline`), 알림(`Alert`, `EmptyState`, `Skeleton`), 입력(`Button`, `Switch`, `Select`, `TextField`, `NumberField`, `SegmentedControl`, `Form`), 연결(`ThreadLink`, `TurnLink`, `ViewLink`, `ApprovalLink`). 이름은 caustic export와 같게 두고, caustic에 없는 것(`Meter`, `Timeline`, `Sparkline`)은 `L4.desktop-ux.spec` §9 간극으로 올립니다.

호스트 API는 데이터 원천 넷과 동작 다섯입니다. 모든 검사는 엔진이 합니다. 클라이언트 검사는 표시용입니다.

| 구분 | 이름 | 하는 일 | 허용 범위 | wire |
|---|---|---|---|---|
| 읽기 | `query` | 자기 `readOnly` 메서드 호출 결과를 바인딩 | 매니페스트 `views.methods`의 `readOnly: true` 메서드 | `ext.<id>.<verb>` |
| 읽기 | `events` | 열린 대화의 이벤트를 접어 목록·최신 값으로 | 자기 kind(`x.<id>.*`, `grp.<id>.*`), 매니페스트 `readsRecordKinds`, 코어 허용 목록(`turn.*`, `lease.*`, 자기 소유 `scope.changed`·`scope.handler_failed`) | `events.subscribe`, `thread.read` [가정: kind 거름 인자는 `[미결]`] |
| 읽기 | `settings` | 자기 설정 값 | `ext.<id>.*`, 내장 그룹의 `l3.<id>.*`. 비밀 키는 핸들만 | `settings.get` |
| 읽기 | `host` | 고정 맥락: 열린 대화 id·제목, 연결 상태, 로케일, 자기 확장 상태(켜짐, 신뢰 등급, 안전 모드) | 읽기 전용 | 클라이언트 거울 |
| 동작 | `call` | 자기 쓰기 메서드 호출 | `readOnly: false` 메서드, 사용자 조작(누름) 뒤에만. `approval: true`면 승인 카드를 먼저 | `ext.<id>.<verb>` |
| 동작 | `command` | 자기 슬래시 명령 실행 | 자기 확장이 등록한 명령만 | `command.run` |
| 동작 | `post` | 열린 대화 입력 큐에 넣기 | 신뢰 등급의 `post` 허용(`X.loading-trust.spec` §4.6.2), scope 켜짐 | `ext.view.post` `[미결]` |
| 동작 | `requestApproval` | 사용자 승인 요청 | 앱이 그리는 표준 승인 카드로만 보임(ADR-0018). 플러그인 화면은 승인 결과만 받음 | `ext.view.requestApproval` `[미결]` |
| 동작 | `navigate` | 자기 다른 화면, 대화·턴, 확장 상세(P-17), 자기 설정 구역 열기 | 앱 화면은 정해진 목록만 | 클라이언트 |

- 입력창 채우기(`compose`)는 클라이언트 동작으로 둡니다. 글을 입력창에 넣기만 하고 보내기는 사용자가 합니다 [제안].
- `query` 갱신: `invalidateOn`(자기 kind 목록) 이벤트가 오면 다시 부릅니다. 주기 갱신은 5초 이상만 허용합니다 [제안].
- 크기 상한 [제안]: `query` 결과 256 KiB, `events` 목록 500행, 트리 노드 2000개, 깊이 24. 넘으면 그 노드는 "긴 내용" 상태로 자릅니다.

### 3.5 보안과 신뢰

1. [제안] 플러그인 화면은 WebView에서 플러그인 코드를 실행하지 않습니다. 화면 트리는 데이터이고 렌더러는 앱 코드입니다. CSP `default-src 'self'`와 B-09 경계를 바꾸지 않습니다.
2. [제안] 화면 기여는 그 확장이 로드됐을 때만 보입니다. `untrusted`는 로드하지 않으므로 화면도 없습니다. 안전 모드에서 빠진 확장의 화면은 자리표시 상태로 보입니다(§3.6).
3. [제안] `project` 등급 확장의 화면에는 셸이 "프로젝트 확장" 배지를 붙입니다. 화면 머리(확장 이름, 등급, 버전)는 셸이 그리고 플러그인이 바꿀 수 없습니다. 플러그인 화면이 앱 화면이나 승인 카드처럼 보이지 않게 하는 장치입니다.
4. [제안] 비밀 값은 어떤 바인딩으로도 오지 않습니다. `secret: true` 설정은 셸의 비밀 핸들 부품(`ENV ← secret://…`)으로만 그립니다. `query` 결과는 엔진이 마스킹 계층(`L0.secrets.spec` §4.5)을 거쳐 보냅니다 [가정: 확장 메서드 결과에도 마스킹을 거는 위치는 `[미결]`].
5. [제안] `Markdown` 위젯은 HTML을 받지 않습니다. 링크는 `http(s)`만 허용하고, 외부 링크는 셸 확인 뒤 OS 브라우저로 엽니다.
6. [제안] 승인은 표준 카드로만 받습니다. 플러그인 화면 안에 "허용" 버튼을 그려 승인을 대신할 수 없습니다. `approval: true` 메서드는 엔진이 `xeon.approvals`로 승인을 만들고, 응답 뒤에 처리기를 부릅니다.
7. 새 신뢰 경계는 생기지 않습니다. 엔진 쪽 처리기는 이미 그 등급으로 실행되는 확장 코드이고, 클라이언트에 오는 것은 스키마로 검사한 JSON입니다. `architecture.security.spec` §4에는 T-16 행(플러그인 화면이 앱 화면을 흉내 냄, 통제 3·6)을 더할 것을 요청합니다(§6 미결 6).

### 3.6 수명과 실패 격리

| 상태 | 뜻 | 화면 |
|---|---|---|
| `active` | 확장 켜짐, 트리 유효 | 그대로 그림 |
| `loading` | 첫 `query` 대기 | `Skeleton` |
| `invalid` | 트리나 결과가 스키마에 맞지 않음, 모르는 위젯 | 셸 자리표시와 진단 한 줄. 모르는 위젯 노드만 자리표시로 바꾸고 나머지는 그림 |
| `view_disabled` | 화면만 자동으로 꺼짐 | "이 화면이 연속 실패해 꺼졌어요" + "다시 켜기" |
| `extension_disabled` | 확장이 꺼짐(사용자, 자동 끄기, 안전 모드) | 사유와 "확장 상세 열기" |
| `offline` | 엔진 연결 끊김 | 마지막 값을 흐리게, 동작 잠금 |

- [제안] 화면 단위 장부: 화면 하나의 `query` 실패, 결과 스키마 위반, 렌더 예외를 셉니다. 연속 5번이면 그 화면만 `view_disabled`로 둡니다. 확장 전체는 끄지 않습니다. 장부는 클라이언트 메모리에 두고 다시 켜기나 재시작으로 비웁니다.
- [제안] 엔진 쪽 확장 메서드 처리기 실패(`threw`, `timeout`, `result_invalid`)는 X 운영 장부(`X.operations.spec` §4.3)에 같은 확장 키로 셉니다. 기준을 넘으면 확장 전체가 자동으로 꺼지고(`scope.changed`, `reason: "auto_disable"`), 그 확장의 화면은 모두 `extension_disabled`가 됩니다. 메서드 처리기 시간 예산은 새 등급 `view`(기본 5,000ms)로 둡니다(§6 미결 4).
- 렌더 예외는 화면마다 React 오류 경계 안에 둡니다. 한 화면의 실패가 셸과 다른 화면을 멈추지 않습니다.
- 핫 리로드는 X 로더 규칙(`X.loading-trust.spec` §4.4.4)을 따릅니다. 화면 트리 파일이 바뀌면 다음 렌더부터 새 트리를 씁니다.

### 3.7 테마, 문구, 버전

- 테마: 플러그인은 색과 간격을 정하지 않습니다. 렌더러가 caustic 부품과 토큰으로 그리므로 라이트·다크, DP-01~DP-17이 자동으로 맞습니다.
- 문구: `title`과 글 props는 메시지 키(`<확장이름>.<키>`) 또는 그냥 문자열입니다. 키는 확장 패키지의 `locales/<로케일>.json`에서 찾고, 없으면 영어, 그다음 키 자체를 보입니다(ADR-0016 폴백과 같은 순서) [제안].
- 버전: 화면 트리는 `views.schemaVersion`, 부품 목록은 `views.widgets`(SemVer 범위)로 앱과 맞춥니다. 앱이 범위를 채우지 못하면 그 확장의 화면 전체가 `invalid`(`widgets_unsupported`)이고 확장 자체는 그대로 동작합니다. 화면은 확장 패키지와 같은 버전으로 배포됩니다.

### 3.8 CLI 대체

- [제안] `page`와 `well` 기여는 CLI 대체를 하나 둡니다. `cli.command`(예: `/helm status`)이거나, 생략하면 CLI의 일반 렌더러가 같은 트리를 글로 그립니다(제목, 이름표·값, 목록, 표만. 입력 부품은 번호 선택으로).
- `card`는 CLI에서 지금처럼 item 요약 한 줄입니다. `status`는 CLI 상태줄에 같은 글자를 보입니다.

### 3.9 Helm 사용 방식(기준 사례)

[제안] Helm은 다음을 기여합니다. 기존 P-05 탐구 탭은 이 기여로 바뀝니다(`L4.desktop-ux.spec` §6.9).

| slot | id | 내용 | 데이터 |
|---|---|---|---|
| `page` | `helm/inquiry` | 탐구 작업 흐름 전체: 단계 `Stepper`, 렌즈 `ActivityTree`, 발견 목록(신뢰도·출처), 임대·상한 `Meter`, 지난 탐구 목록, 시작·멈춤 | `query ext.helm.status`(결과 `HelmStatusView`), `query ext.helm.inquiries`, `query ext.helm.findings { inquiryId }`, `events grp.helm.*` |
| `well` | `helm/panel` | 지금 대화의 탐구 요약(P-05 A~D 상태) | 같은 `query`, `events` |
| `card` | `helm/finished` | `grp.helm.inquiry.finished` 결과 카드: 결과, 렌즈 수, 발견 수, "탐구 화면 열기" | 이벤트 payload |
| `card` | `helm/suggested` | 제안 알림 카드: 신호와 근거, "탐구 시작" | `grp.helm.signal.detected`(`action: "suggested"`) |
| `status` | `helm/phase` | 단계 칩("탐색 2/3 렌즈") | `query ext.helm.status` |
| `command` | `helm/start`, `helm/stop` | 팔레트 "탐구 시작…", "탐구 멈춤" | `command` 동작 `/helm start`, `/helm stop` |

- `ext.helm.status`, `ext.helm.inquiries`, `ext.helm.findings`는 Helm이 새로 등록하는 `readOnly` 메서드입니다. `ext.helm.status`는 `runHelmCommand`의 status 경로와 같은 `HelmStatusView`를 돌려줍니다. 이 메서드가 생기면 `L4.desktop-ux.spec`의 `[gap:W-04]`가 닫힙니다(`L3.helm.spec` 변경은 §6 미결 5).

## 4. 결과

### 4.1 좋은 점

- 플러그인 코드가 WebView에서 돌지 않습니다. 보안 경계와 CSP가 그대로이고, `project` 등급 확장도 화면을 낼 수 있습니다.
- 모든 플러그인 화면이 caustic과 §13 원칙을 자동으로 따릅니다. 셸이 플러그인 수에 따라 달라 보이지 않습니다.
- 같은 트리로 CLI 글 렌더와 나중의 웹 클라이언트(N15)를 만들 수 있습니다. 화면 트리는 전송과 무관한 데이터입니다.
- Helm과 외부 그룹이 같은 길을 씁니다. Helm이 별도 버전의 기본 플러그인이어도 앱과 버전이 엉키지 않습니다.
- 확장 wire 메서드(`ext.<id>.<verb>`)가 실제로 쓰여 [제안] 상태에서 정해집니다.

### 4.2 감수할 점

- 위젯 카탈로그 밖의 화면(자유 캔버스, 그래프 편집기, 사용자 정의 시각화)은 그릴 수 없습니다. 카탈로그를 넓히는 일은 앱 릴리즈를 거칩니다.
- 앱에 렌더러, 스키마 검사, 바인딩 해석, 화면 장부가 새로 생깁니다. F와 X에 매니페스트 필드, 메서드 등록, 예산 등급이 늘어납니다.
- 표현식을 좁게 두어 복잡한 화면 논리는 엔진 쪽 `query` 처리기로 옮겨야 합니다. 플러그인 작성자는 화면용 메서드를 따로 만들어야 합니다.

## 5. 대안

| 기준 | (a) 선언형 화면 스키마 | (b) 격리 iframe·웹 컴포넌트 + postMessage | (c) 신뢰 내장 React 모듈 | (d) 혼합 [채택] |
|---|---|---|---|---|
| 보안(Tauri WebView) | 플러그인 코드 실행 없음. CSP 그대로 | 플러그인 JS가 WebView 프로세스에서 실행. `frame-src`와 스크립트 허용으로 CSP를 넓혀야 함. Tauri IPC가 iframe에 노출되는지 플랫폼마다 확인 필요 | 저장소 코드만. 검토된 코드라 위험 낮음 | (a)와 같음. (b)는 열지 않음 |
| 신뢰하지 않은 확장 | `project` 등급도 안전하게 화면 가능 | `project` 등급에 허용하기 어려움 | 외부 확장 불가 | `project`까지 (a) |
| 비밀 | 바인딩에서 제외, 셸 부품만 | 다리(bridge)에서 막아야 하고, 실수 한 번이 유출 | 앱 규칙 그대로 | (a)와 같음 |
| X 신뢰 등급과의 맞춤 | 엔진 쪽 처리기가 이미 등급으로 실행 | 클라이언트 쪽에 두 번째 권한 모델이 생김 | 등급과 무관(내장만) | 엔진 한 곳에서 판정 |
| 격리 | 화면별 오류 경계, 장부 | 프레임 단위 격리가 가장 강함 | 앱과 같은 프로세스·번들 | (a) |
| 능력 범위 API | 매니페스트 선언 메서드만 | postMessage 다리에 같은 검사를 다시 구현 | 앱 내부 API 전부 | (a) |
| caustic 테마 | 자동 | 토큰을 iframe에 주입해야 하고 모양이 쉽게 달라짐 | 자동 | 자동 |
| i18n | 확장 카탈로그 + 앱 폴백 | 플러그인이 직접 | 앱 카탈로그 | (a) |
| 패키징·버전 | 확장과 함께, `widgets` 범위로 앱과 맞춤 | 확장과 함께, 다리 API 버전 필요 | 앱과 함께. Helm처럼 따로 배포되는 그룹과 버전이 엉킴 | (a) |
| CLI 대체 | 같은 트리를 글로 렌더 가능 | 없음 | 없음 | (a) |
| 작업량 | M~L(스키마, 렌더러, wire) | L + 보안 검토, 플랫폼별 확인 | 화면당 S, 그러나 외부 확장 불가 | (a) + 카탈로그 구현 |
| 채택하지 않은 이유 | 단독으로도 충분하지만 앱 화면과 카탈로그 구현은 React가 필요해 (d)로 정리 | 위 보안 비용. 2차 탈출구로 이름만 예약 | Helm이 `user` 등급 기본 플러그인이라 대상이 안 됨. 외부 그룹이 화면을 못 냄 | |

## 6. 미결 사항

1. [미결] (b) 탈출구를 둘지, 둔다면 `user` 등급 이상만 허용할지. Tauri iframe의 IPC 노출과 CSP 변경을 macOS·Linux에서 확인한 뒤 정합니다.
2. [미결] `ExtensionManifest.views`와 `ViewContribution`, 화면 트리 스키마(`ViewNode`)의 정본 위치. 제안은 `F.extensions.spec` 새 파일 `views.ts`입니다. 위젯 카탈로그 이름 목록을 F에 둘지 L4에 둘지도 함께 정합니다.
3. [미결] 확장 wire 메서드를 여는 일(`F.wire-settings.spec` §4.2 [제안] 확정), `ext.view.post`·`ext.view.requestApproval` 두 코어 메서드, 확장 메서드 등록 API(`X.primitives.spec` `hostOf(g).registerMethod`, `L3.group-kit.spec` `g.registerMethod`).
4. [미결] `X.operations.spec` 예산 등급 `view`(기본 5,000ms)와, 확장 메서드 처리기 실패를 운영 장부에 넣는 규칙.
5. [미결] Helm의 `ext.helm.status`, `ext.helm.inquiries`, `ext.helm.findings` 메서드와 화면 기여(`L3.helm.spec` §3.9, §8).
6. [미결] `architecture.security.spec` §4 T-16 행(플러그인 화면의 흉내 위험)과 확장 메서드 결과의 마스킹 위치.
7. [미결] `requestApproval`의 승인 kind. 새 kind(`plugin`)를 둘지 `question` kind에 출처(`ext:<이름>`)를 실을지(ADR-0018 §3 2번 변경 여부).
8. [미결] `events` 바인딩의 kind 거름 인자를 `events.subscribe`에 둘지, 확장 화면 전용 구독을 둘지(`F.wire-settings.spec`).
9. [가정] 위젯 카탈로그 v1로 Helm 탐구 화면을 그릴 수 있습니다. 작업대 시안(`L4.desktop-ux.spec` §14, 화면 W4)에서 확인합니다.
