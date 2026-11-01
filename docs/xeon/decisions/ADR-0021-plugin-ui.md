---
id: adr.0021
layer: adr
domain: plugin-ui
kind: adr
status: accepted
depends_on: [adr.0007, adr.0008, adr.0010, adr.0016, adr.0017, adr.0018, adr.0020, architecture.security.spec, F.extensions.spec, F.wire-settings.spec, X.loading-trust.spec, X.operations.spec, L3.group-sdk.spec, L3.helm.spec, L3.authoring.spec, L4.desktop.spec, L4.desktop-ux.spec]
binds: [xeon/apps/desktop/src/views/**, xeon/packages/client/**, xeon/packages/contracts/src/extensions/**]
---

# ADR-0021 플러그인 화면 기여: 선언형 모드와 격리 프레임 모드

## 1. 상태와 날짜

- 상태: accepted(방식). 스키마와 이름의 세부는 [제안]이고 정본은 F가 정합니다(§6).
- 날짜: 2026-10-30 초안, 2026-10-31 개정
- [결정: 2026-10-30 사용자] Xeon은 층별 플러그인(F, X, L0~L3)을 조립하고 적응시키는 대화형 에이전트 런타임입니다. Helm 같은 의도 그룹(에이전트 안의 에이전트 시스템)이 핵심 단위입니다.
- [결정: 2026-10-30 사용자] 대화 화면과 런타임 작업이 둘 다 1급입니다. 원문: "핵심은 대화화면이라는 건 어쨋든 에이전트 런타임의 숙명이라고 봄. 그래서 둘다 1급인느낌."
- [결정: 2026-10-30 사용자] 플러그인마다 클라이언트 안에서 자기 화면을 구성할 수 있어야 합니다. 원문: "플러그인 별로 우리 클라이언트 안에서 자기만의 ui 화면을 구성할 수 있는 시스템을 지원했으면 해, 단순 특정 파일을 렌더링 한다기 보다는, 어떤 플러그인을 어댑팅 했을 때, 이 플러그인이 만약 l3고 자기만의 워크플로우나 에이전틱한 흐름에서 대화창이 아닌 커스텀한 화면을 요구한다면 이를 지원할 수 있어야 해."
- [결정: 2026-10-31 사용자] 두 모드를 모두 지원합니다. 선언형 모드(클라이언트가 caustic으로 그림)와 격리 iframe·웹 컴포넌트 모드입니다. 에이전트가 플러그인을 만들 때 어느 모드가 필요한지는 에이전트가 판단합니다(`L4.desktop-ux.spec` §12.3 U-1).
- 2026-10-30 초안의 "(d) 혼합, 선언형만, iframe은 이름만 예약"은 이 개정으로 바뀝니다.

## 2. 맥락

- 지금 확장이 클라이언트에 정보를 보내는 길은 내구 이벤트(`x.<확장id>.*`, `grp.<그룹>.*`)뿐입니다(`F.wire-settings.spec` §4.2). 데스크톱은 이 이벤트를 종류 이름과 요약만 있는 일반 item으로 그립니다(`L4.desktop.spec` §4.13).
- 확장 wire 메서드 `ext.<확장id>.<동사>`는 이름 규칙만 예약된 [제안]입니다. params·result 스키마는 매니페스트에 선언합니다(`F.wire-settings.spec` §4.2, §3.5.3 오류 코드 구간 10000~19999).
- Helm 탐구 화면(`L4.desktop-ux.spec` P-05)은 `command.run { text: "/helm status" }` 결과를 임시로 읽습니다(`[gap:W-04]`). 그룹마다 같은 간극이 생깁니다.
- [결정: review.decisions-2 U-07] 핸들러에 UI 포트(`HandlerContext.ui`)를 두지 않습니다(`X.operations.spec` §4.2.3). 확장이 TUI 컴포넌트를 돌려주는 방식은 원격·웹 클라이언트로 옮길 수 없습니다(`_research/refs/pi.md` 415행).
- 신뢰 등급은 `builtin`, `user`, `project`, `untrusted` 넷이고 `untrusted`는 import하지 않습니다(`X.loading-trust.spec` §4.6.2, §4.6.3). Helm은 사용자 확장 위치에 설치되는 `user` 등급 기본 플러그인입니다(`L3.helm.spec` §3.1).
- 데스크톱 WebView는 CSP `default-src 'self'`이고 셸은 바이트만 릴레이합니다(`architecture.security.spec` B-09, T-11). 신뢰하지 않은 스크립트가 앱 문서 안에서 돌면 wire 연결 전체(승인 응답 포함)를 쓸 수 있습니다.
- 선언형 위젯 카탈로그로는 자유 캔버스, 그래프 편집기, 사용자 정의 시각화를 그릴 수 없습니다. 의도 그룹은 자기 작업 흐름에 맞는 화면을 요구할 수 있습니다(위 2026-10-30 결정 원문).
- 플러그인은 에이전트가 만듭니다. 제작 확장(`L3.authoring.spec`)이 뼈대, 검사, 시험, 패키징을 돕고, 모드 고르기도 그 흐름 안에서 일어납니다.
- 디자인 시스템은 caustic이고 시각 원칙은 `L4.desktop-ux.spec` §13입니다. 문구는 ICU 메시지 키와 ko·en 카탈로그를 씁니다(ADR-0016).

## 3. 결정

### 3.1 방식

1. [결정: 2026-10-31 사용자] 플러그인 화면은 두 모드로 기여합니다.
   - `declarative`(선언형): 확장은 화면 트리 JSON만 냅니다. 앱이 caustic 부품으로 그립니다. 플러그인 코드는 WebView에서 돌지 않습니다.
   - `frame`(격리 프레임): 확장 패키지의 HTML·JS를 격리 iframe 안에서 실행합니다. 프레임 안에서는 웹 컴포넌트를 포함한 어떤 DOM 기술도 쓸 수 있습니다. 앱과는 postMessage 다리(bridge)로만 이야기하고, 다리는 능력 범위 API(§3.4)만 엽니다.
2. [결정: 2026-10-31 사용자] 모드는 매니페스트에서 화면(`ViewContribution`)마다 선언합니다. 한 확장이 화면마다 다른 모드를 쓸 수 있습니다.
3. [결정: 2026-10-31 사용자] 어느 모드가 필요한지는 플러그인을 만드는 에이전트가 판단합니다. 판단 기준과 등급별 기본값은 §3.5입니다. 사용자 설정과 등급 규칙이 그 판단을 제한할 수 있습니다(§3.6.7).
4. [제안] 앱 내장 React 코드는 앱 자신의 화면(대화, 작업대, 설정), 선언형 렌더러와 위젯 카탈로그 구현, 프레임 호스트(틀, 다리, 장부)에만 씁니다. 특정 플러그인 전용 React 모듈은 두지 않습니다.
5. [제안] Helm 탐구 화면은 선언형 기준 사례로 남습니다(§3.10). 위젯 카탈로그로 그릴 수 없는 화면이 나오면 카탈로그를 넓힐지, 그 화면을 `frame`으로 둘지를 §3.5 기준으로 정합니다.

### 3.2 기여 지점(slot)

[제안] 플러그인은 여섯 곳에 화면을 기여합니다. 각 기여는 매니페스트의 화면 선언 하나입니다.

| slot | 위치(`L4.desktop-ux.spec`) | 크기와 규칙 | 기본 개수 상한 | 허용 모드 |
|---|---|---|---|---|
| `page` | 작업대 플러그인 화면 호스트(P-18), 대화에서 링크로 열기 | 가운데 전체. 왼쪽 패널과 오른쪽 막대는 셸 것 | 확장당 4 | `declarative`, `frame` |
| `well` | 대화 영역 오른쪽 떠 있는 막대의 탭 하나와 well | 폭 320~480, 열린 대화 하나의 맥락 | 확장당 1 | `declarative`, `frame` |
| `card` | 대화 트랜스크립트 안 카드 | 자기 레코드 kind 하나(`forKind`). 높이 상한 320, 넘으면 "더 보기"로 `page`나 `well` | kind당 1 | `declarative` |
| `status` | 상태 표시줄 칸 하나 | 글자 24자, tone 하나, 누르면 `Popover` | 확장당 1 | `declarative` |
| `command` | 명령 팔레트 묶음 "플러그인" | 라벨, 보조 설명, 동작 하나 | 확장당 16 | 화면 없음 |
| `settings` | 설정 "플러그인과 그룹" 탭과 확장 상세(P-17) 설정 구역 | 스키마 설정 필드(X10)에 읽기 전용 부품만 더함 | 확장당 1 | `declarative` |

- `frame`은 `page`와 `well`에만 둡니다 [제안]. 카드, 상태 칸, 설정 구역은 셸 틀 안에 섞여 보이는 작은 면이라 셸과 같은 모양이어야 하고, 프레임 수가 대화 길이에 따라 늘면 비용과 격리 장부가 커집니다.
- `card`가 없는 확장 레코드는 지금처럼 일반 item으로 그립니다.
- `status`와 `well`은 열린 대화가 있을 때만 그립니다. `page`는 대화 맥락(`host.thread`)이 없어도 그릴 수 있어야 합니다.
- 상한을 넘는 선언과 허용 모드 밖의 선언은 로더 진단 `view_limit`, `view_mode_not_allowed`로 버립니다 [제안].

### 3.3 매니페스트 모양(개념)

[제안] `ExtensionManifest`(`F.extensions.spec` §3.1)에 선택 필드 `views`를 더합니다. 아래는 개념 모양이고 타입 정본은 F가 정합니다(§6 미결 2).

```ts
// 개념 모양. 정본은 F.extensions.spec(views.ts [제안])
type ViewMode = "declarative" | "frame";
interface ViewContribution {
  readonly id: string;                 // 확장 안에서 유일. 전체 id는 "<확장이름>/<id>"
  readonly slot: "page" | "well" | "card" | "status" | "command" | "settings";
  readonly mode?: ViewMode;            // 생략하면 "declarative". command는 화면이 없어 무시
  readonly title: string;              // 메시지 키 또는 문자열(§3.8)
  readonly icon?: string;              // caustic 아이콘 어댑터 이름(DP-17)
  readonly file?: string;              // declarative: 화면 트리 JSON 경로
  readonly frame?: FrameDecl;          // frame: 프레임 선언
  readonly fallback?: string;          // frame: CLI와 프레임 금지 때 쓰는 화면 트리 JSON(선택)
  readonly forKind?: string;           // card 전용
  readonly when?: { readonly thread?: "required" | "optional" };
  readonly cli?: { readonly command?: string };   // CLI 대체(§3.9)
}
interface FrameDecl {
  readonly root: string;               // 프레임 파일 폴더. 예 "./views/graph"
  readonly entry: string;              // root 안 HTML. 예 "index.html"
  readonly bridge: string;             // 다리 API 범위. 예 "^1.0.0"
  readonly reason: string;             // 선언형으로 그릴 수 없는 이유 한 줄
}
interface ViewsDecl {
  readonly schemaVersion: 1;
  readonly widgets?: string;           // declarative 화면이 있으면 필수. 위젯 카탈로그 범위
  readonly items: readonly ViewContribution[];
  readonly methods?: readonly ExtMethodDecl[];   // 화면이 부르는 ext.<id>.<동사>
  readonly messages?: string;          // 카탈로그 폴더. 예 "./locales"
}
interface ExtMethodDecl {
  readonly verb: string;               // ext.<확장이름>.<verb>
  readonly params: unknown;            // JSON Schema
  readonly result: unknown;            // JSON Schema
  readonly readOnly: boolean;          // 참이면 사용자 조작 없이 부를 수 있음
  readonly approval?: boolean;         // 참이면 호출 전에 표준 승인 카드
}
```

- `methods`는 `F.wire-settings.spec` §4.2의 "확장 메서드의 params·result 스키마를 매니페스트에 선언"을 채웁니다. 확장 코드는 엔진 쪽에서 같은 이름으로 처리기를 등록합니다(`hostOf(g).registerMethod`, `g.registerMethod` [제안], §6 미결 3).
- 화면 트리 파일(`*.view.json`)과 프레임 폴더는 확장 패키지 안에 둡니다. 내장 패키지는 화면 트리를 TS 상수로 export할 수 있습니다.
- `frame.reason`은 비어 있으면 안 됩니다. 제작 확장의 검사(`L3.authoring.spec`)와 확장 신뢰 확인(O-10)이 이 문장을 그대로 보입니다.

### 3.4 호스트 API(두 모드 공통)

선언형 트리의 바인딩과 프레임 다리는 같은 API 표를 씁니다. 모든 검사는 엔진과 셸이 합니다. 화면 쪽 검사는 표시용입니다.

| 구분 | 이름 | 하는 일 | 허용 범위 | wire |
|---|---|---|---|---|
| 읽기 | `query` | 자기 `readOnly` 메서드 호출 | 매니페스트 `views.methods`의 `readOnly: true` 메서드 | `ext.<id>.<verb>` |
| 읽기 | `events` | 열린 대화의 이벤트를 접어 목록·최신 값으로 | 자기 kind(`x.<id>.*`, `grp.<id>.*`), 매니페스트 `readsRecordKinds`, 코어 허용 목록(`turn.*`, `lease.*`, 자기 소유 `scope.changed`·`scope.handler_failed`) | `events.subscribe`, `thread.read`(kind 거름은 §6 미결 8) |
| 읽기 | `settings` | 자기 설정 값 | `ext.<id>.*`, 내장 그룹의 `l3.<id>.*`. `secret: true` 키는 "설정됨/없음" 상태만 | `settings.get` |
| 읽기 | `host` | 고정 맥락: 열린 대화 id·제목, 연결 상태, 로케일, 테마, 자기 확장 상태(켜짐, 신뢰 등급, 안전 모드) | 읽기 전용 | 클라이언트 거울 |
| 동작 | `call` | 자기 쓰기 메서드 호출 | `readOnly: false` 메서드, 사용자 조작 뒤에만. `approval: true`면 승인 카드를 먼저 | `ext.<id>.<verb>` |
| 동작 | `command` | 자기 슬래시 명령 실행 | 자기 확장이 등록한 명령만 | `command.run` |
| 동작 | `post` | 열린 대화 입력 큐에 넣기 | 신뢰 등급의 `post` 허용, scope 켜짐 | `ext.view.post` `[미결]` |
| 동작 | `requestApproval` | 사용자 승인 요청 | 앱이 그리는 표준 승인 카드로만 보임(ADR-0018). 화면은 결과만 받음 | `ext.view.requestApproval` `[미결]` |
| 동작 | `navigate` | 자기 다른 화면, 대화·턴, 확장 상세(P-17), 자기 설정 구역, 비밀 화면(P-10) 열기, 외부 링크 | 앱 화면은 정해진 목록만. 외부 링크는 셸 확인 뒤 OS 브라우저 | 클라이언트 |

- "사용자 조작 뒤에만"의 판정: 선언형은 렌더러가 누름 이벤트를 압니다. 프레임은 셸이 프레임 안 입력을 볼 수 없으므로, 프레임의 `call`은 셸이 띄우는 확인 줄("<확장>이 <동작 라벨>을 하려고 해요")을 거칩니다. 확인 줄은 확장·세션마다 "이 화면에서 묻지 않기"로 끌 수 있고, `approval: true` 메서드는 승인 카드를 끌 수 없습니다 [제안].
- `query` 갱신: `invalidateOn`(자기 kind 목록) 이벤트가 오면 다시 부릅니다. 주기 갱신은 5초 이상만 허용합니다 [제안].
- 크기 상한 [제안]: `query` 결과 256 KiB, `events` 목록 500행. 선언형 트리는 노드 2000개, 깊이 24입니다. 프레임 다리 메시지는 하나에 1 MiB, 초당 50개입니다. 넘으면 선언형은 그 노드를 "긴 내용"으로 자르고, 프레임은 그 메시지를 오류로 돌려주고 장부에 셉니다.

#### 3.4.1 선언형 화면 트리

- 노드: `{ type, props?, bind?, each?, when?, children? }`. `type`은 위젯 카탈로그 이름입니다. `props`는 caustic 부품의 `variant`, `tone`, `size` 같은 선택값과 글자만 받습니다(DP-08). 색, 크기 숫자, CSS, HTML은 받지 않습니다.
- 표현식: 데이터 경로(JSON Pointer)와 같음·있음·없음 비교, 배열 반복(`each`)만 둡니다. 스크립트와 함수 호출은 두지 않습니다. 숫자·시간·바이트·상대 시각 서식은 호스트가 이름으로 제공합니다(`format: "duration"` 등).
- 위젯 카탈로그 v1(초안): 배치(`Stack`, `Row`, `Section`, `Tabs`, `Split`), 글(`Text`, `Heading`, `Markdown`(HTML 없는 부분 집합), `Code`), 자료(`List`, `Table`, `ListDescription`, `Badge`, `Chip`, `Progress`, `Meter`, `Stepper`, `ActivityTree`, `Timeline`, `Sparkline`), 알림(`Alert`, `EmptyState`, `Skeleton`), 입력(`Button`, `Switch`, `Select`, `TextField`, `NumberField`, `SegmentedControl`, `Form`), 연결(`ThreadLink`, `TurnLink`, `ViewLink`, `ApprovalLink`). 이름은 caustic export와 같게 두고, caustic에 없는 것은 `L4.desktop-ux.spec` §9 간극으로 올립니다.

#### 3.4.2 프레임 다리

- [제안] 셸은 프레임이 불러와지면 `MessageChannel` 하나를 만들어 포트 하나를 프레임에 한 번만 넘깁니다. 프레임 origin은 불투명이라 대상 origin을 지정할 수 없으므로, 셸은 `iframe.contentWindow`가 보낸 `ready` 메시지에만 포트를 넘깁니다. 그 뒤 모든 메시지는 그 포트로만 오가고, 포트 밖 `message`는 버립니다.
- 메시지 형식: 요청 `{ v: 1, id, op, args }`, 응답 `{ v: 1, id, ok, value | error }`, 셸이 먼저 보내는 `{ v: 1, push: "theme" | "host" | "event" | "invalidate", value }`입니다. `op`는 §3.4 표의 이름 아홉 개와 `resize`(well 높이 안내), `log`(진단 줄, 길이 상한), `pong`뿐입니다.
- 셸은 요청마다 `op` 허용 목록, `args` 스키마, 매니페스트 선언(`methods`, `readsRecordKinds`), 확장 상태(켜짐, 안전 모드)를 확인한 뒤 wire를 부릅니다. 엔진은 같은 검사를 다시 합니다. 판정의 정본은 엔진입니다.
- 다리 API 버전은 `frame.bridge`(SemVer 범위)로 맞춥니다. 앱이 범위를 채우지 못하면 그 화면은 `invalid`(`bridge_unsupported`)입니다.
- 다리 클라이언트 라이브러리(`@fresnel/view-bridge` [제안])는 타입 있는 얇은 래퍼만 제공합니다. 판정은 셸 쪽에 있으므로 프레임 코드가 이 라이브러리를 쓰지 않아도 보안이 바뀌지 않습니다.

### 3.5 모드 고르기: 플러그인 제작 에이전트의 기준

[결정: 2026-10-31 사용자] 모드는 에이전트가 고릅니다. 아래는 에이전트가 따르는 기준이고, 제작 확장(`L3.authoring.spec`)의 검사가 같은 기준으로 경고를 냅니다 [제안].

| 질문 | 선언형 | 프레임 |
|---|---|---|
| 위젯 카탈로그로 그릴 수 있는가(목록, 표, 상태, 단계, 폼, 활동 트리) | 예 → 선언형 | |
| 자유 배치, 그래프·노드 편집, 캔버스, 사용자 정의 차트, 지속적 애니메이션이 핵심인가 | | 예 → 프레임 |
| CLI·원격·나중의 웹 클라이언트에서 같은 화면이 필요한가 | 예 → 선언형(같은 트리를 글로 렌더) | 프레임이면 `fallback` 트리를 함께 냄 |
| 카드, 상태 칸, 설정 구역인가 | 선언형만 | 허용 안 됨 |
| 외부 라이브러리(그래프, 지도, 편집기)가 필요한가 | | 프레임. 라이브러리는 패키지 안에 번들(네트워크 없음) |
| 요청 신뢰 등급이 `project`인가 | 선언형 | 기본 금지(§3.6.7) |
| 화면이 승인, 비밀, 사용자 입력 확인을 다루는가 | 선언형 + 표준 승인 카드 | 프레임도 승인은 `requestApproval`로만 |

- 기본은 선언형입니다. 에이전트는 표의 프레임 행 중 하나에 해당할 때만 프레임을 고르고, 그 이유를 `frame.reason`에 한 줄로 적습니다.
- 같은 확장 안에서 화면마다 다르게 고릅니다. 예: 그래프 편집 `page`는 프레임, 요약 `well`과 결과 `card`는 선언형.
- 같은 프레임 화면 모양이 여러 플러그인에서 되풀이되면 그 모양을 위젯 카탈로그 후보로 올립니다. 제작 확장이 이 후보를 기록합니다(`L3.authoring.spec` §4.4).

등급별 기본값 [제안]:

| 요청 등급 | 선언형 | 프레임 | 처음 켤 때 |
|---|---|---|---|
| `builtin` | 허용 | 허용 | 확인 없음 |
| `user` | 허용 | 허용 | 확장 신뢰 확인(O-10)에 "자체 화면 코드 실행"과 `frame.reason`을 보임 |
| `project` | 허용 | 기본 금지. `x.views.allowProjectFrames`(기본 `false`, `allowedScopes: ["managed", "user"]`) [제안]가 참일 때만 | 프로젝트 신뢰(O-04) `allow` + O-10 |
| `untrusted` | 로드 안 함 | 로드 안 함 | 해당 없음 |

### 3.6 보안과 신뢰

#### 3.6.1 선언형

1. 화면 트리는 데이터이고 렌더러는 앱 코드입니다. CSP `default-src 'self'`와 B-09 경계를 바꾸지 않습니다.
2. `Markdown` 위젯은 HTML을 받지 않습니다. 링크는 `http(s)`만 허용하고 외부 링크는 셸 확인 뒤 OS 브라우저로 엽니다.

#### 3.6.2 프레임 격리

1. [제안] 프레임은 `<iframe sandbox="allow-scripts">`입니다. `allow-same-origin`, `allow-popups`, `allow-modals`, `allow-forms`, `allow-top-navigation`, `allow-downloads`를 주지 않습니다. 그래서 프레임 문서의 origin은 불투명이고, 앱 문서의 DOM, 저장소, 쿠키에 닿지 못하며 창을 열거나 앱을 다른 곳으로 이동시키지 못합니다.
2. [제안] 프레임 파일은 셸이 등록한 전용 URI 스킴(`xeon-view://<확장이름>/<버전>/<경로>`)으로만 제공합니다. 셸은 확장 패키지의 `frame.root` 아래 파일만 읽고, `..`, 폴더 밖을 가리키는 심볼릭 링크, 절대 경로를 거부합니다. 앱 자원과 다른 확장 파일은 이 스킴으로 나오지 않습니다.
3. [제안] Tauri IPC(`window.__TAURI__`, invoke)는 프레임에 주입되지 않아야 합니다. 셸 capability 파일의 원격·iframe 허용 목록에 `xeon-view:`를 넣지 않습니다. 이 동작을 macOS(WKWebView)와 Linux(WebKitGTK)에서 e2e 시험으로 확인한 뒤에만 프레임 모드를 켭니다(§6 미결 1). 확인 전 빌드는 `x.views.frames`(기본 `true`) [제안]를 `false`로 고정합니다.

#### 3.6.3 CSP

- 앱 문서: 기존 `default-src 'self'`에 `frame-src xeon-view:`만 더합니다. `unsafe-eval`, 원격 `script-src`는 더하지 않습니다.
- 프레임 문서(셸이 응답 헤더로 붙임) [제안]: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'none'; frame-src 'none'; worker-src 'self' blob:; form-action 'none'; base-uri 'none'`. 네트워크 요청, 다른 프레임 열기, `eval`은 막힙니다. 프레임 HTML의 `<meta>` CSP는 이 헤더보다 넓힐 수 없습니다.

#### 3.6.4 wire 직접 연결 없음

- 프레임은 wire 연결, 엔진 소켓, 셸 IPC 어느 것도 받지 않습니다. 프레임이 할 수 있는 일은 다리의 `op`뿐이고, 다리는 셸 안에서 자기 확장 범위로 좁힌 wire 호출로 바뀝니다. `connect-src 'none'`이라 프레임이 원격 서비스 주소를 알아도 붙을 수 없습니다.

#### 3.6.5 비밀은 다리를 건너지 않음

- `settings`는 `secret: true` 키의 값 대신 "설정됨/없음"만 줍니다. 비밀 값 열람과 입력은 `navigate`로 셸 비밀 화면(P-10)을 여는 것뿐입니다.
- `query`·`call` 결과는 엔진이 마스킹 계층(`L0.secrets.spec` §4.5)을 거쳐 보냅니다. 같은 마스킹이 선언형에도 적용됩니다(§6 미결 6).
- 다리 메시지는 진단 로그에 op와 크기만 남기고 값은 남기지 않습니다.

#### 3.6.6 승인은 언제나 셸이 그림

- `requestApproval`과 `approval: true` 메서드는 엔진이 `fresnel.approvals`로 승인을 만들고, 셸이 표준 승인 카드(트랜스크립트, 받은 요청)로 그립니다. 화면은 결과(`allow`, `deny`, 만료)만 받습니다.
- 프레임은 자기 slot 상자 밖에 그릴 수 없고 전체 화면, 팝업, 모달을 열 수 없습니다(§3.6.2). 셸 머리(확장 이름, 등급, 버전, `project` 배지)와 승인 카드는 프레임 밖 셸 층에 있습니다. 프레임 안에 "허용" 버튼을 그려도 승인이 되지 않습니다.

#### 3.6.7 등급과 사용자 제한

- 화면 기여는 그 확장이 로드됐을 때만 보입니다. `untrusted`는 로드하지 않으므로 화면도 없습니다.
- 프레임 허용은 §3.5 등급표를 따릅니다. 사용자는 `x.views.frames = false`로 모든 프레임을 끌 수 있습니다. 그러면 `fallback`이 있는 화면은 선언형으로, 없는 화면은 "이 화면은 자체 코드가 필요해요" 자리표시로 보입니다.
- 안전 모드에서 빠진 확장의 화면은 자리표시 상태로 보입니다(§3.7).

#### 3.6.8 테마 토큰 전달

- 셸은 처음과 테마가 바뀔 때 `push: "theme"`로 caustic 토큰 값(CSS 사용자 속성 이름과 값), 라이트·다크, 밀도, 로케일, `prefers-reduced-motion`, 한글 타이포 규칙(DP-11)을 보냅니다. 셸은 `xeon-view://_caustic/tokens.css`(앱에 든 `@caustic/tokens` 사본, 읽기 전용)도 제공합니다 [제안].
- 프레임 안 모양을 caustic에 맞추는 일은 플러그인 몫입니다. 셸은 머리와 상자 경계를 그려 프레임 화면이 앱 화면처럼 보이지 않게 합니다(§3.6.6).

#### 3.6.9 위협 표

`architecture.security.spec` §4에 다음 행을 더할 것을 요청합니다(§6 미결 6).

| 위협 | 통제 |
|---|---|
| T-16 플러그인 화면이 앱 화면이나 승인 카드를 흉내 냄 | 셸 머리, `project` 배지, 승인은 셸만 그림(§3.6.6) |
| T-17 프레임 스크립트가 IPC, wire, 비밀에 닿음 | sandbox, 전용 스킴, IPC 미주입 e2e, 다리 허용 목록, 비밀 제외(§3.6.2~§3.6.5) |
| T-18 프레임이 무한 루프나 메모리 폭주로 셸을 멈춤 | 생존 확인, 숨은 프레임 내리기, 화면 장부(§3.7). 같은 WebView 프로세스 안이라 완전한 격리는 아님(§4.2) |

### 3.7 수명과 실패 격리

| 상태 | 뜻 | 화면 |
|---|---|---|
| `active` | 확장 켜짐, 트리 유효 또는 프레임 준비됨 | 그대로 그림 |
| `loading` | 첫 `query` 대기 또는 프레임 `ready` 대기 | `Skeleton` |
| `invalid` | 트리·결과 스키마 위반, 모르는 위젯, `widgets_unsupported`, `bridge_unsupported`, 프레임 파일 없음 | 셸 자리표시와 진단 한 줄. 선언형은 모르는 위젯 노드만 자리표시 |
| `view_disabled` | 화면만 자동으로 꺼짐 | "이 화면이 연속 실패해 꺼졌어요" + "다시 켜기" |
| `frame_blocked` | 등급이나 설정 때문에 프레임 금지 | `fallback` 트리 또는 자리표시와 사유 |
| `extension_disabled` | 확장이 꺼짐(사용자, 자동 끄기, 안전 모드) | 사유와 "확장 상세 열기" |
| `offline` | 엔진 연결 끊김 | 마지막 값을 흐리게, 동작 잠금. 프레임에는 `push: "host"`로 알림 |

- [제안] 화면 단위 장부: 선언형은 `query` 실패, 결과 스키마 위반, 렌더 예외를 셉니다. 프레임은 `ready`가 5초 안에 오지 않음, 다리 형식 위반, 상한 초과, 생존 확인(5초 간격 `ping`) 무응답 2번을 셉니다. 연속 5번이면 그 화면만 `view_disabled`로 둡니다. 확장 전체는 끄지 않습니다. 장부는 클라이언트 메모리에 두고 다시 켜기나 재시작으로 비웁니다.
- [제안] 엔진 쪽 확장 메서드 처리기 실패(`threw`, `timeout`, `result_invalid`)는 X 운영 장부(`X.operations.spec` §4.3)에 같은 확장 키로 셉니다. 기준을 넘으면 확장 전체가 자동으로 꺼지고(`scope.changed`, `reason: "auto_disable"`), 그 확장의 화면은 모두 `extension_disabled`가 됩니다. 메서드 처리기 시간 예산은 새 등급 `view`(기본 5,000ms)입니다(§6 미결 4).
- 선언형 렌더 예외는 화면마다 React 오류 경계 안에 둡니다. 프레임은 slot이 보이지 않으면(다른 탭, 다른 화면) 내리고 다시 보일 때 새로 띄웁니다. 오래 남길 상태는 플러그인이 `query`·`call`로 엔진에 둡니다.
- 핫 리로드는 X 로더 규칙(`X.loading-trust.spec` §4.4.4)을 따릅니다. 트리 파일이나 프레임 폴더가 바뀌면 다음 렌더부터 새 파일을 씁니다.

### 3.8 테마, 문구, 버전

- 선언형: 플러그인은 색과 간격을 정하지 않습니다. 렌더러가 caustic 부품과 토큰으로 그리므로 라이트·다크와 §13 원칙이 자동으로 맞습니다.
- 프레임: 토큰을 받아 플러그인이 맞춥니다(§3.6.8).
- 문구: `title`과 글 props는 메시지 키(`<확장이름>.<키>`) 또는 문자열입니다. 키는 확장 패키지 `locales/<로케일>.json`에서 찾고, 없으면 영어, 그다음 키 자체입니다(ADR-0016과 같은 순서) [제안]. 프레임은 `host.locale`을 받아 스스로 번역합니다.
- 버전: 선언형은 `views.schemaVersion`과 `views.widgets`, 프레임은 `frame.bridge`로 앱과 맞춥니다. 범위를 채우지 못하면 그 화면만 `invalid`이고 확장은 그대로 동작합니다. 화면은 확장 패키지와 같은 버전으로 배포됩니다.

### 3.9 CLI 대체

- [제안] `page`와 `well` 기여는 CLI 대체를 하나 둡니다. `cli.command`(예: `/helm status`)이거나, 생략하면 CLI의 일반 렌더러가 선언형 트리(프레임이면 `fallback`)를 글로 그립니다. 둘 다 없으면 CLI는 "데스크톱에서 보기" 한 줄입니다.
- `card`는 CLI에서 지금처럼 item 요약 한 줄입니다. `status`는 CLI 상태줄에 같은 글자를 보입니다.

### 3.10 Helm 사용 방식(선언형 기준 사례)

[제안] Helm은 모든 기여를 선언형으로 둡니다. 기존 P-05 탐구 탭은 이 기여로 바뀝니다(`L4.desktop-ux.spec` §6.9).

| slot | id | 내용 | 데이터 |
|---|---|---|---|
| `page` | `helm/inquiry` | 탐구 작업 흐름 전체: 단계 `Stepper`, 렌즈 `ActivityTree`, 발견 목록, 임대·상한 `Meter`, 지난 탐구, 시작·멈춤 | `query ext.helm.status`(`HelmStatusView`), `ext.helm.inquiries`, `ext.helm.findings { inquiryId }`, `events grp.helm.*` |
| `well` | `helm/panel` | 지금 대화의 탐구 요약 | 같은 `query`, `events` |
| `card` | `helm/finished` | `grp.helm.inquiry.finished` 결과 카드 | 이벤트 payload |
| `card` | `helm/suggested` | 제안 알림 카드 | `grp.helm.signal.detected`(`action: "suggested"`) |
| `status` | `helm/phase` | 단계 칩("탐색 2/3 렌즈") | `query ext.helm.status` |
| `command` | `helm/start`, `helm/stop` | 팔레트 "탐구 시작…", "탐구 멈춤" | `/helm start`, `/helm stop` |

- `ext.helm.status`가 생기면 `L4.desktop-ux.spec`의 `[gap:W-04]`가 닫힙니다(§6 미결 5).
- 프레임 기준 사례는 카탈로그 밖 화면이 처음 나올 때 정합니다. 후보는 제작 확장이 만든 시험 플러그인 하나입니다(`L3.authoring.spec` §9 A-6) [제안].

## 4. 결과

### 4.1 좋은 점

- 대부분의 화면(목록, 상태, 단계, 폼)은 선언형으로 caustic과 §13 원칙을 자동으로 따르고, CLI와 웹 클라이언트로 옮길 수 있습니다.
- 카탈로그 밖 화면(캔버스, 그래프 편집, 사용자 정의 시각화)도 앱 릴리즈를 기다리지 않고 플러그인이 낼 수 있습니다.
- 두 모드가 같은 호스트 API를 쓰므로 권한 판정은 셸과 엔진 한 곳에 있습니다. 모드를 바꿔도 엔진 쪽 메서드는 그대로입니다.
- 에이전트가 화면마다 모드를 고르고 이유를 남기므로, 사용자와 검사가 프레임 사용을 추적할 수 있습니다.
- Helm과 외부 그룹이 같은 길을 씁니다.

### 4.2 감수할 점

- 프레임 모드는 플러그인 JS를 앱과 같은 WebView 프로세스에서 돌립니다. sandbox와 CSP가 DOM, IPC, 네트워크를 막아도 CPU·메모리 폭주는 셸 반응을 늦출 수 있습니다(T-18). 생존 확인과 내리기로 줄일 뿐 없애지 못합니다.
- Tauri iframe에 IPC가 노출되지 않는지를 플랫폼마다 확인해야 하고, 확인 전에는 프레임을 켤 수 없습니다.
- 프레임 화면은 caustic 모양을 자동으로 따르지 않습니다. 셸 경계로 구분은 되지만 모양이 앱과 다를 수 있습니다.
- 앱에 렌더러, 스키마 검사, 바인딩 해석, 프레임 호스트, 다리, 화면 장부가 생깁니다. F와 X에 매니페스트 필드, 메서드 등록, 예산 등급, 로더 진단, 전용 스킴 파일 제공이 늘어납니다.
- 선언형 표현식을 좁게 두어 복잡한 화면 논리는 엔진 쪽 `query` 처리기로 옮겨야 합니다.

## 5. 대안

| 기준 | (a) 선언형만 | (b) 프레임만 | (c) 신뢰 내장 React 모듈 | (e) 두 모드, 화면마다 선언 [채택] |
|---|---|---|---|---|
| 보안 | 플러그인 코드 실행 없음 | 모든 화면이 플러그인 JS | 저장소 코드만 | 프레임은 `page`·`well`과 등급표 안에서만 |
| 표현력 | 카탈로그 안만 | 제한 없음 | 제한 없음, 앱 릴리즈 필요 | 둘 다 |
| caustic 모양 | 자동 | 플러그인 몫 | 자동 | 선언형 자동, 프레임은 토큰 전달 |
| CLI·웹 대체 | 같은 트리 | 없음 | 없음 | 선언형과 `fallback` |
| 외부·`project` 확장 | 가능 | 어려움 | 불가 | 선언형은 가능, 프레임은 설정으로만 |
| 작업량 | M~L | L + 보안 검토 | 화면당 S, 외부 불가 | L + 보안 검토 |
| 채택하지 않은 이유 | 사용자 결정(2026-10-31)과 그룹 전용 작업 흐름 화면 요구 | 작은 면과 CLI 대체를 잃고 모든 화면이 프로세스 위험을 짐 | Helm이 `user` 등급이라 대상이 안 되고 외부 그룹이 화면을 못 냄 | |

- 2026-10-30 초안의 (d)(선언형 + 내장 React, iframe은 이름만)는 (e)로 대체되었습니다.

## 6. 미결 사항

1. [미결] Tauri iframe의 IPC 노출과 전용 URI 스킴 등록을 macOS·Linux에서 e2e로 확인하는 일. 확인 전에는 `x.views.frames`를 끈 빌드로 냅니다. 확인 시험은 `review.m4-plan` 트랙 T-VIEW의 끝 시험입니다.
2. [미결] `ExtensionManifest.views`, `ViewContribution`, `FrameDecl`, `ViewNode`의 정본 위치. 제안은 `F.extensions.spec` 새 파일 `views.ts`입니다. 위젯 카탈로그 이름 목록과 다리 메시지 스키마를 F에 둘지 L4(`packages/client`)에 둘지도 함께 정합니다.
3. [미결] 확장 wire 메서드 열기(`F.wire-settings.spec` §4.2 [제안] 확정), `ext.view.post`·`ext.view.requestApproval`, 확장 메서드 등록 API(`hostOf(g).registerMethod`, `g.registerMethod`).
4. [미결] `X.operations.spec` 예산 등급 `view`(기본 5,000ms)와 확장 메서드 실패의 장부 반영.
5. [미결] Helm의 `ext.helm.status`, `ext.helm.inquiries`, `ext.helm.findings`와 화면 기여(`L3.helm.spec`).
6. [미결] `architecture.security.spec` §4 T-16~T-18 행과 확장 메서드 결과의 마스킹 위치.
7. [미결] `requestApproval`의 승인 kind. 새 kind를 둘지 `question` kind에 출처(`ApprovalOrigin.caller.extension`)를 실을지(ADR-0018 §3 2번).
8. [미결] `events`의 kind 거름 인자를 `events.subscribe`에 둘지 확장 화면 전용 구독을 둘지(`F.wire-settings.spec`, `L4.desktop-ux.spec` W-37).
9. [미결] 설정 키 `x.views.frames`, `x.views.allowProjectFrames`의 소유 문서(`X.loading-trust.spec` 또는 `L4.settings-ui.spec`)와 프레임 `call` 확인 줄을 끄는 범위.
10. [미결] 프레임 안에서 caustic을 쓸 배포물(웹 컴포넌트 빌드 또는 토큰 CSS만)을 caustic 저장소에서 낼지.
11. [가정] 위젯 카탈로그 v1로 Helm 탐구 화면을 그릴 수 있습니다. 작업대 시안(`L4.desktop-ux.spec` §14 W4)에서 확인했고 구현에서 다시 확인합니다.
