---
id: L3.suggest.plan
layer: L3
domain: suggest
kind: plan
status: draft
depends_on: [L3.suggest.spec, L2.knowledge.spec, L4.host-service.spec, L4.release.spec]
binds: [xeon/packages/plugin-suggest/**]
---

# L3 제안 플러그인 구현 계획

대상 스펙: L3.suggest.spec. 패키지: `@fresnel/plugin-suggest`(`xeon/packages/plugin-suggest`). 층 L3(P 층 선언), 도메인 `suggest`.

## 1. 작업 순서

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 행 변환과 상태 필터를 F로 옮긴다(`packages/contracts/src/wire-settings/wire/proposal-rows.ts`). cap-knowledge 대기열 어댑터는 F에서 가져다 쓴다 | 완료 |
| 2 | 패키지 뼈대(`package.json`, `tsconfig.json`, `turbo.json`)와 워크스페이스 연결(`bun.lock`의 워크스페이스 항목 두 곳과 `apps/host` 의존) | 완료 |
| 3 | 매니페스트, 메서드 `list`, `count`, 목록 쪽 나누기(`src/queue.ts`), 화면 한 장(`ui/`), 문구(`locales/`) | 완료 |
| 4 | 번들 빌드 스크립트(`scripts/build-plugin.ts`)와 릴리스 설정(`release-bundle.json`, `DEFAULT_PLUGIN_NAMES`) | 완료 |
| 5 | 호스트 wire 게이트(`proposal.list`, `proposal.decide`)와 조립 연결(`assemble.ts`의 `suggestEnabled`) | 완료 |
| 6 | 시험: 패키지 단위(목록, 개수, 매니페스트, 메서드, 번들), 호스트 게이트 단위, 실제 엔진(번들 설치와 미설치), 릴리스 검토 경로 | 완료 |
| 7 | 문서: 이 계획과 spec, HS-79 (5), 릴리스 spec의 번들 목록, L3 README 표, 라우팅 층 목록 | 완료 |

## 2. 검사

- 작업 중: `just check packages/plugin-suggest`, `just check packages/contracts`, `just check packages/cap-knowledge`, `just check apps/host`(시험 파일은 `bun test <파일>`로 좁힌다).
- 고친 범위에 맞춰 `just check-layers`, `just check-ts-rules`, `just knip`, `just terms check`, `just docs-route --check`.
- `just verify`와 CI는 병합 직전에 메인이 맥에서 돌린다. 트랙 리드와 서브에이전트는 돌리지 않는다.

## 3. 열린 일

- 데스크톱 목록을 `ext.suggest.list`로 옮길지는 다음 작업이다(L3.suggest.spec §9).
- 제안 플러그인을 끄면 호스트 wire가 `unavailable`을 준다. 화면의 안내는 데스크톱 작업이 정한다.
