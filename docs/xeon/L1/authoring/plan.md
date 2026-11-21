---
id: L1.authoring.plan
layer: L1
domain: authoring
kind: plan
status: draft
depends_on: [L1.authoring.spec, L3.authoring.plan]
binds: [xeon/packages/core-authoring/**]
---

# L1 제작 코어 구현 계획

대상 스펙: `L1.authoring.spec`. 근거: 사용자 결정 2026-11-18(AGE-51, AGE-60).

## 1. 파일 배치

`xeon/packages/core-authoring/`: `src/index.ts`(공개 진입점), `src/catalog.ts`, `src/scaffold.ts`, `src/templates-dir.ts`, `src/validate.ts`, `src/au-rules.ts`, `src/pack.ts`, `src/conformance.ts`, `src/errors.ts`, `templates/`(single-plugin, inject-plugin, drive-plugin).

## 2. 순서

1. F: 그룹 이름 규칙과 카탈로그 버전을 contracts로 올린다(완료).
2. L1: 위 파일을 `plugin-builder`에서 옮기고 호스트의 제작 포트가 `@fresnel/core-authoring`을 쓰게 한다. 기존 시험은 그대로 `plugin-builder/test`에 두고 코어 함수를 `@fresnel/core-authoring`에서 가져온다(orchestration-sdk 시험 하니스가 필요해서다).
3. L4: 테스트 챗에서 빌더가 프로필·드래프트와 무관하게 뜨게 한다(`L3.authoring.spec` §4의 켜고 끄기 항목).
