---
id: eng.readme
layer: eng
domain: index
kind: readme
status: draft
depends_on: []
binds: []
---

# 엔지니어링 구속 문서

## 1. 이 디렉터리의 성격

- 이 디렉터리의 문서는 모든 Xeon 구현 작업에 적용되는 구속 문서다. 대상 코드는 `xeon/**`이고, 층 문서(spec, plan)보다 먼저 읽는다.
- 문서 선택은 `docs/xeon/_routing/routes.yaml`의 `by_task`가 정한다. `implement`(코드를 쓰거나 고치는 모든 작업), `data`(저장·이벤트·재생·원자성을 건드리는 작업, implement에 더함), `review`(정합성 검토) 묶음이 이 디렉터리의 문서를 자동으로 고른다. `xeon/scripts/docs-route.ts`가 그 목록을 출력한다.

## 2. 문서 목록

| # | 경로 | id | 종류 | 한 줄 요약 | implement | data | review |
|---|---|---|---|---|---|---|---|
| 1 | `dependency-rules/guide.md` | `eng.dependency-rules.guide` | guide | 층 순위(F → X → L0 → L1 → L2 → L3 → L4), import 규칙, 강제 수단 | 필수 | | 필수 |
| 2 | `typescript/guide.md` | `eng.typescript.guide` | guide | 타입 규칙: 브랜드 ID, `Result`, 금지 구문, 컴파일 옵션 | 필수 | | |
| 3 | `domain-types/guide.md` | `eng.domain-types.guide` | guide | DTO·스키마·도메인 타입 설계, 버전, 확장 규칙 | 필수 | | |
| 4 | `toolchain/guide.md` | `eng.toolchain.guide` | guide | Bun, tsgo, oxlint·oxfmt, turbo, CI와 버전 고정 | 필수 | | |
| 5 | `testing/guide.md` | `eng.testing.guide` | guide | 단위 테스트 우선, 테이프 기반 모델 가짜, 통합 최소화 | 필수 | | |
| 6 | `anti-patterns/guide.md` | `eng.anti-patterns.guide` | guide | 아키텍처·코드·스택 단위 안티패턴(AP-A, AP-C, AP-S)과 감지 수단 | 필수 | | |
| 7 | `best-practices/guide.md` | `eng.best-practices.guide` | guide | 기본 선택 규칙(BP): 계약 먼저, 확장 지점 선택, 오류·주입·설정·비밀·이벤트·로깅 | 필수 | | |
| 8 | `context-map/design.md` | `eng.context-map.design` | design | 바운디드 컨텍스트 지도와 소유 경계 | | 필수 | 필수 |
| 9 | `events/design.md` | `eng.events.design` | design | 이벤트 종류, 내구·휘발, 순서, 재생 | | 필수 | |
| 10 | `transactions/design.md` | `eng.transactions.design` | design | 정합성·원자성, 단일 DB, outbox, 멱등 | | 필수 | |
| 11 | `frontend-state/guide.md` | `eng.frontend-state.guide` | guide | UI 전역 상태(React 19 + Zustand 5): 스토어 구성, reducer 단계, 스트리밍, 재동기화, 선택자 | | | |
| 12 | `performance/guide.md` | `eng.performance.guide` | guide | 속도 예산표, `just bench` 측정 규칙(ADR-0012) | | | |

- `review` 묶음에는 이 디렉터리 밖의 `architecture.layers.spec`도 들어 있다(`routes.yaml` `by_task.review`).
- 11은 작업 묶음에 넣지 않고 `binds`(`xeon/apps/desktop/src/**`, `xeon/**/*.tsx`)로만 고른다. UI 코드가 아닌 작업이 읽을 이유가 없기 때문이다.
- 경로는 이 README 기준 상대 경로다.

## 3. 읽는 순서

1. `dependency-rules`: 어떤 패키지가 무엇을 import할 수 있는지가 모든 코드 배치의 전제다.
2. `typescript`: 모든 파일에 적용되는 타입 규칙과 금지 구문을 먼저 알아야 예제 코드를 읽을 수 있다.
3. `domain-types`: F 계약을 쓰는 방식이다. 새 기능은 F 타입부터 정하므로 구현 전에 읽는다.
4. `toolchain`: `just verify`가 돌리는 도구와 버전 고정 규칙이다. 검사 실패를 해석할 때 필요하다.
5. `testing`: 구현과 함께 쓰는 테스트의 형식이다.
6. `anti-patterns`: 앞 다섯 문서의 규칙을 어기는 전형적인 모양과 감지법이다. 규칙을 안 뒤에 읽어야 사례가 무엇을 어기는지 보인다.
7. `best-practices`: 같은 주제의 기본 선택이다. 안티패턴과 항목별로 짝을 이룬다.
8. `events`: 이벤트를 어떻게 정의하고 재생하는지다. 저장·이벤트를 건드리는 작업은 여기부터 추가로 읽는다.
9. `context-map`: 어떤 컨텍스트가 어떤 데이터와 이벤트 type 접두사를 소유하는지다. 이벤트 정의(`depends_on: eng.events.design`)를 안 뒤에 읽는다.
10. `transactions`: 이벤트와 투영을 어떤 트랜잭션 경계로 커밋하는지다. 이벤트 정의와 소유 경계를 안 뒤에 읽는다.

