# P-14 목표와 작업 셸 목업 (p14-work)

- 빌드: `MOCKUP=p14-work MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S7`(기본 S1), `?theme=dark`.
  S1 목표 진행 중 · S2 충족 · S3 상한 도달 · S4 판정 실패 · S5 목표 없음(걸기 폼) · S6 읽는 중 · S7 긴 작업 목록(끝난 것 접기)

## 구성

- 대화 화면의 오른쪽 well "작업" 탭. 가운데 대화는 `../p05-helm/parts/chat-context.tsx`를 같이 쓰고(`mockup.css`의 `@source`), 판정 행(판정 n/3, 충족 여부, 빠진 것)이 트랜스크립트에 보입니다.
- 목표: 조건, 상태 배지, 판정 n/최대, 판정 모델, 한 줄 설명, 판정 기록(`Timeline`, 진행 중 턴이 맨 위).
- 계획: 버전·상태·보기. 작업: caustic `Plan`(체크리스트). 탐구에서 생긴 작업(#12, #13)은 detail로 출처를 보입니다.
- 스펙에 전체 화면 보기는 없어 만들지 않았습니다.
- 상태 표시줄 목표 칸은 스펙(판정 n/최대)을 따라 페이지에서 바꿉니다. 공용 fixture 설명은 "목표 3개 중 2개"라 스펙과 다릅니다.

## caustic

`Timeline`/`TimelineItem`, `Plan`, `Badge`, `Button`, `Field`, `Input`, `Select`, `Skeleton`.

## 빈틈

- `Plan`은 자체 카드(테두리·진행 띠)라 well 카드 안에서 한 단계 더 깊은 상자가 됩니다(DP-03과 부딪힘). caustic에 상자 없는 checklist가 필요합니다.
- `Plan` 행은 누를 수 없어 "작업 행 누르면 만든 턴으로"를 그리지 못했습니다.
