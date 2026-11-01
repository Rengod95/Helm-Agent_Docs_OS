# 런타임 캔버스 명세 제안 (wb-canvas)

작업대 개요(P-16)를 표·칩 목록에서 공간 캔버스로 바꾸는 제안입니다. 사용자 요청(2026-10-31 "캔버스 라운드")의 층 분리, 맥락 분리, 블록처럼 잇고 쌓는 화면을 다룹니다. 이 문서는 desktop-ux 명세에 합칠 초안이고, §13 원칙(DP-01~46)을 그대로 따릅니다.

- 실행: `MOCKUP=wb-canvas MOCKUP_PORT=8871 mise exec -- bun run mockup`, 상태는 `?state=S1..S13`, `?theme=dark`.
- 셸: 공용 `_shell`을 씁니다. 바꾼 곳은 하나입니다. `WorkbenchPanelProps.contextField`(선택 prop)를 더해 왼쪽 패널 맥락 칸을 페이지 것으로 바꿔 끼울 수 있게 했습니다. 다른 시안의 동작은 바뀌지 않습니다.

## 1. 화면

### 1.1 층 캔버스 (P-16 대체)

투명한 가운데 전체가 캔버스입니다(DP-01). 왼쪽 패널, 오른쪽 떠 있는 막대, 상태 표시줄은 그대로입니다.

- 띠: 위에서 아래로 L3 의도 그룹, L2 능력, L1 코어, L0 플랫폼, X 확장 호스트, F 계약입니다. 위층이 아래층에 기대어 쌓이는 모양입니다. 띠 사이는 8px 틈과 바탕 단계로만 나누고 선을 긋지 않습니다(DP-03). 띠 이름(mono 층 표기 + 한국어 이름 + 켜짐/전체 수)은 화면 왼쪽 84px 칸에 붙고, 캔버스를 옮겨도 세로로만 따라갑니다.
- 블록(확장 노드): 이름(라벨 + mono id, DP-39), 둘째 줄(등급·버전, 제공 능력, 또는 "drive 보유 · 턴 1/4"), 오른쪽 위 상태 면입니다. 면과 글자는 늘 neutral이고 tone은 16px 아이콘 면에만 줍니다(DP-29, DP-46). 자동 꺼짐은 danger 면, 실패는 warning 면과 수, drive 보유는 neutral 면의 selected `Play`입니다. 이 맥락에서 꺼진 블록은 점선 윤곽과 tertiary 글자입니다.
- 포트: 블록 아래 가장자리에 둡니다. 왼쪽 무리는 받는 능력(꽉 찬 점 = `requires`, 빈 점 = `optional`), 오른쪽 셋은 on(원), post(마름모), drive(꽉 찬 네모)입니다. 포트가 있는 연산만 그립니다(매니페스트 `points`, `usesPost`, `usesDrive`).
- L2 띠 오른쪽 끝은 외부 plugin 칸(매니페스트 `layer: "plugin"`)입니다. 점선 하나와 "외부 plugin" 글자로만 나눕니다.
- L3 띠 아래쪽 group-kit 레일: 그룹 블록이 놓이는 바닥입니다(`defineGroup`, `DriveArbiter`, `replayDrive`, 슬롯 넷). group-kit은 확장이 아니라 라이브러리라서 고를 수 없습니다. 레일 끝의 점선 칸 "그룹 쌓기"는 만들기(P-22)로 갑니다.
- X 띠: 첫 줄은 지점 레일입니다. 지점 종류 일곱 칸(input 3, request 9, guard 3, tool 5, boundary 9, session 15, lifecycle 2, 합 46)을 두고, 이 맥락에서 핸들러가 걸린 지점만 이름(꾸밈 없는 글자, DP-31), fold, 건 확장 수를 보입니다. fold는 포트 모양입니다: collect 고리, first 마름모(관문), chain 네모, tap 점. 둘째 줄은 post 큐, drive 임대, scope, 운영, X 훅 블록입니다.
- F 띠: 계약 칸(매니페스트, 지점 표 46, 4연산, 그룹 레코드, 능력 계약, wire·설정)이고 읽기 전용입니다.
- 엣지(연결): 색이 아니라 선 모양으로 구분합니다.

