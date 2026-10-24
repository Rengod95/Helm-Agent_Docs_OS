# archive

정본이 아니다. 정본은 `docs/design/`이다. 이 폴더의 문서는 정본을 만드는 데 쓰인 원전, 개정 후보, 작업 기록이며, 정본과 어긋나면 정본이 맞다. 구조 정리 계획: `.helm-design-work/coordinator/restructure/plan.md` §5.

| 폴더 | 무엇 | 왜 여기 있나 |
|---|---|---|
| `foundations-v0.1/` | v0.1 원론과 v0.2 정제 후보(공리, 불변조건, 가설) | 이론 핵심은 정본으로 흡수 예정. 원문 보존 |
| `foundations-friendly/` | 쉬운 말 버전, `product-language.yaml` | 문구 대응은 용어집으로 흡수 예정 |
| `architecture/` | `helm-system-v0.md`, `helm-kernel-v0.2-candidate.md` | 옛 시스템·커널 후보. 정본이 대체 |
| `v0.3/` | v0.3 개정 후보 00~14, `audit/audit-report.md` | 결정 1~18의 출처 |
| `experience/`, `prototypes/` | v0.2 CLI 경험 계약, 시뮬레이션·종이 시제품 기록 | 설계 검증에 쓴 기록 |
| `research-program/` | 연구 프로그램, 방법 카드, 번들 | 방법론 조사. 정본이 아님 |
| `handoff/` | 클라우드 세션 핸드오프와 대화 전사 | 작업 이력 |
| `design-process/` | 설계 브리프 외의 판정, 이력, 보고, 검증 1·2차, 원전 요약·대화 발췌, 구현 준비 점검표, ADR 문서(`24-adr.md`) | 작업 기록. ADR은 정본 병합 전에 `docs/design`에서 분리 |

참고 자료(pi 사실, 조사 노트)는 `docs/reference/`에 있다.

옛 설계 문서 01~26 전체는 git 태그 `pre-restructure`로 복원한다(`git show pre-restructure:docs/design/<파일>`). 미추적이던 원전의 백업: `~/backups/helm-docs-pre-restructure-20261019.tar.xz`.
