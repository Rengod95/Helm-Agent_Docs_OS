# _wb-c (묶음 C 공용 부품)

c01~c04가 함께 쓰는 부품과 고정 데이터입니다. 각 폴더 `mockup.css`가 `@source "../_wb-c/"`로 읽습니다.

옛 언어(MOCK 기준)로 이식했습니다. 선 격자(`LineGrid*`)는 `../_shell`에서 가져오고, 색·글자·그림자·반지름은 옛 caustic 토큰만 씁니다. 점선 구분선과 레일은 가져오지 않습니다.

| 파일 | 하는 일 |
|---|---|
| `data.ts` | 테스트 행(`runs`, 대화 비교용 `lenses`·`findings` 더함), ReplayDriveReport, 단계 사이 기록, 턴 다시 보기 눈금, 설치 이력, 설정 값 출처, 화면 기여, 기록, X 훅. 종류 id `"bench"`는 c01이 그대로 쓰므로 바꾸지 않습니다 |
| `frame.tsx` | `WbFrame`(크래프트 셸 + 오른쪽 탭 + 상태 표시줄 + "개발 모드" 칸), `goFolder`(`_shell`의 `navigateToPage`로 옆 시안에 감) |
| `parts.tsx` | `Dot`(옛 다섯 tone), `DotText`·`StatusDot`(C-23), `DottedRows`·`DottedRow`(실선으로 나눈 목록), `ExtName`(기본은 id를 보임), `LayerCell`, `SectionTitle`(옛 h2 그대로), `Mono`, `DevLock`("개발 모드에서만" + 이유 툴팁), `ReadOnlyNote` |
| `compare-grid.tsx` | `CompareGrid`: 머리 열 + 비교할 열을 그리는 선 셀 비교표(`LineGridBlock`). 해당 없는 칸(null)은 빗금 |
| `ext-table.tsx` | `ExtTable`(확장 표, 열 최소·최대 폭 격자), `statusOf`(상태 점 + 글 한 곳), `trustLabel`. e04 `parts/ext-table.tsx`에서 옮겼고 e01·e05도 씁니다 |
| `ext-bits.tsx` | `ExtStatus`, `LayerCell`, `statusOf`(ext-table 것 다시 내보냄), `PLAIN_TABLE`(caustic Table에 선 없는 변형 className). wb-opus 조각 |
| `grid-table.tsx` | 행 하나 고르는 ghost 표(wb2-opus 복사). 옛 글자 크기 유지 |
| `turn-replay.tsx` | 턴 다시 보기 막대와 잠김 줄 |
| `settings-slot.tsx` | settings slot 읽기 전용 부분(N-25). `summary="list"`(기본, 옛 ListDescription)·`"grid"`(선 격자 지표 칸) |

옛 언어로 바꾸며 일부러 남기거나 뺀 것:
- `RunKind`·`bench` 종류 id, `hooks`의 `thread.end` 이벤트 이름은 그대로 둡니다(저장 값·코드 id). c01·c03이 그 값에 기댑니다.
- `ExtName`의 기본 `showId`는 `true`(옛 화면이 기본값에 기댑니다). 개발 모드 밖에서 id를 숨기려면 `showId={false}`.
- `grid-table.tsx`의 선택 표시와 글자 크기는 옛 것이 맞아 바꾸지 않았습니다.