| 엣지 | 시작 → 끝 | 선 |
|---|---|---|
| 능력 | L2 `provides` → L3·plugin `requires`/`optional` 포트 | 실선, optional은 긴 점선 |
| 제공자 없음 | 받는 포트 → 끝 × | 짧은 점선 |
| on | 블록 on 포트 → 지점 레일의 그 지점 | 가는 실선(쉴 때 40% 농도) |
| post | 블록 post 포트 → post 큐 | 둥근 점선 |
| drive | 블록 drive 포트 → drive 임대 | 굵은 실선. 보유 중이면 흐름 움직임 |
| provider 등록 | web-exa → web | 짧은 점선 |
| 발화 | loop → 지점 레일 | 넓고 연한 띠 |

- 범례: 캔버스 왼쪽 아래 glass 한 줄(선 모양, fold 모양). 캔버스 폭이 860px보다 좁으면 숨깁니다.
- 실패 표시: 자동 꺼진 확장이 있으면 캔버스 바로 위(머리 아래)에 `Alert tone="danger"` 하나를 둡니다(DP-28). 블록에는 상태 면만 둡니다.
- 머리: `WorkbenchHead` 한 줄(제목 "개요", 확장·켜짐·자동 꺼짐 수)과 둘째 줄(맥락의 한 줄, 실시간 점, "14:03 기준 · seq 9120"). 오른쪽 동작은 비교 `Select`, "턴 재생"(대화·시험 맥락만), 캔버스·목록 `SegmentedControl`입니다.

### 1.2 맥락 분리

- 맥락의 정본은 왼쪽 패널 맥락 칸 하나입니다(§6.21 유지). 칸을 `Select` 묶음 넷으로 넓힙니다: 전체, 대화(대화마다), 프로필(프로필마다), 시험(시험 대화마다). 캔버스 위에는 맥락 이름을 다시 쓰지 않습니다. 왼쪽 패널이 닫히면 머리 둘째 줄 앞에 맥락 이름이 붙습니다.
- 맥락을 바꾸면 캔버스를 다시 그립니다. 그 맥락에서 켜진 블록만 실선 블록이고 나머지는 점선 윤곽입니다. 꺼진 블록의 엣지는 15% 농도로 물러납니다.

| 맥락 | 보이는 것 |
|---|---|
| 전체 | 설치된 확장 전부. 임대는 대화마다 따로라 drive 임대 블록은 "보유 중 2개 대화" 요약만 |
| 대화 | 그 대화에서 켜진 그룹과 확장, 임대 보유·대기열, post 큐 수, 다음 단계 경계에 적용될 켜기·끄기(`GroupStatus.pendingToggle`). 실시간 덧그림(아래) |
| 프로필 | 프로필이 켜는 것(+), 끄는 것(−), 설정을 덮어쓰는 것(~)을 블록 왼쪽 위 표지로. 덮어쓴 설정은 블록 옆 꼬리표(`ext.helm.maxLenses = 4`). drive 그룹 |
| 시험 | 시험 대화의 실제 상태(실시간)와 시험이 덮어쓴 설정·끈 확장. "원래 대화와 떨어져 있어요" |

- 실시간 덧그림(대화·시험): 보유 임대 엣지에 흐름 움직임, 가장 최근 단계 경계 교대를 엣지를 따라 한 번 움직이는 점으로 되풀이합니다. drive 임대 블록 아래에 "턴 7 · 단계 경계 14:02:41 · helm 임대 받음" 꼬리표(마름모 = 단계 경계) 하나를 둡니다. 전환 기록 전체는 오른쪽 "기록" 탭에만 있습니다(DP-23).
- 비교: 머리 `Select`로 다른 맥락 하나를 고르면 한 캔버스 위 차이로 그립니다. 지금 맥락에만 켜진 블록 "−"(diff-remove 면), 비교 맥락에만 켜진 블록 "+"(diff-add 면), 같은 블록은 물러납니다. drive 임대 블록은 "helm → 없음"처럼 보유 변화를 씁니다. 나란히 두 캔버스는 1280px에서 블록 글자가 7px 밑으로 줄어 두지 않았습니다.

### 1.3 턴 재생 (이벤트 흐름 덧그림)