1~7은 모든 구현 작업이 읽는다. 저장·이벤트·재생·원자성을 건드리는 작업은 8~10을 더 읽는다. UI 전역 상태와 화면 부품을 건드리는 작업은 11을 더 읽는다.

## 4. 규칙 ID 체계

| 접두 | 문서 | 형식 |
|---|---|---|
| DR | `eng.dependency-rules.guide` | `DR-NN` |
| TY | `eng.typescript.guide` | `TY-NN` |
| DT | `eng.domain-types.guide` | `DT-NN` |
| TC | `eng.toolchain.guide` | `TC-NN` |
| TS | `eng.testing.guide` | `TS-NN` |
| AP-A, AP-C, AP-S | `eng.anti-patterns.guide` | `AP-A-NN`(아키텍처), `AP-C-NN`(코드), `AP-S-NN`(스택) |
| BP | `eng.best-practices.guide` | `BP-NN` |
| CM | `eng.context-map.design` | `CM-NN` |
| EV | `eng.events.design` | `EV-NN` |
| TX | `eng.transactions.design` | `TX-NN` |
| FS | `eng.frontend-state.guide` | `FS-NN` |
| PF | `eng.performance.guide` | `PF-NN` |

- 인용 형식: 문서 안에서는 `<문서 id> <규칙 ID>`로 쓴다. 예: `eng.anti-patterns.guide AP-C-05`.
- 링크 앵커: 명시적 `<a id>`를 둔 문서는 `eng.anti-patterns.guide`와 `eng.best-practices.guide`뿐이다. 이 두 문서의 항목만 `[AP-C-05](anti-patterns/guide.md#ap-c-05)`처럼 규칙 ID의 소문자를 앵커로 링크한다. 다른 문서의 규칙(DR, TY, DT, TC, TS, CM, EV, TX, FS)은 헤딩 자동 앵커가 제목 전체를 포함하므로 링크하지 않고 인용 형식으로 쓴다.
- 코드 주석의 예외 표시는 `eng.typescript.guide` 4.1절 형식 하나다: `// oxlint-disable-next-line <규칙> -- <이유> (<이슈 URL>)`. 구속 문서가 미리 허용한 예외는 이슈 URL 대신 `(<문서 id> <규칙 ID>)`를 쓴다. 예: `// oxlint-disable-next-line no-restricted-properties -- Clock 구현 (eng.anti-patterns.guide AP-C-05)`. PR 설명에서는 규칙 ID만 써도 된다.
- 번호는 한 번 쓰면 바꾸거나 다시 쓰지 않는다. 규칙을 없애면 번호를 비워 두고 "폐기"로 표시한다.

## 5. 표지와 예외

- 표지 뜻(`_templates/README.md` 문체 규칙):
  - `[결정]`: 사용자 결정. `_research/decisions-log.md`나 ADR을 근거로 단다.
  - `[제안]`: 작성자의 설계 선택. 사용자 확인 없이 바꿀 수 있다.
  - `[가정]`: 확인하지 않은 전제. 확인되면 표지를 지우거나 고친다.
  - `[미결]`: 사용자 확인이 필요한 항목. 각 문서 끝 "미결 사항" 절에 모은다.
- 예외 절차: 규칙 위반은 두 방법으로만 승인한다.
  - 규칙별 허용 목록: 린트 disable 주석이나 검사 스크립트의 허용 목록에 규칙 ID와 이유를 적는다. disable 주석 형식은 `eng.typescript.guide` 4.1절 하나이고, 허용 목록 파일의 형식은 각 guide의 예외 절이 정한다(의존 규칙은 `eng.dependency-rules.guide` 4절).
  - ADR: `[결정]`에서 나온 규칙이나 층 구조를 벗어나는 예외는 `docs/xeon/decisions/`에 ADR을 쓴다.

## 6. 문서 간 우선순위 [제안]

문서 사이에서 규칙이 서로 다르게 읽히면 아래 순서로 앞선 쪽을 따르고, 뒤쪽 문서를 고친다.

1. `_research/foundation-plan.md`의 결정과 ADR(`adr.NNNN`)
2. `eng.dependency-rules.guide`
3. 이 디렉터리의 나머지 문서

같은 순위 안에서 다르게 읽히면 [미결]로 올린다.

## 7. 문서를 바꿀 때

- 문서를 추가·이동·삭제하면 같은 변경에서 `routes.yaml`의 `manifest.engineering`과 `by_task`를 고친다.
- 규칙을 바꾸면 같은 변경에서 그 규칙의 강제 수단을 고친다. 대상은 `xeon/.oxlintrc.json`, `xeon/.oxfmtrc.json`, `xeon/scripts/check-layers.ts`, `.dependency-cruiser.cjs`, `knip.json`, `lefthook.yml`, `justfile` 중 해당하는 것이다.
- 고친 뒤 `just docs-route --check`와 `just verify`로 확인한다.
