---
name: xeon-docs
description: Xeon 문서(docs/xeon)를 쓰거나 고칠 때 쓴다. 디렉터리 규칙, 프런트매터, 문체, 라우팅을 따르게 한다.
---

# Xeon 문서 작성

1. `docs/xeon/README.md`, `docs/xeon/_templates/README.md`, `docs/xeon/_routing/README.md`를 읽는다.
2. 경로는 `docs/xeon/<층>/<도메인>/<종류>.md`다. 층 개요는 `<층>/README.md`다.
3. 프런트매터의 `id`, `depends_on`, `binds`를 `_routing/routes.yaml`의 `layout`과 `manifest`에 맞춘다.
4. 근거는 `docs/xeon/_research/`(특히 `foundation-plan.md`, `layer-plan-v2.json`)와 소스 경로로 단다.
5. 이름(타입, 패키지, 이벤트, 설정 키)은 F 문서가 정한 문자열을 쓴다. F에 없는 이름을 새로 만들면 `[제안]`으로 표시하고 문서 끝 미결 사항에 적는다.
6. 문서의 코드 예제도 `docs/xeon/engineering/typescript/guide.md` 1.3절 체크리스트를 지킨다. 좋은 예에 `as` 단언, `!`, `any`, 예상 가능한 실패의 `throw`·`Bug`, 오류를 삼키는 `catch`를 쓰지 않는다. 나쁜 예에는 실패하는 검사 이름을 주석으로 단다.
7. 끝나면 `cd xeon && bun scripts/docs-route.ts --check`로 링크를 확인한다(스크립트가 있을 때).
