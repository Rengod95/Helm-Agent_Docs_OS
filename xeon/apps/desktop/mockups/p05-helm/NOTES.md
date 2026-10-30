# P-05 탐구(Helm) 셸 목업 (p05-helm)

- 빌드: `MOCKUP=p05-helm MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S12`(기본 S1), `?theme=dark`.
  S1 탐색 중 · S2 수렴 중(발견) · S3 끝: 적용함 · S4 대기 · S5 대기열(임대) · S6 상한 도달 · S7 멈추는 중 · S8 Helm 꺼짐 · S9 읽는 중 · S10 오프라인 · S11 시작 오류 · S12 전체 화면

## 구성

- 스펙대로 대화 화면(P-02)의 오른쪽 well "탐구" 탭. 가운데는 같은 대화(`parts/chat-context.tsx`, 정적 판)이고 Helm 신호·drive 전환·거부된 쓰기 도구가 트랜스크립트 행으로 보입니다.
- 런타임 관점(브리프 Framing correction): well 맨 위 "이 대화의 그룹"에 L3 그룹(helm, learning, review), 거는 훅(on·post·drive·scope), 지금 상태, drive 임대(보유·대기)를 늘 보입니다. 상태마다 임대 보유자가 바뀝니다(S3 적용 뒤 review로, S5 review가 보유해 helm 대기).
- 렌즈 = Helm의 자식 에이전트. caustic `ActivityTree`로 렌즈(step) 아래 자식의 도구 호출(call)을 나무로 그립니다.
- S12 전체 화면은 스펙에 없는 보기입니다. well의 "크게"로 열고 "대화로"로 돌아갑니다. 렌즈 나무, 발견, 그룹, 단계 경계의 그룹 전환(`Timeline`)을 한눈에 봅니다.
- 1100px 이하에서도 처음부터 탐구 탭을 엽니다(대화 위에 뜸). 셸 기본은 닫힘입니다.

## caustic

`Stepper`(4단계, xs), `ActivityTree`(ghost), `ListDescription`(임대·상한), `Progress`, `Badge`, `Button`, `Input`, `Alert`, `Skeleton`, `Timeline`/`TimelineItem`, `ToolCall`, `Message`, `Composer`.

## 빈틈

- `ActivityTree` step에 pending·skipped 상태가 없습니다(스펙 렌즈 상태 5개 중 3개만).
- 탭 머리(셸 well 머리)에 배지를 넣을 자리가 없어 "쓰기 도구 거부 중"은 탐구 머리 줄에 둡니다.
- 대화 안 시스템 행(Helm 신호, 그룹 전환, 목표 판정)용 부품이 없어 `chat-context.tsx`의 `EventRow`로 만듭니다.
