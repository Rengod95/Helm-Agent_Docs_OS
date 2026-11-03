# P-07 예약 · O-08 예약 편집 셸 목업 (p07-schedules)

- 빌드: `MOCKUP=p07-schedules MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S11`(기본 S1), `?theme=dark`.
  S1 목록 · S2~S6 새 예약 시트(간격, 시각, 파일 감시, 루프, 원격) · S7 저장 오류(interval_too_short) · S8 서비스 켜는 중 · S9 빈 · S10 읽는 중 · S11 목록 읽기 실패
- O-08은 이 화면의 상태로 둡니다(시트를 여는 곳이 여기뿐).

## 구성

- 무대 전체: 한 줄 머리(제목, 켜진 것|모두, 새 예약), 서비스 모드 경고, `Table`(예약, 트리거, 다음 실행, 마지막 실행). 개수·프롬프트·실패 사유 코드는 내지 않음. 마지막 실행 칸을 누르면 그 실행 대화로, 행 메뉴는 대화 열기·지금 실행(원격만)·복제·취소. 원격 행만 "지금 실행"이 바로 보입니다.
- 오른쪽 well은 받은 요청 탭만 있고 처음엔 막대로 접습니다(표 폭 우선).
- 시트: 제목, 트리거 `SegmentedControl`, 종류별 입력, 프롬프트, 작업 폴더, 바로 켜기, 서비스 모드 경고.
- `parts/inbox-lite.tsx`: 런타임 묶음 네 화면이 같이 쓰는 받은 요청 탭 내용.

## caustic

`Table`(ghost, sm), `Sheet`, `Field`, `Input`, `NumberField`(scrub, stepper), `SegmentedControl`, `DatePicker`, `TagInput`, `Textarea`, `Select`, `Switch`, `Alert`, `Menu`, `EmptyState`, `Skeleton`, `IconButton`, `Button`.

## 빈틈

- 트리거 편집 부품(gap C-13)은 조합으로 만듭니다. 시간 입력은 `Input type="time"`.
- `Field optional`의 "선택" 표기가 라벨에 붙어 "제목 선택"처럼 읽혀 쓰지 않았습니다.
- 실행 기록은 lastRun 하나뿐(W-07)이라 표에 한 칸만 둡니다.
