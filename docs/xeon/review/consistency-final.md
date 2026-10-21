---
id: review.consistency-final
layer: meta
domain: review
kind: review
status: draft
depends_on: [review.consistency-1, review.decisions-2]
binds: []
---

# 정합성 검토 최종

## 1. 결과

- 대상: `review/consistency-1.md`의 지적 76건(K 20, D 16, T 24, S 16)과 `review/decisions-2.md`의 결정 반영.
- 방법: 2차 수정(층별 수정자 8명), 재검증(검토자 2명), 3차 수정(F 포트·서비스 정본 확정 뒤 하위 6개 그룹), 최종 검증(검토자 2명), 마무리 수정 13건. 판정은 실제 파일을 다시 읽어 정했다.
- 판정: 76건 모두 해결이다. 잠정 결정(U-01~U-24)에 걸린 항목은 문서가 결정과 맞으면 해결로 셌다. 결정 자체의 사용자 확인은 §3에 남는다.
- 최종 검증에서 새로 찾은 상충 12건(죽은 설정 키 참조, 타입 이름, 정규식, 정본 위치 문구, 상한 필드 표기)은 마무리 수정에서 모두 고쳤다.
- 문서 검사: `bun scripts/docs-route.ts --check`(누락 허용 없음)가 오류 0, 경고 0이다. `just verify`와 CI 문서 job에서 `--allow-missing`을 지웠다.

## 2. 이번에 정해진 구조

| 항목 | 정본 |
|---|---|
| 확장 포트(LoopPort, InputQueuePort, ToolsPort, ModelsPort, McpPort, LeaseArbiterPort, RecordCommitPort, 로더·훅 포트) | `F.extensions.spec` §3.2.1 `ports.ts`. X는 재export만 한다 |
| 서비스 인터페이스 15종과 `SERVICE_NAMES` | `F.capabilities.spec` §3.12 `@xeon/contracts/services` |
| Cordis에 등록되는 L2 서비스 | `xeon.mcp`만. 나머지 L2 이름은 묶음 이름이다 |
| 확장 id | `^[a-z][a-z0-9-]{1,31}$`, 테이블 접두 `x_<id>_`, 지역 테이블 이름에 밑줄 금지 |
| 비공개 기록 | `ScopeApi.recordPrivate`, `queryRecords(threadId, query, reader)` |
| 커밋 키 | 정본 `eng.transactions.design` §4.7, 코드 상수 F `records/commit.ts` |
| 쓰기 소유 | OS 잠금 + `sys_leases.epoch` 펜싱(ADR-0004 개정) |

## 3. 남은 일

- 사용자 확인: `review/decisions-2.md` §2의 U-01~U-24.
- 문서 안의 `[미결]` 중 결정 범위 밖 항목(각 문서 끝 "미결 사항")은 해당 plan의 M2 이후 작업에서 정한다. M0·M1 구현을 막는 항목은 없다.
- X.operations §10 미결 4(`ScopeHandle.enable/disable` 사유 인자)와 L3.group-kit §3.13 X 요청 4개는 M2에서 정한다.
