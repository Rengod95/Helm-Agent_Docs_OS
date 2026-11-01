# e04 작업대 상태와 결과 없음 · 시나리오

`?scenario=<id>`(`&dev=1`이면 막대), `&step=<n>&hold=1`은 멈춘 모습. 스크린숏 `sc-<id>-<n>.png`.

| 시나리오 | 누르는 순서 | 화면에서 바뀌는 것 | 근거 |
|---|---|---|---|
| `filter-empty` | 찾기 칸에 lint → 층 L3 → 거르기 지우기 | 1행(pre-commit-lint)만 남음 → "\"lint\" · 층 L3와 맞는 것이 없어요"와 "거르기 지우기" → 9행 다시 | N-48, spec §6.23 |
| `list-load-fail` (실패) | (자동) 읽는 중 → 실패 → Alert의 다시 읽기 | Skeleton 5행 → danger Alert "확장 목록을 읽지 못했어요 · ext.list 시간 초과(5초)" → 다시 읽는 중 → 목록과 토스트 | N-47, DP-28, §6.0 |

## `?state=` 목록

`ext-list`(기본), `ext-loading`, `ext-empty`, `ext-filter-empty`, `ext-error`, `detail-loading`, `detail-offline`, `detail-empty`, `detail-error`, `metrics-loading`, `metrics-many`, `metrics-empty`, `metrics-off`, `palette-empty`, `palette-empty-wb`, `proposals-empty`, `settings-empty`.