- 머리 "턴 재생"이 캔버스 아래에 재생 막대를 엽니다(glass 한 덩어리, 미니맵 자리를 씁니다).
- 막대: 재생·멈춤, 앞·다음 발화, 눈금 줄(눈금 하나 = 지점 하나의 발화, 높이 = 돈 핸들러 수, 위 warning 점 = 핸들러 실패, 마름모 = 단계 경계), 시각·seq·step, 닫기. 아래 줄은 지금 지점 이름과 핸들러마다 확장 이름 + 지연 꼬리표(`3ms / 30s`, 예산 대비 막대, 메모).
- 캔버스: 지금 지점의 레일 포트가 진하게, 그 지점에 핸들러를 건 블록의 on 엣지만 이어지고 나머지는 물러납니다. 핸들러를 돌린 블록 옆에 같은 지연 꼬리표가 붙습니다(L3는 블록 위, 그 밖은 아래). 단계 경계 눈금에서는 임대 엣지를 따라 점이 움직입니다.
- 예: seq 214 `tool.call.before`(first, 실패 closed) — helm 3ms 허용, acme-notes 8.1s 예외 → 거부로 처리. closed 지점의 예외는 거부값이 된다는 F 규칙(§3.4 실패 열)을 화면이 그대로 보입니다.
- 시험 실행(P-19)의 replay와 같은 막대를 씁니다. 시험 맥락에서 "턴 재생"은 그 시험 대화의 턴을 고릅니다.

### 1.4 검사기 (오른쪽 well "검사" 탭)

- 작업대 오른쪽 탭 맨 위에 "검사"를 더합니다(받은 요청, 기록, 대화 앞). 블록을 누르면 well이 이 탭으로 열립니다. 바탕을 누르면 고른 것이 풀립니다.
- caustic `InspectorPanel variant="ghost" size="sm"`(well이 이미 표면이라 테두리·그림자 없음, DP-20). 구역:
  - 머리: 라벨 + mono id, 층·종류·등급·버전·상태, 동작 둘("이 대화에서 끄기"·"다시 켜기", "확장 상세" → P-17). 면제 tier는 끄기 잠금.
  - 연결 지점 n: fold 모양, 지점, fold, p95/예산, 예산 대비 막대(50% warning, 100% danger), 실패 수 면.
  - drive 임대(`usesDrive`만): 역할(보유·차수, 대기, 후보 아님), 턴·spawn·토큰 사용량. `ListDescription` ghost xs(DP-12).
  - 능력: provides, requires·optional과 묶인 제공자(`← web`), 없으면 "없음 · 저하 동작" 또는 "없음 · 켜지지 못함".
  - 설정 바인딩: caustic `InspectorBindings`. 행 = 설정 제목, 값 + mono 키, 범위·출처(session · 이 대화, user · 프로필 탐구 중심, 기본값). 맥락이 덮어쓴 값은 그 값과 출처로 바뀝니다. 끝의 점선 행은 "<맥락>에서 덮어쓰기". 기본값 행은 풀기 잠금.
  - group-kit 슬롯(그룹만): 트리거·펼치기·모으기·적용에 고른 조각.
  - 최근 실패: 시각, 지점, 사유.
- 자동 꺼짐의 설명은 캔버스 위 `Alert` 하나에만 둡니다. 검사기에 같은 Alert를 다시 두지 않습니다(DP-23).

### 1.5 목록 보기와 좁은 창

- 머리 "목록"이나 720px 이하(compact)에서는 캔버스 대신 층 목록을 씁니다. 띠마다 묶음 제목(mono 층 + 이름 + 수), 블록마다 한 행(상태 점, 라벨, mono id, 상태 면, 오른쪽에 연결 요약 "on 6 · post · drive" 또는 상태 글). 엣지는 그리지 않습니다. 행을 누르면 같은 검사기가 뜨는 well로 열립니다.
- 1000px(medium): 캔버스는 폭에 맞춰 줄고(최소 60%), well은 닫힌 채 뜨는 면입니다. 미니맵은 캔버스 폭이 640px보다 넓을 때만 보입니다.

## 2. 상호작용

| 동작 | 결과 |
|---|---|
| 바탕 끌기, 휠 | 이동 |
| ⌘·Ctrl + 휠, 줌 막대 −/+ | 확대·축소(35~160%), 포인터·가운데 기준 |
| 줌 막대 "전체 보기" | 폭과 높이에 맞춤(60~100%) |
| 미니맵 누르기 | 그곳을 가운데로 |
| 블록 누르기 | 선택(caustic `CanvasSelection` 윤곽), 닿는 엣지를 진하게, 관계없는 L3·L2 블록 물러남, 검사 탭 열기 |
| 바탕 누르기 | 선택 풀기 |
| "그룹 쌓기" 칸 | 만들기(P-22), 템플릿 drive·정책·관찰 |
| 맥락 칸 | 캔버스 다시 그리기, 비교·재생 닫기 |
| 비교 `Select` | 차이 그리기, 오른쪽 위에 −/+ 범례 |
| "턴 재생" | 재생 막대, 화살표 키로 눈금 이동, 재생은 1.1초마다 다음 발화 |
| Alert "다시 켜기" / 검사기 "다시 켜기" | `ext.reenable` → 다음 단계 경계 적용 토스트 |

