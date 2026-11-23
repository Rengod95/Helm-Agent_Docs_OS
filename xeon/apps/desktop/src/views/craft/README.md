# 크래프트 화면 (`views/craft`)

크래프트(LightCraft) 영역의 화면과 부품입니다. 내비는 다섯입니다: 프로필, 리뷰, 플러그인, 테스트, 메트릭(`docs/xeon/L4/desktop-ux/spec.md` §4.9.3). 화면 등록은 `views/workbench/index.tsx`입니다.

## 폴더

- `canvas/`: 프로필 캔버스(C3, 화면 `profile`).
- `review/`: 리뷰(화면 `craftReview`).
- `metrics/`: 메트릭(C9, 화면 `craft-metrics`). 턴 번호 곡선 구역과 같이 쓰는 도구 인사이트도 여기 있습니다(옛 성능 측정에서 옮김, AGE-69).
- `trace/`: 트레이스(C8, 목적 화면 `trace`).
- `test-chat/`: 테스트 챗 창(C7). Craft 어디서나 떠 있습니다.
- `members/`, `deps/`, `composition/`: 플러그인 상세(`views/workbench/ext-detail.tsx`)의 멤버, 의존, 구성 탭.
- 낱 파일: `info-tip.tsx`(정보 아이콘), `installed-entries.ts`(설치 목록 읽기), `kind-paths.ts`(종류 그림의 획), `core-required.ts`, `craft-scope.ts`, `craft-theme.ts`(그림의 어두움과 밝음), `hook-labels.ts`(멤버 탭이 쓰는 훅 이름).

## 지운 것

- 옛 개요(지도, 순서, 링크 캔버스와 자세히 보기, `CraftBody`)는 2026-11-23 내비에서 빠졌고 AGE-69에서 코드를 지웠습니다.
- `orbit-model.ts`, `orbit-layout.ts`만 남았습니다. 데스크톱 속도 측정 `just desktop-benchmark frame`(`test/benchmark/orbit-frame.benchmark.ts`)이 이 두 순수 모델로 지도 한 장의 계산 시간을 잽니다. 그 측정을 없앨지는 사용자 확인 전입니다.
