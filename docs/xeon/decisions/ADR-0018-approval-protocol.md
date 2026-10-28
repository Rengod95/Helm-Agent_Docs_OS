---
id: adr.0018
layer: adr
domain: approvals
kind: adr
status: accepted
depends_on: [adr.0004, adr.0006, L1.tools.spec, L2.dialog.spec, L2.work.spec, L2.artifacts.spec, F.records.spec, review.m3-design-inputs]
binds: [xeon/packages/core-tools/**, xeon/packages/contracts/src/services/**, xeon/packages/cap-dialog/**, xeon/packages/cap-work/**, xeon/packages/cap-artifacts/**]
---

# ADR-0018 승인 프로토콜 하나: 도구 승인, 계획 승인, 사용자 질문, 검토 승인

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-26
- [결정] 질문 도구와 계획 승인을 L1-d 승인 프로토콜 하나로 통합한다(`_research/decisions-log.md` 2026-10-21 3차, `_research/foundation-plan.md` §1 결정 5).
- [결정] 이 결정을 ADR로 승격한다(사용자 결정 2026-10-26, `review.m3-design-inputs` D-M3-31 행 7). 승격 기준은 `adr.readme` §4 "두 층 이상의 코드 구조를 바꿈"이다. L1(tools), L2(dialog, work, artifacts), L4(승인 카드)가 같은 형식을 쓴다.

## 2. 맥락

- 사람의 응답을 기다리는 요청은 넷이다. 도구 실행 승인, 계획 승인(`submit_plan`), 사용자 질문(`ask_user`), 산출물 검토 승인(M3-09 `review`)이다.
- 요청마다 형식과 저장 위치가 다르면 재개, 원격 응답, 만료, 무인 실행 정책을 넷으로 나눠 구현한다. 서비스 모드와 원격 클라이언트(ADR-0006)에서는 어느 클라이언트든 같은 방법으로 응답해야 한다.
- `L1.tools.spec`은 이미 단일 대기 형식(`ApprovalKind = "tool" | "plan" | "question"`, 내구 이벤트 `approval.requested`·`approval.resolved`, 호스트 메서드 `approval.respond`)을 정했다(`L1.tools.spec` §4.7, `review.decisions-2` U-02). `adr.readme` §4는 이 결정을 ADR 승격 후보로 두었다.

## 3. 결정

1. [결정] 도구 승인, 계획 승인, 사용자 질문, 검토 승인은 L1-d 승인 서비스(`ApprovalService`) 하나로 처리한다. 대기 레코드 형식, 저장(L1-f 체크포인트 `waiting: "approval"`), 내구 이벤트, 호스트 응답 메서드가 같다.
2. [결정] 승인 kind는 `tool`, `plan`, `question`, `review`다. `review`는 M3-09가 더한다(`F.records.spec`, `L1.tools.spec` 반영은 M3-REQ-09).
3. [결정] 요청자는 둘이다. 도구 승인은 core-tools 파이프라인이 내고, 계획·질문·검토 승인은 L2 능력(dialog, work, artifacts)이 자기 도구 실행 안에서 `xeon.approvals.request`를 부른다. L2는 따로 대기 상태를 저장하지 않는다.
4. [결정] 만료(`expiresAt`, M3-06)와 무인 실행 정책은 kind와 관계없이 같은 규칙을 쓴다. 예약 실행 세션은 대기하고 만료 뒤 거부로 끝내며, 설정으로 대기·거부·만료 뒤 거부를 고른다(D-M3-12). print 모드는 사전 허용 규칙만 적용하고 나머지는 거부하며, 전체 자동 승인 옵션을 따로 둔다(D-M3-14).
5. [결정] 그룹(Helm, 학습)의 사용자 승인도 같은 프로토콜을 쓴다. 학습 제안 대기열의 결정은 승인 증거(`ApprovalEvidence{ source: "learning.queue" }`)로 L2 지식 쓰기 승인과 이어진다(`L3.learning.spec` §4.5).
6. [제안] 클라이언트 승인 카드 요건(`L1.tools.spec` §4.8, M2 마감 G2-10)은 kind마다 본문 표시만 다르고 응답 흐름은 같다.

## 4. 결과

### 4.1 좋은 점

- 재개, 원격 응답, 알림, 만료를 한 번 구현한다.
- 서비스 모드에서 어느 클라이언트든 같은 메서드로 응답한다.
- 무인 실행 정책이 kind마다 다르게 새지 않는다.

### 4.2 감수할 점

- 질문 도구와 계획 도구가 L1 승인 서비스에 의존한다. L2 dialog·work는 L1-d 서비스 키를 주입받는다.
- kind가 늘 때마다 F 레코드 스키마와 승인 카드가 함께 바뀐다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| spec에서만 통합 | ADR 없이 `L1.tools.spec`의 [결정]으로 둔다 | 채택하지 않음 | 사용자 결정 D-M3-31 행 7. 세 층이 쓰는 형식이라 번복 비용이 패키지 하나를 넘는다 |
| 통합하지 않음 | 질문·계획은 L2 dialog·work가 자체 대기 상태를 둔다 | 채택하지 않음 | 재개·원격·만료를 kind마다 구현한다 |

## 6. 미결 사항

- 닫음 [제안: 2026-10-28 F 구현, M3-REQ-09]: `ReviewBody`는 `{ reviewId, artifactId, title, round, files[{ path, change, binary, hunks }] }` 최소 집합이다. 답은 `ReviewAnswer`(`L2.artifacts.spec` §4.2.4)다. 코드는 `xeon/packages/contracts/src/records/catalog/approval.ts`와 `services/approvals.ts`다.
- [미결] 무인 승인 정책 설정 키 이름. `L1.tools.spec` 반영 작업(M3-REQ-73)에서 정한다.
