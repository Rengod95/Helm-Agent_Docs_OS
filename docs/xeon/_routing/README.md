---
id: xeon.routing
layer: meta
domain: routing
kind: guide
status: draft
depends_on: [xeon.readme]
binds: []
---

# 문서 라우팅

작업마다 읽어야 할 문서를 정해진 규칙으로 고른다. 사람과 에이전트가 같은 규칙을 쓴다.

## 규칙

1. 작업 유형 묶음을 고른다(`routes.yaml`의 `by_task`).
   - 코드를 쓰면 `implement`를 고른다.
   - 저장·이벤트를 건드리면 `data`를 더하고, 확장 지점을 건드리면 `extension`을 더한다.
   - 문서를 쓰면 `docs`, 정합성을 검토하면 `review`를 고른다.
2. 고칠 코드 경로와 `binds`가 맞는 문서를 더한다. 보통 해당 도메인의 `spec.md`와 `plan.md`이고, 층 `README.md`도 함께 든다.
3. 2에서 고른 문서의 `depends_on`을 한 단계 펼친다.

## 사용법

```bash
cd xeon
bun scripts/docs-route.ts --task implement packages/core-loop/src/turn.ts
bun scripts/docs-route.ts --task docs L1/loop
```

출력은 읽을 문서 경로 목록이다. 작업자 에이전트 프롬프트는 이 목록으로 시작한다.

## 작업자 에이전트에게 주는 머리말

```
작업 전에 다음 문서를 읽는다: <docs-route 출력>
문서와 코드가 다르면 코드를 문서에 맞춘다. 문서가 틀렸다고 판단되면 고치지 말고 [미결]로 보고한다.
```