- 블록은 버튼이고 `aria-label`에 라벨, id, 층, 상태, 실패 수를 씁니다. 캔버스는 `role="application"` + `aria-roledescription="캔버스"`, 엣지와 띠 이름은 `aria-hidden`이고 같은 정보가 검사기와 목록 보기에 글자로 있습니다. 재생 눈금 줄은 `role="slider"`.
- 움직임(흐름, 교대 점)은 `prefers-reduced-motion`에서 멈춥니다.
- 오프라인이면 쓰기 동작(켜기·끄기, 다시 켜기, 덮어쓰기)을 잠급니다(§6.21).

## 3. 상태

| id | 상태 | 보이는 것 |
|---|---|---|
| S1 | 기본 · 맥락 전체 | 띠 여섯, 블록 21 + X·F, 실패 Alert, 범례, 미니맵 |
| S2 | 대화 맥락 · 실시간 | 캐시 무효화 조사 턴 7: helm 보유(흐름), 계획 먼저 대기, 리뷰 자동 꺼짐, 대화 도구 다음 경계에 켜짐, 교대 꼬리표 |
| S3 | 검사기 · helm | 90% 줌, helm 선택, 닿는 엣지만 진하게, 검사 탭 |
| S4 | 프로필 맥락 | 탐구 중심: ~helm(꼬리표 `ext.helm.maxLenses = 4`), +학습, +Exa 검색 |
| S5 | 비교 | 캐시 무효화 조사 ↔ 조용히: −helm, −계획 먼저, +대화 도구, 임대 helm → 없음 |
| S6 | 재생 · 턴 중간 | seq 214 tool.call.before, helm 3ms 허용, acme-notes 예외 → 거부 |
| S7 | 실패 강조 | 리뷰 선택, 점선 엣지, 검사기 실패 5와 settle 예산 100% |
| S8 | 안전 모드 | warning Alert, L3 띠 빗금, 그룹·user·project 확장 윤곽만, 임대 "보유 없음" |
| S9 | 빈 · 내장만 | 학습 하나, "그룹 블록을 쌓아 보세요 [만들기] [가져오기]" |
| S10 | 오프라인 | neutral Alert "14:03 기준 지도", 캔버스 흐림, 쓰기 잠금, 상태 표시줄 "연결 끊김" |
| S11 | 밀집 · 축소 | 확장 77개 50% 줌: 의미 줌(이름 없는 막대), 자동 꺼짐·실패·임대 보유만 화면 크기 이름표, 띠 이름에 "주의 n" |
| S12 | 시험 맥락 | helm 렌즈 5개: ~helm(`maxLenses = 5`), −계획 먼저, −acme-notes, 임대 턴 2/4 |
| S13 | 목록 보기 | 층 목록(700px와 같은 모양) |

빈(설치 없음)·읽는 중·오류는 P-16 규칙을 따릅니다: 읽는 중이면 블록 자리에 `Skeleton`, `ext.list` 실패면 Alert 한 줄과 "다시 읽기".

## 4. 데이터 출처와 빠진 것

