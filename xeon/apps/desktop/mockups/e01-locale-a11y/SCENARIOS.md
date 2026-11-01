# e01 화면 언어와 접근성 · 시나리오

`?scenario=<id>`(`&dev=1`이면 왼쪽 아래 막대), `&step=<n>&hold=1`은 그 순간에 멈춘 모습입니다. 스크린숏 `sc-<id>-<n>.png`. 영어는 어느 주소에나 `&lang=en`.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `keyboard-only` | F6 → F6 → F6(카드) → Y → (답) → F6 → F6 | 덧그림 번호표가 1→2→3으로 옮겨 가고 초점 고리가 영역 바꾸기·내비·승인 카드에 섭니다. Y를 누르면 카드가 "bash 실행을 허용했어요 · 한 번" 줄로 바뀌고 초점은 입력창, 자막에 polite 문장 둘(허용, 답이 옴). 이어서 well, 상태 표시줄 | N-50, Y14, spec §4.8(승인 카드 Y·N), §6.0 |
| `keyboard-only-fail` (실패) | 입력창에서 Y → ⌘⇧A → N | Y가 입력창에 "y"로 들어가고 alert 자막 "입력란 안이라 Y는 글자로…". ⌘⇧A로 카드에 초점, N으로 거부 | §4.8 "문자 키는 입력란 밖에서만" |
| `lang-switch` | 설정 → 화면 언어 → English | 행 도움말 "문구 묶음을 읽는 중" → 다시 그려 영어 화면, 토스트 "Display language changed" | N-49, Y15 |
| `lang-switch-fail` (실패) | 설정 → 화면 언어 → English | 문구 묶음을 못 읽어 Select가 "시스템 따름(한국어)"로 돌아가고 행 아래 오류 한 줄, danger 토스트, alert 자막 | N-49 |

## `?state=` 목록

`chat`(기본), `wb-ext`, `status-pop`, `settings`, `focus-order`, `focus-order-chat`, `focus-approval`, `live-captions`, `reduced-motion`, `hc-broken`, `hc-fixed`, `zoom-200`(640×400, 배율 2로 찍음), `lang-fail`. 모두 `&lang=en`과 함께 볼 수 있습니다.

## aria-live 문장(polite, 오류만 alert)

| 때 | 문장 | 종류 |
|---|---|---|
| 승인 허용 | "bash 실행을 허용했어요 · 한 번. 승인 대기 0개" | polite |
| 승인 거부 | "bash 실행을 거부했어요. 승인 대기 0개" | polite |
| 답이 옴(턴 끝) | "답이 왔어요: 캐시를 지우고 시험 12개가 모두 통과해요" | polite |
| ⌘⇧A로 카드 | "승인 카드: bash, 위험도 exec. 캐시 무효화 조사" | polite |
| 입력란에서 Y | "입력란 안이라 Y는 글자로 들어갔어요(승인은 입력란 밖에서만)" | alert(목업 설명용, 실제 앱은 읽지 않음) |
| 언어 바꾸기 실패 | "영어 문구 묶음을 읽지 못해 한국어로 둬요" | alert |
| 새 승인 도착(다른 대화) | "승인 요청: bash · 테스트 정리" | polite(제안) |
| 연결 끊김·다시 연결 | "엔진과 연결이 끊겼어요" / "다시 연결됐어요" | alert / polite(제안) |
