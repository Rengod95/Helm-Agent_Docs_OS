# d02 셸 수명 · 시나리오

`?scenario=<id>`(`&dev=1`이면 왼쪽 아래 막대), `&step=<n>&hold=1`은 그 순간에 멈춘 모습입니다. 스크린숏 `sc-<id>-<n>.png`.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `engine-crash` | (자동) 엔진이 멈춤 → 다시 시작 → 돌아옴 | 상태 표시줄 엔진 칸 "다시 시작 중 1/3"(warning 점), 연결 칸 "다시 연결 중", 목록 흐림, 입력 잠금(쓰던 글 남음), 입력창 위 경고 띠. 돌아오면 런타임 행 "다시 시작됐어요"와 "이어서 실행" 행 | L4.desktop §4.4, spec §6.3 그림, N-54 |
| `engine-crash-safe` (실패) | (자동) 시작 실패 3번 → 카드 "안전 모드로 시작" | 1/3 → 2/3 → 3/3 뒤 엔진 칸 "엔진 시작 실패"(danger 점) + 띠 위 버튼 "엔진 다시 시작"·"진단 복사", 입력창 자리에 안전 모드 제안 카드(원인 `ext.load_failed · ext:acme-notes`, stderr 마지막 20줄). 누르면 "안전 모드로 시작 중" → 상태 표시줄 칩 "안전 모드", 대화 런타임 줄 "안전 모드 · 그룹·외부 확장·X 훅 꺼짐 · 주도 없음" | N-55(W-35·W-39 `suggestSafeMode`, `safeModeCause`), N-56(결정 12), 계획에 없음 5 |
| `webview-reattach` | (자동) 화면만 죽음 → 다시 붙음 | 창 전체 "화면을 다시 불러오는 중"(엔진·턴은 그대로) → 토스트 "진행 중 턴은 끊기지 않았어요" | L4.desktop §4.4 WebView 행, §4.5 |
| `app-update` | (자동) 업데이트 칸 → 내려받기 → 다시 시작 → 지금 다시 시작 | 상태 표시줄 "업데이트"(점) → "업데이트 58%" → "다시 시작해서 업데이트". 턴이 돌고 있어 확인 대화 상자(나중에 · 턴이 끝나면 · 지금 다시 시작, 멈추는 것 목록) → 창 전체 "0.4.2로 다시 시작하는 중" → 토스트와 "이어서 실행" 행 | 계획에 없음 1, L4.release §5 |
| `app-update-fail` (실패) | (자동) 내려받기 21%에서 끊김 → "다시 시도" → 서명 불일치 | danger 토스트 + 칸 "업데이트 실패". 다시 받으면 서명 확인에서 멈추고 받은 파일을 지움("그래도 설치"는 두지 않음) | 계획에 없음 1 |
| `notifications` | (자동) 다른 대화(테스트 정리)에 있음 → OS 알림 → 누름 → 허용 | 오른쪽 위 OS 배너(앱 밖)와 앱 안 토스트가 함께, 배너를 누르면 그 대화가 열리고 승인 카드에 강조 테두리 | N-53, flow §7.2, §6.4 |
| `notifications-denied` (실패) | (자동) OS 권한 거부 → 토스트 "설정 보기" | 토스트 "OS 알림이 꺼져 있어요" → 설정 "실행과 서비스" 탭 알림 묶음, 위에 "시스템 설정 열기" Alert, 스위치 잠김. 같은 탭 아래 "창을 닫으면"(메뉴 막대 아이콘으로 남기기) | N-53 끄는 자리, `l2.dialog.notify.*`, N-51 |
| `background-work` (실패 포함) | 상태 표시줄 "진행 중 5" → 행 누름 | Popover에 종류별 목록(대화·테스트 대화·예약·제작 대화), 예약이 실패하면 칸에 danger 점과 그 행 danger 아이콘, 행을 누르면 그 대화로 | N-58(`liveTurns`), 계획에 없음 10 |
| `toast-well` | (자동) well 열림 → 닫힘 → 열림 | 토스트가 well 왼쪽 끝 → 막대 옆 → 다시 well 왼쪽. danger 토스트는 닫히지 않음 | S-04, 결정 14 |

## `?state=` 목록

`main`, `bg-popover`, `bg-fail`, `engine-restarting`, `engine-failed`, `engine-popover`, `safe-starting`, `safe-mode`, `safe-chip`, `reattach`, `reattached`, `web-failed`, `update-available`, `update-downloading`, `update-confirm`, `update-applying`, `update-done`, `update-fail-download`, `update-fail-signature`, `toast-well`, `toast-nowell`, `os-banners`, `os-landed`, `notify-denied`, `notify-settings`, `tray`, `tray-closed`, `mac-menu`, `mac-menu-thread`.
