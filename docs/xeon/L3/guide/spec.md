---
id: L3.guide.spec
layer: L3
domain: guide
kind: spec
status: draft
depends_on: [L3.group-sdk.spec, L3.authoring.spec, L2.knowledge.spec, X.operations.spec]
binds: [xeon/packages/group-guide/**]
---

# L3 Fresnel Guide (guide)

모델이 Fresnel의 구조와 쓰는 법을 모를 때 읽는 제품 지식입니다. 모델이 Fresnel 플러그인 형식을 몰라 다른 도구의 `.codex-plugin` 형식을 베껴 만든 일이 계기입니다. 켜고 끄는 단위는 플러그인(그룹)이고, 모델이 읽는 모양은 스킬입니다. 본문은 모델이 `skill_view`로 요청할 때만 문맥에 들어옵니다.

- [결정: 2026-11-13 사용자] 내장 플러그인으로 두고, 기본은 꺼짐이며 개발 모드에서는 항상 켭니다. 플러그인 빌더도 이 내용을 참조할 수 있어야 합니다.
- [결정: 2026-11-13 사용자] 상위 원칙: 시스템 프롬프트와 환경 블록에 줄을 더하지 않습니다. 꺼져 있을 때 문맥 비용은 0입니다.

## 1. 형태

| 항목 | 값 |
|---|---|
| 이름 | `guide`, 표시 이름 "Fresnel Guide", 패키지 `xeon/packages/group-guide`, 설정 키 `ext.guide.enabled` |
| 선언 | 내장(`trust.level: "builtin"`), 루트 L3 플러그인, `group: {}`, `defaultEnabled: false`. 도구와 drive는 없고 훅 `thread.shutdown` 하나(아무 일도 안 함)가 그룹 선언을 채웁니다 |
| 내용 | `xeon/packages/group-guide/skills/<이름>/SKILL.md`와 `references/*.md`. 영어, 모델용으로 다시 쓴 짧은 글입니다. 스펙 문서를 통째로 싣지 않습니다 |
| 켜짐 판정 | 개발 모드(`l3.authoring.devMode`가 참)이거나 `ext.guide.enabled`가 참 |
| 안전 모드 | 싣지 않습니다(`defaultGroups: false`도 같습니다) |

## 2. 스킬 통로

- 호스트(`apps/host/src/assembly/guide.ts`)가 켜짐 판정이 참일 때만 가이드 폴더를 확장 제공 스킬 루트로 `cap-knowledge`의 `extensionSkillRoots`에 알립니다(`L2.knowledge.spec` §4.2.7). 대화가 시작될 때 읽으므로 켠 뒤 새 대화부터 보입니다.
- 꺼져 있으면 빈 목록이라 스킬 인덱스에 아무것도 더하지 않습니다. 켜지면 늘어나는 것은 스킬 이름과 설명뿐입니다.
- 가이드 폴더는 환경 변수 `FRESNEL_GUIDE_SKILLS_DIR`, 릴리즈 자원 폴더의 `guide/skills`, 소스 저장소의 `packages/group-guide/skills` 순으로 찾습니다(`locateGuideSkills`). 릴리즈 번들 설정 `release-bundle.json`의 `guide`가 이 폴더를 아카이브의 `guide/skills`로 싣습니다.

## 3. 플러그인 빌더의 참조

플러그인 빌더(`L3.authoring.spec`)의 도구 `authoring_guide`가 같은 폴더를 `createGuideReader`로 읽어 주제 목록과 본문을 내줍니다. 가이드 그룹이 꺼져 있어도 읽힙니다. 원본은 한 벌이고 복제하지 않습니다. 두 L3 패키지는 서로 import하지 않으므로 호스트가 읽기 구현을 `AuthoringDeps.guide`로 넘깁니다.

## 4. 주제

| 스킬 | 내용 |
|---|---|
| `fresnel-plugin-authoring` | 플러그인 구조(`.fresnel-plugin/plugin.json`), 종류, hook, 도구 등록, 설치 위치, `authoring_*` 흐름 |
| `fresnel-settings-and-safety` | 설정 키와 범위, 권한 모드, 샌드박스, 안전 모드 |
| `fresnel-agent-assets` | 스킬, 메모리, MCP, 예약, 서브에이전트 정의의 쓰는 법과 파일 위치 |
| `fresnel-data-and-diagnostics` | 데이터·로그 위치와 진단 |

내용은 코드와 `docs/xeon` 스펙에서 확인한 사실만 적습니다. 문서의 "없다/미정" 문장은 코드로 확인한 뒤에만 옮깁니다.

## 5. 수용 기준

- G-1. 그룹이 꺼져 있고 개발 모드가 아닐 때 모델 요청에 가이드 스킬이 없습니다.
- G-2. 개발 모드이거나 `ext.guide.enabled`가 참이면 새 대화의 스킬 인덱스에 네 스킬이 있고 `skill_view`로 읽힙니다.
- G-3. 가이드 그룹이 꺼져 있어도 `authoring_guide`가 같은 본문을 돌려줍니다.
