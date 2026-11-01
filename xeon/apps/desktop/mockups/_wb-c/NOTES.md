# _wb-c (묶음 C 공용 부품)

c01~c04가 함께 쓰는 부품과 고정 데이터입니다. 각 폴더 `mockup.css`가 `@source "../_wb-c/"`로 읽습니다.

| 파일 | 하는 일 |
|---|---|
| `data.ts` | 시험 행, ReplayDriveReport, 단계 사이 기록, 턴 다시 보기 눈금, 설치 이력, 설정 값 출처, 화면 기여, 기록, X 훅 |
| `frame.tsx` | `WbFrame`(작업대 셸 + 오른쪽 탭 + 상태 표시줄 + "개발 모드" 칸), `goFolder`(옆 시안으로) |
| `parts.tsx` | `DotText`·`StatusDot`(C-23), `ExtName`(표시 이름 + mono id), `LayerCell`, `SectionTitle`, `Mono`, `DevLock`("개발 모드에서만" + 이유 툴팁), `ReadOnlyNote` |
| `grid-table.tsx` | 행 하나 고르는 ghost 표(wb2-opus 복사) |
| `turn-replay.tsx` | 턴 다시 보기 막대와 잠김 줄 |
| `settings-slot.tsx` | settings slot 읽기 전용 부분(N-25) |
