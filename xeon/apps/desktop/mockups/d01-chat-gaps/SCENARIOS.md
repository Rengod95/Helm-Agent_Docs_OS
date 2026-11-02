# d01 대화 영역 빈칸 · 시나리오

`?scenario=<id>`로 시작하고 `&dev=1`이면 왼쪽 아래 막대에서 고르고 다시 시작합니다. `&step=<n>`은 대본의 앞 n개 동작을 바로 적용한 순간이고, `&hold=1`을 더하면 그 순간에 멈춥니다(스크린숏용). 스크린숏 이름 `sc-<id>-<n>.png`가 그 순간입니다.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `turn-fail-retry` | (자동) 보냄 → 도구 → 실패 · Alert "다시 시도" | 사용자 메시지, 흐르는 답, edit 도구 행, 트랜스크립트 아래 `Alert tone="danger"`(이유 문장은 host 그대로). 다시 시도하면 런타임 행 "같은 입력으로 다시 시도" 뒤 테스트 통과 | spec §6.6 F·오류, N-42 |
| `resume-after-restart` | (자동) 앱 재시작 → 띠 "이어서 실행" | 입력창 위 "앱을 다시 열었어요" 띠와 잠긴 입력, 목록 행 배지 "이어서 실행", 경고 띠(그대로 두기·이어서 실행), 누르면 런타임 행 "이어서 실행했어요"와 흐르는 답 | L4.desktop §4.7, `turn.resume` resumed, N-44 |
| `resume-closed` (실패) | 같은 순서 | 결과 `closed`: "이어갈 수 없어서 턴을 닫았어요 · 재개 횟수 3/3" 경고 행, 목록 배지 사라짐 | `turn.resume` closed, `l1.persistence.maxResumeAttempts` |
| `resume-nothing` | 같은 순서 | 결과 `nothing`: "이어서 할 일이 없어요 · 다른 창에서 이미 끝냈어요" | `turn.resume` nothing |
| `thread-menu` | 행 위 ⋯ → 이름 바꾸기 → 저장 · ⋯ → 분기 · ⋯(실행 중 t1) → 지우기 · ⋯(주간 회고) → 지우기 → 지우기 | 이름이 바뀌고 토스트, 분기한 대화가 원래 행 아래에 생기고 열림, 실행 중 대화는 O-06이 "지울 수 없어요"(닫기만), 주간 회고는 지워지고 토스트 | spec §6.1 행 메뉴, O-06 대화 변형, N-45 |
| `schedule-delete` | "예약: 매일 정리" 행 ⋯ → 예약 지우기 → 예약 지우기 | O-06 예약 변형(다음 실행 취소, 지난 실행 대화는 남음) | O-06 예약 변형 |
| `export-thread` | t1 행 ⋯ → 내보내기 → 형식 → 저장… | Markdown·JSON 고르기, 도구 결과·런타임 행 포함 여부, 시크릿은 핸들만, 저장 뒤 토스트 "폴더 열기" | 계획에 없음 6 |
| `export-fail` (실패) | 같은 순서, JSON | 대화 상자 안 `Alert danger` "~/Documents에 쓸 수 없어요 · 권한 없음", 버튼이 "다른 곳에 저장…" | 계획에 없음 6 |
| `list-states` | (자동) 읽는 중 → 실패 → "다시 읽기" → "더 보기" | Skeleton 5행 → "대화 목록을 읽지 못했어요" + 다시 읽기 → 목록과 "더 보기 · 50개 뒤" → 옛 대화 두 개 붙음 | spec §6.1 상태, N-46 |
| `read-fail` (실패) | (자동) 빌드 실패 분석 열기 → 실패 → "다시 읽기" | 얇은 진행 막대 + Skeleton 3행 → "대화를 읽지 못했어요" → 다시 읽은 트랜스크립트 | spec §6.6 G |
| `new-messages` | (자동) 위로 올려 읽는 중 새 항목이 옴 → "새 메시지 N" | 바닥 따라가기를 멈추고 입력창 위 가운데 알약 "새 메시지 N"이 늘어남, 누르면 맨 아래 | spec §6.6 H |
| `approval-sync` | (자동) 질문·계획·변경 검토 카드가 옴 → 아무 곳에서나 답 | 같은 카드 부품이 트랜스크립트 끝과 받은 요청 well에 함께, 한쪽에서 답하면 두 곳 모두 기록 줄로 바뀜 | N-43, FS-02, Y1 |

## `?state=` 목록

`main`(기본: 긴 도구 결과 400자 미리보기 + 도구 승인), `cards-transcript`, `cards-well`, `cards-page`(P-03 무대, well 닫힘), `cards-resolved`, `loading`, `read-fail`, `turn-fail`, `new-msgs`, `restarting`, `resume-band`, `resume-resumed`, `resume-closed`, `resume-nothing`, `row-menu`, `rename`, `forked`, `delete`, `delete-running`, `schedule-delete`, `export`, `export-fail`, `list-loading`, `list-fail`, `list-more`, `list-empty`.
