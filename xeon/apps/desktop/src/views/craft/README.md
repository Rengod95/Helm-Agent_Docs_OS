# 크래프트 개요 (`views/craft`)

크래프트(LightCraft)의 개요 화면: 지도(Orbit)·순서(Strata)·링크(Link)와 자세히 보기. 설계는 `docs/xeon/L4/desktop-ux/spec.md` §6.22.0(승인 시안 `mockups/wb-v5`)입니다. 순수 모델은 `packages/client/src/workbench/canvas`(`@fresnel/client/workbench/canvas`)에 있고 이 폴더는 그리기만 합니다.

## 연결

- 개요 화면 `overview`는 `views/workbench/craft-screen.tsx`가 등록합니다. 목록을 아직 못 읽었으면 띠(읽는 중·오류·오프라인)만 보이고, 읽히면 이 폴더의 `CraftBody`를 `CraftProvider`로 감싸 그립니다. 캔버스가 화면 전체를 쓰고 도구 막대·찾기·층 패널·선택 패널·자세히 보기는 캔버스 위에 뜹니다.
- 데이터와 동작은 `CraftSource`(`craft-context.tsx`) 하나로 들어옵니다: `snapshot`, 훅별 `order`, 그룹 스위치 `setOn`, `orderPort`(`hooks.order.get|set|reset|preview`, 결과는 `Result`이고 실패는 던지지 않고 err 값으로 옮긴다), `openBuilder(hook | null)`, `recentRuns(id)`(`trace.turn`, 계측이 꺼져 있으면 `null`). `views/workbench/craft-source.ts`의 `useCraftSource`가 워크벤치 스토어와 명령(`commands.workbench`)에서 만듭니다.
- 화면 상태는 따로 두지 않습니다. `CraftProvider`는 스토어의 `view`·`sel`·`panel`·`detail`·`kind`·`contrib`·`query`를 `craftStateOf`로 읽고(`mode`는 `view`), `useCraft().dispatch`는 `craftDispatch`로 스토어 동작(`setView`, `pickPlugin`, `toggleContrib` …)에 옮깁니다. `mode`를 바꾸는 `setView`는 자세히 보기를 닫습니다.
- `recentRuns`의 턴 id는 엔진 거울의 `latestTurnId`(thread별 가장 최근 턴)입니다. 목록을 읽을 때 `ThreadSummary.lastTurnId`로 먼저 채우고 이후 `turn.started` 사실이 덮어쓰므로 앱을 다시 켠 뒤에도 잠기지 않습니다. 분기해 자기 턴이 없는 대화만 첫 턴까지 잠깁니다.
- 자세히 보기(`detail`)는 확장 화면의 상세(`ExtDetail`)와 같은 값입니다. 한쪽에서 열면 다른 쪽에도 그 확장이 보입니다.
- `orderPort`의 타입은 `m4/order`의 wire를 옮겨 적은 `order-wire.ts`입니다. 병합 뒤 `@fresnel/contracts`의 타입으로 바꾸고 그 파일을 지웁니다.
- 스타일: 지도는 `orbit.css`(`src/styles.css`가 가져옴), 링크는 `link-style.ts`의 문자열입니다. 색은 caustic 토큰만이고 셰이더 상수만 예외입니다(`space-math.ts`).

## 규칙

- 전역만 보입니다(범위·맥락 칸 없음). 그룹은 스위치 하나이고 구성원 하나씩 끄기는 없습니다(15-1).
- 훅 줄 핸들러 순서는 티어와 상관없이 끌어 바꿉니다. 저장 전 `hooks.order.preview`가 건너뛰기·가드 위험을 알리면 경고 모달을 거칩니다(15-2). 순서가 그대로면 미리보기도 부르지 않습니다.
- 줄 끝 `추가`는 그 훅을 고른 채 빌더를 엽니다(15-3). 선언을 고치지 않습니다.
- 구성 요소 거르기(`contrib`)는 지도의 점과 호, 순서의 핸들러, 링크의 상대와 실, 층 패널의 카드를 숨깁니다(`keepsContrib`). 순서 줄에서 보이는 핸들러를 끌어 바꾼 순서는 `mergeVisibleLane`으로 가려진 것까지 든 전체 줄에 합쳐 저장합니다. 종류 거르기는 흐리게 둡니다.
- 지도에는 구조 편집 동작이 없습니다.
- 성능: 배경 30fps 상한(코어 60), 탭이 숨겨지면 멈춤, 움직임 줄이기는 한 장, 컨텍스트 손실과 WebGL 없음은 CSS 대체(`frame-policy.ts`가 판정).

## 아직 모형이거나 열려 있는 것

- 층 패널 카드 순서: 표시용인지 불러오는 순서인지 [미결: 사용자 확인]. 지금은 컴포넌트 상태에만 있고 저장하지 않습니다.
- 설정 편집, 코드 저장, 플러그인 가져오기, 지우기, 그룹에서 제거·해제, 대체: wire가 없어 만들지 않았습니다.
- 최근 실행의 "고침" 결과는 `trace.turn`에 해당 필드가 없어 만들지 않았습니다. `tool.run` 순간은 계측에 기록이 없어 "기록 없음"입니다.
- `hooks.order.preview`의 `skips`가 기본 순서에서 이미 있던 건너뜀을 포함할 수 있어 `strata-flow.ts`는 순서가 같으면 미리보기를 건너뜁니다. 같은 값으로 그대로 저장하는 경우의 경고 기준은 [미결].
- 재생 막대는 두지 않았습니다 [미결: 사용자 확인].
- 이름표는 확장 24개 이하이거나 확대 170% 이상일 때만 모두 보입니다. 그 밖에는 켜진·고른·올린 것만 보입니다(77개 겹침 방지).