| 화면 요소 | 출처 | 상태 |
|---|---|---|
| 블록(층, 종류, 등급, 버전, 상태, 실패) | `ext.list` | `[gap:W-15]` |
| 포트(points, usesPost, usesDrive, requires/optional/provides) | 매니페스트 → `ext.get` | `[gap:W-20]` |
| 능력 엣지의 실제 바인딩(누가 어떤 능력을 제공하는지) | 없음 | 새 간극 **W-40** `ext.bindings { threadId? }`: 능력 id마다 제공 확장과 버전, 받는 확장과 requires/optional, 미충족 |
| 맥락별 켜짐·대기 표시 | `group.list`(`GroupStatus.scope`, `pendingToggle`, `drive`) | `[gap:W-24]`. plugin(그룹 아님)의 대화별 켜짐은 `GroupStatus`에 없음 → **W-41** `ext.list { threadId }`가 scope 상태를 대화별로 |
| 임대(보유, 차수, 사용량, 대기·거부) | `lease.*` 이벤트, `OpenLease.used` | 대기 계수(`leaseWaitLimit` 대비)는 이벤트에 없음 → **W-42** `group.lease { threadId }`: holder, leaseEpoch, limits, used, 후보별 대기 수 |
| 지점 레일(종류별 수, 지점별 fold·failure) | F `POINTS` 상수 | 정적. wire로 보낼 필요 없음(앱이 contracts를 읽음) |
| 지점별 건 확장 수 | 매니페스트 points 합 | 있음(W-15/W-20이 오면) |
| 턴 재생: 지점 발화 순서, 핸들러별 시간·결과 | 없음. `scope.handler_failed`만 내구 이벤트 | **X 간극 X-15**: 디스패처가 지점 발화와 핸들러 시간을 계측 기록으로 남겨야 함(내구 아님, 링 버퍼). wire **W-43** `trace.turn { threadId, turnId }` → `{ seq, point, step, handlers[{ ext, ms, result }] }[]`. 핸들러 시간 `[gap:W-23]`의 확장 |
| 단계 경계 표지 | `boundary.step.after` 커밋 seq | W-43에 포함 |
| 프로필·시험 맥락의 가상 상태 | 프로필 정의(`enable`, `disable`, 설정, driveGroup) | 프로필을 대화 없이 "적용했다면" 계산하는 함수가 없음 → **W-44** `profile.preview { id }`: 켜질 scope, 후보, 예상 holder(중재 규칙 X.primitives §4.4.1 4번) |
| 시험 대화 | `ext.test.list` | `[gap:W-29]` |
| 설정 바인딩(값, 범위, 출처) | `settings.get` + 범위 해석 | 출처가 프로필인지 알 수 없음 → **W-45** `settings.explain { key, threadId }`: 이긴 범위와 그 값을 쓴 쪽(프로필, 시험, 사용자) |
| group-kit 슬롯 | 없음 | **L3 간극**: 그룹이 어떤 슬롯 조각으로 만들어졌는지 매니페스트나 group-kit 메타에 남지 않음. `defineGroup({ slots })` 선택 메타 제안 |
| X 훅 | `hooks.list` | `[gap:W-36]` |
| 안전 모드 | `host.status.safeMode` | `[gap:W-35]` |

## 5. 고정 데이터 정정 (§14.5와 다르게 둔 곳)

- 대기열: §14.5 `lease.queue`는 review 대기, work 거부입니다. 그런데 work는 L2 plugin이라 drive를 쓰지 못하고(F.extensions §2 "플러그인은 drive를 쓰지 않는다", §4.6), review는 자동 꺼짐이라 임대 후보가 아닙니다(X.primitives §4.4.1 4번 "켜져 있고 오류 상태가 아닌 scope"). 그래서 둘째 drive 그룹 "계획 먼저 `plan-first`"(user, drive)를 덧붙여 대기열에 두었습니다. §14.5 고정 데이터와 wb1·wb2 시안의 "거부 work"를 고쳐야 합니다.
- 턴 7의 임대 교대: §14.5는 "13:58 lease.released core"입니다. 반납 주체는 core가 아니라 임대를 가진 scope입니다. 시안은 "계획 먼저가 턴 6 끝에 상한(4/4)으로 반납, 사용자가 helm 제안 카드에서 탐구 시작 → `x.primitives.activeDriveGroup = helm`(session) → 턴 7 첫 단계 경계에서 helm 임대"로 두었습니다. 계획 먼저는 `budget` 반납 뒤라 다시 후보가 될 때까지 대기합니다.
- acme-notes `tool.call.before` 실패: 이 지점은 first, 실패 closed입니다. 예외는 기록만 되는 것이 아니라 거부값으로 처리되어 도구 호출이 막힙니다. 런타임 행과 기록의 문구를 "예외 → 거부로 처리"로 바꿔야 합니다.
- 능력: helm의 knowledge.search는 제공자가 없습니다(P-17 와이어프레임 "knowledge.search 없음"과 같음). knowledge 블록은 knowledge.skills·memory만 제공합니다.
- 프로필 "조용히"에 `disable: [helm, plan-first]`를 덧붙여 비교에 차이가 보이게 했습니다(프로필 모델에 enable·disable이 따로 있음, wb2 NOTES).

## 6. 새 원칙 제안

