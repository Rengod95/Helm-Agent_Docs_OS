---
id: L3.guide.plan
layer: L3
domain: guide
kind: plan
status: draft
depends_on: [L3.guide.spec, L3.authoring.spec]
binds: [xeon/packages/plugin-guide/**]
---

# L3 Fresnel Guide 구현 계획

대상 스펙: L3.guide.spec. 패키지: `@fresnel/plugin-guide`(`xeon/packages/plugin-guide`).

## 1. 순서

1. 패키지: 매니페스트(`manifest.ts`), 스킬만 내는 플러그인(`group.ts`), 가이드 폴더 찾기와 읽기(`reader.ts`). 시험 `test/reader.test.ts`.
2. 스킬 본문: `skills/<이름>/SKILL.md`와 `references/*.md`. 코드와 스펙에서 확인한 사실만 영어로 짧게 적는다.
3. 호스트: `apps/host/src/assembly/guide.ts`가 켜짐 판정(개발 모드 또는 `ext.guide.enabled`)과 스킬 루트를 `cap-knowledge`에 알린다. 설정 카탈로그에 `ext.guide.enabled`를 올린다.
4. 플러그인 빌더: 도구 `authoring_guide`가 같은 폴더를 읽는다(`AuthoringDeps.guide`).
5. 릴리즈: `release-bundle.json`의 `guide`가 폴더를 아카이브 `guide/skills`로 싣는다.

## 2. 완료 기준

L3.guide.spec §5 수용 기준 G-1~G-3.
