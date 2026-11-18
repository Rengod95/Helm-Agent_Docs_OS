---
id: L1.authoring.spec
layer: L1
domain: authoring
kind: spec
status: draft
depends_on: [L3.authoring.spec, F.capabilities.spec, architecture.layers.spec, eng.dependency-rules.guide]
binds: [xeon/packages/core-authoring/**]
---

# L1 제작 코어 (authoring)

패키지: `@fresnel/core-authoring`(`xeon/packages/core-authoring`). 층 L1, 도메인 `authoring`. [결정: 2026-11-18 사용자, AGE-51·AGE-60] 빌더를 둘로 나눈다. 플러그인 만들기의 파일 일(제작 코어)은 엔진의 시스템 모듈이고, 사람과 대화하며 쓰는 빌더(`L3.authoring.spec`)는 그 코어의 공개 API만 쓰는 플러그인이다. 대화하는 빌더까지 코어에 넣고 같은 것을 플러그인으로 또 두지 않는다(같은 동작이 두 군데에 생기면 어긋난다).

## 1. 정하는 것

- 코어가 가진 것: 종류 카탈로그(`KIND_CATALOG`, `kindEntryOf`), 뼈대 만들기(`scaffoldExtension`, 템플릿 세 방식 `templates/`와 `locateTemplateDirs`), 플러그인 폴더 검사(`validateExtensionDir`, AU 규칙 `au-rules.ts`), 구성 검사(`validateCompositionReport`), 묶기(`packExtension`), 종류 카탈로그 적합 시험(`catalogConformance`).
- 코어가 하지 않는 것: 대화, 도구, 단계 머신, 쓰기 범위 가드, 묶기 확인 카드(모두 대화하는 빌더). 호스트 상태(설치된 확장 이름, 검토 제출, 시험 기록, 테스트 런 대화 열기)는 호스트 포트(`apps/host/src/assembly/m4/devkit-port.ts`)가 이 함수들과 이어 준다.
- 지난 턴에 돌려 보기(`runInstalledReplay`)는 group-sdk의 모듈과 하니스가 필요하다. L1은 P를 import할 수 없어(DR-01) 이 함수는 `plugin-builder`에 남고, 호스트가 실행기(`ReplayRunner`, `assembly/m4/replay-run.ts`)로 주입한다. 호스트는 빌더 플러그인의 켜짐과 무관하게 이 실행기를 부른다 [제안: group-sdk가 코어로 내려오면 코어로 옮긴다].

## 2. 시스템 모듈이라는 것

- 코어는 플러그인이 아니다. 프로필·켜짐 상태가 없고 끌 수 없다. 드래프트 검사, 리뷰 제출, 테스트 런, 지난 턴에 돌려 보기는 빌더 플러그인이 꺼져 있어도 같은 호스트 포트로 돈다(화면의 wire `ext.*`도 같은 포트다).
- 공개 API는 `fresnel.devkit` 서비스 계약(`DevkitService`, `contracts/services/devkit.ts`)이다. 대화하는 빌더는 이 계약만 쓴다. 패키지 `@fresnel/core-authoring`의 export는 호스트(조립 루트)용이다.
- 이름 규칙의 정본(`GROUP_NAME_PATTERN`, `RESERVED_GROUP_NAMES`, `checkGroupName`)과 카탈로그 버전(`KIND_CATALOG_VERSION`)은 contracts에 있다(`F.capabilities.spec`). group-sdk는 이름 규칙을 다시 내보낸다.

## 3. 의존

- `@fresnel/contracts`, `@fresnel/ext-host`(묶기가 쓰는 SDK 모듈 지정자)뿐이다. 새 의존 예외를 만들지 않는다.
- 플러그인(`plugin-builder`)이 `core-*`를 import하는 것은 DR-15가 소스에서 막는다(`just check-layers`). 시험 파일은 면제라 `plugin-builder`의 시험이 코어 함수를 직접 부른다. `authoring.core-boundary.test.ts`가 소스 쪽을 값으로 고정한다.
- [결정: 구현] 종류 카탈로그 항목의 `template` 값 `plugin-builder/templates/single-plugin`은 저장·와이어 값이라 그대로 둔다(실제 템플릿은 `core-authoring/templates`에 있다). 값을 맞추는 일은 [미결]이다.
