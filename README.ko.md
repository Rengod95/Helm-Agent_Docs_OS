# Fresnel

[English](README.md) | [中文](README.zh.md)

Fresnel(임시 이름)은 대화형 에이전트 런타임입니다. 런타임 전체를 층으로 나눠 배포하고, 사용자는 층마다 플러그인과 플러그인 그룹을 추가하거나 교체합니다. Helm은 기본으로 제공되는 L3 플러그인 그룹입니다.

상태: 출시 전입니다. 데스크톱 앱, CLI, 백그라운드 서비스를 개발 중이며 안정 릴리즈는 아직 없습니다.

## 구성

| 경로 | 내용 |
|------|------|
| `xeon/` | 작업 공간: 엔진, 호스트, CLI, 데스크톱 앱(Bun 위의 TypeScript, Rust Tauri 셸) |
| `docs/xeon/` | 제품 기획, 층별 스펙과 구현 계획, 구속력 있는 엔지니어링 규칙 |
| `packages/agent-docs-init/` | `@helmdocs/init`, Agent Docs OS 설치 도구(런타임과 별개 도구) |

층은 낮은 쪽부터 F(계약), X(확장 체계), L0(플랫폼), L1(코어), L2(기능), L3(플러그인 그룹), L4(앱)입니다. 패키지는 자기보다 낮은 층만 import합니다.

## 시작하기

```bash
cd xeon
mise install      # 고정된 도구 버전
just setup        # bun install --frozen-lockfile
just --list       # 모든 명령. 실행은 전부 just로 합니다
just check <pkg>  # 패키지 하나의 lint, 타입 검사, 시험. 예: just check packages/core-loop
```

먼저 `docs/xeon/engineering/onboarding/guide.md`를 읽고, 작업 규칙은 `xeon/AGENTS.md`를 봅니다. 문서 색인은 `docs/xeon/README.md`입니다.

## 라이선스

MIT, [LICENSE](LICENSE)를 보세요. 릴리즈의 서드파티 고지는 `xeon/scripts/notices.ts`가 만듭니다.
