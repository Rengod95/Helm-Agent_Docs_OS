# 크래프트 개요 (`views/craft`)

크래프트(LightCraft)의 개요 화면: 지도(Orbit)·순서(Strata)·링크(Link)와 자세히 보기. 설계는 `docs/xeon/L4/desktop-ux/spec.md` §6.22.0(승인 시안 `mockups/wb-v5`)입니다. 순수 모델은 `packages/client/src/workbench/canvas`(`@fresnel/client/workbench/canvas`)에 있고 이 폴더는 그리기만 합니다.

## 연결

- 화면 `CraftScreen({ source })`는 `desktop-registry.tsx`가 화면 id `overview`로 등록합니다. `source`가 `null`이면 "엔진에 연결되면 보여요" 빈 상태입니다.
- 데이터와 동작은 `CraftSource`(`craft-context.tsx`) 하나로 들어옵니다: `snapshot`, 훅별 `order`, 그룹 스위치 `setOn`, `orderPort`(`hooks.order.get|set|reset|preview`), `openBuilder(hook | null)`, `recentRuns(id)`(`trace.turn`, 계측이 꺼져 있으면 `null`). **T-BENCH가 이 `source`를 엔진 wire로 채웁니다.** `createDesktopRegistry(craftSource)`에 넘깁니다.
- `orderPort`의 타입은 `m4/order`의 wire를 옮겨 적은 `order-wire.ts`입니다. 병합 뒤 `@fresnel/contracts`의 타입으로 바꾸고 그 파일을 지웁니다.
- 스타일: 지도는 `orbit.css`(`src/styles.css`가 가져옴), 링크는 `link-style.ts`의 문자열입니다. 색은 caustic 토큰만이고 셰이더 상수만 예외입니다(`space-math.ts`).

## 규칙

- 전역만 보입니다(범위·맥락 칸 없음). 그룹은 스위치 하나이고 구성원 하나씩 끄기는 없습니다(15-1).
- 훅 줄 핸들러 순서는 티어와 상관없이 끌어 바꿉니다. 저장 전 `hooks.order.preview`가 건너뛰기·가드 위험을 알리면 경고 모달을 거칩니다(15-2). 순서가 그대로면 미리보기도 부르지 않습니다.
- 줄 끝 `추가`는 그 훅을 고른 채 빌더를 엽니다(15-3). 선언을 고치지 않습니다.
- 지도에는 구조 편집 동작이 없습니다.
- 성능: 배경 30fps 상한(코어 60), 탭이 숨겨지면 멈춤, 움직임 줄이기는 한 장, 컨텍스트 손실과 WebGL 없음은 CSS 대체(`frame-policy.ts`가 판정).

## 아직 모형이거나 열려 있는 것

- 층 패널 카드 순서: 표시용인지 불러오는 순서인지 [미결: 사용자 확인]. 지금은 컴포넌트 상태에만 있고 저장하지 않습니다.
- 설정 편집, 코드 저장, 플러그인 가져오기, 지우기, 그룹에서 제거·해제, 대체: wire가 없어 만들지 않았습니다.
- 최근 실행의 "고침" 결과는 `trace.turn`에 해당 필드가 없어 만들지 않았습니다. `tool.run` 순간은 계측에 기록이 없어 "기록 없음"입니다.
- `hooks.order.preview`의 `skips`가 기본 순서에서 이미 있던 건너뜀을 포함할 수 있어 `strata-flow.ts`는 순서가 같으면 미리보기를 건너뜁니다. 같은 값으로 그대로 저장하는 경우의 경고 기준은 [미결].
- 재생 막대는 두지 않았습니다 [미결: 사용자 확인].
- 이름표는 확장 24개 이하이거나 확대 170% 이상일 때만 모두 보입니다. 그 밖에는 켜진·고른·올린 것만 보입니다(77개 겹침 방지).
