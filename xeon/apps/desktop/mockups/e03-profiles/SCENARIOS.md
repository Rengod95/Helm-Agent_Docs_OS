# e03 프로필 관리 · 시나리오

`?scenario=<id>`(`&dev=1`이면 막대), `&step=<n>&hold=1`은 멈춘 모습. 스크린숏 `sc-<id>-<n>.png`.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `profile-crud` | 새 프로필 → 이름 → 만들기 → 행 메뉴 이름 바꾸기 → 저장 → 복제 → "탐구 중심" 지우기… → 지우기 | 목록에 새 행과 토스트, 제목 자리 입력칸과 저장 중, 사본 행, 지우기 확인에 쓰는 곳 셋(시험 대화 둘, 웹 창 하나), 지운 뒤 토스트 "시험 대화는 이미 적용한 값을 그대로 가져요" | N-57, W-46, 결정 5 |
| `profile-conflict` (실패) | "탐구 중심" 이름 바꾸기 → 저장 → 다시 읽기 | 저장 중 → 상세 위 Alert "다른 곳에서 바뀜 · 웹 · build-box에서 1분 전 먼저 저장(rev 7 → 8)…", 다시 읽으면 그쪽 바꿈(작업 관리 켜기, maxLenses 6)이 보이고 내 이름은 입력칸에 남음 | N-57 baseRev(§6.28.3) |
| `profile-live` | (기다림) | 2.5초 뒤 다른 기기(앱 · iPhone)가 "조용히"를 바꿔 행에 "방금 바뀜"과 토스트 | `profile.changed`, N-57 |

## `?state=` 목록

`main`(기본), `menu`, `create`, `rename`, `duplicated`, `delete-confirm`, `conflict`, `reloaded`, `live-changed`, `empty`, `loading`, `offline`.
