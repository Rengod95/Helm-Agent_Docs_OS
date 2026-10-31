# P-08 연결 셸 목업 (p08-connection)

- 빌드: `MOCKUP=p08-connection MOCKUP_OUT=<dir> mise exec -- bun run mockup:build`
- 상태: `?state=S1`~`S7`(기본 S1), `?theme=dark`.
  S1 사이드카에 붙음 · S2 로컬 서비스 · S3 원격에 붙는 중 · S4 원격(build-box)에 붙음 · S5 붙기 실패 · S6 원격 대상 추가(검사 오류) · S7 원격 대상 없음

## 구성

- 무대 전체, 1000px 이상 두 열(대상 | 지금 대상), 그보다 좁으면 한 열.
- 대상: `RadioGroup`(이름, 원격 표시, 주소 mono, 상태 배지). 지금 대상과 다른 것을 고르면 "연결"이 나옵니다.
- 지금 대상: `ListDescription`(상태, 주소, pid, 시작, 클라이언트, 진행 턴, 유휴 종료, 대기 예약, 안전 모드·불러온 그룹 수), 서비스 스위치 셋(서비스 모드는 바꾸면 "재시작 필요"), 서비스 멈추기·로컬로 돌아가기·진단 복사·엔진 다시 시작.
- 붙는 중·실패는 지금 대상 위에 `Stepper`(SSH 터널, 초기화, 동기화)와 `Alert`(다시 시도, 진단 복사). 상태 표시줄의 대상·연결 칸도 상태별로 바꿉니다.

## caustic

`RadioGroup`, `ListDescription`, `Stepper`, `Switch`, `Field`, `Input`, `Alert`, `Badge`, `Button`, `IconButton`.

## 빈틈

- 연결된 클라이언트 목록(W-12)이 없어 수와 이름 추정만 보입니다.
- `RadioGroupItem`은 라벨 안 여러 줄 내용을 위한 정렬이 없어 원을 위쪽에 맞추는 클래스를 덧붙입니다.
