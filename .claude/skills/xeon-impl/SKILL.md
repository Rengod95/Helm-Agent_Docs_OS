---
name: xeon-impl
description: xeon/ 워크스페이스에서 코드를 구현하거나 고칠 때 쓴다. 문서 라우팅, 층 의존 규칙, 테스트, 검증 순서를 따르게 한다.
---

# Xeon 구현

1. `cd xeon && bun scripts/docs-route.ts --task implement <고칠 경로>`로 읽을 문서를 받고 모두 읽는다.
2. `docs/xeon/engineering/`의 규칙이 우선한다. 층 순위 F → X → L0 → L1 → L2 → L3 → L4에서 낮은 순위만 import한다. 같은 층 패키지끼리 import하지 않는다.
3. 공개 타입은 `packages/contracts`(F)에 둔다. 패키지 안에서 F 타입을 다시 정의하지 않는다.
4. 각 변경에 단위 테스트를 같은 패키지 `test/`에 둔다(`bun test`). 통합 테스트는 만들지 않는다(예외는 testing 가이드).
5. 끝내기 전에 `just verify`(xeon/)를 돌린다. 종료코드 1은 고치고, 2는 환경 문제로 보고한다. `--no-verify` 금지.
6. 문서와 코드가 다르면 코드를 문서에 맞춘다. 문서가 틀렸으면 고치지 말고 보고한다.
