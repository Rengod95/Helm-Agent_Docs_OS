# d03 기존 페이지 빠진 상태 · 시나리오

이 폴더는 상태를 채우는 곳이라 시나리오는 시작 화면만 고르고, 뒤는 화면 안 버튼(로컬 상태)이 진행합니다. `?scenario=<id>&dev=1`이면 왼쪽 아래에 시나리오 막대와 다음에 누를 것이, 그 위에 페이지 고르기가 뜹니다.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `wipe-data` | 설정 개요 맨 아래 "데이터 지우기…" → ‘지우기’ 입력 → "모두 지우기" | O-06 데이터 변형(지우는 것·남는 것, 시크릿 값·사용자 확장 고르기, 확인 글) → 창 전체 "지우는 중" → "다 지웠어요 · 다시 시작" | 계획에 없음 6, O-06 |
| `wipe-blocked` (실패) | 같은 대화 상자 | 진행 중 턴·실행 중 예약이 있어 지우지 않고 이유 목록과 "닫기"만 | O-06 |
| `schedule-runs` | 예약 행 ⋯ → 실행 기록 · 주간 보고 "다시 켜기" · ⋯ → 고치기… · ⋯ → 지우기… | 실행 기록 Sheet(실패·건너뜀 이유, 그 실행의 대화), 꺼진 예약이 켜지고 다음 실행이 생김, 고치기 Sheet, O-06 예약 변형 | P-07, W-07 `schedule.runs`·`schedule.update` |
| `connection-stop` | 유휴 종료 안내 → "서비스 멈추기" · 상태 표시줄 대상 칸 | 유휴 종료 Alert("계속 켜 두기"), 멈추기 확인(진행 중 턴·대기 예약·다른 클라이언트 영향), 대상 팝오버("대상 바꾸기", "연결 화면") | P-08, §6.12, flow §7.8 |

## `?page=` · `?state=` 목록(새로 더한 상태는 `D-`)

| page | 원래 상태 | 더한 상태 |
|---|---|---|
| `p04` | S1~S8 | `D-observe`(권한 필요: 관찰 중), `D-resolved`(다른 곳에서 이미 답함) |
| `p07` | S1~S11 | `D-offline`, `D-runs`, `D-reenable`, `D-edit`, `D-delete` |
| `p08` | S1~S7 | `D-loading`, `D-stop`, `D-restarting`, `D-idle`, `D-target`, `D-web` |
| `p09` | S1~S9 | `D-data`, `D-wipe`, `D-wipe-ready`, `D-wipe-blocked` |
| `p10` | S1~S9 | `D-loading`, `D-offline`, `D-usage`, `D-web` |
| `p11` | S1~S7 | `D-empty`, `D-loading` |
| `p12` | S1~S5 | `D-offline` |
| `p14` | S1~S7 | `D-offline`, `D-error` |
| `p15` | S1~S6 | `D-engine`, `D-update`, `D-uptodate`, `D-update-fail` |