- DP-47 캔버스 띠: 층 분리는 띠 바탕 단계와 8px 틈으로만 드러내고 선을 긋지 않습니다. 띠 이름은 화면 왼쪽 칸에 붙어 이동해도 보입니다.
- DP-48 엣지는 연산마다 선 모양(실선, 점선, 굵기)으로 구분하고 tone 색을 쓰지 않습니다. 강조는 neutral 단계(tertiary → secondary → primary)와 농도로만 합니다(DP-29를 선으로 넓힘).
- DP-49 캔버스에서 맥락 이름은 왼쪽 패널 맥락 칸에만 씁니다. 캔버스 덧그림은 그 맥락의 사실(턴, 실시간, 차이)만 씁니다(DP-23과 같은 이유).
- DP-50 의미 줌: 블록 글자가 화면에서 8px보다 작아지는 줌에서는 이름을 숨긴 막대로 바꾸고, 주의할 것(자동 꺼짐, 실패, 임대 보유)만 화면 크기 이름표를 답니다.
- DP-51 실시간 움직임은 한 화면에 둘까지입니다(보유 임대 흐름, 가장 최근 교대 하나). 나머지 변화는 기록 탭에 둡니다.
- DP-52 같은 확장을 가리키는 캔버스 블록, 목록 행, 검사기 머리는 같은 상태 면(DP-29)과 같은 이름 규칙(DP-39)을 씁니다.

## 7. caustic

- 쓴 것: `InspectorPanel`·`InspectorSection`·`InspectorSectionHeader`, `InspectorBindings`·`InspectorBindingsRow`, `CanvasSelection`(select, 손잡이 없음), `ZoomControl`(ghost, static readout), `Alert`, `Button`, `IconButton`, `Select`·`SelectGroup`·`SelectHeading`, `SegmentedControl`, `ListDescription`, `EmptyState`, glass 유틸, `canvas-dot`·`canvas-selection`·`diff-add/remove` 토큰.
- 쓰지 않은 것: `CanvasHint`(키 칩을 그려 DP-06과 부딪침), `CanvasRuler`·`CanvasGuide`(배치 편집이 없음), `LayerTree`(목록 보기는 층 묶음 하나라 트리가 과함), `TokenGraph`(아래).
- 빈틈(시안 `parts/`에 토큰으로 만들고 머리 주석에 적음). caustic `packages/react`에 넣을 것을 제안합니다:
  - C-34 `CanvasViewport`: 이동·확대(view, onViewChange, minZoom, maxZoom), 점 격자, 화면 좌표 덧그림 칸.
  - C-35 `GraphNode`: 제목, 메타, 상태 면, 네 변의 타입 포트(모양 prop). `TokenGraphNode`는 좌우 포트 하나씩이라 맞지 않습니다.
  - C-36 `GraphEdge`: 경로, kind별 dash, traced·dimmed·ghost, 흐름 움직임, 경로를 따르는 점.
  - C-37 `CanvasMinimap`: 세계 축소판, 보이는 영역, 눌러 이동. `ZoomControl`과 한 glass 덩어리.
  - C-38 `EventScrubber`: 이산 눈금(높이, 표지), 경계 마름모, 재생, `role="slider"`.
  - `InspectorBindingsRow`에 "값 + 기계 키" 두 단 토큰 칸과 compact 높이(한 줄)를 제안합니다. 지금은 토큰 경로 한 줄 전제라 두 줄 카드가 됩니다.

## 8. 미결

1. 프로필·시험을 맥락 칸에 넣을지, 캔버스 전용 "가정 보기"로 둘지. 시안은 맥락 칸(정본 하나)에 넣었습니다. 그러면 P-17, P-20의 맥락도 넷이 되어야 합니다.
2. 개요를 캔버스로 바꿀지, P-16(목록)을 두고 캔버스를 별도 내비("지도")로 둘지. 시안은 개요 자체를 바꾸고 머리 캔버스·목록 전환을 두었습니다.
3. 블록 배치: 시안은 층 안 고정 순서입니다. 사용자가 끌어 놓은 자리를 기억할지(UI 스토어), 자동 배치만 둘지.
4. 블록을 잇는 편집(캔버스에서 능력 바인딩을 바꾸거나 그룹을 슬롯으로 조립)을 이 화면에서 할지, 구성(P-21) 그룹 구성 탭을 캔버스로 바꿀지. 시안은 읽기와 켜기·끄기·덮어쓰기까지만 둡니다.
5. 턴 재생의 계측(X-15)을 늘 켤지, 작업대가 열려 있을 때만 켤지(비용).
6. L1·L0 블록을 그릴지. 코어는 면제 tier라 끌 수 없지만 "발화" 엣지와 능력(fresnel.agents)의 근원이라 남겼습니다.
