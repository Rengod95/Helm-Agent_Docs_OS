# e05 웹·좁은 폭·원격 크래프트 · 시나리오

`?scenario=<id>`(`&dev=1`이면 막대), `&step=<n>&hold=1`은 멈춘 모습. 스크린숏 `sc-<id>-<n>.png`. 웹 연결(계획에 없음 7), 모바일 폭(계획에 없음 8)은 "계획에 없음" 항목을 그린 것입니다.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `web-login` (실패 포함) | 토큰 xk_wrong… → 연결 → 토큰 xk_live… → 연결 → (자동 끊김) → 지금 다시 연결 | 토큰 칸 오류 "남은 시도 4번" → 연결 중 → 브라우저 안 셸 → 3초 뒤 "다시 연결 중 1" → "끊김" 띠와 입력 잠금 → 다시 붙어 토스트와 놓친 항목 2개 | 계획에 없음 7, spec §7.8 연결 상태 |
| `web-unreachable` (실패) | 연결 → 다시 시도 | 폼 위 danger Alert "build-box.local:7420에 닿지 못했어요…" | 계획에 없음 7 |
| `mobile-approve` | (기다림) → 띠의 보기 → bash 요청 → 허용 | 390: 다른 대화에서 알림 띠와 받은 요청 배지 2 → 받은 요청 목록 → 승인 전체 화면 → 허용 뒤 목록 "허용했어요 · bash", 배지 1, 토스트 | 계획에 없음 8, N-59 |
| `mobile-approve-expired` (실패) | 같은 순서로 허용 | 데스크톱이 먼저 답해 상세 위 "데스크톱에서 이미 허용했어요(14:06)"와 버튼 잠금 | approval.resolved(FS-02), N-59 |
| `remote-enable` (실패) | 리뷰 켜기 스위치 | build-box가 거부 → 표 위 danger Alert "권한 없음(ext.manage)…" | N-60 |

## `?state=` 목록

웹(1280): `web-login`(기본), `web-connecting`, `web-bad-token`, `web-unreachable`, `web-live`, `web-reconnecting`, `web-offline`, `web-reconnected`.
좁은 폭(390×844, `m-settings`는 700): `m-chat`, `m-banner`, `m-inbox`, `m-approve`, `m-approved`, `m-elsewhere`, `m-left-sheet`, `m-well-sheet`, `m-workbench`, `m-settings`.
원격(1280): `remote-ext`, `remote-denied`, `remote-menu`, `remote-views`.
