---
id: adr.0013
layer: adr
domain: post-next-aside
kind: adr
status: accepted
depends_on: [adr.0007, L1.tasks.spec]
binds: [xeon/packages/core-tasks/**]
---

# ADR-0013 `post.when = next`는 붙기만 하고, `aside`는 L1·CLI 입력 전용

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-25(결정 2026-10-23)
- [결정] `post.when = next`는 B안(붙기만 하고 스스로 시작하지 않음)이고 `aside`는 1안(L1·CLI 전용)입니다. F `PostWhen`은 바꾸지 않습니다(`review.m2-plan` §8 D7).
- 이 ADR은 D7을 plan 표에서 ADR로 옮깁니다(마일스톤 재점검 G3-03). 구현 규칙의 정본은 `L1.tasks.spec` §4.9입니다.
- ADR-0007 §6의 미결 "`next`가 경계 뒤 요청을 스스로 시작하는가"를 닫습니다.

## 2. 맥락

- 확장은 `post`로 입력을 큐에 넣습니다. `when` 값은 `steer`, `followUp`, `next`입니다(`F.extensions.spec`).
- `next`가 유휴 thread에서 turn을 열면 `agent_before_settle`의 `continue`, drive의 `loop.turn`과 기능이 겹칩니다(`L1.tasks.spec` §4.9 A안 단점).
- `aside`는 사용자가 진행 중인 turn을 멈추지 않고 덧붙이는 입력입니다. F에 넣을지(FR-T4)가 열려 있었습니다.

## 3. 결정

1. [결정] `next`는 요청을 만들지 않습니다. 실행 중이면 `continuing: true`인 `stepEnd`에서, 유휴면 다음 `turnStart`에서 배치합니다.
2. [결정] `aside`는 L1 `InputMode`에만 둡니다. `InputSource.type === "user"`만 받고 다른 출처는 `mode_not_supported`입니다.
3. [결정] F `PostWhen`(`steer | followUp | next`)은 그대로 둡니다. FR-T4는 철회합니다.
4. turn을 시작할 수 있는 모드는 `steer`와 `followUp`뿐입니다. `next`·`aside`가 들어와도 유휴 thread는 turn을 열지 않습니다(`L1.tasks.spec` §4.9).

## 4. 결과

### 4.1 좋은 점

- 모델 요청을 만드는 경로가 `continue`와 drive 두 가지로 정리됩니다.
- `next`와 `aside`의 배치 규칙이 같습니다. 차이는 출처뿐입니다.
- F 계약 변경이 없습니다.

### 4.2 감수할 점

- 유휴 thread에 넣은 `next`는 사용자 입력이 올 때까지 머뭅니다. 확장이 즉시 실행을 원하면 drive를 써야 합니다.
- 확장은 `aside`를 쓸 수 없습니다.

## 5. 대안

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| A. `next`가 시작 | 유휴면 turn을 엽니다 | 채택하지 않음 | `continue`, drive와 겹칩니다 |
| 2. `aside`를 F에 | `PostWhen`에 `aside`를 더합니다 | 채택하지 않음 | 확장 쪽 쓰임이 없고 `next`로 같은 동작을 얻습니다 |

## 6. 미결 사항

- [가정] pi `deliverAs: "nextTurn"`이 B안과 같은 뜻이라는 전제는 확인하지 않았습니다(`L1.tasks.spec` §4.9).
