---
id: xeon.research
layer: meta
domain: research
kind: guide
status: accepted
depends_on: []
binds: []
---

# 조사 원자료

정본 문서가 아니다. 스펙과 계획을 쓸 때 근거로 인용한다. 인용 형식은 `_research/<파일>.md §절`이다.

| 파일 | 내용 |
|---|---|
| `foundation-plan.md` | 승인된 실행 계획(결정, 스택, 배치, 단계). 최우선 근거 |
| `decisions-log.md` | 사용자 결정 기록 |
| `layer-plan-v2.json`, `layer-plan-v2-notes.md` | 층 구성 계획 v2 데이터(하위 층, 구성요소 182개, 출처·단계·L4 설정)와 본문 |
| `ref-synthesis.md`, `refs/*.md` | 레퍼런스 6종(pi, oh-my-pi, pi durable, opencode, Claude Code, Hermes)의 F~L2 조사 |
| `item-catalog.md`, `items-from-*.md` | 층별 항목 카탈로그 188개 |
| `session-storage.md` | 세션 저장 방식 비교(C안 근거) |
| `web-tools.md`, `browser-tools.md` | 웹 검색·fetch·브라우저 도구 조사 |
| `packages.md` | 구성요소별 패키지 채택 판정 |
| `process.md` | 프로세스 구조와 데몬 단계 |
| `secrets.md` | 비밀 관리(SOPS, 참조, 마스킹) 설계 초안 |
| `settings.md` | L4 설정 노출 조사 |
| `l2e.md` | 작업·상호작용 능력 조사 |
| `ext-points.md` | 확장 지점 4연산 근거 |

도메인 하나에만 쓰이는 조사는 그 도메인 디렉터리의 `_research/`에 둔다. 인용 형식은 `<층>/<도메인>/_research/<파일>.md §절`이다.

| 파일 | 내용 |
|---|---|
| `../L4/desktop/_research/state-management.md` | 데스크톱 UI 상태 관리 라이브러리 비교(adr.0010 근거) |

기존 Helm 설계 정본 `docs/design/01~26`도 참고 자료로 인용할 수 있다. 커널·홈서버 데몬 전제가 다르므로 그대로 따르지 않는다.
